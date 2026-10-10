'use strict';

// Model hashing/downloads run outside the HTTP process with bounded buffers.
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { lstat, mkdir, open, readFile, rename, rm, stat, statfs, utimes, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const catalog = require('./speech-models.json');
const STATUS_FILE = '.speech-model-download.json';
const LOCK_FILE = '.speech-model-download.lock';
const MANIFEST_FILE = '.speech-model-checksums.json';
const TRANSACTION_FILE = '.speech-model-transaction.json';

function targetFor(root, model) {
  const target = path.resolve(root, model.relativeDirectory);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error('Diretório do modelo inválido.');
  return target;
}

async function fingerprint(root, model) {
  const target = targetFor(root, model);
  const directory = await lstat(target);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Diretório de modelo inválido.');
  const parts = [];
  for (const filename of [MANIFEST_FILE, ...model.files]) {
    const item = await lstat(path.join(target, filename));
    if (!item.isFile() || item.isSymbolicLink() || !item.size) throw new Error('Arquivo de modelo inválido: ' + filename);
    parts.push([filename, item.size, item.mtimeMs, item.ctimeMs, item.ino]);
  }
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

async function readStatus(root) {
  try { return JSON.parse(await readFile(path.join(root, STATUS_FILE), 'utf8')); } catch { return null; }
}

async function writeStatus(root, value) {
  const temporary = path.join(root, `${STATUS_FILE}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify({ ...value, updatedAt: new Date().toISOString() }), { mode: 0o644 });
  await rename(temporary, path.join(root, STATUS_FILE));
}

// A killed installer may leave the old directory renamed or a partial staging
// directory. The next lock owner recovers only paths recorded by this installer.
async function recoverTransaction(root) {
  const journalPath = path.join(root, TRANSACTION_FILE);
  const raw = await readFile(journalPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (raw === null) return;
  const journal = JSON.parse(raw);
  const model = catalog.find((entry) => entry.id === journal.modelId);
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
  if (!model || !new RegExp('^\\.speech-model-staging-' + uuid + '$').test(journal.stage || '') ||
      !new RegExp('^' + uuid + '$').test(journal.backupId || '')) {
    throw new Error('Registro de recuperação de modelo inválido.');
  }
  let directory = root;
  for (const segment of model.relativeDirectory.split('/').slice(0, -1)) {
    directory = path.join(directory, segment);
    if ((await lstat(directory).catch(() => null))?.isSymbolicLink()) {
      throw new Error('Pasta de recuperação não pode ser um link simbólico.');
    }
  }
  const target = targetFor(root, model);
  const stage = path.join(root, journal.stage);
  const backup = target + '.previous-' + journal.backupId;
  const info = await Promise.all([target, stage, backup].map((name) => lstat(name).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  })));
  if (info.some((item) => item && (!item.isDirectory() || item.isSymbolicLink()))) {
    throw new Error('Diretório de recuperação de modelo inválido.');
  }
  if (info[2]) {
    const validTarget = info[0] && await verify(root, model).then(() => true, () => false);
    if (validTarget) await rm(backup, { recursive: true, force: true });
    else {
      if (info[0]) await rm(target, { recursive: true, force: true });
      await rename(backup, target);
    }
  }
  if (info[1]) await rm(stage, { recursive: true, force: true });
  await rm(journalPath, { force: true });
}

async function hashFile(filename) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(filename, { highWaterMark: 64 * 1024 })) hash.update(bytes);
  return hash.digest('hex');
}

async function verify(root, model) {
  const target = targetFor(root, model);
  const before = await fingerprint(root, model);
  const manifest = JSON.parse(await readFile(path.join(target, MANIFEST_FILE), 'utf8'));
  if (manifest.algorithm !== 'sha256' || manifest.model !== model.id || manifest.revision !== model.revision) {
    throw new Error('Manifesto incompatível com modelo/revisão configurados.');
  }
  for (const filename of model.files) {
    const expected = String(manifest.files?.[filename] || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Checksum ausente: ' + filename);
    if (model.hashes?.[filename] && expected !== model.hashes[filename]) {
      throw new Error('Checksum não corresponde ao catálogo fixado: ' + filename);
    }
    if (await hashFile(path.join(target, filename)) !== expected) throw new Error('Checksum inválido: ' + filename);
  }
  if (await fingerprint(root, model) !== before) throw new Error('Modelo mudou durante a verificação.');
  return before;
}

async function remoteFiles(model, fetcher, signal) {
  if (model.files.every((name) => model.hashes?.[name] && model.sizes?.[name])) {
    return model.files.map((name) => ({ path: name, size: model.sizes[name], sha256: model.hashes[name] }));
  }
  const response = await fetcher(
    `https://huggingface.co/api/models/${model.repository}/tree/${model.revision}?recursive=true&expand=true`,
    { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) },
  );
  if (!response.ok || !response.body) throw new Error(`Catálogo remoto indisponível (HTTP ${response.status}).`);
  const chunks = [];
  let size = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('Catálogo remoto excedeu o limite.');
    chunks.push(chunk);
  }
  const entries = JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  if (!Array.isArray(entries)) throw new Error('Catálogo remoto inválido.');
  return model.files.map((name) => {
    const item = entries.find((entry) => entry.type === 'file' && entry.path === name);
    if (!item || !Number.isSafeInteger(item.size) || item.size <= 0 || item.size > 1024 * 1024 * 1024) {
      throw new Error('Arquivo indisponível na revisão fixada: ' + name);
    }
    const sha256 = String(item.lfs?.oid || '').replace(/^sha256:/i, '').toLowerCase();
    return { path: name, size: item.size, sha256: /^[a-f0-9]{64}$/.test(sha256) ? sha256 : null };
  });
}

