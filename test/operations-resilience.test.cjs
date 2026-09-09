'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const ts = require('typescript');

function load(relative, dependencies, extra = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), URL, Buffer, Date, ...extra });
  return exports;
}
function publisher() {
  let flush, lastRequest, lastResponse;
  const payloads = [];
  const http = { request: (_url, _options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => { request.emit('error', new Error('test disconnect')); request.emit('close'); };
    request.end = (payload) => payloads.push(payload);
    request.respond = () => {
      const response = new EventEmitter(); response.statusCode = 202; response.resume = () => undefined;
      callback(response); lastResponse = response;
    };
    lastRequest = request; return request;
  } };
  const implementation = load('src/api/services/operations.service.ts', { http }, {
    process: { env: { OPERATIONS_ENABLED: 'true', OPERATIONS_INTERNAL_TOKEN: 'test-only-internal-token-not-production-12345678' } },
    setInterval: (fn) => { flush = fn; return { unref() {} }; },
  });
  function observe(status = 200) {
    const req = { path: '/message/sendText/private-instance' };
    for (const key of ['body', 'headers', 'query', 'params']) Object.defineProperty(req, key, { get() { throw new Error('Private request data was accessed'); } });
    const response = new EventEmitter(); response.statusCode = status;
    let next = false;
    implementation.observeOperations(req, response, () => { next = true; });
    assert.ok(next); response.emit('finish');
  }
  return { observe, payloads, flush: () => flush(), request: () => lastRequest, response: () => lastResponse };
}

test('telemetry never inspects communication payload and survives an agent response reset', () => {
  const p = publisher(); p.observe(500); p.flush(); p.request().respond();
  assert.doesNotThrow(() => p.response().emit('error', new Error('agent response reset')));
  p.request().emit('close');
  p.observe(); p.flush();
  assert.equal(p.payloads.length, 2);
  const first = JSON.parse(p.payloads[0]);
  assert.equal(first.events[0].count, 1); assert.equal(first.events[0].errors, 1);
  assert.ok(!p.payloads[0].includes('private-instance'));
});
test('agent outage does not block requests and the next batch reports a telemetry gap', () => {
  const p = publisher(); p.observe(); p.flush(); p.request().destroy();
  p.observe(); p.flush();
  const recovered = JSON.parse(p.payloads[1]);
  assert.equal(recovered.events.find((event) => event.event === 'telemetry.gap').count, 1);
});
test('operations facade refuses an instance key and only accepts the global administrative key', () => {
  const handlers = [];
  const fakeRouter = () => ({ use(fn) { handlers.push(fn); return this; }, get() { return this; } });
  const { OperationsRouter } = load('src/api/routes/operations.router.ts', {
    express: { Router: fakeRouter },
    '@api/services/operations.service': { operationsTarget: () => undefined },
    '@config/env.config': { configService: { get: () => ({ API_KEY: { KEY: 'test-only-global-key' } }) } },
  });
  new OperationsRouter();
  function authenticate(key) {
    let next = false, status = 0;
    const res = { status(code) { status = code; return this; }, json() {}, set() {} };
    handlers[0]({ get: () => key }, res, () => { next = true; });
    return { next, status };
  }
  assert.deepEqual(authenticate('test-only-instance-key'), { next: false, status: 403 });
  assert.deepEqual(authenticate(''), { next: false, status: 403 });
  assert.equal(authenticate('test-only-global-key').next, true);
});
