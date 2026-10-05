'use strict';

const truthy = new Set(['1', 'true', 'yes', 'on']);

function boolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return truthy.has(String(value).trim().toLowerCase());
}

function integer(name, fallback, minimum, maximum) {
  const value = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

function durationSeconds(name, fallback, maximum = 31_536_000) {
  const value = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(0, value));
}

function endpoint(value) {
  return String(value || 'minio')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
}

function normalizedProvider() {
  // `openai` was the old value. Treat it as a local migration alias so an
  // existing .env never causes a restart loop or a network call.
  const value = String(process.env.SPEECH_PROVIDER || process.env.TRANSCRIPTION_PROVIDER || process.env.TRANSCRIPTION_ENGINE || 'local')
    .trim()
    .toLowerCase();
  return value === 'openai' ? 'local' : value;
}

function loadConfig() {
  const modeValue = String(process.env.SPEECH_WORKER_MODE || 'transcription').trim().toLowerCase();
  const mode = modeValue === 'dictation' ? 'dictation' : 'transcription';
  const queueDefault = mode === 'dictation' ? 'speech.dictation' : 'speech.transcription';
  return {
    enabled: boolean('SPEECH_ENABLED', boolean('TRANSCRIPTION_ENABLED', false)),
    provider: normalizedProvider(),
    mode,
    queue: String(mode === 'dictation'
      ? (process.env.SPEECH_DICTATION_QUEUE || queueDefault)
      : (process.env.SPEECH_TRANSCRIPTION_QUEUE || process.env.TRANSCRIPTION_QUEUE || queueDefault)).trim(),
    requestRoutingKey: mode === 'dictation' ? 'speech.dictation.requested' : 'transcription.requested',
    resultRoutingPrefix: mode === 'dictation' ? 'speech.dictation.' : 'transcription.',
    cancelRoutingKey: mode === 'dictation' ? 'speech.cancel.dictation' : 'speech.cancel.transcription',
    concurrency: integer('SPEECH_WORKER_CONCURRENCY', integer('TRANSCRIPTION_WORKER_CONCURRENCY', 1, 1, 8), 1, 8),
    maxAudioBytes: mode === 'dictation'
      ? integer('DICTATION_MAX_AUDIO_BYTES', 5 * 1024 * 1024, 1, 25 * 1024 * 1024)
      : integer('TRANSCRIPTION_MAX_AUDIO_BYTES', 25 * 1024 * 1024, 1, 250 * 1024 * 1024),
    maxAttempts: integer('SPEECH_MAX_ATTEMPTS', 3, 1, 10),
    dictationAudioRetentionMs: integer('DICTATION_AUDIO_RETENTION_MINUTES', 5, 1, 60) * 60_000,
    heartbeatIntervalSeconds: integer('SPEECH_HEARTBEAT_INTERVAL_SECONDS', 5, 1, 60),
    chunkSeconds: integer('SPEECH_CHUNK_SECONDS', 30, 5, 120),
    strideSeconds: integer('SPEECH_STRIDE_SECONDS', 5, 0, 15),
    vadThresholdDb: Number.parseFloat(process.env.SPEECH_VAD_THRESHOLD_DB || '-45'),
    autoStop: boolean('DICTATION_AUTO_STOP', true),
    silenceTimeoutMs: integer('DICTATION_SILENCE_TIMEOUT_MS', 1500, 500, 10000),
    local: {
      model: String(process.env.SPEECH_MODEL || process.env.TRANSCRIPTION_LOCAL_MODEL || 'Xenova/whisper-small').trim(),
      modelPath: String(process.env.SPEECH_MODEL_PATH || '/models/Xenova/whisper-small').trim(),
      device: String(process.env.SPEECH_DEVICE || process.env.TRANSCRIPTION_LOCAL_DEVICE || 'cpu').trim().toLowerCase(),
      dtype: String(process.env.SPEECH_DTYPE || process.env.TRANSCRIPTION_LOCAL_DTYPE || 'q8').trim().toLowerCase(),
      cacheDir: String(process.env.SPEECH_MODEL_CACHE_DIR || process.env.TRANSCRIPTION_MODEL_CACHE_DIR || '/models').trim(),
    },
    syncModelCache: boolean('SPEECH_SYNC_MODEL_CACHE', false),
    sourceRetentionSeconds: durationSeconds('TRANSCRIPTION_SOURCE_RETENTION_SECONDS', 0),
    sourceCleanupIntervalSeconds: durationSeconds('TRANSCRIPTION_SOURCE_CLEANUP_INTERVAL_SECONDS', 900, 86_400),
    modelStoragePrefix: String(process.env.TRANSCRIPTION_MODEL_STORAGE_PREFIX || 'transcription-models')
      .trim()
      .replace(/^\/+|\/+$/g, ''),
    rabbitmq: {
      uri: String(process.env.RABBITMQ_URI || '').trim(),
      exchange: String(process.env.RABBITMQ_EXCHANGE_NAME || 'argws_connect').trim(),
    },
    s3: {
      endpoint: endpoint(process.env.S3_ENDPOINT),
      port: integer('S3_PORT', 9000, 1, 65535),
      useSSL: boolean('S3_USE_SSL', false),
      accessKey: String(process.env.S3_ACCESS_KEY || '').trim(),
      secretKey: String(process.env.S3_SECRET_KEY || '').trim(),
      bucket: String(process.env.S3_BUCKET || '').trim(),
      region: String(process.env.S3_REGION || 'us-east-1').trim(),
    },
  };
}

