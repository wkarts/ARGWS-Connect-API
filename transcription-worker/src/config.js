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

function endpoint(value) {
  return String(value || 'minio')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');
}

function normalizedProvider() {
  // `openai` was the old value. Treat it as a local migration alias so an
  // existing .env never causes a restart loop or a network call.
  const value = String(process.env.TRANSCRIPTION_PROVIDER || process.env.TRANSCRIPTION_ENGINE || 'local')
    .trim()
    .toLowerCase();
  return value === 'openai' ? 'local' : value;
}

function loadConfig() {
  return {
    enabled: boolean('TRANSCRIPTION_ENABLED', false),
    provider: normalizedProvider(),
    queue: String(process.env.TRANSCRIPTION_QUEUE || 'argws-connect.transcription').trim(),
    concurrency: integer('TRANSCRIPTION_WORKER_CONCURRENCY', 1, 1, 8),
    maxAudioBytes: integer('TRANSCRIPTION_MAX_AUDIO_BYTES', 25 * 1024 * 1024, 1, 250 * 1024 * 1024),
    local: {
      model: String(process.env.TRANSCRIPTION_LOCAL_MODEL || 'Xenova/whisper-small').trim(),
      device: String(process.env.TRANSCRIPTION_LOCAL_DEVICE || 'cpu').trim().toLowerCase(),
      dtype: String(process.env.TRANSCRIPTION_LOCAL_DTYPE || 'q8').trim().toLowerCase(),
      cacheDir: String(process.env.TRANSCRIPTION_MODEL_CACHE_DIR || '/home/node/.cache/huggingface').trim(),
    },
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
  const missing = [];
  if (!config.rabbitmq.uri) missing.push('RABBITMQ_URI');
  if (!config.rabbitmq.exchange) missing.push('RABBITMQ_EXCHANGE_NAME');
  if (!config.queue || config.queue.length > 180) missing.push('TRANSCRIPTION_QUEUE');
  if (!config.s3.accessKey) missing.push('S3_ACCESS_KEY');
  if (!config.s3.secretKey) missing.push('S3_SECRET_KEY');
  if (!config.s3.bucket) missing.push('S3_BUCKET');
  if (!config.local.model || config.local.model.length > 180 || /[\u0000\r\n]/.test(config.local.model)) {
    missing.push('TRANSCRIPTION_LOCAL_MODEL');
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
