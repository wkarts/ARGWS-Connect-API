'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const express = require('express');
const ts = require('typescript');
require('tsx/cjs');

const { DiagnosticsService } = require('../src/diagnostics/diagnostics.service.ts');
const { diagnosticContext } = require('../src/diagnostics/diagnostic-context.ts');
const { createDiagnosticObserver } = require('../src/diagnostics/diagnostic-http.ts');
const exceptions = require('../src/exceptions/index.ts');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSTANCE = 'hub-SECRET-PRIVATE-5575999999999';

function controller(service, provider) {
  const filename = path.resolve(__dirname, '../src/api/controllers/call.controller.ts');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = function (id) {
    if (id === '../../diagnostics/diagnostics.service') return { diagnostics: service };
    if (id === '@exceptions') return exceptions;
    return Module.prototype.require.call(this, id);
  };
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, filename);
  return new loaded.exports.CallController({ waInstances: { [INSTANCE]: provider } }, { createMediaTicket: async () => ({}) });
}

async function harness(t, provider = {}) {
  const records = [];
  // Use the real service + sanitizer, replacing only disk append with an in-memory test sink.
  const service = new DiagnosticsService({ append: event => records.push(event) });
  const calls = controller(service, provider);
  const app = express();
  app.use(createDiagnosticObserver(service));
  app.use(express.json({ limit: '4kb' }));
  const routes = express.Router();
  for (const [operation, method] of Object.entries({ offer: 'offerCall', accept: 'acceptCall', reject: 'rejectCall', end: 'endCall', mute: 'muteCall' })) {
    routes.post(`/${operation}/:instanceName`, async (req, res, next) => {
      try {
        const result = await calls[method](req.params, req.body);
        res.status(operation === 'offer' ? 201 : 200).json(result);
      } catch (error) { next(error); }
    });
  }
  app.use('/call', routes);
  app.get('/diagnostics/status', (_req, res) => res.json({ ready: true }));
  app.get('/diagnostics/failure', (_req, res) => res.status(403).json({ error: 'Forbidden' }));
  app.use((error, _req, res, _next) => {
    service.record({ code: 'runtime.error', component: 'http', error });
    res.status(error.status || 500).json({ error: 'Falha técnica.' });
  });
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  const listener = http.createServer(app);
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { listener.closeAllConnections(); listener.close(resolve); }));
  const port = listener.address().port;
  const begin = (url, { body, raw, method = 'POST', headers = {} } = {}) => {
    let req;
    const result = new Promise((resolve, reject) => {
      req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers: {
        'content-type': 'application/json', apikey: 'SECRET-APIKEY', authorization: 'Bearer SECRET-TOKEN',
        'x-request-id': 'FORGED-CLIENT-TRACE', ...headers,
      } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      });
      req.once('error', reject);
      req.end(raw === undefined ? (body === undefined ? undefined : JSON.stringify(body)) : raw);
    });
    result.catch(() => {});
    return { req, result };
  };
  return { begin, request: (url, options) => begin(url, options).result, records, calls, service };
}

