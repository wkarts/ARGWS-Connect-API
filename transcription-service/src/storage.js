'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createHash } = require('node:crypto');
const { verifyModelDirectory } = require('./model-checksum');
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

async function downloadObjectToFile(client, bucket, sourceKey, mimetype, maxBytes, options = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'speech-source-'));
  const filePath = path.join(directory, 'audio' + extensionFor(mimetype, sourceKey));
  let total = 0;
  const hash = createHash('sha256');
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(Object.assign(new Error('Áudio excede o limite de bytes permitido.'), { code: 'AUDIO_TOO_LARGE', retryable: false }));
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });

  try {
    const signal = options.signal || AbortSignal.timeout(options.timeoutMs || 60000);
    signal.throwIfAborted();
    let abort;
    const pendingSource = client.getObject(bucket, objectKey(sourceKey));
    // If getObject resolves after cancellation, its socket still must be closed.
    void pendingSource.then((source) => { if (signal.aborted) source.destroy(); }, () => {});
    const source = await Promise.race([
      pendingSource,
      new Promise((_, reject) => {
        abort = () => reject(Object.assign(new Error('Download de áudio cancelado ou expirado.'), { code: 'AUDIO_DOWNLOAD_ABORTED', retryable: true }));
        signal.addEventListener('abort', abort, { once: true });
      }),
    ]).finally(() => signal.removeEventListener('abort', abort));
    await pipeline(source, limiter, fs.createWriteStream(filePath, { mode: 0o600, flags: 'wx' }), { signal });
    const digest = hash.digest('hex');
    if (options.sha256 && digest !== options.sha256) {
      throw Object.assign(new Error('A fonte de áudio não corresponde ao SHA-256 autorizado.'), { code: 'SOURCE_HASH_MISMATCH', retryable: false });
    }
    if (options.expectedBytes !== undefined && Number(options.expectedBytes) !== total) {
      throw Object.assign(new Error('O tamanho da fonte diverge do job autorizado.'), { code: 'SOURCE_SIZE_MISMATCH', retryable: false });
    }
    return { directory, filePath, bytes: total, sha256: digest };
  } catch (error) {
    await cleanup(directory);
    throw error;
  }
}

async function writeBufferToTemp(buffer, mimetype, maxBytes) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Áudio inline vazio.');
  if (buffer.length > maxBytes) throw new Error('Áudio excede o limite configurado.');
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'speech-dictation-'));
  const filePath = path.join(directory, 'audio' + extensionFor(mimetype, 'audio'));
  try {
    await fsp.writeFile(filePath, buffer, { mode: 0o600, flag: 'wx' });
    return { directory, filePath, bytes: buffer.length };
  } catch (error) {
    await cleanup(directory);
    throw error;
  }
}

async function cleanup(directory) {
  if (!directory) return;
  await fsp.rm(directory, { recursive: true, force: true }).catch(() => {});
}

module.exports = {
  createClient,
  objectKey,
  verifyModelDirectory,
  downloadObjectToFile,
  writeBufferToTemp,
  cleanup,
};
