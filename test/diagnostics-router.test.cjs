'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const { gunzipSync } = require('node:zlib');
const express = require('express');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/api/routes/diagnostics.router.ts');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded.require = function (id) {
  if (id === '@config/env.config') return { configService: { get: () => ({ API_KEY: { KEY: 'global-admin-key' } }) } };
  if (id === '../../diagnostics/diagnostics.service') return { diagnostics: {} };
  return Module.prototype.require.call(this, id);
};
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, filename);
const { DiagnosticsRouter } = loaded.exports;

const invalid = () => Object.assign(new Error('SECRET-TOKEN /private/logs unexpected query'), { name: 'DiagnosticValidationError' });
const event = { id: 'event-1', timestamp: '2026-09-13T12:00:00.000Z', category: 'call', code: 'call.state', level: 'info', callId: 'call-123', instanceId: 'instance-123' };
function service(overrides = {}) {
  return {
    captured: [],
    status: async () => ({ enabled: true, settings: { retentionDays: 7, maxDiskMB: 128 }, storedEvents: 1 }),
    events: async (filter) => ({ events: filter.level === 'error' ? [] : [event], nextCursor: null }),
    async *exportRecords(filter) {
      if (filter.from === 'invalid') throw invalid();
      if (filter.level !== 'error') yield event;
    },
    settings: async () => ({}),
    record(input) { this.captured.push(input); },
    ...overrides,
  };
}

async function server(t, fake = service()) {
  const app = express();
  app.use(express.json({ limit: '8kb' }));
  app.use('/diagnostics', new DiagnosticsRouter(fake).router);
  const listener = http.createServer(app);
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    listener.closeAllConnections();
    listener.close(resolve);
  }));
  const port = listener.address().port;
  const begin = (url, { method = 'GET', key = 'global-admin-key', body, ...options } = {}) => {
    const headers = { ...(key ? { apikey: key } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...options.headers };
    let req;
    const result = new Promise((resolve, reject) => {
      req = http.request({ hostname: '127.0.0.1', port, path: `/diagnostics${url}`, method, headers }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, buffer, text: buffer.toString('utf8') });
        });
        res.on('error', reject);
      });
      req.once('error', reject);
      req.end(body !== undefined ? JSON.stringify(body) : undefined);
    });
    // Aborted-client tests intentionally destroy the request; retain its error for assertions.
    result.catch(() => {});
    return { req, result };
  };
  return { begin, request: (url, options) => begin(url, options).result, fake };
}

const until = async (predicate) => {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > end) throw Error('condition not reached');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

test('all endpoints require the global administrator key and suppress caches', async t => {
  const { request, fake } = await server(t);
  for (const [url, method] of [['/status', 'GET'], ['/events', 'GET'], ['/export', 'GET'], ['/settings', 'PUT'], ['/client-events', 'POST']]) {
    for (const key of [undefined, 'instance-api-key', 'incorrect-admin-key']) {
      const res = await request(url, { method, key: key ?? '', body: method === 'GET' ? undefined : {} });
      assert.equal(res.status, 403);
      assert.equal(res.headers['cache-control'], 'no-store');
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.deepEqual(JSON.parse(res.text), { error: 'Acesso administrativo necessário.' });
    }
  }
  const query = await request('/status?apikey=global-admin-key', { key: '' });
  assert.equal(query.status, 403);
  assert.equal(fake.captured.length, 0);
});

test('status and paginated events preserve the typed filter contract', async t => {
  const queries = [];
  const { request } = await server(t, service({ events: async filter => { queries.push(filter); return { events: [event], nextCursor: 'cursor-safe' }; } }));
  const status = await request('/status');
  assert.equal(status.status, 200);
  assert.equal(JSON.parse(status.text).enabled, true);
  const response = await request('/events?level=info&category=call&code=call.state&traceId=trace-123&callId=call-123&instanceId=instance-123&limit=20&cursor=cursor-safe');
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.text).nextCursor, 'cursor-safe');
  assert.deepEqual(queries, [{ level: 'info', category: 'call', code: 'call.state', traceId: 'trace-123', callId: 'call-123', instanceId: 'instance-123', cursor: 'cursor-safe', limit: 20 }]);
});

test('rejects unknown, nested, duplicate and oversized parameters without leaking input', async t => {
  const { request } = await server(t);
  for (const url of [
    '/status?path=SECRET', '/events?path=SECRET', '/events?level[raw]=SECRET',
    '/events?level=info&level=error', '/events?limit=0', '/events?limit=201', '/events?limit=1.2',
    '/events?instanceId=../../SECRET', `/events?traceId=${'a'.repeat(129)}`, '/export?limit=10',
    '/export?cursor=SECRET', '/export?format=zip', '/export?format[secret]=SECRET',
  ]) {
    const res = await request(url);
    assert.equal(res.status, 400, url);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.deepEqual(JSON.parse(res.text), { error: 'Parâmetro inválido.' });
  }
});

