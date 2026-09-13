'use strict';

require('tsx/cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DiagnosticStore, validateDiagnosticFilter } = require('../src/diagnostics/diagnostic-store.ts');
const { DIAGNOSTIC_CODES } = require('../src/diagnostics/diagnostic-types.ts');

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const event = (id, fields = {}) => ({
  id: `event-${String(id).padStart(5, '0')}`, timestamp: new Date(NOW).toISOString(),
  level: 'info', category: 'call', code: DIAGNOSTIC_CODES[0], summary: 'Evento de chamada.',
  traceId: 'trace-1', callId: 'call-1', instanceId: 'instance-012345abcdef', ...fields,
});
async function setup(t, clock = () => NOW) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'argws-diagnostic-store-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return { dir, store: new DiagnosticStore(dir, { clock }) };
}
async function collect(iterable) { const result = []; for await (const item of iterable) result.push(item); return result; }

test('persists private JSONL and settings across a real process-store restart', async t => {
  const { dir, store } = await setup(t);
  store.append(event(1));
  store.append(event(2, { level: 'error', category: 'error' }));
  await store.flush();
  await store.updateSettings({ retentionDays: 10, maxDiskMB: 64 });
  const files = (await fs.readdir(dir)).filter(name => name.endsWith('.jsonl'));
  assert.equal(files.length, 1);
  assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
  assert.equal((await fs.stat(path.join(dir, files[0]))).mode & 0o777, 0o600);
  const restarted = new DiagnosticStore(dir, { clock: () => NOW });
  const status = await restarted.snapshot();
  assert.equal(status.persistent, true);
  assert.equal(status.retentionDays, 10);
  assert.equal(status.maxDiskBytes, 64 * 1024 * 1024);
  assert.equal(status.storedEvents, 2);
  assert.deepEqual(status.counts, { info: 1, warn: 0, error: 1 });
  assert.equal(status.categories.call, 1);
  assert.deepEqual((await restarted.query()).events.map(e => e.id), ['event-00002', 'event-00001']);
});

test('query and export apply the same date, severity, category and correlation filters', async t => {
  const { store } = await setup(t);
  store.append(event(1, { timestamp: '2026-09-13T11:00:00.000Z' }));
  store.append(event(2, { level: 'error', category: 'call' }));
  store.append(event(3, { level: 'error', category: 'error' }));
  store.append(event(4, { level: 'error', traceId: 'trace-2' }));
  store.append(event(5, { level: 'error', callId: 'call-2' }));
  store.append(event(6, { level: 'error', instanceId: 'instance-other' }));
  const filter = { from: '2026-09-13T11:30:00Z', to: '2026-09-13T12:00:00Z',
    level: 'error', category: 'call', code: DIAGNOSTIC_CODES[0], traceId: 'trace-1', callId: 'call-1', instanceId: 'instance-012345abcdef' };
  assert.deepEqual((await store.query(filter)).events.map(e => e.id), ['event-00002']);
  assert.deepEqual((await collect(store.exportRecords(filter))).map(e => e.id), ['event-00002']);
});

test('pagination remains stable when new events arrive between pages, including identical timestamps', async t => {
  const { store } = await setup(t);
  for (let i = 0; i < 7; i++) store.append(event(i));
  const first = await store.query({ limit: 3 });
  assert.deepEqual(first.events.map(e => e.id), ['event-00006', 'event-00005', 'event-00004']);
  assert.ok(first.nextCursor);
  store.append(event(100, { timestamp: new Date(NOW + 1).toISOString() }));
  const second = await store.query({ limit: 3, cursor: first.nextCursor });
  const last = await store.query({ limit: 3, cursor: second.nextCursor });
  assert.deepEqual(second.events.map(e => e.id), ['event-00003', 'event-00002', 'event-00001']);
  assert.deepEqual(last.events.map(e => e.id), ['event-00000']);
  assert.equal(last.nextCursor, null);
  assert.equal((await collect(store.exportRecords({ limit: 1, cursor: first.nextCursor }))).length, 8);
});

test('rejects malformed filters and forged cursors without touching arbitrary paths', async () => {
  for (const filter of [null, [], { from: 'tomorrow' }, { from: '2026-02-30T12:00:00Z' },
    { from: '2026-09-13T12:00:00Z', to: '2026-09-12T12:00:00Z' },
    { from: '2026-08-01T12:00:00Z', to: '2026-09-12T12:00:00Z' }, { level: 'debug' },
    { category: 'messages' }, { code: 'invented' }, { callId: '../../password' },
    { instanceId: 'phone@server' }, { traceId: 'a'.repeat(129) }, { limit: 0 }, { limit: 201 },
    { limit: '10' }, { cursor: 'not-a-cursor' }, { cursor: Buffer.from('{}').toString('base64url') }, { path: '/tmp' }]) {
    assert.throws(() => validateDiagnosticFilter(filter), error => error.name === 'DiagnosticValidationError' && error.status === 400);
  }
});

