'use strict';

const truthy = new Set(['1', 'true', 'yes', 'on']);

function boolean(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return truthy.has(String(value).trim().toLowerCase());
}

function integer(name, fallback, minimum, maximum) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum ? Math.min(Math.floor(value), maximum) : fallback;
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
  // Legacy/external providers require an explicit migration. Never relabel
  // a request as local or silently substitute a different engine.
  const value = String(process.env.SPEECH_PROVIDER || process.env.TRANSCRIPTION_PROVIDER || process.env.TRANSCRIPTION_ENGINE || 'local')
    .trim()
    .toLowerCase();
  return value;
}

function loadConfig() {
  const mode = 'pool';
  const engine = String(process.env.SPEECH_ENGINE || 'whisper.cpp').trim().toLowerCase();
  const queueV2 = (value) => String(value).trim().replace(/(?:\.v2)?$/, '.v2');
  const model = String(process.env.SPEECH_MODEL || process.env.TRANSCRIPTION_LOCAL_MODEL || 'whisper-base-q5_1').trim();
  const modelPath = String(process.env.SPEECH_MODEL_PATH || '/models/whisper.cpp/base-q5_1').trim();
  const exchange = String(process.env.RABBITMQ_EXCHANGE_NAME || 'argws_connect').trim();
  const transcriptionQueue = queueV2(process.env.SPEECH_TRANSCRIPTION_QUEUE || process.env.TRANSCRIPTION_QUEUE || 'speech.transcription');
  const dictationQueue = queueV2(process.env.SPEECH_DICTATION_QUEUE || 'speech.dictation');
  return {
    enabled: boolean('SPEECH_ENABLED', boolean('TRANSCRIPTION_ENABLED', false)),
    provider: normalizedProvider(),
    mode,
    engine,
    poolId: String(process.env.SPEECH_POOL_ID || exchange).trim(),
    modes: mode === 'pool' ? ['dictation', 'transcription'] : [mode],
    queue: mode === 'dictation' ? dictationQueue : transcriptionQueue,
    queues: { dictation: dictationQueue, transcription: transcriptionQueue },
    requestRoutingKey: mode === 'dictation' ? 'speech.dictation.requested.v2' : 'transcription.requested.v2',
    resultRoutingPrefix: mode === 'dictation' ? 'speech.dictation.' : 'transcription.',
    cancelRoutingKey: mode === 'dictation' ? 'speech.cancel.dictation' : 'speech.cancel.transcription',
    controlRoutingKey: 'speech.control.v2',
    controlTimeoutMs: integer('SPEECH_CONTROL_TIMEOUT_MS', 10000, 1000, 30000),
    executionLeaseSeconds: integer('SPEECH_LEASE_SECONDS', 30, 10, 120),
    modelIdleTtlSeconds: durationSeconds('SPEECH_MODEL_IDLE_TTL_SECONDS', 300, 3600),
    inferenceThreads: integer('SPEECH_INFERENCE_THREADS', 1, 1, 8),
    inferenceInterThreads: integer('SPEECH_INFERENCE_INTER_THREADS', 1, 1, 4),
    chunkDeadlineSeconds: integer('SPEECH_CHUNK_DEADLINE_SECONDS', 180, 10, 3600),
    processKillGraceMs: integer('SPEECH_PROCESS_KILL_GRACE_MS', 1000, 100, 5000),
    poolPrefetch: integer('SPEECH_POOL_PREFETCH', 10, 1, 50),
    dictationWeight: integer('SPEECH_DICTATION_WEIGHT', 3, 1, 10),
    queueMaxJobs: integer('SPEECH_QUEUE_MAX_JOBS', 50, 1, 1000000),
    queueMaxBytes: integer('SPEECH_QUEUE_MAX_BYTES', 8388608, 1024, 268435456),
    queueRetentionSeconds: integer('SPEECH_QUEUE_RETENTION_SECONDS', 86400, 60, 604800),
    deadLetterMaxJobs: integer('SPEECH_DEAD_LETTER_MAX_JOBS', 100, 1, 1000000),
    deadLetterRetentionSeconds: integer('SPEECH_DEAD_LETTER_RETENTION_SECONDS', 86400, 60, 604800),
    sourceCacheMaxBytes: integer('SPEECH_SOURCE_CACHE_MAX_BYTES', 50 * 1024 * 1024, 1024 * 1024, 250 * 1024 * 1024),
    downloadTimeoutSeconds: integer('SPEECH_DOWNLOAD_TIMEOUT_SECONDS', 60, 5, 300),
    concurrency: 1,
    globalConcurrency: integer('SPEECH_GLOBAL_CONCURRENCY', 1, 1, 8),
    shutdownGraceSeconds: integer('SPEECH_SHUTDOWN_GRACE_SECONDS', 90, 5, 300),
    maxDurationSeconds: integer('TRANSCRIPTION_MAX_DURATION_SECONDS', integer('SPEECH_MAX_DURATION_SECONDS', 3600, 1, 14400), 1, 14400),
    dictationMaxDurationSeconds: integer('DICTATION_MAX_DURATION_SECONDS', 60, 1, 1800),
    dictationMaxAudioBytes: integer('DICTATION_MAX_AUDIO_BYTES', 5 * 1024 * 1024, 1, 25 * 1024 * 1024),
    transcriptionMaxAudioBytes: integer('TRANSCRIPTION_MAX_AUDIO_BYTES', 25 * 1024 * 1024, 1, 250 * 1024 * 1024),
    maxAudioBytes: mode === 'dictation'
      ? integer('DICTATION_MAX_AUDIO_BYTES', 5 * 1024 * 1024, 1, 25 * 1024 * 1024)
      : integer('TRANSCRIPTION_MAX_AUDIO_BYTES', 25 * 1024 * 1024, 1, 250 * 1024 * 1024),
    maxAttempts: integer('SPEECH_MAX_ATTEMPTS', 3, 1, 10),
    dictationAudioRetentionMs: integer('DICTATION_AUDIO_RETENTION_MINUTES', 5, 1, 60) * 60_000,
    heartbeatIntervalSeconds: integer('SPEECH_HEARTBEAT_INTERVAL_SECONDS', 5, 1, 60),
    inferenceStallSeconds: integer('SPEECH_INFERENCE_STALL_SECONDS', 300, 60, 7200),
    modelWarmupTimeoutSeconds: integer('SPEECH_MODEL_WARMUP_TIMEOUT_SECONDS', 300, 60, 1800),
    chunkSeconds: integer('SPEECH_CHUNK_SECONDS', 15, 5, 30),
    strideSeconds: integer('SPEECH_STRIDE_SECONDS', 1, 0, 15),
    vadThresholdDb: Number.parseFloat(process.env.SPEECH_VAD_THRESHOLD_DB || '-45'),
    autoStop: boolean('DICTATION_AUTO_STOP', true),
    silenceTimeoutMs: integer('DICTATION_SILENCE_TIMEOUT_MS', 1500, 500, 10000),
    local: {
      model,
      modelPath,
      revision: String(process.env.SPEECH_MODEL_REVISION || '').trim(),
      device: String(process.env.SPEECH_DEVICE || process.env.TRANSCRIPTION_LOCAL_DEVICE || 'cpu').trim().toLowerCase(),
      dtype: String(process.env.SPEECH_DTYPE || process.env.TRANSCRIPTION_LOCAL_DTYPE || 'q5_1').trim().toLowerCase(),
    },
    whisper: {
      binary: String(process.env.SPEECH_WHISPER_CPP_BINARY || '/usr/local/bin/whisper-server').trim(),
      port: integer('SPEECH_WHISPER_CPP_PORT', 8178, 1024, 65535),
      modelFile: String(process.env.SPEECH_WHISPER_MODEL_FILE || require('node:path').join(modelPath, model.includes('small') ? 'ggml-small-q5_1.bin' : 'ggml-base-q5_1.bin')).trim(),
      modelSha256: String(process.env.SPEECH_WHISPER_MODEL_SHA256 || '').trim().toLowerCase(),
    },
    sourceRetentionSeconds: durationSeconds('TRANSCRIPTION_SOURCE_RETENTION_SECONDS', 0),
    sourceCleanupIntervalSeconds: durationSeconds('TRANSCRIPTION_SOURCE_CLEANUP_INTERVAL_SECONDS', 900, 86_400),
    rabbitmq: {
      uri: String(process.env.RABBITMQ_URI || '').trim(),
      exchange,
    },
    s3: {
      endpoint: endpoint(process.env.S3_ENDPOINT),
      port: integer('S3_PORT', 9000, 1, 65535),
      useSSL: boolean('S3_USE_SSL', false),
      accessKey: String(process.env.S3_ACCESS_KEY || '').trim(),
      secretKey: String(process.env.S3_SECRET_KEY || '').trim(),
      bucket: String(process.env.S3_BUCKET || process.env.S3_BUCKET_NAME || '').trim(),
      speechBucket: String(process.env.SPEECH_S3_BUCKET_NAME || (process.env.S3_BUCKET || process.env.S3_BUCKET_NAME || '') + '-speech').trim(),
      region: String(process.env.S3_REGION || 'us-east-1').trim(),
    },
  };
}