test('store validation is translated before export headers and raw exceptions never reach clients', async t => {
  const { request } = await server(t, service({ events: async () => { throw invalid(); }, status: async () => { throw Error('SECRET /private/logs'); } }));
  const invalidExport = await request('/export?from=invalid');
  assert.equal(invalidExport.status, 400);
  assert.equal(invalidExport.headers['content-disposition'], undefined);
  assert.equal(invalidExport.text.includes('SECRET'), false);
  const events = await request('/events');
  assert.equal(events.status, 400);
  const status = await request('/status');
  assert.equal(status.status, 503);
  assert.deepEqual(JSON.parse(status.text), { error: 'Diagnóstico temporariamente indisponível.' });
});

test('JSONL and gzip downloads contain one manifest followed by filtered records and an audit event', async t => {
  const { request, fake } = await server(t);
  for (const format of ['jsonl', 'gzip']) {
    const response = await request(`/export?format=${format}&category=call&callId=call-123`);
    assert.equal(response.status, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(response.headers['content-disposition'], format === 'gzip'
      ? /^attachment; filename="connect-diagnostics-\d{8}\.jsonl\.gz"$/
      : /^attachment; filename="connect-diagnostics-\d{8}\.jsonl"$/);
    const text = format === 'gzip' ? gunzipSync(response.buffer).toString('utf8') : response.text;
    const lines = text.trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, 2);
    assert.equal(lines[0].type, 'manifest');
    assert.equal(lines[0].schemaVersion, 1);
    assert.deepEqual(lines[0].filters, { category: 'call', callId: 'call-123' });
    assert.deepEqual(lines[1], event);
  }
  await until(() => fake.captured.length === 2);
  assert.deepEqual(fake.captured.map(({ code, format, count }) => ({ code, format, count })), [
    { code: 'diagnostics.exported', format: 'jsonl', count: 1 }, { code: 'diagnostics.exported', format: 'gzip', count: 1 },
  ]);
  const empty = await request('/export?format=jsonl&level=error');
  assert.equal(empty.text.trim().split('\n').length, 1);
});

test('frontend events accept only fixed metadata, never messages, stack traces, URLs or request bodies', async t => {
  const { request, fake } = await server(t);
  for (const body of [
    { kind: 'window_error', page: 'calls', message: 'SECRET-CONVERSATION' },
    { kind: 'window_error', page: 'https://host/SECRET?apikey=SECRET' },
    { kind: 'window_error', page: '/instances/private-account' },
    { kind: 'window_error', page: 'calls', stack: 'SECRET' },
    { kind: 'arbitrary_error', page: 'calls' },
    { kind: 'window_error', page: 'calls', traceId: ['SECRET'] },
  ]) {
    const res = await request('/client-events', { method: 'POST', body });
    assert.equal(res.status, 400);
    assert.equal(res.text.includes('SECRET'), false);
  }
  for (const kind of ['window_error', 'unhandled_rejection', 'vue_error']) {
    const res = await request('/client-events', { method: 'POST', body: { kind, page: 'calls', traceId: 'trace-123' } });
    assert.equal(res.status, 202);
  }
  assert.deepEqual(fake.captured.map(({ code, kind, page, traceId }) => ({ code, kind, page, traceId })),
    ['window_error', 'unhandled_rejection', 'vue_error'].map(kind => ({ code: 'frontend.error', kind, page: 'calls', traceId: 'trace-123' })));
});

test('frontend event floods are bounded without disabling backend diagnostics', async t => {
  const { request, fake } = await server(t);
  for (let i = 0; i < 60; i++) {
    const response = await request('/client-events', { method: 'POST', body: { kind: 'window_error', page: 'calls' } });
    assert.equal(response.status, 202);
  }
  const exceeded = await request('/client-events', { method: 'POST', body: { kind: 'window_error', page: 'calls' } });
  assert.equal(exceeded.status, 429);
  assert.equal(fake.captured.length, 60);
  assert.equal((await request('/status')).status, 200);
});

