'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { InferenceClient } = require('../src/inference-client');
const { groupHasLiveProcesses } = require('../src/process-supervisor');
const fixture = path.join(__dirname, 'fixtures/stalling-inference.cjs');

test('mantém o mesmo processo entre jobs e aceita métricas sem job', async () => {
  const client = new InferenceClient({}, { workerPath: fixture });
  try {
    await client.warmup();
    client.sampleMemory();
    const a = await client.transcribe('a.ogg');
    const b = await client.transcribe('b.ogg');
    assert.equal(a.pid, b.pid);
    assert.equal(a.text, 'recuperado');
    assert.ok(client.lastSuccessfulInferenceAt);
  } finally { await client.stop(); }
});

test('heartbeat do coordenador continua durante código nativo síncrono simulado', async () => {
  const client = new InferenceClient({}, { workerPath: path.join(__dirname, 'fixtures/blocking-inference.cjs') });
  let heartbeats = 0;
  try {
    await client.warmup();
    const interval = setInterval(() => { heartbeats += 1; }, 15);
    try { assert.equal((await client.transcribe('audio.ogg')).text, 'concluído'); assert.ok(heartbeats >= 3); }
    finally { clearInterval(interval); }
  } finally { await client.stop(); }
});

test('watchdog encerra processo travado antes de permitir um substituto', async () => {
  const client = new InferenceClient({ processKillGraceMs: 50 }, { workerPath: fixture, stallTimeoutMs: 80 });
  try {
    await client.warmup();
    const previousPid = client.child.pid;
    assert.equal(await groupHasLiveProcesses(previousPid), true);
    await assert.rejects(client.transcribe('travado.ogg', { stall: true }), { code: 'INFERENCE_STALLED', retryable: true });
    assert.equal(await groupHasLiveProcesses(previousPid), false);
    const next = await client.transcribe('seguinte.ogg');
    assert.notEqual(next.pid, previousPid);
  } finally { await client.stop(); }
});

test('deadline absoluto do chunk encerra nativo sem depender de progresso', async () => {
  const client = new InferenceClient({ processKillGraceMs: 50 }, { workerPath: fixture, stallTimeoutMs: 10000, chunkDeadlineMs: 80 });
  try {
    await client.warmup();
    await assert.rejects(client.transcribeChunk('travado.ogg', { stall: true }), { code: 'CHUNK_DEADLINE_EXCEEDED' });
  } finally { await client.stop(); }
});

test('cancelamento aguarda morte do líder e de seu subprocesso antes de rejeitar job', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-process-test-'));
  const client = new InferenceClient({ processKillGraceMs: 50 }, { workerPath: fixture, stallTimeoutMs: 10000 });
  try {
    await client.warmup();
    const pid = client.child.pid;
    const pidFile = path.join(root, 'grandchild.pid');
    const pending = assert.rejects(client.transcribe('cancel.ogg', { stall: true, grandchildPidFile: pidFile }), { code: 'CANCELLED' });
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await fs.access(pidFile).then(() => true, () => false)) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(Number(await fs.readFile(pidFile, 'utf8')) > 0);
    await client.cancel(); await pending;
    assert.equal(await groupHasLiveProcesses(pid), false);
    assert.equal(client.active, null);
  } finally { await client.stop(); await fs.rm(root, { recursive: true, force: true }); }
});

test('stop remove os temporários só após encerrar o grupo nativo', async () => {
  const client = new InferenceClient({ processKillGraceMs: 50 }, { workerPath: fixture });
  await client.warmup();
  const directory = client.tempDirectory;
  await fs.writeFile(path.join(directory, 'orphan.pcm'), 'pcm');
  const pending = assert.rejects(client.transcribe('pending.ogg', { stall: true }), { code: 'WORKER_STOPPING' });
  await client.stop(); await pending;
  await assert.rejects(fs.access(directory), { code: 'ENOENT' });
});

test('quando restart está desativado um processo falho não aquece modelo novo', async () => {
  const client = new InferenceClient({ processKillGraceMs: 50 }, { workerPath: fixture, stallTimeoutMs: 80, restartOnFailure: false });
  try {
    await client.warmup();
    await assert.rejects(client.transcribe('pending.ogg', { stall: true }), { code: 'INFERENCE_STALLED' });
    await assert.rejects(client.transcribe('next.ogg'), { code: 'INFERENCE_PROCESS_FAILED' });
  } finally { await client.stop(); }
});

test('SIGKILL real do coordenador não deixa engine bloqueado nem seus descendentes vivos', { timeout: 10000 }, async () => {
  const { fork } = require('node:child_process');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'speech-orphan-test-'));
  const coordinator = fork(path.join(__dirname, 'fixtures/guardian-parent.cjs'), [path.join(root, 'native.pid')], {
    detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let status;
  try {
    status = await new Promise((resolve, reject) => {
      coordinator.once('message', resolve); coordinator.once('error', reject);
      coordinator.once('exit', (code) => { if (!status) reject(new Error(`Coordinator exited before ready: ${code}`)); });
    });
    assert.equal(await groupHasLiveProcesses(status.groupId), true);
    coordinator.kill('SIGKILL');
    const until = Date.now() + 3000;
    while (Date.now() < until && await groupHasLiveProcesses(status.groupId)) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(await groupHasLiveProcesses(status.groupId), false);
    // A new resident is only started after death of the previous group was observed.
    const next = new InferenceClient({}, { workerPath: fixture });
    try { await next.warmup(); assert.equal((await next.transcribe('next.ogg')).text, 'recuperado'); }
    finally { await next.stop(); }
  } finally {
    coordinator.kill('SIGKILL');
    if (status?.groupId) { try { process.kill(-status.groupId, 'SIGKILL'); } catch {} }
    if (status?.directory) await fs.rm(status.directory, { recursive: true, force: true });
    await fs.rm(root, { recursive: true, force: true });
  }
});