async function downloadFile({ file, model, stage, completed, total, root, state, fetcher, signal }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Download excedeu 10 minutos.')), 600_000);
  timeout.unref?.();
  let idle;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => controller.abort(new Error('Download sem dados por 30 segundos.')), 30_000);
    idle.unref?.();
  };
  touch();
  const combined = AbortSignal.any([signal, controller.signal]);
  try {
    const encoded = file.path.split('/').map(encodeURIComponent).join('/');
    const response = await fetcher(
      `https://huggingface.co/${model.repository}/resolve/${model.revision}/${encoded}?download=true`,
      { signal: combined },
    );
    if (!response.ok || !response.body) throw new Error(`Download indisponível (HTTP ${response.status}).`);
    const target = path.join(stage, file.path);
    await mkdir(path.dirname(target), { recursive: true });
    let received = 0;
    let savedAt = 0;
    const hash = createHash('sha256');
    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > file.size) return callback(new Error('Download excedeu o tamanho publicado.'));
        touch();
        hash.update(chunk);
        if (Date.now() - savedAt >= 1000) {
          savedAt = Date.now();
          writeStatus(root, { ...state, downloadedBytes: completed + received, totalBytes: total,
            progressPercent: Math.min(99, Math.floor(100 * (completed + received) / total)) })
            .then(() => callback(null, chunk), callback);
        } else callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(target + '.part', { flags: 'wx' }),
      { signal: combined });
    if (received !== file.size) throw new Error('Tamanho baixado não corresponde ao catálogo.');
    const actual = hash.digest('hex');
    if (file.sha256 && actual !== file.sha256) throw new Error('SHA-256 remoto inválido: ' + file.path);
    await rename(target + '.part', target);
    return actual;
  } finally { clearTimeout(timeout); clearTimeout(idle); }
}

