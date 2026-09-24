import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as Vue from 'vue';
import { parse, compileScript } from '@vue/compiler-sfc';
import { renderToString } from '@vue/server-renderer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function evaluate(name, text, deps = {}, globals = {}) {
  const result = ts.transpileModule(text, { fileName: name, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } });
  const module = { exports: {} };
  vm.runInNewContext(result.outputText, { module, exports: module.exports, URL, Date, Buffer, console, AbortController,
    require: key => { if (!Object.hasOwn(deps, key)) throw new Error('Unexpected dependency: ' + key); return deps[key]; }, ...globals }, { filename: name });
  return module.exports;
}
const load = (name, deps, globals) => evaluate(name, read(name), deps, globals);
const channel = load('src/services/findhub-channel.ts');
const google = { id: 'g/one', name: 'Device account', integration: 'GOOGLE-FIND-HUB', provider: 'GOOGLE-FIND-HUB', providerLabel: 'Google Find Hub', status: 'disconnected', counts: { contacts: 0, conversations: 0, messages: 0 } };
const whatsapp = { id: 'wa-one', name: 'Messaging account', integration: 'WHATSAPP-ZAPO' };
const plain = value => JSON.parse(JSON.stringify(value));

function routing({ item = google, authenticated = true, permission = true } = {}) {
  let guard, config, reads = 0;
  load('src/router/index.ts', {
    'vue-router': { createRouter: value => { config = value; return { beforeEach: fn => { guard = fn; } }; }, createWebHistory: () => ({}) },
    '@/config/runtime': { appBasePath: () => '/manager/', runtime: { authMode: 'access-code' }, featureEnabled: () => true },
    '@/stores/session': { useSessionStore: () => ({ restore: async () => authenticated, security: {}, hasPermission: () => permission }) },
    '@/services/findhub-channel': channel,
    '@/services/connect': { connect: { connection: async () => { reads++; return item; } } },
  });
  return { config, reads: () => reads, check: (path, { params = {}, query = {}, meta = { permission: 'instances.read' } } = {}) => guard({ path, params, query, meta }) };
}

for (const [suffix, section] of [['', 'conta'], ['/configuracao', 'configuracao'], ['/integracoes', 'integracoes'], ['/integracoes/openai', 'integracoes'], ['/modelos', 'conta']]) {
  test(`Google legacy deep link ${suffix || '/instance'} never mounts a WhatsApp view`, async () => {
    const r = routing();
    assert.deepEqual(plain(await r.check('/instancias/id' + suffix, { params: { id: google.id } })), { path: channel.findHubPath(google.id, section), replace: true });
  });
}
test('global integrations query for a Google account also routes to its dedicated integration', async () => {
  const r = routing();
  assert.equal((await r.check('/integracoes', { query: { instance: google.id } })).path, channel.findHubPath(google.id, 'integracoes'));
});
test('channel routing happens only after session and permission validation', async () => {
  for (const options of [{ authenticated: false }, { permission: false }]) {
    const r = routing(options);
    const result = await r.check('/instancias/google/configuracao', { params: { id: google.id } });
    assert.equal(result, options.authenticated === false ? '/login' : '/');
    assert.equal(r.reads(), 0);
  }
});
test('existing WhatsApp instance and settings routes keep the same view and handler', async () => {
  const r = routing({ item: whatsapp });
  for (const suffix of ['', '/configuracao', '/integracoes', '/integracoes/openai', '/modelos']) {
    assert.equal(await r.check('/instancias/wa-one' + suffix, { params: { id: 'wa-one' } }), true);
  }
  assert.equal((await r.check('/findhub/wa-one/conta', { params: { id: 'wa-one' }, meta: { channel: 'findhub' } })).path, '/findhub');
  assert.ok(r.config.routes.some(route => route.path === '/findhub'));
});
test('Google channel retains access to its own device/history/events routes', async () => {
  const r = routing();
  for (const section of ['conta', 'dispositivos', 'historico', 'integracoes', 'eventos']) {
    assert.equal(await r.check('/findhub/google/' + section, { params: { id: google.id, section }, meta: { channel: 'findhub' } }), true);
  }
});