function validateConfig(config) {
  if (!config.enabled) return;
  if (config.concurrency > 1) {
    throw new Error('Use SPEECH_TRANSCRIPTION_REPLICAS para paralelismo; SPEECH_WORKER_CONCURRENCY deve ser 1 por processo.');
  }
  const missing = [];
  if (!config.rabbitmq.uri) missing.push('RABBITMQ_URI');
  if (!config.rabbitmq.exchange) missing.push('RABBITMQ_EXCHANGE_NAME');
  if (!config.queue || config.queue.length > 180) missing.push('TRANSCRIPTION_QUEUE');
  if (!config.s3.accessKey) missing.push('S3_ACCESS_KEY');
  if (!config.s3.secretKey) missing.push('S3_SECRET_KEY');
  if (!config.s3.bucket) missing.push('S3_BUCKET');
  if (!config.modelStoragePrefix || config.modelStoragePrefix.includes('..')) {
    missing.push('TRANSCRIPTION_MODEL_STORAGE_PREFIX');
  }
  if (!config.local.model || config.local.model.length > 180 || /[\u0000\r\n]/.test(config.local.model)) {
    missing.push('SPEECH_MODEL');
  }
  if (config.mode === 'dictation' && config.queue !== String(process.env.SPEECH_DICTATION_QUEUE || 'speech.dictation').trim()) {
    throw new Error('SPEECH_WORKER_MODE=dictation precisa consumir SPEECH_DICTATION_QUEUE.');
  }
  if (!['local'].includes(config.provider)) {
    throw new Error('TRANSCRIPTION_PROVIDER não suportado pelo worker: ' + config.provider);
  }
  if (!['cpu'].includes(config.local.device)) {
    throw new Error('TRANSCRIPTION_LOCAL_DEVICE inválido: ' + config.local.device);
  }
  if (!['q8', 'q4', 'fp32', 'fp16'].includes(config.local.dtype)) {
    throw new Error('TRANSCRIPTION_LOCAL_DTYPE inválido: ' + config.local.dtype);
  }
  if (missing.length) {
    throw new Error('Configuração do worker incompleta: ' + missing.join(', '));
  }
}

module.exports = { loadConfig, validateConfig, normalizedProvider };