function validateConfig(config) {
  if (!config.enabled) return;
  if (config.concurrency > 1) {
    throw new Error('O serviço único exige concorrência de inferência igual a 1.');
  }
  if (process.env.S3_BUCKET && process.env.S3_BUCKET_NAME && process.env.S3_BUCKET.trim() !== process.env.S3_BUCKET_NAME.trim()) {
    throw new Error('S3_BUCKET e S3_BUCKET_NAME divergem; alinhe o bucket de mídia da API e do serviço.');
  }
  const missing = [];
  if (!config.rabbitmq.uri) missing.push('RABBITMQ_URI');
  if (!config.rabbitmq.exchange) missing.push('RABBITMQ_EXCHANGE_NAME');
  if (!config.queue || config.queue.length > 180) missing.push('TRANSCRIPTION_QUEUE');
  if (!config.s3.accessKey) missing.push('S3_ACCESS_KEY');
  if (!config.s3.secretKey) missing.push('S3_SECRET_KEY');
  if (!config.s3.bucket) missing.push('S3_BUCKET');
  if (!config.local.model || config.local.model.length > 180 || /[\u0000\r\n]/.test(config.local.model)) {
    missing.push('SPEECH_MODEL');
  }
  if (config.mode === 'dictation' && config.queues && config.queue !== config.queues.dictation) {
    throw new Error('Uma operação de ditado precisa consumir SPEECH_DICTATION_QUEUE.');
  }
  if (config.engine && config.engine !== 'whisper.cpp') {
    throw new Error('SPEECH_ENGINE deve ser whisper.cpp; o executor Transformers foi removido, sem fallback automático.');
  }
  if (config.poolId && !/^[A-Za-z0-9._-]{1,100}$/.test(config.poolId)) {
    throw new Error('SPEECH_POOL_ID inválido.');
  }
  if (!['local'].includes(config.provider)) {
    throw new Error('SPEECH_PROVIDER=' + config.provider + ' não é compatível com o serviço local. Configure local e SPEECH_ENGINE explicitamente após migrar o provider.');
  }
  if (!['cpu'].includes(config.local.device)) {
    throw new Error('TRANSCRIPTION_LOCAL_DEVICE inválido: ' + config.local.device);
  }
  if (!['q5_1', 'q8', 'q4', 'fp32', 'fp16'].includes(config.local.dtype)) {
    throw new Error('TRANSCRIPTION_LOCAL_DTYPE inválido: ' + config.local.dtype);
  }
  if (missing.length) {
    throw new Error('Configuração do serviço incompleta: ' + missing.join(', '));
  }
}

module.exports = { loadConfig, validateConfig, normalizedProvider };
