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

// Exercise the actual router middleware with Node's real constant-time primitive.
// An insecure hash or a password KDF in this request path must not be reintroduced.
function administrativeAuth(expectedKey) {
  const registrations = [], comparisons = [];
  const realCrypto = require('node:crypto');
  const crypto = {
    timingSafeEqual(left, right) {
      assert.ok(Buffer.isBuffer(left) && Buffer.isBuffer(right));
      assert.equal(left.length, right.length);
      comparisons.push([Buffer.from(left), Buffer.from(right)]);
      return realCrypto.timingSafeEqual(left, right);
    },
    createHash() { throw new Error('Authentication must not hash API keys'); },
    scryptSync() { throw new Error('Authentication must not block the event loop with a KDF'); },
    pbkdf2Sync() { throw new Error('Authentication must not block the event loop with a KDF'); },
  };
  const { OperationsRouter } = load('src/api/routes/operations.router.ts', {
    crypto,
    express: { Router: () => ({
      use(handler) { registrations.push({ kind: 'use', handler }); return this; },
      get(route, handler) { registrations.push({ kind: 'get', route, handler }); return this; },
    }) },
    '@api/services/operations.service': { operationsTarget: () => undefined },
    '@config/env.config': { configService: { get: () => ({ API_KEY: { KEY: expectedKey } }) } },
  });
  new OperationsRouter();
  function authenticate(supplied) {
    const result = { next: false, status: 0, body: undefined, headers: {} };
    const response = {
      status(code) { result.status = code; return this; },
      json(body) { result.body = JSON.parse(JSON.stringify(body)); return this; },
      set(name, value) { result.headers[name] = value; return this; },
    };
    registrations[0].handler({ get: () => supplied }, response, () => { result.next = true; });
    return result;
  }
  return { authenticate, registrations, comparisons };
}
test('all operational reads register after the administrative guard', () => {
  const auth = administrativeAuth('test-only-global-key');
  assert.equal(auth.registrations[0].kind, 'use');
  assert.deepEqual(auth.registrations.slice(1).map(({ route }) => route), ['/snapshot', '/statistics', '/history', '/archives', '/export']);
});
test('administrative authentication compares the exact key bytes without hashing', () => {
  const expected = 'test-only-global-key';
  const auth = administrativeAuth(expected);
  for (let index = 0; index < expected.length; index++) {
    const altered = expected.slice(0, index) + 'X' + expected.slice(index + 1);
    const result = auth.authenticate(altered);
    assert.equal(result.status, 403); assert.equal(result.next, false);
    assert.equal(result.headers['Cache-Control'], 'no-store');
  }
  const accepted = auth.authenticate(expected);
  assert.equal(accepted.next, true); assert.equal(accepted.headers['Cache-Control'], 'no-store');
  assert.equal(auth.comparisons.length, expected.length + 1);
  const [left, right] = auth.comparisons.at(-1);
  assert.equal(left.toString('utf8'), expected); assert.equal(right.toString('utf8'), expected);
});
test('missing, empty and different-length keys fail closed without throwing or reflecting secrets', () => {
  const expected = 'test-only-global-key';
  const auth = administrativeAuth(expected);
  for (const supplied of [undefined, '', 'x', expected.slice(0, -1), expected + 'X', 'X'.repeat(8192)]) {
    const result = auth.authenticate(supplied);
    assert.equal(result.next, false); assert.equal(result.status, 403);
    assert.deepEqual(result.body, { error: 'Acesso administrativo necessário.' });
    assert.equal(result.headers['Cache-Control'], 'no-store');
  }
  assert.equal(auth.comparisons.length, 0);
  for (const missing of [undefined, null, '', 123]) {
    const result = administrativeAuth(missing).authenticate(expected);
    assert.equal(result.next, false); assert.equal(result.status, 403);
  }
});
test('UTF-8 byte length, not JavaScript character length, guards timingSafeEqual', () => {
  const expected = 'test-only-key-é';
  const auth = administrativeAuth(expected);
  // Equal character count with a different UTF-8 byte count must not throw.
  assert.equal(auth.authenticate('test-only-key-e').status, 403);
  assert.equal(auth.comparisons.length, 0);
  // Equal byte count still requires an exact comparison, with no normalization.
  assert.equal(auth.authenticate('test-only-key-ê').status, 403);
  assert.equal(auth.authenticate(expected).next, true);
  assert.equal(auth.comparisons.length, 2);
});
