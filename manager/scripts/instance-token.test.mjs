import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ts = createRequire(import.meta.url)('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function load(source, deps, globals = {}) {
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, URL, AbortController, Error, setTimeout, clearTimeout,
    require: name => { assert.ok(name in deps, `Unexpected dependency: ${name}`); return deps[name]; },
    ...globals,
  });
  return module.exports;
}
function apiHarness({ payload = [{ id: 'i1', token: 'fixture-instance-token' }], status = 200, compatibility = 'current', fetcher, ...globals } = {}) {
  let credential = 'fixture-login-key';
  const requests = [];
  const api = load(read('src/services/instance-token.ts'), {
    '@/config/runtime': { runtime: { apiBaseUrl: 'https://fixture.invalid', requestTimeoutMs: 30000, compatibility } },
    './current': { getCurrentAccessCode: () => credential },
  }, {
    fetch: async (url, init) => {
      requests.push({ url: new URL(url), init });
      return fetcher ? fetcher(url, init) : Response.json(payload, { status });
    },
    ...globals,
  });
  return { api, requests, credential: value => { credential = value; } };
}

test('token fetch is on-demand, authenticated, no-store and scoped to the exact instance', async () => {
  const h = apiHarness({ payload: [{ id: 'other', token: 'wrong' }, { id: 'i1', token: 'fixture-instance-token' }] });
  assert.equal(h.requests.length, 0);
  assert.equal(await h.api.readInstanceToken('i1'), 'fixture-instance-token');
  const r = h.requests[0];
  assert.equal(r.url.pathname, '/instance/fetchInstances');
  assert.equal(r.url.search, '?instanceId=i1');
  assert.equal(r.init.headers.apikey, 'fixture-login-key');
  assert.equal(r.init.cache, 'no-store');
  assert.equal(r.init.credentials, 'same-origin');
  assert.ok(!r.url.href.includes('fixture-login-key'));
  await h.api.readInstanceToken('i1');
  assert.equal(h.requests.length, 2, 'Explicit requests must not reuse stale token cache');
});

test('accepts the native single-record response without changing token bytes', async () => {
  const h = apiHarness({ payload: { id: 'i1', token: 'Case-Sensitive.Token+123' } });
  assert.equal(await h.api.readInstanceToken('i1'), 'Case-Sensitive.Token+123');
});

test('never returns another instance token, provider key, hash or login-key fallback', async () => {
  for (const payload of [[], null, [{ id: 'other', token: 'wrong' }], [{ id: 'i1', apikey: 'fixture-login-key' }], [{ id: 'i1', hash: 'wrong' }], [{ id: 'i1', token: '  ' }], [{ id: 'i1', token: 123 }]]) {
    const h = apiHarness({ payload });
    await assert.rejects(h.api.readInstanceToken('i1'), /não foi disponibilizado/);
  }
});

test('no request without login, instance id or supported adapter', async () => {
  const h = apiHarness();
  await assert.rejects(h.api.readInstanceToken(''), /Instância não informada/);
  h.credential('');
  await assert.rejects(h.api.readInstanceToken('i1'), /sessão expirou/);
  assert.equal(h.requests.length, 0);
  const unsupported = apiHarness({ compatibility: 'service' });
  assert.equal(unsupported.api.instanceTokenSupported(), false);
  await assert.rejects(unsupported.api.readInstanceToken('i1'), /indisponível/);
  assert.equal(unsupported.requests.length, 0);
});

test('upstream errors and malformed JSON do not leak response bodies', async () => {
  for (const status of [401, 403, 404, 500]) {
    const h = apiHarness({ status, payload: { message: 'secret-must-not-appear' } });
    await assert.rejects(h.api.readInstanceToken('i1'), error => !error.message.includes('secret-must-not-appear'));
  }
  const h = apiHarness({ fetcher: async () => ({ ok: true, status: 200, json: async () => { throw new Error('secret-must-not-appear'); } }) });
  await assert.rejects(h.api.readInstanceToken('i1'), /Não foi possível consultar/);
});

