'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const amqp = require('amqplib');
const { createClient, downloadObjectToFile, writeBufferToTemp, cleanup } = require('./storage');
const { InferenceClient } = require('./inference-client');
const { acquire } = require('./admission');
const { verifyModelDirectory } = require('./model-checksum');

const REQUESTED = 'transcription.requested';
const PROCESSING = 'transcription.processing';
const COMPLETED = 'transcription.completed';
const FAILED = 'transcription.failed';
const READY_FILE = '/tmp/transcription-worker.ready';
const PERMANENT_ERRORS = new Set([
  'CANCELLED', 'INVALID_AUDIO', 'NO_SPEECH', 'UNSUPPORTED_AUDIO', 'MODEL_MISSING',
  'MODEL_CHECKSUM_MISMATCH', 'FFMPEG_MISSING', 'QUEUE_MODE_MISMATCH',
  'AUDIO_TOO_LONG',
  'DICTATION_AUDIO_EXPIRED',
]);

function normalizeJob(value, maxAudioBytes = 25 * 1024 * 1024) {
  if (!value || typeof value !== 'object') throw new Error('Mensagem de transcrição inválida.');
  const jobId = String(value.jobId || '').trim();
  const mode = value.mode === 'dictation' ? 'dictation' : 'transcription';
  const source = value.source && typeof value.source === 'object' ? value.source : {};
  const sourceKey = String(source.key || '').trim();
  const sourceMimeType = String(source.mimeType || '').split(';', 1)[0].trim().toLowerCase();
  const normalizedMimeType = sourceMimeType === 'video/webm' && /\.webm$/i.test(sourceKey)
    ? 'audio/webm'
    : sourceMimeType;
  if (!jobId || jobId.length > 128) throw new Error('jobId inválido.');
  if (!sourceKey || !normalizedMimeType.startsWith('audio/')) throw new Error('Origem de áudio inválida.');

  let inlineAudio = null;
  if (value.inlineAudio !== undefined && value.inlineAudio !== null) {
    if (mode !== 'dictation') throw new Error('Áudio inline é reservado ao ditado.');
    const encoded = String(value.inlineAudio);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error('Áudio inline inválido.');
    }
    if (encoded.length > Math.ceil(maxAudioBytes / 3) * 4 + 4) throw new Error('Áudio inline excede o limite configurado.');
    inlineAudio = Buffer.from(encoded, 'base64');
    if (!inlineAudio.length || inlineAudio.length > maxAudioBytes) throw new Error('Áudio inline excede o limite configurado.');
  }
  if (mode === 'dictation' && !inlineAudio) throw new Error('Ditado sem áudio inline.');

  const attempts = Number.isFinite(Number(value.attempts)) ? Math.max(1, Math.floor(Number(value.attempts))) : 1;
  return {
    jobId,
    mode,
    attempts,
    messageId: value.messageId ? String(value.messageId) : null,
    instanceId: value.instanceId ? String(value.instanceId) : null,
    sourceKey,
    sourceMimeType: normalizedMimeType,
    language: value.language ? String(value.language) : null,
    model: value.model ? String(value.model) : null,
    inlineAudio,
    queuedAt: typeof value.queuedAt === 'number' && Number.isFinite(value.queuedAt)
      ? value.queuedAt
      : Number.isFinite(Date.parse(value.queuedAt)) ? Date.parse(value.queuedAt) : null,
  };
}

function probeFfmpeg() {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error('FFmpeg não está disponível no worker.')));
  });
}