function component(name, deps, inlineTemplate = false) {
  const descriptor = parse(read(name), { filename: name }).descriptor;
  const script = compileScript(descriptor, { id: 'findhub-test', inlineTemplate });
  return evaluate(name, script.content, { vue: Vue, ...deps }).default;
}
const Stub = { render: () => Vue.h('span') };
test('dedicated account card renders without phone/message counts or send-test actions', async () => {
  const card = component('src/components/FindHubInstanceCard.vue', {
    './AppIcon.vue': Stub, './InstanceToken.vue': Stub, './StatusPill.vue': Stub, './FindHubTrackingModal.vue': Stub,
    '@/services/connect': { connect: { findHubSnapshot: async () => ({connected:false,counts:{devices:0,tracking:0,positions:0},email:''}) } },
    '@/services/findhub-channel': channel,
    'vue-router': { useRouter: () => ({ push() {} }) },
  }, true);
  const html = await renderToString(Vue.createSSRApp(card, { item: google }));
  assert.match(html, /Google Find Hub/);
  assert.match(html, /Device account/);
  assert.doesNotMatch(html, /Contatos|Conversas|Mensagens|Enviar teste|Número não informado/);
});
test('Find Hub preserves the global platform shell instead of replacing its navigation', async () => {
  const shell = component('src/layouts/FindHubShell.vue', {
    './AppShell.vue': { props: ['navigationGroups'], render() { assert.equal(this.navigationGroups, undefined); return Vue.h('nav','GLOBAL_PLATFORM_NAVIGATION'); } },
  }, true);
  const html = await renderToString(Vue.createSSRApp(shell));
  assert.match(html, /GLOBAL_PLATFORM_NAVIGATION/);
  const view = read('src/views/FindHubView.vue');
  for(const resource of ['mapa','configuracao','historico','integracoes','eventos']) assert.ok(view.includes(resource));
  assert.doesNotMatch(view, /rejectCall|readMessages|alwaysOnline/);
});
test('Google no longer inherits the WhatsApp privacy capability and is excluded from bot/message selectors', () => {
  const normalizers = load('src/services/normalizers.ts');
  const caps = normalizers.providerCapabilities('GOOGLE-FIND-HUB');
  for (const name of ['privacy', 'messaging', 'groups', 'presence', 'calls', 'qrCode', 'pairingCode']) assert.equal(caps[name], false);
  for (const name of ['devices', 'location', 'tracking']) assert.equal(caps[name], true);
  for (const name of ['IntegrationsView', 'MessagesView', 'ContactsView', 'ConversationsView', 'VoiceView']) assert.match(read('src/views/' + name + '.vue'), /\.filter\(\(item\) => !isFindHub\(item\)\)/);
  const view = read('src/views/FindHubView.vue');
  assert.doesNotMatch(view, /TestMessageModal|rejectCall|readMessages|alwaysOnline|integrationDefinitions|capabilityGroups/);
  assert.match(view, /FindHubShell/);
  assert.match(read('src/views/InstancesView.vue'), /FindHubInstanceCard v-if="isFindHub\(item\)"/);
});
test('assisted auth UI never asks the operator to copy the session or Google tokens', () => {
  const descriptor = parse(read('src/components/FindHubBrowserAuth.vue')).descriptor;
  assert.doesNotMatch(descriptor.template.content, /Session ID|Bridge token|Copiar token|Credential Provider/);
  assert.match(descriptor.template.content, /extensão própria/);
  assert.match(descriptor.template.content, /experimental/);
  assert.match(descriptor.template.content, /não funciona em qualquer navegador mobile/);
  assert.doesNotMatch(descriptor.scriptSetup.content, /localStorage|sessionStorage|clipboard/);
  assert.match(descriptor.scriptSetup.content, /response\.connected !== true/);
});
test('event options are channel events, with no messaging/bot/proxy settings', () => {
  const source = read('src/components/FindHubEvents.vue');
  for (const event of ['FINDHUB_DEVICES_UPDATED', 'FINDHUB_LOCATION_UPDATED', 'FINDHUB_TRACKING_UPDATE', 'FINDHUB_ERROR']) assert.ok(source.includes(event));
  assert.doesNotMatch(source, /MESSAGES_UPSERT|CONTACTS_UPSERT|QRCODE_UPDATED|chatwoot|typebot|alwaysOnline|rejectCall/);
  assert.match(source, /CONNECTION_UPDATE/);
});
test('Find Hub creation refreshes the cache before the router resolves its new account', () => {
  assert.match(read('src/services/current.ts'), /await rawInstances\(payload.integration === 'GOOGLE-FIND-HUB'\)/);
});