test('logout during response parsing and aborted requests discard the token', async () => {
  let h;
  h = apiHarness({ fetcher: async () => ({ ok: true, status: 200, json: async () => { h.credential('new-session'); return [{ id: 'i1', token: 'old-secret' }]; } }) });
  await assert.rejects(h.api.readInstanceToken('i1'), /cancelada/);
  const controller = new AbortController();
  controller.abort();
  const aborted = apiHarness();
  await assert.rejects(aborted.api.readInstanceToken('i1', controller.signal), /cancelada/);
  assert.equal(aborted.requests[0].init.signal.aborted, true);
});

test('modern clipboard copies the entire token without a temporary DOM field', async () => {
  const copied = [];
  const h = apiHarness({ navigator: { clipboard: { writeText: async text => copied.push(text) } } });
  await h.api.copyInstanceToken('full-fixture-token');
  assert.deepEqual(copied, ['full-fixture-token']);
  await assert.rejects(h.api.copyInstanceToken(' '), /Nenhum token/);
});

function legacyHarness(success, modernDenied = false) {
  let removed = false, focused = false, copied;
  const field = { value: '', style: {}, setAttribute() {}, focus() {}, select() {}, setSelectionRange() {}, remove() { removed = true; } };
  const h = apiHarness({
    navigator: modernDenied ? { clipboard: { writeText: async () => { throw new Error('denied'); } } } : {},
    HTMLInputElement: class {}, HTMLTextAreaElement: class {},
    document: {
      activeElement: { focus() { focused = true; } }, getSelection: () => null,
      createElement: () => field, body: { appendChild() {} },
      execCommand: command => { assert.equal(command, 'copy'); copied = field.value; return success; },
    },
  });
  return { ...h, state: () => ({ removed, focused, copied, value: field.value }) };
}

test('clipboard fallback cleans temporary plaintext and restores focus', async () => {
  for (const denied of [false, true]) {
    const h = legacyHarness(true, denied);
    await h.api.copyInstanceToken('full-fixture-token');
    assert.deepEqual(h.state(), { removed: true, focused: true, copied: 'full-fixture-token', value: '' });
  }
});

test('copy failure is reported and never pretends success', async () => {
  const h = legacyHarness(false);
  await assert.rejects(h.api.copyInstanceToken('full-fixture-token'), /copie o texto manualmente/);
  assert.equal(h.state().removed, true);
  assert.equal(h.state().value, '');
});

