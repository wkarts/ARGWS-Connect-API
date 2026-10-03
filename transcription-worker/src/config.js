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

function loadConfig() {
  return {
    enabled: boolean('TRANSCRIPTION_ENABLED', false),
    provider: String(process.env.TRANSCRIPTION_PROVIDER || 'openai').trim().toLowerCase(),
    queue: String(process.env.TRANSCRIPTION_QUEUE || 'argws-connect.transcription').trim(),
    concurrency: integer('TRANSCRIPTION_WORKER_CONCURRENCY', 1, 1, 8),
    maxAudioBytes: integer('TRANSCRIPTION_MAX_AUDIO_BYTES', 25 * 1024 * 1024, 1, 250 * 1024 * 1024),
    openai: {
      apiKey: String(process.env.OPENAI_API_KEY_GLOBAL || '').trim(),
      model: String(process.env.TRANSCRIPTION_OPENAI_MODEL || 'whisper-1').trim(),
      timeoutMs: integer('TRANSCRIPTION_OPENAI_TIMEOUT_MS', 120000, 1000, 600000),
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
  if (config.provider === 'openai' && !config.openai.apiKey) missing.push('OPENAI_API_KEY_GLOBAL');
  if (!['openai'].includes(config.provider)) {
    throw new Error('TRANSCRIPTION_PROVIDER não suportado pelo worker: ' + config.provider);
  }
  if (missing.length) {
    throw new Error('Configuração do worker incompleta: ' + missing.join(', '));
  }
}

module.exports = { loadConfig, validateConfig };
