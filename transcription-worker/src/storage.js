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

function modelCachePrefix(storagePrefix, model) {
  const prefix = String(storagePrefix || 'transcription-models')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  const modelPath = String(model || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/[^A-Za-z0-9._-]/g, '_'))
    .join('/');
  if (!prefix || !modelPath || prefix.includes('..') || modelPath.includes('..')) {
    throw new Error('Prefixo ou modelo inválido para o cache persistente.');
  }
  return `${prefix}/${modelPath}/`;
}

async function listObjectNames(client, bucket, prefix) {
  return await new Promise((resolve, reject) => {
    const names = [];
    const stream = client.listObjectsV2(bucket, prefix, true);
    stream.on('data', (item) => {
      const name = String(item?.name || '');
      if (name) names.push(name);
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(names));
  });
}

function safeCachePath(cacheDir, relativePath) {
  const root = path.resolve(cacheDir);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Caminho de cache fora do diretório permitido.');
  }
  return target;
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function restoreModelCache(client, bucket, storagePrefix, model, cacheDir) {
  const remotePrefix = objectKey(modelCachePrefix(storagePrefix, model));
  const names = await listObjectNames(client, bucket, remotePrefix);
  let restored = 0;
  for (const name of names) {
    const relativePath = name.slice(remotePrefix.length);
    if (!relativePath || relativePath.endsWith('/')) continue;
    const target = safeCachePath(cacheDir, relativePath);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const source = await client.getObject(bucket, name);
    await pipeline(source, fs.createWriteStream(target, { flags: 'w', mode: 0o600 }));
    restored += 1;
  }
  const manifestPath = safeCachePath(cacheDir, '.speech-model-checksums.json');
  if (fs.existsSync(manifestPath)) {
    let manifest;
    try {
      manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
    } catch {
      throw Object.assign(new Error('Manifesto de checksum do modelo inválido.'), { code: 'MODEL_CHECKSUM_MISMATCH' });
    }
    const checksums = manifest?.files && typeof manifest.files === 'object' ? manifest.files : {};
    for (const [relativePath, expected] of Object.entries(checksums)) {
      const filePath = safeCachePath(cacheDir, relativePath);
      const actual = await hashFile(filePath).catch(() => '');
      if (!actual || actual !== expected) {
        throw Object.assign(new Error('Checksum inválido no cache local do modelo.'), { code: 'MODEL_CHECKSUM_MISMATCH' });
      }
    }
  }
  return restored;
}

async function listFiles(root, relative = '') {
  const directory = safeCachePath(root, relative || '.');
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRelative = relative ? path.posix.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, childRelative));
    } else if (entry.isFile()) {
      files.push(childRelative.replace(/\\/g, '/'));
    }
  }
  return files;
}

async function persistModelCache(client, bucket, storagePrefix, model, cacheDir) {
  const localFiles = (await listFiles(cacheDir)).filter((file) => file !== '.speech-model-checksums.json');
  const remotePrefix = modelCachePrefix(storagePrefix, model);
  const checksums = {};
  for (const relativePath of localFiles) {
    const sourcePath = safeCachePath(cacheDir, relativePath);
    const stat = await fsp.stat(sourcePath);
    checksums[relativePath] = await hashFile(sourcePath);
    await client.putObject(
      bucket,
      objectKey(remotePrefix + relativePath),
      fs.createReadStream(sourcePath),
      stat.size,
      { 'Content-Type': 'application/octet-stream' },
    );
  }
  const manifest = Buffer.from(JSON.stringify({ algorithm: 'sha256', files: checksums }, null, 2));
  await client.putObject(
    bucket,
    objectKey(remotePrefix + '.speech-model-checksums.json'),
    manifest,
    manifest.length,
    { 'Content-Type': 'application/json' },
  );
  return localFiles.length;
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
  modelCachePrefix,
  restoreModelCache,
  persistModelCache,
  verifyModelDirectory,
  downloadObjectToFile,
  writeBufferToTemp,
  cleanup,
};
