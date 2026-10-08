'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const amqp = require('amqplib');
const { createClient, downloadObjectToFile, cleanup } = require('./storage');
const { InferenceClient } = require('./inference-client');
const { modelIdentity } = require('./provider');
const { SpeechControlClient } = require('./control-client');
const { FairScheduler } = require('./fair-scheduler');
const { acquire } = require('./admission');
const { verifyModelDirectory } = require('./model-checksum');

const REQUESTED = 'transcription.requested';
const PROCESSING = 'transcription.processing';
const COMPLETED = 'transcription.completed';
const FAILED = 'transcription.failed';
const READY_FILE = '/tmp/transcription-worker.ready';
const errorWith = (message, code, retryable = false) => Object.assign(new Error(message), { code, retryable });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PERMANENT_ERRORS = new Set([
  'CANCELLED', 'INVALID_AUDIO', 'NO_SPEECH', 'UNSUPPORTED_AUDIO', 'MODEL_MISSING',
  'MODEL_CHECKSUM_MISMATCH', 'FFMPEG_MISSING', 'QUEUE_MODE_MISMATCH', 'AUDIO_TOO_LONG',
  'AUDIO_TOO_LARGE', 'DICTATION_AUDIO_EXPIRED', 'DEADLINE_EXCEEDED', 'MODEL_MISMATCH',
  'MODEL_FORMAT_MISMATCH', 'MODEL_REVISION_MISMATCH', 'ENGINE_MISMATCH', 'ENGINE_UNSUPPORTED', 'CHECKPOINT_MODEL_MISMATCH',
  'SOURCE_HASH_MISMATCH', 'SOURCE_SIZE_MISMATCH', 'SOURCE_BUCKET_MISMATCH', 'CHECKPOINT_TOO_LARGE', 'INVALID_CHECKPOINT',
]);

function normalizeJob(value, maxAudioBytes = 25 * 1024 * 1024) {
  if (!value || typeof value !== 'object') throw new Error('Mensagem de transcrição inválida.');
  const jobId = String(value.jobId || '').trim();
  const mode = value.mode === 'dictation' ? 'dictation' : 'transcription';
  const source = value.source && typeof value.source === 'object' ? value.source : {};
  const sourceKey = String(source.key || value.sourceKey || '').trim();
  const sourceMimeType = String(source.mimeType || value.audioMimeType || '').split(';', 1)[0].trim().toLowerCase();
  const mime = sourceMimeType === 'video/webm' && /\.webm$/i.test(sourceKey) ? 'audio/webm' : sourceMimeType;
  if (!jobId || jobId.length > 128) throw new Error('jobId inválido.');
  if (!sourceKey || !mime.startsWith('audio/')) throw new Error('Origem de áudio inválida.');
  const bytes = Number(source.bytes ?? value.audioBytes);
  if (Number.isFinite(bytes) && (bytes <= 0 || bytes > maxAudioBytes)) throw errorWith('Áudio excede o limite configurado.', 'AUDIO_TOO_LARGE');
  const sha256 = String(source.sha256 || value.checksumSha256 || '').toLowerCase();
  if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('SHA-256 da fonte inválido.');
  const version = Number(value.version || 1);
  const generation = Number(value.generation || 0);
  if (version === 2 && (!Number.isSafeInteger(generation) || generation < 1 || value.inlineAudio)) {
    throw new Error('Execução v2 inválida: geração obrigatória e áudio armazenado fora do broker.');
  }
  return {
    version, jobId, mode, generation, executionId: value.executionId || null,
    attempts: Math.max(1, Math.floor(Number(value.attempts) || 1)),
    messageId: value.messageId ? String(value.messageId) : null,
    instanceId: value.instanceId ? String(value.instanceId) : null,
    scopeKey: value.scopeKey ? String(value.scopeKey) : null,
    poolId: value.poolId ? String(value.poolId) : null,
    sourceKey, sourceMimeType: mime, sourceBytes: Number.isFinite(bytes) ? bytes : undefined, sourceSha256: sha256 || null,
    sourceBucket: source.bucket || value.bucket || null,
    language: value.language ? String(value.language).slice(0, 32) : null,
    model: value.model || value.requestedModel || null, engine: value.engine || null,
    modelRevision: value.modelRevision || null,
    maxDurationMs: Number(value.maxDurationMs) || null,
    deadlineAt: value.deadlineAt || null,
    queuedAt: typeof value.queuedAt === 'number' ? value.queuedAt : Date.parse(value.queuedAt || '') || null,
  };
}