function componentHarness({ supported = true, readToken = async () => 'fixture-instance-token', copyToken = async () => {} } = {}) {
  const hooks = {}, listeners = {}, timers = new Map(), requests = [], copied = [];
  const props = { instanceId: 'i1', instanceName: 'Instância A' };
  const session = { authenticated: true, account: { id: 'u1' }, hasPermission: () => true };
  const document = { hidden: false, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: name => { delete listeners[name]; } };
  let timerId = 0;
  const script = read('src/components/InstanceToken.vue').match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const state = load(script + '\nexport { token, busy, copied, error, visible, allowed, act, hide };', {
    vue: {
      ref: value => ({ value }), computed: fn => ({ get value() { return fn(); } }),
      onMounted: fn => { hooks.mounted = fn; }, onBeforeUnmount: fn => { hooks.unmount = fn; },
      watch: (_source, fn) => { hooks.watch = fn; },
    },
    '@/stores/session': { useSessionStore: () => session },
    '@/components/AppIcon.vue': {},
    '@/services/instance-token': {
      instanceTokenSupported: () => supported,
      readInstanceToken: (...args) => { requests.push(args); return readToken(...args); },
      copyInstanceToken: async value => { copied.push(value); await copyToken(value); },
    },
  }, {
    defineProps: () => props, document,
    window: { addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: name => { delete listeners[name]; } },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  hooks.mounted();
  return { state, hooks, listeners, timers, requests, copied, props, session, document };
}

test('component starts masked and clicking Copy does not reveal plaintext', async () => {
  const h = componentHarness();
  assert.equal(h.state.visible.value, false);
  assert.equal(h.requests.length, 0);
  await h.state.act('copy');
  assert.deepEqual(h.copied, ['fixture-instance-token']);
  assert.equal(h.state.token.value, '');
  assert.equal(h.state.copied.value, true);
});

test('show/hide is isolated per card and removes plaintext after 30 seconds', async () => {
  const a = componentHarness(), b = componentHarness();
  await a.state.act('show');
  assert.equal(a.state.token.value, 'fixture-instance-token');
  assert.equal(b.state.token.value, '');
  [...a.timers.values()].find(timer => timer.ms === 30000).fn();
  assert.equal(a.state.token.value, '');
  await a.state.act('show');
  await a.state.act('show');
  assert.equal(a.state.token.value, '');
  assert.equal(a.requests.length, 2);
});

test('blur, hidden tab, changed session/id and unmount clear secrets and listeners', async () => {
  for (const event of ['blur', 'visibilitychange', 'watch', 'unmount']) {
    const h = componentHarness();
    await h.state.act('show');
    if (event === 'visibilitychange') h.document.hidden = true;
    (h.listeners[event] || h.hooks[event])();
    assert.equal(h.state.token.value, '');
    if (event === 'unmount') assert.deepEqual(Object.keys(h.listeners), []);
  }
});

test('late responses after hiding cannot reveal or copy a token; parallel clicks are ignored', async () => {
  for (const action of ['show', 'copy']) {
    let resolve;
    const h = componentHarness({ readToken: () => new Promise(done => { resolve = done; }) });
    const pending = h.state.act(action);
    await h.state.act(action);
    assert.equal(h.requests.length, 1);
    h.state.hide();
    assert.equal(h.requests[0][1].aborted, true);
    resolve('late-secret');
    await pending;
    assert.equal(h.state.token.value, '');
    assert.equal(h.copied.length, 0);
  }
});

test('unsupported and unauthorized sessions make no token request', async () => {
  for (const type of ['unsupported', 'signed-out', 'forbidden']) {
    const h = componentHarness({ supported: type !== 'unsupported' });
    if (type === 'signed-out') h.session.authenticated = false;
    if (type === 'forbidden') h.session.hasPermission = () => false;
    await h.state.act('show'); await h.state.act('copy');
    assert.equal(h.requests.length, 0);
  }
});

test('component presents failures without claiming copied', async () => {
  const h = componentHarness({ copyToken: async () => { throw new Error('Cópia bloqueada'); } });
  await h.state.act('copy');
  assert.equal(h.state.copied.value, false);
  assert.equal(h.state.error.value, 'Cópia bloqueada');
  assert.equal(h.state.token.value, '');
});

test('card change is additive, click-isolated and uses existing theme tokens', () => {
  const component = read('src/components/InstanceToken.vue');
  assert.match(component, /@click\.stop @keydown\.stop/);
  assert.match(component, /<code v-if="visible"/);
  assert.match(component, /aria-pressed="visible"/);
  assert.match(component, /role="status" aria-live="polite"/);
  assert.doesNotMatch(component, /localStorage|sessionStorage|v-html|:title="token"|:value="token"|setInterval/);
  const styles = component.match(/<style scoped>([\s\S]*?)<\/style>/)[1];
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}\b/i);
  assert.match(styles, /var\(--surface-2\)/);
  const view = read('src/views/InstancesView.vue');
  assert.match(view, /<InstanceToken :instance-id="item.id" :instance-name="item.name"/);
  assert.match(view, /<footer class="instance-card-actions" @click\.stop>/);
  assert.match(view, />Enviar teste<\/button>/);
  assert.match(view, /Abrir <AppIcon name="arrow"/);
});