async function provisionModel(options, dependencies = {}) {
  const { modelId, operation = 'download', force = false } = options;
  const root = path.resolve(options.root || '/models');
  const model = catalog.find((entry) => entry.id === modelId);
  if (!model) throw new Error('Modelo fora do catálogo permitido.');
  await mkdir(root, { recursive: true });
  let current = root;
  for (const segment of model.relativeDirectory.split('/').slice(0, -1)) {
    current = path.join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (info?.isSymbolicLink()) throw new Error('Pasta de modelo não pode ser um link simbólico.');
  }
  const lockPath = path.join(root, LOCK_FILE);
  const lock = await open(lockPath, 'wx', 0o644).catch(async (error) => {
    if (error.code !== 'EEXIST') throw error;
    const previous = await stat(lockPath).catch(() => null);
    if (previous && Date.now() - previous.mtimeMs > 120_000) {
      await rm(lockPath, { force: true });
      return open(lockPath, 'wx', 0o644).catch((next) => { if (next.code === 'EEXIST') return null; throw next; });
    }
    return null;
  });
  if (!lock) return { busy: true };
  const lockId = randomUUID();
  await lock.writeFile(JSON.stringify({ pid: process.pid, lockId, modelId, operation }));
  await lock.close();
  const heartbeat = setInterval(() => void utimes(lockPath, new Date(), new Date()).catch(() => {}), 10_000);
  heartbeat.unref?.();
  const absolute = AbortSignal.timeout(1_800_000);
  const signal = dependencies.signal ? AbortSignal.any([absolute, dependencies.signal]) : absolute;
  const fetcher = dependencies.fetch || globalThis.fetch;
  let stage;
  let checkedFingerprint = await fingerprint(root, model).catch(() => null);
  const state = { id: model.id, engine: model.engine, revision: model.revision,
    status: operation === 'verify' ? 'verifying' : 'downloading', progressPercent: 0,
    downloadedBytes: 0, totalBytes: 0, errorMessage: null, startedAt: new Date().toISOString() };
  try {
    await recoverTransaction(root);
    checkedFingerprint = await fingerprint(root, model).catch(() => null);
    await writeStatus(root, state);
    if (operation === 'verify' || (!force && checkedFingerprint)) {
      try {
        checkedFingerprint = await verify(root, model);
        await writeStatus(root, { ...state, status: 'ready', progressPercent: 100,
          checkedFingerprint, verifiedAt: new Date().toISOString() });
        return { verified: true };
      } catch (error) { if (operation === 'verify') throw error; }
    }
    const files = await remoteFiles(model, fetcher, signal);
    const total = files.reduce((sum, file) => sum + file.size, 0);
    const space = await statfs(root);
    if (Number(space.bavail) * Number(space.bsize) < total * 1.1 + 64 * 1024 * 1024) {
      throw new Error('Espaço insuficiente para preparar o modelo com segurança.');
    }
    const stageName = `.speech-model-staging-${randomUUID()}`;
    const backupId = randomUUID();
    stage = path.join(root, stageName);
    const journalPath = path.join(root, TRANSACTION_FILE);
    const journalTemporary = journalPath + '.' + randomUUID() + '.tmp';
    await writeFile(journalTemporary, JSON.stringify({ modelId, stage: stageName, backupId }), { mode: 0o644 });
    await rename(journalTemporary, journalPath);
    await mkdir(stage, { recursive: true });
    let completed = 0;
    const hashes = {};
    for (const file of files) {
      hashes[file.path] = await downloadFile({ file, model, stage, completed, total, root, state, fetcher, signal });
      completed += file.size;
    }
    await writeFile(path.join(stage, MANIFEST_FILE), JSON.stringify({ algorithm: 'sha256',
      model: model.id, engine: model.engine, revision: model.revision, files: hashes,
      downloadedAt: new Date().toISOString() }), { mode: 0o644 });
    const target = targetFor(root, model);
    await mkdir(path.dirname(target), { recursive: true });
    const old = await lstat(target).catch(() => null);
    if (old?.isSymbolicLink()) throw new Error('Diretório do modelo não pode ser um link simbólico.');
    const backup = `${target}.previous-${backupId}`;
    if (old) await rename(target, backup);
    try { await rename(stage, target); stage = null; }
    catch (error) { if (old) await rename(backup, target); throw error; }
    if (old) await rm(backup, { recursive: true, force: true });
    await rm(journalPath, { force: true });
    checkedFingerprint = await fingerprint(root, model);
    await writeStatus(root, { ...state, status: 'ready', downloadedBytes: total, totalBytes: total,
      progressPercent: 100, checkedFingerprint, verifiedAt: new Date().toISOString() });
    return { verified: true };
  } catch (error) {
    await writeStatus(root, { ...state, status: 'failed', checkedFingerprint,
      errorMessage: String(error.message || error).slice(0, 500) });
    throw error;
  } finally {
    clearInterval(heartbeat);
    if (stage) await rm(stage, { recursive: true, force: true }).catch(() => {});
    await recoverTransaction(root).catch(() => {});
    const owner = JSON.parse(await readFile(lockPath, 'utf8').catch(() => '{}'));
    if (owner.lockId === lockId) await rm(lockPath, { force: true });
  }
}

if (require.main === module) {
  provisionModel({ modelId: process.argv[2], root: process.argv[3],
    operation: process.argv.includes('--verify') ? 'verify' : 'download', force: process.argv.includes('--force') })
    .catch((error) => { console.error(String(error.message || error).slice(0, 500)); process.exitCode = 1; });
}
module.exports = { provisionModel, fingerprint, verify, readStatus, writeStatus, recoverTransaction, catalog, STATUS_FILE, LOCK_FILE };