function queueArguments(config, mode) {
  const retention = (config.queueRetentionSeconds || 86400) * 1000;
  return {
    'x-queue-type': 'quorum',
    'x-max-length': config.queueMaxJobs || 50,
    'x-max-length-bytes': config.queueMaxBytes || 8388608,
    'x-overflow': 'reject-publish',
    'x-delivery-limit': config.maxAttempts || 3,
    'x-dead-letter-exchange': '',
    'x-dead-letter-routing-key': (config.queues?.[mode] || config.queue || `speech.${mode}.v2`) + '.dead-letter',
    'x-message-ttl': mode === 'dictation' ? Math.min(retention, config.dictationAudioRetentionMs || 300000) : retention,
  };
}

function probeFfmpeg() {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(errorWith('FFmpeg não respondeu.', 'FFMPEG_MISSING')); }, 5000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('close', (code) => { clearTimeout(timeout); code === 0 ? resolve() : reject(errorWith('FFmpeg indisponível.', 'FFMPEG_MISSING')); });
  });
}

class TranscriptionWorker {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.createInferenceClient = dependencies.createInferenceClient || ((value) => new InferenceClient(value));
    this.probeFfmpeg = dependencies.probeFfmpeg || probeFfmpeg;
    this.verifyModel = dependencies.verifyModel || verifyModelDirectory;
    this.acquireSlot = dependencies.acquireSlot || acquire;
    this.connectBroker = dependencies.connectBroker || ((...args) => amqp.connect(...args));
    this.workerId = String(process.env.HOSTNAME || process.pid).slice(0, 128);
    this.control = dependencies.control || new SpeechControlClient(config, this.workerId);
    this.downloadAudio = dependencies.downloadAudio || ((job, signal) => downloadObjectToFile(
      this.client, this.bucketFor(job), job.sourceKey, job.sourceMimeType, this.audioLimit(job.mode), {
        signal, sha256: job.sourceSha256, expectedBytes: job.sourceBytes,
        timeoutMs: (this.config.downloadTimeoutSeconds || 60) * 1000,
      },
    ));
    this.connection = null; this.channel = null; this.controlChannel = null;
    this.provider = null; this.client = null; this.residentLease = null;
    this.stopping = false; this.cancelledJobs = new Set(); this.settledMessages = new WeakSet();
    this.scheduler = new FairScheduler(config.dictationWeight || 3);
    this.activeTask = null; this.activeContext = null; this.consumerTags = [];
    this.sourceCache = new Map(); this.sourceCacheBytes = 0;
    this.modelVerified = false; this.lastSuccessfulInferenceAt = null;
    this.releasingResidency = false;
  }

  get modes() { return this.config.modes || (this.config.mode === 'pool' ? ['dictation', 'transcription'] : [this.config.mode || 'transcription']); }
  audioLimit(mode) { return mode === 'dictation' ? (this.config.dictationMaxAudioBytes || this.config.maxAudioBytes || 5242880) : (this.config.transcriptionMaxAudioBytes || this.config.maxAudioBytes || 26214400); }
  bucketFor(job) {
    const original = this.config.s3?.bucket;
    const speech = this.config.s3?.speechBucket || (original ? original + '-speech' : null);
    const target = job.sourceBucket || original;
    if (!target || ![original, speech].includes(target)) throw errorWith('Fonte pertence a outro armazenamento.', 'SOURCE_BUCKET_MISMATCH');
    return target;
  }
  queueFor(mode) { return this.config.queues?.[mode] || this.config.queue || `speech.${mode}.v2`; }

  async start() {
    fs.rmSync(READY_FILE, { force: true });
    if (!this.config.enabled) { console.log('Speech worker desabilitado.'); return; }
    this.client = createClient(this.config.s3);
    await this.probeFfmpeg();
    while (!this.stopping) {
      await this.waitForPersistentModel();
      if (this.stopping) return;
      try {
        if (this.config.local.modelPath) await this.verifyModel(this.config.local.modelPath);
        this.verifiedIdentity = await modelIdentity(this.config);
        this.modelVerified = true;
        break;
      } catch (error) {
        console.error('Modelo inválido; aguardando uma geração reparada:', error.code || 'MODEL_INVALID');
        await this.waitForModelRepair();
      }
    }
    if (this.stopping) return;
    await this.connect().catch((error) => {
      console.error('Falha ao conectar coordenador de voz:', error.code || error.message);
      void this.connection?.close().catch(() => {});
      this.scheduleReconnect();
    });
  }

  async waitForPersistentModel() {
    const modelPath = this.config.local?.modelPath;
    if (!modelPath) return;
    const manifest = path.join(path.resolve(modelPath), '.speech-model-checksums.json');
    let lastNotice = 0;
    while (!this.stopping && !fs.existsSync(manifest)) {
      if (Date.now() - lastNotice > 30000) { console.log('Aguardando provisionamento verificado do modelo de voz.'); lastNotice = Date.now(); }
      await delay(1000);
    }
  }

  async waitForModelRepair() {
    const manifest = path.join(path.resolve(this.config.local?.modelPath || '/models'), '.speech-model-checksums.json');
    const revision = () => { try { const stat = fs.statSync(manifest); return `${stat.mtimeMs}:${stat.size}`; } catch { return ''; } };
    const before = revision();
    while (!this.stopping && revision() === before) await delay(1000);
  }

  logMemory(phase, job = null, extra = {}) {
    const { rss, heapUsed, external } = process.memoryUsage();
    console.log(JSON.stringify({ event: 'speech_memory', phase, mode: this.config.mode, workerId: this.workerId,
      jobId: job?.jobId, generation: job?.generation, activeJobs: this.activeContext ? 1 : 0,
      queuedDeliveries: this.scheduler?.size || 0, cachedAudioBytes: this.sourceCacheBytes || 0,
      rss, heapUsed, external, ...extra }));
  }

  async ensureResidency() {
    clearTimeout(this.idleTimer);
    if (this.residentLease) return this.residentLease;
    this.residentLease = await this.acquireSlot(this.config, () => this.stopping || !this.channel,
      () => { void this.onConnectionLost(this.connection); }, this.connection || undefined);
    return this.residentLease;
  }

  async loadProvider(job) {
    if (this.stopping) throw errorWith('Worker em encerramento.', 'WORKER_STOPPING', true);
    clearTimeout(this.idleTimer);
    const provider = this.provider || this.createInferenceClient(this.config);
    this.provider = provider;
    let timer;
    try {
      await Promise.race([provider.warmup(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(errorWith('O modelo não ficou pronto dentro do prazo.', 'MODEL_WARMUP_TIMEOUT', true)), (this.config.modelWarmupTimeoutSeconds || 300) * 1000);
      })]);
      if (this.stopping || this.provider !== provider) throw errorWith('Worker em encerramento.', 'WORKER_STOPPING', true);
      this.lastSuccessfulInferenceAt = provider.lastSuccessfulInferenceAt || this.lastSuccessfulInferenceAt;
      this.modelVerified = true;
      return provider;
    } catch (error) {
      if (this.provider === provider) this.provider = null;
      if (['MODEL_MISSING', 'MODEL_CHECKSUM_MISMATCH', 'MODEL_FORMAT_MISMATCH', 'MODEL_MISMATCH'].includes(error.code)) {
        this.modelVerified = false; this.invalidManifestStamp = this.modelManifestStamp();
      }
      await this.terminateProvider(provider);
      throw error;
    } finally { clearTimeout(timer); }
  }

  async terminateProvider(provider) { await provider?.stop(); }
  async unloadProvider() {
    const provider = this.provider;
    this.provider = null;
    if (provider) {
      try { await this.terminateProvider(provider); this.logMemory('model_unloaded'); }
      catch (error) { this.provider = provider; throw error; }
    }
  }

  scheduleIdleUnload() {
    clearTimeout(this.idleTimer);
    const legacyMode = this.config.mode !== 'pool';
    if (this.stopping || this.scheduler?.size || this.activeContext || this.pumpTask ||
      (!this.provider && !(legacyMode && this.residentLease))) return;
    const configuredIdleMs = Math.max(0, this.config.modelIdleTtlSeconds ?? 300) * 1000;
    // Old Compose files run one coordinator per mode. A coordinator that has
    // never loaded a model must still yield so the other mode can consume.
    const idleMs = !this.provider && legacyMode ? Math.min(5000, configuredIdleMs) : configuredIdleMs;
    this.idleTimer = setTimeout(() => {
      if (this.stopping || this.activeContext || this.scheduler.size || this.pumpTask) return;
      const connection = this.connection;
      const lease = this.residentLease;
      void (async () => {
        // Pool ownership belongs to the lightweight coordinator until reconnect.
        // Legacy single-mode replicas yield residency after idle to the other mode.
        if (legacyMode) {
          // Deliveries already in flight remain unacknowledged until closing the
          // connection requeues them. They cannot start while residency is freed.
          this.releasingResidency = true;
          await this.pauseConsumers();
          if (this.stopping || this.connection !== connection || this.residentLease !== lease) return;
        }
        await this.unloadProvider();
        if (legacyMode) {
          if (this.stopping || this.connection !== connection || this.residentLease !== lease) return;
          // stop() or a socket close can overlap this awaited broker operation.
          // The native process is gone; detach ownership before releasing once.
          this.residentLease = null;
          await lease?.release();
          await this.onConnectionLost(connection);
        }
        await this.reportHealth();
      })().catch((error) => {
        this.fatalError = error; this.stopping = true;
        fs.rmSync(READY_FILE, { force: true });
        console.error('Processo nativo sem encerramento confirmado; residência retida:', error.code);
        void this.reportHealth().catch(() => {});
      });
    }, idleMs);
    this.idleTimer.unref?.();
  }

  async connect() {
    if (this.stopping) return;
    await this.lossBarrier;
    this.releasingResidency = false;
    const connection = await this.connectBroker(this.config.rabbitmq.uri, { timeout: 5000, keepAlive: true });
    this.connection = connection;
    connection.on('error', (error) => console.error('RabbitMQ speech:', error.code || 'CONNECTION_ERROR'));
    connection.on('close', () => { void this.onConnectionLost(connection); });
    const channel = await connection.createConfirmChannel();
    this.channel = channel;
    channel.on('error', () => {});
    channel.on('close', () => { if (this.channel === channel) void this.onConnectionLost(connection); });
    await channel.assertExchange(this.config.rabbitmq.exchange, 'topic', { durable: true });
    for (const mode of this.modes) {
      const queue = this.queueFor(mode);
      await channel.assertQueue(queue, { durable: true, arguments: queueArguments(this.config, mode) });
      await channel.bindQueue(queue, this.config.rabbitmq.exchange, mode === 'dictation' ? 'speech.dictation.requested.v2' : 'transcription.requested.v2');
      await channel.assertQueue(queue + '.dead-letter', { durable: true, arguments: {
        'x-queue-type': 'quorum', 'x-max-length': this.config.deadLetterMaxJobs || 100,
        'x-max-length-bytes': 1048576, 'x-overflow': 'drop-head',
        'x-message-ttl': (this.config.deadLetterRetentionSeconds || 86400) * 1000,
      } });
    }
    await this.control.connect(connection);
    clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => {
      void this.reportHealth().catch(() => {});
      void this.expireSourceCache();
    }, 10000);
    this.healthTimer.unref?.();
    await this.reportHealth();
    // Acquire before consuming so a standby replica cannot hide jobs behind its
    // prefetch while a resident model elsewhere owns the only compute slot.
    await this.ensureResidency();
    if (this.stopping || this.connection !== connection) return;
    const controlChannel = await connection.createChannel();
    this.controlChannel = controlChannel;
    controlChannel.on('error', () => {});
    const broadcast = await controlChannel.assertQueue('', { exclusive: true, autoDelete: true, arguments: {
      'x-max-length': 100, 'x-message-ttl': 60000,
    } });
    for (const mode of this.modes) await controlChannel.bindQueue(broadcast.queue, this.config.rabbitmq.exchange, `speech.cancel.${mode}`);
    await controlChannel.prefetch(10);
    await controlChannel.consume(broadcast.queue, (message) => { if (message) this.handleControl(message, controlChannel); }, { noAck: false });
    const prefetch = Math.max(1, Math.floor((this.config.poolPrefetch || 10) / this.modes.length));
    await channel.prefetch(prefetch);
    this.consumerTags = [];
    for (const mode of this.modes) {
      const consumer = await channel.consume(this.queueFor(mode), (message) => {
        if (!message) return;
        if (this.stopping || this.channel !== channel) { this.negativeAcknowledge(channel, message, true); return; }
        let job;
        try { job = normalizeJob(JSON.parse(message.content.toString('utf8')), this.audioLimit(mode)); }
        catch { job = { mode, instanceId: null }; }
        this.scheduler.add(job, { message, channel, queueMode: mode });
        this.pump();
      }, { noAck: false });
      this.consumerTags.push(consumer.consumerTag);
    }
    fs.writeFileSync(READY_FILE, JSON.stringify({ version: 2, mode: this.config.mode, coordinator: true }));
    this.scheduleIdleUnload();
    await this.reportHealth();
    console.log(`Speech coordinator v2 ativo: ${this.modes.join(', ')}; engine=${this.config.engine || 'transformers'}.`);
  }

  async onConnectionLost(connection) {
    if (!connection || this.connection !== connection) return;
    this.connection = null; this.channel = null; this.controlChannel = null;
    this.residentLease = null; this.consumerTags = [];
    fs.rmSync(READY_FILE, { force: true });
    clearInterval(this.healthTimer); clearTimeout(this.idleTimer);
    this.scheduler = new FairScheduler(this.config.dictationWeight || 3);
    this.activeContext?.abort.abort();
    // Disconnect must stop computation before a replacement lease can be used.
    this.lossBarrier = (async () => {
      await this.unloadProvider();
      await connection.close().catch(() => {});
    })();
    try { await this.lossBarrier; }
    catch (error) { this.fatalError = error; console.error('Não foi possível garantir encerramento nativo:', error.code); this.stopping = true; }
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.stopping || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(async (error) => {
        console.error('Reconexão de voz falhou:', error.code || 'CONNECTION_ERROR');
        await this.onConnectionLost(this.connection);
        this.scheduleReconnect();
      });
    }, 5000);
    // The broker socket may be the last referenced handle. Keep this retry alive
    // until stop() clears it; exiting with code 0 defeats restart:on-failure.
  }

  pump() {
    if (this.pumpTask || this.stopping || this.releasingResidency) return;
    this.pumpTask = (async () => {
      while (!this.stopping && this.scheduler.size) {
        const entry = this.scheduler.take();
        if (entry.channel !== this.channel) continue;
        const task = this.handle(entry.message, entry.channel, entry.queueMode);
        this.activeTask = task;
        const outcome = await task;
        if (outcome?.defer && entry.channel === this.channel) {
          this.scheduler.add(outcome.job, entry);
          await delay(Math.min(5000, Math.max(100, outcome.delayMs || 1000)));
        }
        if (this.activeTask === task) this.activeTask = null;
      }
    })().catch((error) => {
      console.error('Falha no coordenador de voz:', error.code || error.message);
      void this.onConnectionLost(this.connection);
    }).finally(() => { this.pumpTask = null; this.scheduleIdleUnload(); });
  }

  acknowledge(channel, message) {
    if (!channel || (channel !== this.channel && channel !== this.controlChannel) || !message || typeof message !== 'object') return false;
    this.settledMessages ||= new WeakSet();
    if (this.settledMessages.has(message)) return false;
    try { channel.ack(message); this.settledMessages.add(message); return true; }
    catch { void Promise.resolve(channel.close?.()).catch(() => {}); return false; }
  }

  negativeAcknowledge(channel, message, requeue) {
    if (!channel || channel !== this.channel || !message || typeof message !== 'object') return false;
    this.settledMessages ||= new WeakSet();
    if (this.settledMessages.has(message)) return false;
    try { channel.nack(message, false, requeue); this.settledMessages.add(message); return true; }
    catch { void Promise.resolve(channel.close?.()).catch(() => {}); return false; }
  }

  handleControl(message, channel = this.controlChannel) {
    if (channel !== this.controlChannel) return;
    try {
      const value = JSON.parse(message.content.toString('utf8'));
      const jobId = String(value.jobId || '').trim();
      if (jobId && jobId.length <= 128) {
        // Broadcast is only a latency hint. Revalidate its durable generation so
        // a delayed cancellation from an old attempt never cancels a manual retry.
        const context = this.activeContext;
        if (context?.job.jobId === jobId && (!value.generation || Number(value.generation) === context.job.generation)) {
          void this.control.request('lease', context.job, { stage: context.stage }).then(async (reply) => {
            if (reply.cancelRequested || (!reply.granted && reply.terminal)) {
              context.cancelRequested = true;
              context.abort.abort();
              await this.provider?.cancel();
            }
          }).catch(async (error) => {
            context.abortError = error;
            context.abort.abort();
            try { await this.provider?.cancel(); } catch (fatal) {
              context.abortError = fatal; this.fatalError = fatal; this.stopping = true;
              fs.rmSync(READY_FILE, { force: true });
            }
          });
        }
      }
    } catch { console.error('Mensagem de controle de voz inválida.'); }
    this.acknowledge(channel, message);
  }

  modelManifestStamp() {
    try { const stat = fs.statSync(path.join(this.config.local.modelPath, '.speech-model-checksums.json')); return `${stat.mtimeMs}:${stat.size}`; } catch { return ''; }
  }

  async reportHealth() {
    if (!this.modelVerified && this.config.local?.modelPath && this.modelManifestStamp() !== this.invalidManifestStamp) {
      if (!this.modelVerification) this.modelVerification = this.verifyModel(this.config.local.modelPath).then(async () => {
        this.verifiedIdentity = await modelIdentity(this.config);
        this.modelVerified = true;
      }).catch(() => { this.invalidManifestStamp = this.modelManifestStamp(); }).finally(() => { this.modelVerification = null; });
      await this.modelVerification;
    }
    if (!this.control?.channel && this.control instanceof SpeechControlClient) return;
    const engine = this.provider?.status || {};
    const accepting = !this.stopping && !this.releasingResidency && Boolean(this.channel && this.residentLease && this.modelVerified);
    const health = {
      modes: this.modes, processAlive: !this.stopping, brokerConnected: Boolean(this.channel),
      modelVerified: this.modelVerified, engineReady: Boolean(this.provider?.ready), acceptingJobs: accepting,
      state: this.fatalError ? 'degraded' : this.stopping ? 'stopping' : !this.residentLease ? 'standby' : engine.state || 'idle',
      lastSuccessfulInferenceAt: this.provider?.lastSuccessfulInferenceAt || this.lastSuccessfulInferenceAt,
      engine: this.config.engine || 'transformers', effectiveModel: engine.effectiveModel || this.config.local?.model,
      modelRevision: engine.modelRevision || this.verifiedIdentity?.modelRevision || null,
    };
    return this.control.request('health', {}, { health });
  }

  async cacheDrop(key) {
    const entry = this.sourceCache.get(key);
    if (!entry) return;
    this.sourceCache.delete(key); this.sourceCacheBytes -= entry.bytes || 0;
    await cleanup(entry.directory);
  }

  async expireSourceCache() {
    for (const [key, entry] of this.sourceCache) {
      if (entry.jobId !== this.activeContext?.job.jobId && Date.now() - entry.lastUsedAt > 300000) await this.cacheDrop(key);
    }
  }

  async sourceFor(job, signal) {
    const key = `${job.jobId}:${this.bucketFor(job)}:${job.sourceSha256 || job.sourceKey}`;
    const existing = this.sourceCache.get(key);
    if (existing && fs.existsSync(existing.filePath)) { existing.lastUsedAt = Date.now(); return existing; }
    if (existing) await this.cacheDrop(key);
    const budget = this.config.sourceCacheMaxBytes || 50 * 1024 * 1024;
    const reserve = job.sourceBytes || this.audioLimit(job.mode);
    if (reserve > budget) throw errorWith('Áudio excede o orçamento de temporários do pool.', 'AUDIO_TOO_LARGE');
    const entries = [...this.sourceCache.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
    for (const [cachedKey] of entries) {
      if (this.sourceCacheBytes + reserve <= budget) break;
      await this.cacheDrop(cachedKey);
    }
    const source = await this.downloadAudio(job, signal);
    const entry = { ...source, jobId: job.jobId, lastUsedAt: Date.now(), key };
    this.sourceCache.set(key, entry); this.sourceCacheBytes += source.bytes || 0;
    return entry;
  }

  async publishDeadLetter(job, error, channel = this.channel) {
    if (!channel || channel !== this.channel) throw errorWith('Canal indisponível.', 'CONTROL_UNAVAILABLE', true);
    const body = Buffer.from(JSON.stringify({ version: 2, jobId: job.jobId, mode: job.mode,
      generation: job.generation, attempts: job.attempts, errorCode: String(error.code || 'INVALID_JOB').slice(0, 64),
      failedAt: new Date().toISOString() }));
    await new Promise((resolve, reject) => channel.sendToQueue(this.queueFor(job.mode) + '.dead-letter', body,
      { persistent: true, contentType: 'application/json', expiration: String((this.config.deadLetterRetentionSeconds || 86400) * 1000) },
      (cause) => cause ? reject(cause) : resolve()));
  }

  async handle(message, channel = this.channel, queueMode) {
    if (!channel || channel !== this.channel) return;
    let job;
    try {
      if (message.content.length > 64 * 1024) throw new Error('Job de voz excessivo.');
      const raw = JSON.parse(message.content.toString('utf8'));
      job = normalizeJob(raw, this.audioLimit(raw.mode));
      if (job.version !== 2) throw errorWith('Mensagem legada requer migração explícita pela API.', 'LEGACY_PROTOCOL_REQUIRES_RETRY');
      if (!this.modes.includes(job.mode) || (queueMode && job.mode !== queueMode)) throw errorWith('Modalidade incompatível.', 'QUEUE_MODE_MISMATCH');
      if (job.poolId && job.poolId !== (this.config.poolId || this.config.rabbitmq?.exchange)) throw errorWith('Pool incompatível.', 'POOL_MISMATCH');
    } catch (error) {
      await this.publishDeadLetter(job || { mode: queueMode || this.modes[0] }, error, channel);
      this.acknowledge(channel, message);
      return;
    }
    const context = { job, abort: new AbortController(), stage: 'claiming', checkpoint: null, leaseRequest: null };
    let source;
    let yielded = false;
    let leaseTimer;
    let heartbeat;
    const stopHeartbeat = async () => { clearInterval(heartbeat); clearTimeout(leaseTimer); await context.leaseRequest?.catch(() => {}); };
    const terminateForControl = async (error, cancelled = false) => {
      context.abortError = error; context.cancelRequested ||= cancelled;
      context.abort.abort();
      await this.provider?.cancel();
    };
    const armLease = (reply) => {
      const leaseUntil = Date.parse(reply.leaseExpiresAt || '');
      if (!Number.isFinite(leaseUntil)) throw errorWith('Lease inválida.', 'LEASE_LOST', true);
      context.leaseExpiresAt = leaseUntil;
      clearTimeout(leaseTimer);
      leaseTimer = setTimeout(() => { void terminateForControl(errorWith('A lease expirou sem confirmação.', 'LEASE_LOST', true)); },
        Math.max(0, leaseUntil - Date.now() - (this.config.processKillGraceMs || 1000) - 3000));
      leaseTimer.unref?.();
    };
    try {
      await this.ensureResidency();
      const claim = await this.control.request('claim', job);
      if (!claim.granted) {
        if (claim.terminal || claim.cancelRequested) { this.acknowledge(channel, message); return; }
        if (claim.ok === false) throw errorWith('A autoridade durável recusou o controle.', 'CONTROL_REJECTED', true);
        return { defer: true, job, delayMs: claim.retryAfterMs || 1000 };
      }
      job.executionId = claim.executionId; job.generation = claim.generation;
      job.deadlineAt = claim.deadlineAt || job.deadlineAt;
      context.checkpoint = claim.checkpoint || null;
      if (claim.job) {
        const authoritative = normalizeJob(claim.job, this.audioLimit(job.mode));
        Object.assign(job, authoritative, { executionId: claim.executionId, generation: claim.generation, deadlineAt: claim.deadlineAt || authoritative.deadlineAt });
      }
      this.activeContext = context; this.activeJobId = job.jobId;
      armLease(claim);
      heartbeat = setInterval(() => {
        if (context.leaseRequest || context.abort.signal.aborted || this.stopping) return;
        context.leaseRequest = this.control.request('lease', job, { stage: context.stage }).then(async (reply) => {
          if (!reply.granted || reply.cancelRequested) {
            await terminateForControl(errorWith('Execução revogada pela autoridade durável.', 'LEASE_LOST', true), reply.cancelRequested);
          } else armLease(reply);
        }).catch((error) => terminateForControl(error)).finally(() => { context.leaseRequest = null; });
      }, Math.min(this.config.heartbeatIntervalSeconds || 5, (this.config.executionLeaseSeconds || 30) / 3) * 1000);
      heartbeat.unref?.();
      if (job.deadlineAt && Date.parse(job.deadlineAt) <= Date.now()) throw errorWith('O prazo do job expirou.', 'DEADLINE_EXCEEDED');
      // An incompatible queued request is closed durably before downloading
      // audio or allocating a native model for a different configuration.
      const identity = await modelIdentity(this.config);
      if (job.engine && job.engine !== identity.engine) throw errorWith('O job requer outro engine.', 'ENGINE_MISMATCH');
      if (job.model && job.model !== identity.effectiveModel) throw errorWith('O job requer outro modelo.', 'MODEL_MISMATCH');
      if (job.modelRevision && job.modelRevision !== identity.modelRevision) throw errorWith('O job requer outra revisão do modelo.', 'MODEL_REVISION_MISMATCH');
      this.bucketFor(job);
      context.stage = 'downloading';
      const sourceSignal = AbortSignal.any([context.abort.signal, AbortSignal.timeout((this.config.downloadTimeoutSeconds || 60) * 1000)]);
      source = await this.sourceFor(job, sourceSignal);
      if (context.abort.signal.aborted) throw context.abortError || errorWith('Processamento cancelado.', 'CANCELLED');
      context.stage = 'loading_model';
      const provider = await this.loadProvider(job);
      if (context.abort.signal.aborted) throw context.abortError || errorWith('Processamento cancelado.', 'CANCELLED');
      context.stage = 'transcribing';
      const part = await provider.transcribeChunk(source.filePath, {
        jobId: job.jobId, generation: job.generation, executionId: job.executionId,
        mode: job.mode, language: job.language, model: job.model, engine: job.engine, modelRevision: job.modelRevision,
        maxDurationMs: job.maxDurationMs, deadlineAt: job.deadlineAt,
        sourceSha256: job.sourceSha256, checkpoint: context.checkpoint,
        onProgress: (progress) => { context.stage = progress.stage || context.stage; },
      });
      this.lastSuccessfulInferenceAt = provider.lastSuccessfulInferenceAt || new Date().toISOString();
      await stopHeartbeat();
      if (context.abortError || context.cancelRequested) throw context.abortError || errorWith('Processamento cancelado.', 'CANCELLED');
      const reply = part.done
        ? await this.control.request('finish', job, { status: 'completed', result: { ...part.result, provider: 'local' } })
        : await this.control.request('release', job, { reason: 'yield', delayMs: 0, checkpoint: part.checkpoint });
      if (!reply.applied && !reply.terminal) throw errorWith('A autoridade não confirmou a persistência do resultado.', 'CONTROL_NOT_APPLIED', true);
      yielded = !part.done && reply.applied && !reply.terminal;
      this.acknowledge(channel, message);
    } catch (cause) {
      await stopHeartbeat();
      const error = context.abortError || cause;
      if (error.code === 'PROCESS_TERMINATION_FAILED') {
        this.fatalError = error; this.stopping = true;
        fs.rmSync(READY_FILE, { force: true });
        console.error('Pool degradado: morte do processo nativo não foi confirmada; residência retida.');
        await this.reportHealth().catch(() => {});
        return;
      }
      if (this.provider?.active || context.cancelRequested || context.abort.signal.aborted) await this.provider?.cancel();
      if (this.stopping || channel !== this.channel) return;
      if (!job.executionId || /^CONTROL_/.test(error.code || '')) {
        // Keep the delivery unacked. A confirmed DB lease/outbox owns recovery;
        // never run a replacement while authority is unavailable.
        await this.onConnectionLost(this.connection);
        if (!this.connection && channel === this.channel) this.negativeAcknowledge(channel, message, true);
        return;
      }
      try {
        const cancelled = context.cancelRequested || error.code === 'CANCELLED';
        const permanent = cancelled || error.retryable === false || PERMANENT_ERRORS.has(error.code);
        const reply = permanent
          ? await this.control.request('finish', job, { status: cancelled ? 'cancelled' : 'failed',
            errorCode: String(error.code || 'TRANSCRIPTION_FAILED').slice(0, 64), errorMessage: String(error.message || error).slice(0, 2000) })
          : await this.control.request('release', job, { reason: String(error.code || 'TRANSCRIPTION_FAILED').slice(0, 64),
            delayMs: [30000, 120000, 600000][Math.min(2, job.attempts - 1)] });
        if (!reply.applied && !reply.terminal) throw errorWith('Persistência da falha não confirmada.', 'CONTROL_NOT_APPLIED', true);
        if (permanent && !cancelled) await this.publishDeadLetter(job, error, channel);
        this.acknowledge(channel, message);
      } catch (persistError) {
        console.error('Falha ao persistir execução de voz:', persistError.code || 'CONTROL_ERROR');
        await this.onConnectionLost(this.connection);
      }
    } finally {
      await stopHeartbeat();
      if (!yielded && source && !this.fatalError) await this.cacheDrop(source.key);
      this.cancelledJobs.delete(job.jobId);
      if (this.activeContext === context) { this.activeContext = null; this.activeJobId = null; }
      this.scheduleIdleUnload();
    }
  }

  async pauseConsumers() {
    const channel = this.channel;
    const tags = this.consumerTags || (this.consumerTag ? [this.consumerTag] : []);
    // Detach before awaiting: idle handoff and stop() may cancel concurrently.
    this.consumerTags = [];
    for (const tag of tags) await channel?.cancel(tag).catch(() => {});
  }

  async stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopWorker();
    return this.stopPromise;
  }

  async stopWorker() {
    this.stopping = true;
    clearTimeout(this.reconnectTimer); clearTimeout(this.idleTimer); clearInterval(this.healthTimer);
    fs.rmSync(READY_FILE, { force: true });
    await this.pauseConsumers();
    if (this.activeTask) {
      let timer;
      const settled = await Promise.race([this.activeTask.then(() => true, () => true), new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), (this.config.shutdownGraceSeconds || 90) * 1000);
      })]);
      clearTimeout(timer);
      if (!settled) { this.activeContext?.abort.abort(); await this.unloadProvider(); }
    }
    await this.unloadProvider();
    // No native process remains when the exclusive residence slot is released.
    await this.residentLease?.release(); this.residentLease = null;
    for (const key of this.sourceCache?.keys() || []) await this.cacheDrop(key);
    await this.control?.close();
    await this.controlChannel?.close().catch(() => {});
    await this.channel?.close().catch(() => {});
    await this.connection?.close().catch(() => {});
  }
}

module.exports = { TranscriptionWorker, normalizeJob, queueArguments, REQUESTED, PROCESSING, COMPLETED, FAILED };