test('rotates real data below 4 MiB and enforces the configured total disk quota', async t => {
  const { dir, store } = await setup(t);
  await store.updateSettings({ maxDiskMB: 32 });
  for (let i = 0; i < 600; i++) store.append(event(i, { details: { padding: 'x'.repeat(60000) } }));
  await store.flush();
  const status = await store.snapshot();
  assert.ok(status.diskBytes <= 32 * 1024 * 1024);
  assert.ok(status.storedEvents > 0 && status.storedEvents < 600);
  const files = (await fs.readdir(dir)).filter(name => name.endsWith('.jsonl'));
  assert.ok(files.length > 1);
  for (const name of files) assert.ok((await fs.stat(path.join(dir, name))).size <= 4 * 1024 * 1024);
  const restarted = new DiagnosticStore(dir, { clock: () => NOW });
  assert.equal((await restarted.snapshot()).storedEvents, status.storedEvents);
});

test('compacts sparse flushes without prematurely losing retained history', async t => {
  const { dir, store } = await setup(t);
  for (let i = 0; i < 330; i++) { store.append(event(i)); await store.flush(); }
  const files = (await fs.readdir(dir)).filter(name => name.endsWith('.jsonl'));
  assert.ok(files.length <= 256);
  assert.equal((await store.snapshot()).storedEvents, 330);
  assert.equal((await collect(store.exportRecords())).length, 330);
  const restarted = new DiagnosticStore(dir, { clock: () => NOW });
  assert.equal((await restarted.snapshot()).storedEvents, 330);
  assert.equal((await restarted.snapshot()).storageError, false);
});

test('recovers interrupted compaction without duplicate events or arbitrary file deletion', async t => {
  const { dir, store } = await setup(t);
  for (let i = 0; i < 256; i++) { store.append(event(i)); await store.flush(); }
  const originalName = (await fs.readdir(dir)).filter(name => name.endsWith('.jsonl')).sort()[0];
  const original = await fs.readFile(path.join(dir, originalName));
  store.append(event(256));
  await store.flush();
  await assert.rejects(fs.stat(path.join(dir, originalName)), { code: 'ENOENT' });
  // A crash after replacement commit but before removing originals leaves this exact state.
  await fs.writeFile(path.join(dir, originalName), original);
  const staged = originalName + '.tmp';
  await fs.writeFile(path.join(dir, staged), 'partially written staging data');
  const restarted = new DiagnosticStore(dir, { clock: () => NOW });
  assert.equal((await restarted.snapshot()).storedEvents, 257);
  const records = await collect(restarted.exportRecords());
  assert.equal(new Set(records.map(record => record.id)).size, 257);
  await assert.rejects(fs.stat(path.join(dir, originalName)), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(dir, staged)), { code: 'ENOENT' });

  const maliciousName = (await fs.readdir(dir)).find(name => name.endsWith('.jsonl'));
  const unrelated = path.join(dir, 'never-delete.txt');
  await fs.writeFile(unrelated, 'keep');
  await fs.writeFile(path.join(dir, maliciousName), JSON.stringify({ diagnosticSegment: 1, replaces: ['../never-delete.txt', 'never-delete.txt'] }) + '\n');
  const malformed = new DiagnosticStore(dir, { clock: () => NOW });
  assert.equal((await malformed.snapshot()).storageError, true);
  assert.equal(await fs.readFile(unrelated, 'utf8'), 'keep');
});

test('retention removes expired segments from disk while retaining recent records', async t => {
  let clock = NOW;
  const { dir, store } = await setup(t, () => clock);
  await store.updateSettings({ retentionDays: 1 });
  store.append(event(1));
  await store.flush();
  clock += 2 * 86400000;
  store.append(event(2, { timestamp: new Date(clock).toISOString() }));
  await store.flush();
  assert.equal((await fs.readdir(dir)).filter(name => name.endsWith('.jsonl')).length, 1);
  assert.deepEqual((await store.query()).events.map(e => e.id), ['event-00002']);
});