class TranscriptionWorker {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.createInferenceClient = dependencies.createInferenceClient || ((value) => new InferenceClient(value, {
      restartOnFailure: false,
    }));
    this.probeFfmpeg = dependencies.probeFfmpeg || probeFfmpeg;
    this.verifyModel = dependencies.verifyModel || verifyModelDirectory;
    this.acquireSlot = dependencies.acquireSlot || acquire;
    this.downloadAudio = dependencies.downloadAudio || ((job) => job.inlineAudio
      ? writeBufferToTemp(job.inlineAudio, job.sourceMimeType, this.config.maxAudioBytes)
      : downloadObjectToFile(this.client, this.config.s3.bucket, job.sourceKey,
        job.sourceMimeType, this.config.maxAudioBytes));
    this.connection = null;
    this.channel = null;
    this.controlChannel = null;
    this.settledMessages = new WeakSet();
    this.client = null;
    this.provider = null;
    this.stopping = false;
    this.reconnectTimer = null;
    this.cancelledJobs = new Set();
    this.activeTask = null;
    this.workerId = String(process.env.HOSTNAME || process.pid).slice(0, 128);
  }

  async start() {
    fs.rmSync(READY_FILE, { force: true });
    if (!this.config.enabled) {
      console.log('Speech worker desabilitado; nenhum modelo ou consumidor iniciado.');
      return;
    }
    this.client = createClient(this.config.s3);
    await this.probeFfmpeg();
    while (!this.stopping) {
      await this.waitForPersistentModel();
      if (this.stopping) return;
      try {
        if (this.config.local.modelPath) await this.verifyModel(this.config.local.modelPath);
        break;
      } catch (error) {
        console.error('Modelo de voz inválido; aguardando reparo antes de atender a fila:', error.code || error.message);
        await this.waitForModelRepair();
      }
    }
    if (this.stopping) return;
    // The admission lease must be acquired before native model allocation.
    // A consumer can be ready while its inference thread is absent.
    this.logMemory('model_verified');
    await this.connect().catch((error) => {
      console.error('RabbitMQ indisponível no início do worker:', error.message);
      void this.connection?.close().catch(() => {});
      this.scheduleReconnect();
    });
    this.idleMetrics = setInterval(() => {
      if (!this.activeTask) {
        this.logMemory('idle');
        this.provider?.sampleMemory();
      }
    }, 60_000);
    this.idleMetrics.unref?.();
  }

  logMemory(phase, job = null, extra = {}) {
    const { rss, heapUsed, heapTotal, external, arrayBuffers } = process.memoryUsage();
    console.log(JSON.stringify({ event: 'speech_memory', phase, mode: this.config.mode,
      workerId: this.workerId, jobId: job?.jobId, attempt: job?.attempts,
      activeJobs: this.activeTask ? 1 : 0,
      rss, heapUsed, heapTotal, external, arrayBuffers, ...extra }));
  }

  async loadProvider(job) {
    if (this.stopping) throw Object.assign(new Error('Worker em encerramento.'), { code: 'WORKER_STOPPING' });
    this.logMemory('before_model', job);
    const provider = this.createInferenceClient(this.config);
    this.provider = provider;
    let timeout;
    try {
      await Promise.race([
        provider.warmup(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(Object.assign(new Error('O modelo não ficou pronto dentro do prazo.'), {
            code: 'MODEL_WARMUP_TIMEOUT', retryable: true,
          })), (this.config.modelWarmupTimeoutSeconds || 300) * 1000);
        }),
      ]);
      if (this.stopping || this.provider !== provider) {
        throw Object.assign(new Error('Worker em encerramento.'), { code: 'WORKER_STOPPING' });
      }
      this.logMemory('after_model', job);
      return provider;
    } catch (error) {
      if (this.provider === provider) this.provider = null;
      await this.terminateProvider(provider);
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async unloadProvider(job) {
    const provider = this.provider;
    this.provider = null;
    if (!provider) return;
    await this.terminateProvider(provider);
    this.logMemory('model_unloaded', job);
  }

  async terminateProvider(provider) {
    let timeout;
    try {
      await Promise.race([
        provider.stop(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('A thread nativa não encerrou em cinco segundos.')), 5000);
        }),
      ]);
    } catch (error) {
      // A stuck native thread cannot keep its model while another process
      // acquires the slot. Broker redelivery recovers any unacknowledged job.
      console.error('Falha fatal ao descarregar o modelo; encerrando somente o worker:', error.message);
      process.exit(1);
    } finally {
      clearTimeout(timeout);
    }
  }

  async waitForPersistentModel() {
    const modelPath = String(this.config.local.modelPath || '').trim();
    if (!modelPath) return;
    const manifestPath = path.join(path.resolve(modelPath), '.speech-model-checksums.json');
    let lastNotice = 0;
    while (!this.stopping) {
      if (fs.existsSync(manifestPath)) return;
      if (Date.now() - lastNotice >= 30000) {
        console.log(`Modelo local ausente em ${modelPath}; aguardando a API concluir o provisionamento automático.`);
        lastNotice = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  async waitForModelRepair() {
    const manifest = path.join(path.resolve(this.config.local.modelPath || '/models'), '.speech-model-checksums.json');
    const revision = () => {
      try { const stat = fs.statSync(manifest); return `${stat.mtimeMs}:${stat.size}`; } catch { return null; }
    };
    const previous = revision();
    while (!this.stopping) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      if (revision() !== previous) return;
    }
  }

  async connect() {
    if (this.stopping) return;
    const connection = await amqp.connect(this.config.rabbitmq.uri, { timeout: 5000, keepAlive: true });
    this.connection = connection;
    connection.on('error', (error) => console.error('RabbitMQ speech error:', error.message));
    connection.on('close', () => {
      if (this.connection !== connection) return;
      this.channel = null;
      this.controlChannel = null;
      this.connection = null;
      fs.rmSync(READY_FILE, { force: true });
      this.scheduleReconnect();
    });

    const channel = await connection.createConfirmChannel();
    this.channel = channel;
    channel.on('error', (error) => console.error('RabbitMQ speech channel error:', error.message));
    const onChannelClose = (closed) => {
      if (this.connection !== connection || (this.channel !== closed && this.controlChannel !== closed)) return;
      this.channel = null;
      this.controlChannel = null;
      this.connection = null;
      fs.rmSync(READY_FILE, { force: true });
      void connection.close().catch(() => {});
      this.scheduleReconnect();
    };
    channel.on('close', () => onChannelClose(channel));

    await channel.assertExchange(this.config.rabbitmq.exchange, 'topic', { durable: true });
    await channel.assertQueue(this.config.queue, {
      durable: true,
      arguments: {
        'x-queue-type': 'quorum',
        ...(this.config.mode === 'dictation' ? { 'x-message-ttl': this.config.dictationAudioRetentionMs } : {}),
      },
    });
    await channel.bindQueue(this.config.queue, this.config.rabbitmq.exchange, this.config.requestRoutingKey);

    this.config.controlQueue = this.config.queue + '.control';
    this.config.retryQueue = this.config.queue + '.retry';
    this.config.deadLetterQueue = this.config.queue + '.dead-letter';
    await channel.assertQueue(this.config.controlQueue, {
      durable: true,
      arguments: { 'x-queue-type': 'quorum' },
    });
    await channel.bindQueue(this.config.controlQueue, this.config.rabbitmq.exchange, this.config.cancelRoutingKey);
    await channel.assertQueue(this.config.retryQueue, {
      durable: true,
      arguments: {
        'x-queue-type': 'quorum',
        'x-dead-letter-exchange': this.config.rabbitmq.exchange,
        'x-dead-letter-routing-key': this.config.requestRoutingKey,
      },
    });
    await channel.assertQueue(this.config.deadLetterQueue, {
      durable: true,
      arguments: { 'x-queue-type': 'quorum' },
    });
    // A busy job channel has prefetch=1. Keep cancellation on another channel
    // so its delivery cannot wait for inference to finish.
    const controlChannel = await connection.createChannel();
    if (this.connection !== connection || this.channel !== channel) {
      await controlChannel.close().catch(() => {});
      return;
    }
    this.controlChannel = controlChannel;
    controlChannel.on('error', (error) => console.error('RabbitMQ speech control channel error:', error.message));
    controlChannel.on('close', () => onChannelClose(controlChannel));
    const broadcastQueue = await controlChannel.assertQueue('', { exclusive: true, autoDelete: true });
    await controlChannel.bindQueue(broadcastQueue.queue, this.config.rabbitmq.exchange, this.config.cancelRoutingKey);
    await controlChannel.prefetch(10);
    await controlChannel.consume(broadcastQueue.queue, (message) => {
      if (message) this.handleControl(message, controlChannel);
    }, { noAck: false });
    // Drain cancellation messages left in the old shared queue during rolling
    // upgrades; each live replica also receives the broadcast above.
    await controlChannel.consume(this.config.controlQueue, (message) => {
      if (message) this.handleControl(message, controlChannel);
    }, { noAck: false });
    await channel.prefetch(this.config.concurrency);
    const consumer = await channel.consume(this.config.queue, (message) => {
      if (!message) return;
      if (this.stopping) {
        this.negativeAcknowledge(channel, message, true);
        return;
      }
      const task = this.handle(message, channel);
      this.activeTask = task;
      void task.finally(() => { if (this.activeTask === task) this.activeTask = null; }).catch((error) => {
        console.error('Falha inesperada no job de voz:', error.message);
      });
    }, { noAck: false });
    this.consumerTag = consumer.consumerTag;
    if (this.channel !== channel || this.controlChannel !== controlChannel) return;
    fs.writeFileSync(READY_FILE, 'ready');
    console.log(`Speech ${this.config.mode} worker pronto na fila ${this.config.queue}.`);
  }

  scheduleReconnect() {
    if (this.stopping || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        console.error('Falha ao reconectar o worker:', error.message);
        this.scheduleReconnect();
      });
    }, 5000);
  }

  acknowledge(channel, message) {
    if (!channel || (channel !== this.channel && channel !== this.controlChannel) || !message || typeof message !== 'object') return false;
    this.settledMessages ||= new WeakSet();
    if (this.settledMessages.has(message)) return false;
    try {
      channel.ack(message);
      this.settledMessages.add(message);
      return true;
    } catch (error) {
      console.error('Não foi possível confirmar mensagem de voz:', error.message);
      void Promise.resolve(channel.close?.()).catch(() => {});
      return false;
    }
  }

  negativeAcknowledge(channel, message, requeue) {
    if (!channel || channel !== this.channel || !message || typeof message !== 'object') return false;
    this.settledMessages ||= new WeakSet();
    if (this.settledMessages.has(message)) return false;
    try {
      channel.nack(message, false, requeue);
      this.settledMessages.add(message);
      return true;
    } catch (error) {
      console.error('Não foi possível devolver mensagem de voz à fila:', error.message);
      void Promise.resolve(channel.close?.()).catch(() => {});
      return false;
    }
  }

  handleControl(message, channel = this.controlChannel) {
    if (!channel || channel !== this.controlChannel) return;
    try {
      const payload = JSON.parse(message.content.toString('utf8'));
      const jobId = String(payload.jobId || '').trim();
      if (jobId && jobId.length <= 128) {
        this.cancelledJobs.add(jobId);
        if (this.cancelledJobs.size > 1024) this.cancelledJobs.delete(this.cancelledJobs.values().next().value);
        if (this.activeJobId === jobId) this.provider?.cancel();
      }
      this.acknowledge(channel, message);
    } catch (error) {
      console.error('Controle de ditado inválido:', error.message);
      this.acknowledge(channel, message);
    }
  }

  async publish(status, payload, channel = this.channel) {
    const prefix = payload.mode === 'dictation' ? 'speech.dictation.' : 'transcription.';
    const routingKey = prefix + status;
    const message = Buffer.from(JSON.stringify({
      ...payload,
      workerId: this.workerId,
      status,
      mode: payload.mode || this.config.mode,
      heartbeatAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    if (!channel || channel !== this.channel) throw new Error('RabbitMQ speech channel indisponível.');
    await new Promise((resolve, reject) => {
      channel.publish(
        this.config.rabbitmq.exchange,
        routingKey,
        message,
        { persistent: true, contentType: 'application/json', messageId: payload.jobId },
        (error) => error ? reject(error) : resolve(),
      );
    });
  }

  async publishDeadLetter(job, error, channel = this.channel) {
    if (!channel || channel !== this.channel) throw new Error('RabbitMQ speech channel indisponível.');
    const body = Buffer.from(JSON.stringify({
      jobId: job.jobId,
      mode: job.mode,
      attempts: job.attempts,
      errorCode: String(error?.code || 'TRANSCRIPTION_FAILED').slice(0, 64),
      failedAt: new Date().toISOString(),
    }));
    await new Promise((resolve, reject) => {
      channel.sendToQueue(
        this.config.deadLetterQueue,
        body,
        { persistent: true, contentType: 'application/json', messageId: job.jobId },
        (cause) => cause ? reject(cause) : resolve(),
      );
    });
  }

  async scheduleRetry(job, error, channel = this.channel) {
    if (!channel || channel !== this.channel) throw new Error('RabbitMQ speech channel indisponível.');
    const retryDelays = [30000, 120000, 600000];
    const delay = retryDelays[Math.max(0, job.attempts - 1)] || retryDelays[retryDelays.length - 1];
    const next = {
      jobId: job.jobId, mode: job.mode, messageId: job.messageId, instanceId: job.instanceId,
      source: { key: job.sourceKey, mimeType: job.sourceMimeType },
      language: job.language, model: job.model, attempts: job.attempts + 1,
      queuedAt: job.queuedAt ? new Date(job.queuedAt).toISOString() : undefined,
      ...(job.inlineAudio ? { inlineAudio: job.inlineAudio.toString('base64') } : {}),
    };
    const body = Buffer.from(JSON.stringify(next));
    await new Promise((resolve, reject) => {
      channel.sendToQueue(
        this.config.retryQueue,
        body,
        {
          persistent: true,
          expiration: String(delay),
          contentType: 'application/json',
          messageId: job.jobId,
        },
        (cause) => cause ? reject(cause) : resolve(),
      );
    });
    await this.publish('processing', {
      jobId: job.jobId,
      mode: job.mode,
      attempts: job.attempts,
      messageId: job.messageId,
      instanceId: job.instanceId,
      stage: 'retrying',
      progressPercent: 0,
      processedDurationMs: 0,
      retryInMs: delay,
      errorCode: String(error?.code || 'TEMPORARY_FAILURE').slice(0, 64),
    }, channel);
  }

  async handle(message, channel = this.channel) {
    if (!channel || channel !== this.channel) return;
    let job;
    let raw;
    try {
      raw = JSON.parse(message.content.toString('utf8'));
      job = normalizeJob(raw, this.config.maxAudioBytes);
    } catch (error) {
      const jobId = typeof raw?.jobId === 'string' && raw.jobId.length <= 128 ? raw.jobId.trim() : '';
      if (jobId) {
        const rejected = { jobId, mode: this.config.mode,
          attempts: Number.isFinite(Number(raw.attempts)) ? Math.max(1, Math.floor(Number(raw.attempts))) : 1 };
        try {
          await this.publish('failed', { ...rejected, errorCode: 'INVALID_JOB',
            errorMessage: 'A mensagem da fila contém áudio ou metadados inválidos.' }, channel);
          await this.publishDeadLetter(rejected, { code: 'INVALID_JOB' }, channel);
        } catch (cause) {
          console.error('Falha ao registrar job inválido:', cause.message);
          this.negativeAcknowledge(channel, message, true);
          return;
        }
      } else {
        console.error('Mensagem de áudio sem identificador válido descartada:', error.message);
      }
      this.acknowledge(channel, message);
      return;
    }
    if (job.mode !== this.config.mode) {
      const error = Object.assign(new Error('O job chegou a uma fila de finalidade diferente.'), { code: 'QUEUE_MODE_MISMATCH' });
      try { await this.publishDeadLetter(job, error, channel); } catch {}
      this.acknowledge(channel, message);
      return;
    }
    const deliveryCount = Number(message.properties?.headers?.['x-delivery-count'] || 0);
    if (job.attempts + deliveryCount > this.config.maxAttempts) {
      const error = { code: 'WORKER_RESTART_LIMIT' };
      try {
        await this.publish('failed', { jobId: job.jobId, mode: job.mode, attempts: job.attempts,
          errorCode: error.code, errorMessage: 'O job excedeu o limite de entregas após interrupções do worker.' }, channel);
        await this.publishDeadLetter(job, error, channel);
        this.acknowledge(channel, message);
      } catch (cause) {
        console.error('Falha ao registrar limite de reinícios do job:', cause.message);
        this.negativeAcknowledge(channel, message, true);
      }
      return;
    }

    let downloaded = null;
    let lease = null;
    let peakRss = 0;
    const startedAt = Date.now();
    let heartbeat = null;
    const state = { stage: 'waiting_for_capacity', progressPercent: 0, processedDurationMs: 0, partialText: '' };
    const isCancelled = () => this.cancelledJobs.has(job.jobId) || channel !== this.channel;
    const isExpired = () => job.mode === 'dictation' && job.queuedAt !== null
      && Date.now() - job.queuedAt >= this.config.dictationAudioRetentionMs;
    const publishProgress = (progress = {}) => {
      Object.assign(state, progress);
      return this.publish('processing', {
        jobId: job.jobId,
        mode: job.mode,
        attempts: job.attempts,
        messageId: job.messageId,
        instanceId: job.instanceId,
        ...state,
      }, channel);
    };

    try {
      this.activeJobId = job.jobId;
      this.logMemory('job_received', job, { encodedBytes: message.content.length, deliveryCount });
      await publishProgress();
      heartbeat = setInterval(() => {
        if (isCancelled() || this.stopping) return;
        void publishProgress().catch((error) => console.error('Heartbeat de voz não publicado:', error.message));
      }, this.config.heartbeatIntervalSeconds * 1000);
      heartbeat.unref?.();
      lease = await this.acquireSlot(this.config, () => isCancelled() || this.stopping || isExpired(), () => {
        console.error('A reserva global de inferência foi perdida; devolvendo o job à fila.', job.jobId);
        if (this.stopping) return;
        this.stopping = true;
        this.provider?.cancel();
        void channel.close().catch(() => {});
        void this.unloadProvider(job).catch(() => {}).then(async () => {
          await this.activeTask?.catch(() => {});
          process.exit(1);
        });
      });
      if (isExpired()) throw Object.assign(new Error('O áudio do ditado expirou enquanto aguardava capacidade.'), {
        code: 'DICTATION_AUDIO_EXPIRED', retryable: false,
      });
      this.logMemory('admitted', job, { slot: lease.slot });
      const metrics = setInterval(() => {
        const rss = process.memoryUsage().rss;
        peakRss = Math.max(peakRss, rss);
        this.logMemory('job_running', job, { slot: lease.slot, peakRss });
      }, 5000);
      metrics.unref?.();
      try {
      await publishProgress({ stage: 'preparing', progressPercent: 2 });

      if (isCancelled()) throw Object.assign(new Error('O processamento foi cancelado.'), { code: 'CANCELLED', retryable: false });
      await publishProgress({ stage: job.inlineAudio ? 'normalizing' : 'downloading', progressPercent: 5 });
      downloaded = await this.downloadAudio(job);
      if (isCancelled()) throw Object.assign(new Error('O processamento foi cancelado.'), { code: 'CANCELLED', retryable: false });

      await publishProgress({ stage: 'loading_model', progressPercent: 8 });
      const provider = await this.loadProvider(job);
      if (isExpired()) throw Object.assign(new Error('O áudio do ditado expirou durante a preparação do modelo.'), {
        code: 'DICTATION_AUDIO_EXPIRED', retryable: false,
      });
      if (isCancelled()) throw Object.assign(new Error('O processamento foi cancelado.'), { code: 'CANCELLED', retryable: false });
      const result = await provider.transcribe(downloaded.filePath, {
        language: job.language,
        model: job.model,
        mode: job.mode,
        jobId: job.jobId,
        attempts: job.attempts,
        isCancelled,
        onProgress: publishProgress,
      });
      if (isCancelled()) throw Object.assign(new Error('O processamento foi cancelado.'), { code: 'CANCELLED', retryable: false });
      await publishProgress({ stage: 'finalizing', progressPercent: 98, processedDurationMs: result.durationMs });
      await this.publish('completed', {
        jobId: job.jobId,
        mode: job.mode,
        attempts: job.attempts,
        messageId: job.messageId,
        instanceId: job.instanceId,
        provider: this.config.provider,
        model: job.model || this.config.local.model,
        ...result,
      }, channel);
      this.acknowledge(channel, message);
      } finally { clearInterval(metrics); }
    } catch (error) {
      if (channel !== this.channel) return;
      if (this.stopping) {
        this.negativeAcknowledge(channel, message, true);
        return;
      }
      const code = String(isExpired() ? 'DICTATION_AUDIO_EXPIRED' : error?.code || 'TRANSCRIPTION_FAILED').slice(0, 64);
      if (code === 'CANCELLED' || isCancelled()) {
        try {
          await this.publish('cancelled', {
            jobId: job.jobId,
            mode: job.mode,
            attempts: job.attempts,
            messageId: job.messageId,
            instanceId: job.instanceId,
          }, channel);
          this.acknowledge(channel, message);
        } catch {
          this.negativeAcknowledge(channel, message, true);
        }
      } else if (!PERMANENT_ERRORS.has(code) && job.attempts < this.config.maxAttempts) {
        try {
          await this.scheduleRetry(job, error, channel);
          this.acknowledge(channel, message);
        } catch (retryError) {
          console.error('Não foi possível agendar retry de voz:', retryError.message);
          this.negativeAcknowledge(channel, message, true);
        }
      } else {
        const safeMessage = String(error?.message || error).slice(0, 2000);
        console.error('Processamento de voz falhou:', code, safeMessage);
        try {
          await this.publish('failed', {
            jobId: job.jobId,
            mode: job.mode,
            attempts: job.attempts,
            messageId: job.messageId,
            instanceId: job.instanceId,
            provider: this.config.provider,
            model: job.model || this.config.local.model,
            errorCode: code,
            errorMessage: safeMessage,
          }, channel);
          await this.publishDeadLetter(job, { ...error, code }, channel);
          this.acknowledge(channel, message);
        } catch (publishError) {
          console.error('Não foi possível persistir a falha do áudio:', publishError.message);
          this.negativeAcknowledge(channel, message, true);
        }
      }
    } finally {
      this.activeJobId = null;
      if (heartbeat) clearInterval(heartbeat);
      try {
        if (downloaded) await cleanup(downloaded.directory);
      } finally {
        this.cancelledJobs.delete(job.jobId);
        // Keep the distributed slot until the model thread has actually exited.
        try {
          await this.unloadProvider(job);
        } finally {
          await lease?.release();
        }
      }
      this.logMemory('job_settled', job, { elapsedMs: Date.now() - startedAt, peakRss });
    }
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopWorker();
    return this.stopPromise;
  }

  async stopWorker() {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.idleMetrics) clearInterval(this.idleMetrics);
    fs.rmSync(READY_FILE, { force: true });
    if (this.channel && this.consumerTag) await this.channel.cancel(this.consumerTag).catch(() => {});
    if (this.activeTask) {
      let timeout;
      const settled = await Promise.race([
        this.activeTask.then(() => true, () => true),
        new Promise((resolve) => { timeout = setTimeout(() => resolve(false), (this.config.shutdownGraceSeconds || 90) * 1000); }),
      ]);
      clearTimeout(timeout);
      if (!settled) {
        this.provider?.cancel();
        await this.unloadProvider();
        await Promise.race([this.activeTask.catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5000))]);
      }
    }
    await this.unloadProvider();
    await this.controlChannel?.close().catch(() => {});
    await this.channel?.close().catch(() => {});
    await this.connection?.close().catch(() => {});
  }
}

module.exports = {
  TranscriptionWorker,
  normalizeJob,
  REQUESTED,
  PROCESSING,
  COMPLETED,
  FAILED,
};
