import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const manager = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(manager, file), 'utf8');
const sources = {
  current: read('src/services/current.ts'),
  operations: read('src/services/operations.ts'),
};
const compiled = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name,
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText,
]));
const accessRequired = /Este painel exige acesso administrativo com a chave global/;

function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const calls = { read: 0, write: 0 };
  return {
    data, calls,
    getItem(key) { calls.read++; return data.get(key) ?? null; },
    setItem(key, value) { calls.write++; data.set(key, String(value)); },
    removeItem(key) { data.delete(key); },
  };
}

// Execute both complete, real service modules in one document context. Only
// browser I/O and unrelated imported services are doubles; auth is not mocked.
function documentSession(options = {}) {
  const sessionStorage = options.sessionStorage || storage();
  const localStorage = options.localStorage || storage();
  const requests = [], links = [], blobs = [], revoked = [], timers = new Map();
  let nextTimer = 0;
  const setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; };
  const clearTimeout = (id) => timers.delete(id);
  class BrowserURL extends URL {
    static createObjectURL(blob) { blobs.push(blob); return 'blob:https://manager.example.test/export'; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  const dependencies = {
    '@/config/runtime': { runtime: { apiBaseUrl: 'https://manager.example.test', requestTimeoutMs: 30000 } },
    './normalizers': {},
    './whatsapp-destination': {},
    './integration-definitions': {},
    './voice-media': {},
  };
  const context = {
    sessionStorage, localStorage, URL: BrowserURL, AbortController, setTimeout, clearTimeout,
    window: { setTimeout },
    document: { createElement(tag) {
      assert.equal(tag, 'a');
      const link = { click() { links.push(this); } };
      return link;
    } },
    async fetch(input, init) {
      const request = { url: new URL(String(input)), init };
      requests.push(request);
      if (options.respond) return options.respond(request);
      return request.url.pathname.endsWith('/export')
        ? new Response('test-export', { headers: { 'content-type': 'application/gzip' } })
        : Response.json({ enabled: true });
    },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
      return dependencies[name];
    },
  };
  function load(name) {
    const module = { exports: {} };
    vm.runInNewContext(compiled[name], { ...context, module, exports: module.exports }, { filename: `${name}.js` });
    return module.exports;
  }
  const current = load('current');
  dependencies['./current'] = current;
  const { operations } = load('operations');
  return { current, operations, requests, sessionStorage, localStorage, links, blobs, revoked, timers };
}

function assertMemoryOnly(session) {
  for (const store of [session.sessionStorage, session.localStorage]) {
    assert.equal(store.calls.read, 0, 'Credentials must not be read from Web Storage');
    assert.equal(store.calls.write, 0, 'Credentials must not be written to Web Storage');
    assert.equal(store.data.has('connect_access_code'), false);
  }
}

