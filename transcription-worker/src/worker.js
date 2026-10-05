'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const amqp = require('amqplib');
const { createClient, downloadObjectToFile, writeBufferToTemp, cleanup } = require('./storage');
const { createProvider } = require('./provider');

const REQUESTED = 'transcription.requested';
const PROCESSING = 'transcription.processing';
const COMPLETED = 'transcription.completed';
const FAILED = 'transcription.failed';
const READY_FILE = '/tmp/transcription-worker.ready';
const PERMANENT_ERRORS = new Set([
  'CANCELLED', 'INVALID_AUDIO', 'NO_SPEECH', 'UNSUPPORTED_AUDIO', 'MODEL_MISSING',
  'MODEL_CHECKSUM_MISMATCH', 'FFMPEG_MISSING', 'QUEUE_MODE_MISMATCH',
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
  constructor(config) {
    this.config = config;
    this.connection = null;
    this.channel = null;
    this.settledMessages = new WeakSet();
    this.client = createClient(config.s3);
    this.provider = createProvider(config);
    this.stopping = false;
    this.reconnectTimer = null;
    this.cancelledJobs = new Set();
  }

  async start() {
    fs.rmSync(READY_FILE, { force: true });
    if (!this.config.enabled) {
      fs.writeFileSync(READY_FILE, 'disabled');
      console.log('Speech worker desabilitado; aguardando ativação por ambiente.');
      await new Promise(() => {});
      return;
    }
    await probeFfmpeg();
    await this.waitForPersistentModel();
    if (this.stopping) return;
    await this.provider.warmup();
    await this.connect();
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

  async connect() {
    if (this.stopping) return;
    const connection = await amqp.connect(this.config.rabbitmq.uri);
    this.connection = connection;
    connection.on('error', (error) => console.error('RabbitMQ speech error:', error.message));
    connection.on('close', () => {
      if (this.connection !== connection) return;
      this.channel = null;
      this.connection = null;
      fs.rmSync(READY_FILE, { force: true });
      this.scheduleReconnect();
    });

    const channel = await connection.createConfirmChannel();
    this.channel = channel;
    channel.on('error', (error) => console.error('RabbitMQ speech channel error:', error.message));
    channel.on('close', () => {
      if (this.channel !== channel || this.connection !== connection) return;
      this.channel = null;
      this.connection = null;
      fs.rmSync(READY_FILE, { force: true });
      void connection.close().catch(() => {});
      this.scheduleReconnect();
    });

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
    await channel.prefetch(this.config.concurrency);
    await channel.consume(this.config.controlQueue, (message) => {
      if (message) this.handleControl(message, channel);
    }, { noAck: false });
    await channel.consume(this.config.queue, (message) => {
      if (message) void this.handle(message, channel);
    }, { noAck: false });
    if (this.channel !== channel) return;
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
    if (!channel || channel !== this.channel || !message || typeof message !== 'object') return false;
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

  handleControl(message, channel = this.channel) {
    if (!channel || channel !== this.channel) return;
    try {
      const payload = JSON.parse(message.content.toString('utf8'));
      const jobId = String(payload.jobId || '').trim();
      if (jobId && jobId.length <= 128) this.cancelledJobs.add(jobId);
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
    const next = { ...job, attempts: job.attempts + 1, inlineAudio: job.inlineAudio?.toString('base64') || undefined };
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
    try {
      job = normalizeJob(JSON.parse(message.content.toString('utf8')), this.config.maxAudioBytes);
    } catch (error) {
      console.error('Mensagem de áudio descartada:', error.message);
      this.acknowledge(channel, message);
      return;
    }
    if (job.mode !== this.config.mode) {
      const error = Object.assign(new Error('O job chegou a uma fila de finalidade diferente.'), { code: 'QUEUE_MODE_MISMATCH' });
      try { await this.publishDeadLetter(job, error, channel); } catch {}
      this.acknowledge(channel, message);
      return;
    }

    let downloaded = null;
    let heartbeat = null;
    const state = { stage: 'preparing', progressPercent: 2, processedDurationMs: 0, partialText: '' };
    const isCancelled = () => this.cancelledJobs.has(job.jobId) || channel !== this.channel;
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
      await publishProgress({ stage: 'preparing', progressPercent: 2 });
      heartbeat = setInterval(() => {
        if (isCancelled() || this.stopping) return;
        void publishProgress().catch((error) => console.error('Heartbeat de voz não publicado:', error.message));
      }, this.config.heartbeatIntervalSeconds * 1000);
      heartbeat.unref?.();

      if (isCancelled()) throw Object.assign(new Error('O processamento foi cancelado.'), { code: 'CANCELLED', retryable: false });
      await publishProgress({ stage: job.inlineAudio ? 'normalizing' : 'downloading', progressPercent: 5 });
      downloaded = job.inlineAudio
        ? await writeBufferToTemp(job.inlineAudio, job.sourceMimeType, this.config.maxAudioBytes)
        : await downloadObjectToFile(
          this.client,
          this.config.s3.bucket,
          job.sourceKey,
          job.sourceMimeType,
          this.config.maxAudioBytes,
        );
      if (isCancelled()) throw Object.assign(new Error('O processamento foi cancelado.'), { code: 'CANCELLED', retryable: false });

      const result = await this.provider.transcribe(downloaded.filePath, {
        language: job.language,
        model: job.model,
        mode: job.mode,
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
    } catch (error) {
      if (channel !== this.channel) return;
      const code = String(error?.code || 'TRANSCRIPTION_FAILED').slice(0, 64);
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
      if (heartbeat) clearInterval(heartbeat);
      if (downloaded) await cleanup(downloaded.directory);
      this.cancelledJobs.delete(job.jobId);
    }
  }

  async stop() {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    fs.rmSync(READY_FILE, { force: true });
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
