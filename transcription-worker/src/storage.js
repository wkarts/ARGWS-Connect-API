'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const Minio = require('minio');

function createClient(config) {
  return new Minio.Client({
    endPoint: config.endpoint,
    port: config.port,
    useSSL: config.useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
  });
}

function objectKey(sourceKey) {
  const value = String(sourceKey || '').replace(/\\/g, '/').trim().replace(/^\.\//, '');
  if (!value || value.includes('\0') || value.startsWith('/') || value.split('/').includes('..')) {
    throw new Error('source.key inválida para leitura no armazenamento.');
  }
  return value.startsWith('argws-connect-api/') ? value : 'argws-connect-api/' + value;
}

function extensionFor(mimetype, sourceKey) {
  const normalizedMime = String(mimetype || '').split(';', 1)[0].trim().toLowerCase();
  const byMime = {
    'audio/ogg': '.ogg',
    'audio/opus': '.opus',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/wav': '.wav',
    'audio/wave': '.wav',
    'audio/webm': '.webm',
    'audio/amr': '.amr',
  };
  if (normalizedMime === 'video/webm') return '.webm';
  if (byMime[normalizedMime]) return byMime[normalizedMime];
  const ext = path.extname(String(sourceKey || '')).toLowerCase();
  return /^[.][a-z0-9]{1,8}$/.test(ext) ? ext : '.audio';
}

async function downloadObjectToFile(client, bucket, sourceKey, mimetype, maxBytes) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'argws-connect-transcription-'));
  const filePath = path.join(directory, 'audio' + extensionFor(mimetype, sourceKey));
  let total = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(new Error('Áudio excede TRANSCRIPTION_MAX_AUDIO_BYTES.'));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    const source = await client.getObject(bucket, objectKey(sourceKey));
    await pipeline(source, limiter, fs.createWriteStream(filePath, { mode: 0o600 }));
    return { directory, filePath, bytes: total };
  } catch (error) {
    await cleanup(directory);
    throw error;
  }
}

async function cleanup(directory) {
  if (!directory) return;
  await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
}

module.exports = { createClient, objectKey, downloadObjectToFile, cleanup };