test('operations imports the live login accessor, never browser storage or the agent token', () => {
  assert.match(sources.operations, /import\s*\{\s*getCurrentAccessCode\s*\}\s*from ['"]\.\/current['"]/);
  assert.match(sources.operations, /const key = getCurrentAccessCode\(\)/);
  assert.doesNotMatch(sources.operations, /sessionStorage|localStorage|OPERATIONS_INTERNAL_TOKEN/);
  assert.doesNotMatch(sources.current, /(?:sessionStorage|localStorage)\.(?:getItem|setItem)\(/);
});

test('successful login immediately authorizes snapshot with its memory-only credential', async () => {
  const session = documentSession();
  await assert.rejects(() => session.operations.snapshot(), accessRequired);
  assert.equal(session.requests.length, 0);
  const account = await session.current.current.loginAccess('  test-global-key  ');
  assert.equal(account.account.roleLabel, 'Administração');
  assert.equal(session.current.getCurrentAccessCode(), 'test-global-key');
  assert.equal((await session.operations.snapshot()).enabled, true);
  assert.deepEqual(session.requests.map((r) => r.url.pathname), ['/verify-creds', '/operations/snapshot']);
  for (const { init } of session.requests) assert.equal(init.headers.apikey, 'test-global-key');
  assertMemoryOnly(session);
  assert.equal(session.timers.size, 0);
});

test('pending login does not release a credential before backend verification', async () => {
  let finish;
  const verified = new Promise((resolve) => { finish = resolve; });
  const session = documentSession({ respond: (r) => r.url.pathname === '/verify-creds' ? verified : Response.json({ enabled: true }) });
  const login = session.current.current.loginAccess('test-global-key');
  assert.equal(session.current.getCurrentAccessCode(), '');
  await assert.rejects(() => session.operations.snapshot(), accessRequired);
  assert.equal(session.requests.length, 1);
  finish(Response.json({ valid: true }));
  await login;
  await session.operations.snapshot();
  assert.equal(session.requests.length, 2);
  assertMemoryOnly(session);
});

test('rejected login never authorizes an operational request', async () => {
  const session = documentSession({ respond: () => Response.json({ message: 'Invalid credentials' }, { status: 401 }) });
  await assert.rejects(() => session.current.current.loginAccess('invalid-test-key'), /Invalid credentials/);
  assert.equal(session.current.getCurrentAccessCode(), '');
  await assert.rejects(() => session.operations.snapshot(), accessRequired);
  assert.equal(session.requests.length, 1);
  assertMemoryOnly(session);
});

test('all five operational endpoints use the same credential and preserve parameters and export', async () => {
  const session = documentSession();
  await session.current.current.loginAccess('test-global-key');
  await session.operations.snapshot();
  await session.operations.statistics('2026-09-01', '2026-09-10');
  await session.operations.archives();
  await session.operations.history('2026-09-01', '2026-09-10', 'cursor+/=');
  await session.operations.download('2026-09-09');
  const requests = session.requests.slice(1);
  assert.deepEqual(requests.map((r) => r.url.pathname), [
    '/operations/snapshot', '/operations/statistics', '/operations/archives', '/operations/history', '/operations/export',
  ]);
  for (const { url, init } of requests) {
    assert.equal(url.origin, 'https://manager.example.test');
    assert.deepEqual(Object.keys(init.headers), ['apikey']);
    assert.equal(init.headers.apikey, 'test-global-key');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(url.toString().includes('test-global-key'), false);
  }
  assert.equal(requests[1].url.searchParams.get('from'), '2026-09-01');
  assert.equal(requests[1].url.searchParams.get('to'), '2026-09-10');
  assert.equal(requests[3].url.searchParams.get('cursor'), 'cursor+/=');
  assert.equal(requests[4].url.searchParams.get('day'), '2026-09-09');
  assert.equal(requests[4].url.searchParams.get('format'), 'log');
  assert.equal(session.links[0].download, 'connect-operations-2026-09-09.log.gz');
  assert.equal(await session.blobs[0].text(), 'test-export');
  assert.equal(session.timers.size, 1);
  const revoke = [...session.timers.values()][0];
  assert.equal(revoke.delay, 1000);
  revoke.callback();
  assert.deepEqual(session.revoked, [session.links[0].href]);
  assertMemoryOnly(session);
});

test('logout blocks every operational endpoint and a new login uses the new key', async () => {
  const session = documentSession();
  await session.current.current.loginAccess('first-test-key');
  await session.operations.snapshot();
  await session.current.current.logout();
  assert.equal(session.current.getCurrentAccessCode(), '');
  for (const call of [
    () => session.operations.snapshot(), () => session.operations.archives(),
    () => session.operations.statistics('2026-09-01', '2026-09-10'),
    () => session.operations.history('2026-09-01', '2026-09-10'),
    () => session.operations.download('2026-09-09'),
  ]) await assert.rejects(call, accessRequired);
  assert.equal(session.requests.length, 2);
  await session.current.current.loginAccess('second-test-key');
  await session.operations.snapshot();
  assert.equal(session.requests.at(-1).init.headers.apikey, 'second-test-key');
  session.current.clearCurrentAccess();
  await assert.rejects(() => session.operations.snapshot(), accessRequired);
  assertMemoryOnly(session);
});

test('old storage credentials are purged and a document reload does not restore login', async () => {
  const sessionStorage = storage({ connect_access_code: 'old-test-key' });
  const localStorage = storage({ connect_access_code: 'old-test-key', managerTheme: 'dark' });
  const session = documentSession({ sessionStorage, localStorage });
  assert.equal(session.current.getCurrentAccessCode(), '');
  assertMemoryOnly(session);
  assert.equal(localStorage.data.get('managerTheme'), 'dark');
  await session.current.current.loginAccess('test-global-key');
  await session.operations.snapshot();
  const reloaded = documentSession({ sessionStorage, localStorage });
  await assert.rejects(() => reloaded.operations.snapshot(), accessRequired);
  assert.equal(reloaded.requests.length, 0);
  assert.equal(reloaded.current.hasCurrentAccess(), false);
  assertMemoryOnly(reloaded);
});

test('blocked browser storage does not prevent authenticated operational requests', async () => {
  const blocked = {
    getItem() { throw new Error('Storage unavailable'); },
    setItem() { throw new Error('Storage unavailable'); },
    removeItem() { throw new Error('Storage unavailable'); },
  };
  const session = documentSession({ sessionStorage: blocked, localStorage: blocked });
  await session.current.current.loginAccess('test-global-key');
  assert.equal((await session.operations.snapshot()).enabled, true);
  assert.equal(session.requests.at(-1).init.headers.apikey, 'test-global-key');
});

for (const [status, body, expected] of [
  [403, {}, /Somente o administrador da instalação/],
  [503, { enabled: false }, /Monitoramento não habilitado/],
  [503, {}, /temporariamente indisponível/],
  [429, {}, /Outra consulta está em andamento/],
]) {
  test(`backend authorization and availability errors remain enforced: ${status} ${expected.source}`, async () => {
    const session = documentSession({ respond: (r) => r.url.pathname === '/verify-creds'
      ? Response.json({ valid: true }) : Response.json(body, { status }) });
    await session.current.current.loginAccess('test-access-key');
    await assert.rejects(() => session.operations.snapshot(), expected);
    assert.equal(session.requests.at(-1).init.headers.apikey, 'test-access-key');
    assert.equal(session.timers.size, 0);
    assertMemoryOnly(session);
  });
}