const until = async predicate => {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error('Expected event was not emitted.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};
const assertPrivate = records => {
  const serialized = JSON.stringify(records);
  for (const forbidden of ['SECRET', '5575999999999', 'FORGED-CLIENT-TRACE', '/private/account', 'https://']) {
    assert.equal(serialized.includes(forbidden), false, `diagnostic leaked ${forbidden}`);
  }
};

test('concurrent call commands keep distinct server-generated traces across awaits and HTTP completion', async t => {
  const pending = new Map();
  const contexts = new Map();
  const provider = { async acceptCall(callId) {
    const before = diagnosticContext.getStore()?.traceId;
    await new Promise(resolve => pending.set(callId, resolve));
    contexts.set(callId, { before, after: diagnosticContext.getStore()?.traceId });
    return { callId, state: 'connecting', response: { conversation: 'SECRET-PROVIDER-RESPONSE' } };
  } };
  const { request, records } = await harness(t, provider);
  const ids = ['call-first', 'call-second', 'call-third'];
  const responses = ids.map(callId => request(`/call/accept/${INSTANCE}?token=SECRET-QUERY`, {
    body: { callId, message: 'SECRET-CONVERSATION', media: 'SECRET-AUDIO' },
  }));
  await until(() => pending.size === 3);
  for (const id of ids.slice().reverse()) { pending.get(id)(); await new Promise(resolve => setImmediate(resolve)); }
  const results = await Promise.all(responses);
  await until(() => records.filter(record => record.code === 'http.request').length === 3);
  const traces = results.map(result => result.headers['x-request-id']);
  assert.equal(new Set(traces).size, 3);
  for (let i = 0; i < ids.length; i++) {
    const traceId = traces[i];
    assert.match(traceId, UUID);
    assert.equal(results[i].status, 200);
    assert.deepEqual(contexts.get(ids[i]), { before: traceId, after: traceId });
    const own = records.filter(record => record.traceId === traceId);
    assert.equal(own.length, 3);
    assert.deepEqual(own.filter(record => record.code === 'call.action').map(record => record.details.phase), ['requested', 'completed']);
    assert.ok(own.filter(record => record.code === 'call.action').every(record => record.callId === ids[i]));
    const httpRecord = own.find(record => record.code === 'http.request');
    assert.equal(httpRecord.details.route, '/call/accept/:instanceName');
    assert.equal(httpRecord.details.status, 200);
    assert.equal(httpRecord.details.aborted, false);
  }
  assert.equal(diagnosticContext.getStore(), undefined);
  assertPrivate(records);
});

test('outgoing offer acquires the provider callId while preserving the native response and trace', async t => {
  const native = { id: 'call-outgoing', callId: 'call-outgoing', jid: '5575999999999:3@s.whatsapp.net', payload: 'SECRET-PROVIDER-RESPONSE' };
  let received;
  const { request, records } = await harness(t, { async offerCall(input) { received = input; await Promise.resolve(); return native; } });
  const body = { number: '5575999999999', isVideo: false, text: 'SECRET-CONVERSATION' };
  const response = await request(`/call/offer/${INSTANCE}`, { body });
  assert.equal(response.status, 201);
  assert.deepEqual(JSON.parse(response.text), native);
  assert.deepEqual(received, body);
  const traceId = response.headers['x-request-id'];
  const own = records.filter(record => record.traceId === traceId);
  assert.equal(own.length, 3);
  const commands = own.filter(record => record.code === 'call.action');
  assert.equal(commands[0].callId, undefined);
  assert.equal(commands[1].callId, 'call-outgoing');
  assert.deepEqual(commands.map(record => record.details.action), ['start', 'start']);
  assertPrivate(records);
});

test('provider errors share the request trace through command failure, sanitized error and HTTP response', async t => {
  const failure = Object.assign(new Error('SECRET-CONVERSATION'), {
    name: 'AxiosError', code: 'ECONNRESET', status: 502,
    config: { url: 'https://SECRET-HOST/private/account', headers: { authorization: 'SECRET-TOKEN' } },
    response: { status: 502, data: { text: 'SECRET-CONVERSATION' } },
  });
  const { request, records } = await harness(t, { async acceptCall() { await Promise.resolve(); throw failure; } });
  const response = await request(`/call/accept/${INSTANCE}`, { body: { callId: 'call-failed' } });
  assert.equal(response.status, 502);
  const traceId = response.headers['x-request-id'];
  assert.match(traceId, UUID);
  assert.equal(records.length, 4);
  assert.ok(records.every(record => record.traceId === traceId));
  const commands = records.filter(record => record.code === 'call.action');
  assert.deepEqual(commands.map(record => record.details.phase), ['requested', 'failed']);
  assert.equal(commands[1].details.error.code, 'ECONNRESET');
  assert.equal(commands[1].level, 'error');
  const error = records.find(record => record.code === 'runtime.error');
  assert.equal(error.details.name, 'AxiosError');
  assert.equal(error.details.status, 502);
  assert.equal(error.details.code, 'ECONNRESET');
  assert.equal(records.find(record => record.code === 'http.request').details.status, 502);
  assertPrivate(records);
});

test('reject, end and mute use the same correlated command path without recording arguments', async t => {
  const invoked = [];
  const provider = Object.fromEntries(['rejectCall', 'endCall', 'muteCall'].map(method => [method, async (...args) => {
    invoked.push([method, ...args]);
    return { callId: args[0], raw: 'SECRET-PROVIDER-RESPONSE' };
  }]));
  const { request, records } = await harness(t, provider);
  for (const action of ['reject', 'end', 'mute']) {
    const response = await request(`/call/${action}/${INSTANCE}`, { body: { callId: `call-${action}`, muted: true, payload: 'SECRET-CONVERSATION' } });
    const own = records.filter(record => record.traceId === response.headers['x-request-id']);
    assert.equal(response.status, 200);
    assert.equal(own.length, 3);
    const commands = own.filter(record => record.code === 'call.action');
    assert.ok(commands.every(record => record.details.action === action && record.callId === `call-${action}`));
  }
  assert.deepEqual(invoked, [['rejectCall', 'call-reject'], ['endCall', 'call-end'], ['muteCall', 'call-mute', true]]);
  assertPrivate(records);
});

test('malformed JSON is observed before body parsing and rejected without conversation content in diagnostics', async t => {
  let invoked = false;
  const { request, records } = await harness(t, { async acceptCall() { invoked = true; } });
  const response = await request(`/call/accept/${INSTANCE}?token=SECRET-QUERY`, { raw: '{"text":"SECRET-CONVERSATION", broken' });
  assert.equal(response.status, 400);
  assert.match(response.headers['x-request-id'], UUID);
  assert.equal(invoked, false);
  assert.equal(records.length, 2);
  assert.ok(records.every(record => record.traceId === response.headers['x-request-id']));
  assert.equal(records.find(record => record.code === 'runtime.error').details.name, 'SyntaxError');
  const requestRecord = records.find(record => record.code === 'http.request');
  assert.equal(requestRecord.details.status, 400);
  assert.equal(requestRecord.details.route, '/call/unknown');
  assertPrivate(records);
});

test('successful diagnostics polling is excluded but failed polls and unknown URLs are traced safely', async t => {
  const { request, records } = await harness(t);
  const success = await request('/diagnostics/status?apikey=SECRET-QUERY', { method: 'GET' });
  assert.equal(success.status, 200);
  assert.match(success.headers['x-request-id'], UUID);
  assert.equal(records.length, 0);
  const denied = await request('/diagnostics/failure', { method: 'GET' });
  assert.equal(denied.status, 403);
  assert.equal(records.length, 1);
  assert.equal(records[0].traceId, denied.headers['x-request-id']);
  const missing = await request('/SECRET-PRIVATE/private/account?text=SECRET-CONVERSATION', { method: 'GET' });
  assert.equal(missing.status, 404);
  assert.equal(records.length, 2);
  assert.equal(records[1].details.route, '/unknown');
  assertPrivate(records);
});

test('aborted HTTP requests produce one terminal HTTP event and retain command trace after the client disconnects', async t => {
  let complete;
  const { begin, records } = await harness(t, { async acceptCall(callId) {
    await new Promise(resolve => { complete = resolve; });
    return { callId };
  } });
  const client = begin(`/call/accept/${INSTANCE}`, { body: { callId: 'call-aborted' } });
  await until(() => typeof complete === 'function');
  client.req.destroy();
  await assert.rejects(client.result);
  await until(() => records.some(record => record.code === 'http.request'));
  const requestRecord = records.find(record => record.code === 'http.request');
  assert.equal(requestRecord.details.aborted, true);
  assert.equal(requestRecord.level, 'warn');
  complete();
  await until(() => records.some(record => record.details.phase === 'completed'));
  assert.equal(records.filter(record => record.code === 'http.request').length, 1);
  assert.equal(records.length, 3);
  assert.ok(records.every(record => record.traceId === requestRecord.traceId));
  assertPrivate(records);
});