test('settings validate fixed safe limits and return the refreshed status', async t => {
  const values = [];
  const { request } = await server(t, service({ settings: async value => values.push(value) }));
  for (const body of [
    {}, { retentionDays: 0, maxDiskMB: 128 }, { retentionDays: 31, maxDiskMB: 128 },
    { retentionDays: 7, maxDiskMB: 31 }, { retentionDays: 7, maxDiskMB: 513 },
    { retentionDays: '7', maxDiskMB: 128 }, { retentionDays: 7, maxDiskMB: 128, directory: '/SECRET' },
  ]) assert.equal((await request('/settings', { method: 'PUT', body })).status, 400);
  const response = await request('/settings', { method: 'PUT', body: { retentionDays: 10, maxDiskMB: 64 } });
  assert.equal(response.status, 200);
  assert.deepEqual(values, [{ retentionDays: 10, maxDiskMB: 64 }]);
  assert.equal(JSON.parse(response.text).enabled, true);
});

test('at most four reads run concurrently and aborting a client releases its reservation', async t => {
  const waiting = [];
  const { begin, request } = await server(t, service({ status: () => new Promise(resolve => waiting.push(resolve)) }));
  const pending = Array.from({ length: 4 }, () => begin('/status'));
  await until(() => waiting.length === 4);
  assert.equal((await request('/status')).status, 429);
  pending[0].req.destroy();
  await assert.rejects(pending[0].result);
  await new Promise(resolve => setTimeout(resolve, 20));
  const replacement = begin('/status');
  await until(() => waiting.length === 5);
  waiting.forEach(resolve => resolve({ enabled: true }));
  assert.equal((await replacement.result).status, 200);
  for (const entry of pending.slice(1)) assert.equal((await entry.result).status, 200);
});

test('at most two exports run concurrently and abort closes the store iterator', async t => {
  const waiting = [];
  let returned = 0;
  const fake = service({ exportRecords() {
    return {
      [Symbol.asyncIterator]() { return this; },
      next() { return new Promise(resolve => waiting.push(resolve)); },
      async return() { returned++; return { done: true }; },
    };
  } });
  const { begin, request } = await server(t, fake);
  const first = begin('/export');
  const second = begin('/export');
  await until(() => waiting.length === 2);
  assert.equal((await request('/export')).status, 429);
  first.req.destroy();
  await assert.rejects(first.result);
  await new Promise(resolve => setTimeout(resolve, 20));
  const replacement = begin('/export');
  await until(() => waiting.length === 3);
  waiting.forEach(resolve => resolve({ done: true }));
  assert.equal((await second.result).status, 200);
  assert.equal((await replacement.result).status, 200);
  await until(() => returned === 3);
});

test('real sanitizer, persistent store and HTTP download preserve correlation without collecting conversations', async t => {
  require('tsx/cjs');
  const { DiagnosticsService } = require('../src/diagnostics/diagnostics.service.ts');
  const { DiagnosticStore } = require('../src/diagnostics/diagnostic-store.ts');
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'diagnostics-router-'));
  const live = new DiagnosticsService(new DiagnosticStore(directory));
  t.after(async () => { await live.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  await live.start('1.0.30');
  live.record({ code: 'runtime.error', component: 'api', traceId: 'trace-integration',
    error: Object.assign(new Error('SECRET-CONVERSATION'), { code: 'ECONNRESET', authorization: 'SECRET-TOKEN' }),
    body: { text: 'SECRET-CONVERSATION' }, url: 'https://SECRET-HOST/private?apikey=SECRET-TOKEN' });
  live.record({ code: 'call.action', component: 'voip', traceId: 'trace-integration', callId: 'call-integration',
    instanceId: 'hub-private-phone-5575999999999', action: 'accept', phase: 'started', message: 'SECRET-CONVERSATION' });
  await live.flush();
  const { request } = await server(t, live);
  const events = await request('/events?traceId=trace-integration');
  assert.equal(events.status, 200);
  const records = JSON.parse(events.text).events;
  assert.equal(records.length, 2);
  assert.ok(records.every(record => record.traceId === 'trace-integration'));
  assert.ok(records.some(record => record.callId === 'call-integration'));
  const download = await request('/export?format=gzip&traceId=trace-integration');
  assert.equal(download.status, 200);
  const text = gunzipSync(download.buffer).toString('utf8');
  const exported = text.trim().split('\n').map(JSON.parse);
  assert.equal(exported.length, 3);
  assert.equal(exported[0].diagnostics.privacy, 'technical_metadata_only');
  assert.equal(exported[0].diagnostics.version, '1.0.30');
  assert.ok(!text.includes('SECRET'));
  assert.ok(!text.includes('5575999999999'));
  assert.ok(!text.includes(directory));
  for (const filter of ['level=SECRET', 'category=SECRET', 'from=2026-02-30T00:00:00Z']) {
    assert.equal((await request(`/events?${filter}`)).status, 400);
    assert.equal((await request(`/export?${filter}`)).status, 400);
  }
});
