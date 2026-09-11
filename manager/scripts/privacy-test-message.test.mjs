import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ts = require('typescript');
// Standalone Docker builds receive only manager/. Repository/API parity lives
// in test/manager-feature-contract.test.cjs, executed by the root CI suite.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function load(name, deps = {}, globals = {}) {
  const source = read(name);
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const context = { module, exports: module.exports, URL, AbortController, Buffer, Date,
    require: key => { if (!(key in deps)) throw Error('Unexpected dependency: ' + key); return deps[key]; }, ...globals };
  vm.runInNewContext(code, context, { filename: name }); return module.exports;
}
const MANAGER_FEATURE_DEFAULTS = JSON.parse(read('public/assets/feature-defaults.json'));
const defaultFeatures = Object.fromEntries(Object.entries(MANAGER_FEATURE_DEFAULTS).map(([key, [, fallback]]) => [key, fallback]));
const input = load('src/services/test-message-input.ts');

test('production defaults hide all communication screens; test send does not expose contacts', () => {
  const features = defaultFeatures;
  for (const key of ['conversations', 'messages', 'contacts', 'testMessageContacts']) assert.equal(features[key], false);
  assert.equal(features.instanceTestMessage, true);
  assert.ok(!JSON.stringify(features).includes('secret'));
});
function router(features) {
  let config, guard, restored = 0;
  load('src/router/index.ts', {
    'vue-router': { createWebHistory: () => ({}), createRouter: value => { config = value; return { beforeEach: handler => { guard = handler; } }; } },
    '@/config/runtime': { appBasePath: () => '/manager/', runtime: { authMode: 'access-code' }, featureEnabled: (name, fallback) => features[name] ?? fallback },
    '@/stores/session': { useSessionStore: () => ({ restore: async () => { restored++; return true; }, security: {}, hasPermission: () => true }) },
  });
  return { config, check: async path => { const route = config.routes.find(r => r.path === path); assert.ok(route); return guard({ ...route, meta: route.meta || {} }); }, restored: () => restored };
}
test('hidden deep links redirect before loading session or view data', async () => {
  const r = router(defaultFeatures);
  for (const path of ['/conversas', '/mensagens', '/contatos']) assert.equal(await r.check(path), '/');
  assert.equal(r.restored(), 0);
});
test('explicit true restores all three views without an environment hard lock', async () => {
  const r = router({ ...defaultFeatures, conversations: true, messages: true, contacts: true });
  for (const path of ['/conversas', '/mensagens', '/contatos']) assert.notEqual(await r.check(path), '/');
  assert.equal(r.restored(), 3);
});
test('navigation and route feature identifiers agree', () => {
  const shell = read('src/layouts/AppShell.vue'); const r = router(defaultFeatures);
  for (const [path, feature] of [['/conversas', 'conversations'], ['/mensagens', 'messages'], ['/contatos', 'contacts']]) {
    assert.equal(r.config.routes.find(r => r.path === path).meta.feature, feature);
    assert.ok(shell.split('\n').some(line => line.includes(`to:'${path}'`) && line.includes(`feature:'${feature}'`)));
  }
});
test('test input validates phone without invented country/DDD; selected LID remains a LID', () => {
  assert.equal(input.testMessageDestination('+55 (75) 9623-6940'), '557596236940');
  assert.equal(input.testMessageDestination('', { rawRef: '557596236940:3@s.whatsapp.net' }), '557596236940');
  assert.equal(input.testMessageDestination('', { rawRef: '22654721644999@lid' }), '22654721644999@lid');
  for (const value of ['', '123', 'text 557596236940', '12345@g.us', '22654721644999@lid', 'status@broadcast', '1234567890123456', '0012345678']) assert.throws(() => input.testMessageDestination(value));
  assert.throws(() => input.testMessageDestination('', { rawRef: '22654721644999@lid' }, 'WHATSAPP-BUSINESS'));
  assert.equal(input.testMessageDestination('', { rawRef: '22654721644999@lid', number: '557596236940' }, 'WHATSAPP-BUSINESS'), '557596236940');
});
test('test text is bounded and blank messages are rejected', () => {
  assert.equal(input.testMessageText(' hello '), 'hello');
  assert.throws(() => input.testMessageText(' ')); assert.throws(() => input.testMessageText('x'.repeat(4097)));
  assert.equal(input.testMessageText('x'.repeat(4096)).length, 4096);
});
function currentSession(features) {
  const requests = [];
  const normalizers = load('src/services/normalizers.ts');
  const { current } = load('src/services/current.ts', {
    '@/config/runtime': { runtime: { apiBaseUrl: 'https://fixture.invalid', requestTimeoutMs: 30000 }, featureEnabled: (key, fallback) => features[key] ?? fallback },
    './normalizers': normalizers, './whatsapp-destination': load('src/services/whatsapp-destination.ts'), './integration-definitions': {}, './voice-media': {},
  }, {
    sessionStorage: { removeItem() {} }, localStorage: { removeItem() {} }, window: { setTimeout }, clearTimeout,
    fetch: async (url, init) => {
      const target = new URL(url); requests.push({ target, init });
      if (target.pathname === '/instance/fetchInstances') return Response.json([{ id: 'i1', name: 'Atendimento A', token: 'fixture-instance-token' }]);
      if (target.pathname.includes('/findContacts/')) return Response.json(Array.from({ length: 50 }, (_, i) => ({ id: String(i), remoteJid: i === 0 ? '12345@g.us' : `55759623${6940 + i}@s.whatsapp.net`, pushName: `Fixture ${i}` })));
      return Response.json({ ok: true });
    },
  });
  return { current, requests };
}
test('contact selector disabled causes no network request', async () => {
  const { current, requests } = currentSession({ testMessageContacts: false });
  await assert.rejects(() => current.testMessageContacts('i1'), /desabilitada/); assert.equal(requests.length, 0);
});
test('explicit contact picker reads one bounded page for the selected instance, no conversations', async () => {
  const { current, requests } = currentSession({ testMessageContacts: true });
  await current.loginAccess('fixture-global'); assert.equal(requests.length, 1);
  const result = await current.testMessageContacts('i1', 2);
  const request = requests.at(-1);
  assert.equal(request.target.pathname, '/chat/findContacts/Atendimento%20A');
  assert.deepEqual(JSON.parse(request.init.body), { where: {}, page: 2, offset: 50 });
  assert.equal(request.init.headers.apikey, 'fixture-instance-token');
  assert.equal(result.hasMore, true); assert.equal(result.items.length, 49);
  assert.ok(!requests.some(r => /findMessages|findChats/.test(r.target.pathname)));
  const before = requests.length; await assert.rejects(() => current.testMessageContacts('i1', -1)); assert.equal(requests.length, before);
});
test('test sending reuses the native text endpoint, scoped to the chosen instance', async () => {
  const { current, requests } = currentSession({});
  await current.loginAccess('fixture-global');
  await current.sendText('i1', '557596236940', 'Mensagem de teste');
  assert.equal(requests.at(-1).target.pathname, '/message/sendText/Atendimento%20A');
  assert.equal(requests.at(-1).init.method, 'POST');
  assert.deepEqual(JSON.parse(requests.at(-1).init.body), { number: '557596236940', text: 'Mensagem de teste' });
  assert.equal(requests.at(-1).init.headers.apikey, 'fixture-instance-token');
});
test('modal is on-demand, keeps no history and has no background polling/storage', () => {
  const modal = read('src/components/TestMessageModal.vue');
  assert.doesNotMatch(modal, /connect\.(messages|conversations|contacts)\(/);
  assert.doesNotMatch(modal, /setInterval|localStorage|sessionStorage/);
  assert.match(modal, /generation !== sequence/); assert.match(modal, /:dismissible="!busy"/);
  assert.match(modal, /@click="loadContacts\(1\)"/); assert.match(modal, /await connect\.sendText/);
  for (const view of ['InstancesView.vue', 'InstanceView.vue']) assert.match(read('src/views/' + view), /TestMessageModal v-if=/);
});
test('standalone container honors explicit ENV flags without secrets or accumulated old values', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-flags-'));
  try {
    const output = path.join(directory, 'runtime.js');
    const env = { PATH: process.env.PATH, MANAGER_FEATURE_CONVERSATIONS: 'true', MANAGER_FEATURE_MESSAGES: 'false', MANAGER_FEATURE_CONTACTS: 'true', MANAGER_FEATURE_TEST_MESSAGE_CONTACTS: 'off', MANAGER_FEATURE_DOCS: ' ', AUTHENTICATION_API_KEY: 'do-not-export' };
    const script = path.join(root, 'docker-entrypoint.d/40-manager-features.sh');
    const template = path.join(root, 'public/assets/runtime-config.js');
    const render = () => execFileSync('sh', [script, template, output], { env });
    render(); const before = fs.readFileSync(output, 'utf8'); render(); assert.equal(fs.readFileSync(output, 'utf8'), before);
    const window = { location: { hostname: 'fixture.invalid', protocol: 'https:', port: '' } };
    vm.runInNewContext(before, { window });
    assert.deepEqual(JSON.parse(JSON.stringify(window.__CONNECT_WEB__.features)), { studio: true, ...defaultFeatures, conversations: true, messages: false, contacts: true, testMessageContacts: false });
    assert.ok(!before.includes('do-not-export'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('standalone development reads its local defaults without imports outside its Docker context', () => {
  assert.match(read('vite.config.ts'), /public\/assets\/feature-defaults\.json/);
  assert.doesNotMatch(read('vite.config.ts'), /from ['"]\.\.\//);
});


test('instance actions share a footer and the test action keeps its feature, permission and connection guards', () => {
  const view = read('src/views/InstancesView.vue');
  const footer = view.match(/<footer class="instance-card-actions" @click\.stop>([\s\S]*?)<\/footer>/)?.[1];
  assert.ok(footer, 'Both card actions must be inside the click-isolated footer');
  const buttons = [...footer.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  assert.equal(buttons.length, 2);
  const [send, open] = buttons;
  assert.equal(send[2].trim(), 'Enviar teste');
  assert.match(send[1], /featureEnabled\('instanceTestMessage', true\) && session\.hasPermission\('messages\.send'\)/);
  assert.match(send[1], /:disabled="item\.status !== 'connected' \|\| !item\.capabilities\.messaging"/);
  assert.match(send[1], /aria-haspopup="dialog"/);
  assert.match(send[1], /@click\.stop="testInstance = item"/);
  assert.match(open[1], /instance-card-open/);
  assert.match(open[1], /@click\.stop="router\.push\(`/);
  assert.ok(open[1].includes('encodeURIComponent(item.id)'));
  assert.match(open[2], /Abrir <AppIcon name="arrow" :size="15"\/>/);
  for (const button of buttons) {
    assert.match(button[1], /type="button"/);
    assert.match(button[1], /class="card-link instance-card-action/);
    assert.doesNotMatch(button[1], /class="btn/);
  }
});

test('instance footer styling is scoped, uses the existing link tokens and keeps open right-aligned', () => {
  const view = read('src/views/InstancesView.vue');
  const style = view.match(/<style scoped>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(style);
  assert.match(style, /\.instance-card-actions\s*\{[^}]*align-items:\s*center;[^}]*justify-content:\s*space-between;[^}]*margin-top:\s*auto;/);
  assert.match(style, /\.instance-card-open\s*\{[^}]*margin-left:\s*auto;/);
  assert.match(style, /\.instance-card-action\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/);
  assert.match(style, /\.instance-card-action:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--primary\);/);
  assert.match(style, /\.instance-card-action:disabled\s*\{[^}]*cursor:\s*not-allowed;/);
  assert.doesNotMatch(style, /#[0-9a-f]{3,8}\b/i);
});