test('in-flight streaming export stays complete while retention runs, then releases its files', async t => {
  let clock = NOW;
  const { dir, store } = await setup(t, () => clock);
  await store.updateSettings({ retentionDays: 1 });
  store.append(event(1));
  await store.flush();
  store.append(event(2));
  await store.flush();
  const exported = store.exportRecords();
  const first = await exported.next();
  assert.equal(first.value.id, 'event-00001');
  clock += 2 * 86400000;
  await store.snapshot();
  assert.equal((await fs.readdir(dir)).filter(name => name.endsWith('.jsonl')).length, 2);
  const rest = await collect(exported);
  assert.deepEqual(rest.map(e => e.id), ['event-00002']);
  assert.equal((await fs.readdir(dir)).filter(name => name.endsWith('.jsonl')).length, 0);
});

test('rejects invalid settings and leaves the persisted configuration intact', async t => {
  const { store, dir } = await setup(t);
  await store.updateSettings({ retentionDays: 8 });
  for (const input of [{ retentionDays: 0 }, { retentionDays: 31 }, { maxDiskMB: 1 }, { maxDiskMB: 513 },
    { retentionDays: 1.5 }, { enabled: false }, { path: '/tmp' }]) {
    await assert.rejects(store.updateSettings(input), { name: 'DiagnosticValidationError' });
  }
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'settings.json'))), { retentionDays: 8, maxDiskMB: 128 });
});

test('concurrent settings changes are serialized without losing independent fields', async t => {
  const { store, dir } = await setup(t);
  await Promise.all([store.updateSettings({ retentionDays: 11 }), store.updateSettings({ maxDiskMB: 96 })]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir, 'settings.json'))), { retentionDays: 11, maxDiskMB: 96 });
});

test('append is bounded, counts overload and does not retain caller mutations', async t => {
  const { store } = await setup(t);
  const original = event(1, { details: { state: 'ringing' } });
  store.append(original);
  original.details.state = 'changed-after-append';
  for (let i = 2; i <= 1005; i++) store.append(event(i));
  store.append(event(2000, { details: { oversize: 'x'.repeat(70000) } }));
  await store.flush();
  const status = await store.snapshot();
  assert.equal(status.storedEvents, 1000);
  assert.equal(status.dropped, 6);
  const saved = (await collect(store.exportRecords())).find(e => e.id === original.id);
  assert.equal(saved.details.state, 'ringing');
});

test('initialization failure is visible, bounded in memory, and never throws through append', async t => {
  const { dir } = await setup(t);
  const file = path.join(dir, 'not-a-directory');
  await fs.writeFile(file, 'existing');
  const store = new DiagnosticStore(file, { clock: () => NOW });
  for (let batch = 0; batch < 2; batch++) {
    for (let i = 0; i < 1000; i++) assert.doesNotThrow(() => store.append(event(batch * 1000 + i)));
    await store.flush();
  }
  const status = await store.snapshot();
  assert.equal(status.ready, true);
  assert.equal(status.persistent, false);
  assert.equal(status.storageError, true);
  assert.equal(status.storedEvents, 1000);
  assert.equal(status.dropped, 1000);
  assert.equal((await collect(store.exportRecords())).length, 1000);
});

test('write failure retains recent events for export and exposes storage degradation', async t => {
  const { dir, store } = await setup(t);
  await store.init();
  await fs.rmdir(dir);
  await fs.writeFile(dir, 'unavailable');
  store.append(event(1));
  await store.flush();
  assert.equal((await store.snapshot()).storageError, true);
  assert.deepEqual((await collect(store.exportRecords())).map(e => e.id), ['event-00001']);
});

test('recovers intact lines after malformed, truncated and oversized disk records', async t => {
  const { dir, store } = await setup(t);
  store.append(event(1));
  await store.flush();
  const name = (await fs.readdir(dir)).find(name => name.endsWith('.jsonl'));
  await fs.appendFile(path.join(dir, name), '{broken}\n' + 'x'.repeat(2 * 1024 * 1024) + '\n' + JSON.stringify(event(2)) + '\n{"truncated":');
  const restarted = new DiagnosticStore(dir, { clock: () => NOW });
  assert.deepEqual((await restarted.query()).events.map(e => e.id), ['event-00002', 'event-00001']);
  assert.equal((await restarted.snapshot()).storageError, true);
});

test('partial temporary files and foreign files are neither exported nor pruned', async t => {
  const { dir, store } = await setup(t);
  await fs.writeFile(path.join(dir, 'unrelated.jsonl'), 'private unrelated file');
  await fs.writeFile(path.join(dir, 'events-partial.jsonl.tmp'), '{incomplete');
  store.append(event(1));
  await store.flush();
  assert.equal((await collect(store.exportRecords())).length, 1);
  assert.equal(await fs.readFile(path.join(dir, 'unrelated.jsonl'), 'utf8'), 'private unrelated file');
  assert.equal((await store.snapshot()).storageError, false);
});
