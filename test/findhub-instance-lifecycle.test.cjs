'use strict';

// Exercise the real controller, settings service, monitor and Find Hub runtime.
// Only infrastructure/provider dependencies are replaced; no server bootstrap,
// real account, network request or filesystem cleanup is allowed by this harness.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const Integration = {
  GOOGLE_FIND_HUB: 'GOOGLE-FIND-HUB',
  WHATSAPP_BAILEYS: 'WHATSAPP-BAILEYS',
  WHATSAPP_ZAPO: 'WHATSAPP-ZAPO',
  WHATSAPP_BUSINESS: 'WHATSAPP-BUSINESS',
};
const Events = {
  INSTANCE_CREATE: 'instance.create',
  INSTANCE_DELETE: 'instance.delete',
  REMOVE_INSTANCE: 'remove.instance',
  LOGOUT_INSTANCE: 'logout.instance',
};
const plain = (value) => JSON.parse(JSON.stringify(value));
const compiled = new Map();

function loadSource(relative, dependencies) {
  const file = path.join(ROOT, relative);
  if (!compiled.has(file)) {
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
      reportDiagnostics: true,
    });
    assert.equal((output.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
    compiled.set(file, output.outputText);
  }
  const module = { exports: {} };
  vm.runInNewContext(compiled.get(file), {
    module, exports: module.exports, Buffer, URL, console,
    process: { env: {} }, setInterval, clearInterval, setTimeout, clearTimeout,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unexpected dependency in isolated lifecycle test: ${name}`);
    },
  }, { filename: file });
  return module.exports;
}

function harness(options = {}) {
  const calls = [];
  const errors = [];
  const rows = new Map();
  const emitter = new EventEmitter();
  class Logger {
    error(...args) { errors.push(args); }
    warn() {}
    info() {}
    log() {}
    setInstance() {}
  }
  class BadRequestException extends Error {
    constructor(message) { super(message); this.status = 400; }
  }
  const matches = (row, where) => Object.entries(where).every(([key, value]) => value === undefined || row[key] === value);
  const config = {
    get(name) {
      const values = {
        DATABASE: { CONNECTION: { CLIENT_NAME: 'lifecycle-tests' }, SAVE_DATA: { INSTANCE: true } },
        CACHE: { REDIS: { ENABLED: false, SAVE_INSTANCES: false } },
        PROVIDER: { ENABLED: false },
        CHATWOOT: { ENABLED: options.chatwootEnabled !== false },
        DEL_INSTANCE: false,
        SERVER: { URL: 'https://connect.example.invalid' },
        WA_BUSINESS: { TOKEN_WEBHOOK: 'test-business-webhook' },
        AUTHENTICATION: { API_KEY: { KEY: 'test-admin' } },
      };
      assert.ok(Object.hasOwn(values, name), `Unexpected config ${name}`);
      return values[name];
    },
  };
  const prisma = {
    instance: {
      async create({ data }) {
        calls.push(['db.create', plain(data)]);
        if (options.saveError) throw new Error('database insert failed');
        if (rows.has(data.name)) throw new Error('duplicate instance name');
        rows.set(data.name, { ...data });
        return { ...data };
      },
      async findFirst({ where }) { return [...rows.values()].find((row) => matches(row, where)) || null; },
      async findUnique({ where }) { return prisma.instance.findFirst({ where }); },
      async findMany() { return [...rows.values()]; },
      async update({ where, data }) {
        const row = await prisma.instance.findFirst({ where });
        if (!row) throw new Error('instance not found');
        Object.assign(row, data);
        return row;
      },
      async delete({ where }) {
        if (options.beforeDelete) await options.beforeDelete();
        const row = await prisma.instance.findFirst({ where });
        if (!row) throw new Error('instance not found');
        rows.delete(row.name);
        calls.push(['db.delete', row.id]);
        return row;
      },
      async deleteMany({ where }) {
        calls.push(['db.deleteMany', plain(where)]);
        let count = 0;
        for (const row of [...rows.values()]) {
          if (matches(row, where)) { rows.delete(row.name); count++; }
        }
        return { count };
      },
    },
    findHubDevice: {
      async deleteMany(args) { calls.push(['devices.deleteMany', plain(args)]); return { count: 0 }; },
      async findMany(args) { calls.push(['devices.findMany', plain(args)]); return []; },
    },
  };
  for (const name of [
    'session', 'chat', 'contact', 'messageUpdate', 'message', 'webhook', 'chatwoot',
    'proxy', 'rabbitmq', 'nats', 'sqs', 'integrationSession', 'typebot', 'websocket', 'setting', 'label',
  ]) {
    prisma[name] = { async deleteMany(args) { calls.push([`${name}.deleteMany`, plain(args)]); return { count: 0 }; } };
  }
  const eventManager = {
    async setInstance(name, data) {
      calls.push(['events.setInstance', name, plain(data)]);
      if (options.eventsError) throw new Error('event configuration failed');
    },
    async emit(event) {
      calls.push(['events.emit', plain(event)]);
      if (options.creationEventError && event.event === Events.INSTANCE_CREATE) throw new Error('creation event failed');
      if (options.deletionEventError && event.event === Events.INSTANCE_DELETE) throw new Error('deletion event failed');
    },
  };
  const dependencies = {
    '@api/types/wa.types': { Integration, Events },
    '@api/server.module': { eventManager, channelController: {} },
    '@config/logger.config': { Logger },
    '@config/path.config': { INSTANCE_DIR: '/virtual/instances', STORE_DIR: '/virtual/store' },
    '@exceptions': { BadRequestException, InternalServerErrorException: Error, UnauthorizedException: Error, NotFoundException: Error },
    '@api/services/provider-session-migration.service': { ProviderSessionMigrationService: class {} },
    'baileys': { delay: async () => {} },
    'class-validator': { isArray: Array.isArray, isURL: () => true },
    'qrcode': { toDataURL: async () => { throw new Error('Unexpected QR generation'); } },
    'uuid': { v4: randomUUID },
    'crypto': require('node:crypto'),
    'path': require('node:path'),
    'fs': { rmSync: (...args) => calls.push(['fs.remove', ...args]) },
    'child_process': { execFileSync: (...args) => calls.push(['process.exec', ...args]) },
    './local-template.definition': {
      isLocalTemplateProvider: (provider) => [Integration.WHATSAPP_BAILEYS, Integration.WHATSAPP_ZAPO].includes(provider),
      defaultLocalTemplateRecord: () => ({ name: 'hello' }),
    },
    '../findhub.constants': { FINDHUB_INTEGRATION: Integration.GOOGLE_FIND_HUB, FINDHUB_EVENTS: {} },
    '../auth/findhub-auth-broker.service': {
      FindHubAuthBrokerService: class {
        async load() { return null; }
        async status() { return { state: 'WAITING_AUTH', email: null, ready: false }; }
        async clear(id) { calls.push(['auth.clear', id]); }
      },
    },
    './findhub-protocol.client': { FindHubProtocolClient: class { constructor() { throw new Error('Unexpected Google connection'); } } },
    './findhub-traccar.service': { FindHubTraccarService: class {} },
  };
  dependencies['./findhub-monitoring'] = loadSource('src/api/integrations/channel/findhub/services/findhub-monitoring.ts', dependencies);
  const { FindHubStartupService } = loadSource('src/api/integrations/channel/findhub/services/findhub-runtime.service.ts', dependencies);
  dependencies['@api/server.module'].channelController.init = (data) => {
    calls.push(['channel.init', data.integration]);
    if (options.factoryError) throw new Error('runtime initialization failed');
    if (data.integration === Integration.GOOGLE_FIND_HUB) {
      const runtime = new FindHubStartupService(config, emitter, prisma);
      if (options.setInstanceError) runtime.setInstance = () => { throw new Error('runtime assignment failed'); };
      return runtime;
    }
    return {
      integration: data.integration || Integration.WHATSAPP_BAILEYS,
      connectionStatus: { state: data.integration === Integration.WHATSAPP_BUSINESS ? 'open' : 'close' },
      setInstance(value) { Object.assign(this, value); },
      async setSettings(value) { calls.push(['wa.setSettings', plain(value)]); this.settings = value; },
      async findSettings() { return this.settings || {}; },
      async setPresence(value) { calls.push(['wa.setPresence', value]); return value; },
      clearCacheChatwoot() { calls.push(['wa.clearCacheChatwoot']); },
      async sendDataWebhook(event, data) { calls.push(['wa.event', event, data]); },
      async logoutInstance() { calls.push(['wa.logout']); this.connectionStatus.state = 'close'; },
    };
  };
  const { WAMonitoringService } = loadSource('src/api/services/monitor.service.ts', dependencies);
  const monitor = new WAMonitoringService(emitter, config, prisma, {}, {}, {}, {});
  const { SettingsService } = loadSource('src/api/services/settings.service.ts', dependencies);
  const settings = new SettingsService(monitor);
  const { InstanceController } = loadSource('src/api/controllers/instance.controller.ts', dependencies);
  const controller = new InstanceController(monitor, config, prisma, emitter, {
    create: (...args) => calls.push(['chatwoot.create', ...args]),
  }, settings, {
    testProxy: async (...args) => { calls.push(['proxy.test', ...args]); return true; },
    createProxy: async (...args) => calls.push(['proxy.create', ...args]),
  }, {}, {}, {}, {});
  return { controller, monitor, prisma, calls, errors, rows, emitter, settings, BadRequestException };
}

const findHub = (extra = {}) => ({ instanceName: 'findhub-test', integration: Integration.GOOGLE_FIND_HUB, ...extra });

// The first test reproduces the reported setSettings TypeError on the unfixed code.
test('create Find Hub with the real runtime, no fake WhatsApp settings methods', async () => {
  const h = harness();
  const result = await h.controller.createInstance(findHub());
  const runtime = h.monitor.waInstances['findhub-test'];
  assert.equal(typeof runtime.setSettings, 'undefined');
  assert.equal(typeof runtime.findSettings, 'undefined');
  assert.equal(typeof runtime.clearCacheChatwoot, 'undefined');
  assert.equal(result.instance.integration, Integration.GOOGLE_FIND_HUB);
  assert.equal(result.instance.status, 'close');
  assert.equal(h.rows.get('findhub-test').connectionStatus, 'close');
  assert.equal(result.settings, null);
  assert.equal(result.qrcode, undefined);
  assert.equal(Object.keys(h.monitor.delInstanceTimeouts).length, 0);
  assert.equal(h.calls.filter(([name]) => name === 'wa.setSettings').length, 0);
  assert.equal(h.calls.filter(([name, value]) => name === 'events.emit' && value.event === Events.INSTANCE_CREATE).length, 1);
});

test('caller cannot mark a newly created Google account as already connected', async () => {
  const h = harness();
  const result = await h.controller.createInstance(findHub({ status: 'open' }));
  assert.equal(result.instance.status, 'close');
  assert.equal(h.rows.get('findhub-test').connectionStatus, 'close');
});

test('inactive generic form defaults and qrcode flag do not trigger WhatsApp pairing', async () => {
  const h = harness();
  const result = await h.controller.createInstance(findHub({
    qrcode: true, number: '', businessId: '', rejectCall: false, groupsIgnore: false,
    alwaysOnline: false, readMessages: false, readStatus: false, syncFullHistory: false, msgCall: '',
  }));
  assert.equal(result.settings, null);
  assert.equal(result.qrcode, undefined);
});

test('same public create flow preserves instance token and event transport configuration', async () => {
  const h = harness();
  const input = findHub({ token: 'test-instance-token', webhook: { url: 'https://example.invalid/hook' },
    websocket: { enabled: true }, rabbitmq: { enabled: true }, nats: { enabled: true }, sqs: { enabled: true } });
  const result = await h.controller.createInstance(input);
  assert.equal(result.hash, 'test-instance-token');
  assert.equal(h.rows.get(input.instanceName).token, result.hash);
  assert.equal(result.webhook.webhookUrl, input.webhook.url);
  for (const key of ['websocket', 'rabbitmq', 'nats', 'sqs']) assert.equal(result[key].enabled, true);
  assert.deepEqual(h.calls.find(([name]) => name === 'events.setInstance')[2], plain(input));
});

for (const incompatible of [
  { readMessages: true }, { alwaysOnline: true }, { rejectCall: true }, { groupsIgnore: true },
  { readStatus: true }, { syncFullHistory: true }, { msgCall: 'call response' }, { voipMaxConcurrentCalls: 1 },
  { proxyHost: 'localhost', proxyPort: '1080', proxyProtocol: 'socks5' },
  { chatwootAccountId: 1, chatwootToken: 'test-token', chatwootUrl: 'https://example.invalid' },
]) {
  test(`reject unsupported Find Hub options before side effects: ${Object.keys(incompatible)[0]}`, async () => {
    const h = harness();
    await assert.rejects(h.controller.createInstance(findHub(incompatible)),
      (error) => error.status === 400 && /não suportadas.*Google Find Hub/.test(error.message));
    assert.equal(h.calls.length, 0);
    assert.equal(h.rows.size, 0);
  });
}

test('database insert failure does not register a phantom Find Hub runtime', async () => {
  const h = harness({ saveError: true });
  await assert.rejects(h.controller.createInstance(findHub()), /database insert failed/);
  assert.equal(Object.keys(h.monitor.waInstances).length, 0);
  assert.equal(h.calls.filter(([name]) => name === 'events.setInstance').length, 0);
});

test('duplicate creation leaves the existing instance, token and runtime intact', async () => {
  const h = harness();
  await h.controller.createInstance(findHub());
  const runtime = h.monitor.waInstances['findhub-test'];
  const record = h.rows.get('findhub-test');
  await assert.rejects(h.controller.createInstance(findHub()), /duplicate instance name/);
  assert.equal(h.monitor.waInstances['findhub-test'], runtime);
  assert.equal(h.rows.get('findhub-test'), record);
  assert.equal(h.calls.filter(([name]) => name === 'db.delete').length, 0);
});

test('initializer failure cannot delete an existing instance with the requested name', async () => {
  const h = harness({ factoryError: true });
  const existing = { instanceId: 'existing-id', integration: Integration.WHATSAPP_ZAPO };
  h.monitor.waInstances['findhub-test'] = existing;
  h.rows.set('findhub-test', { id: 'existing-id', name: 'findhub-test' });
  await assert.rejects(h.controller.createInstance(findHub()), /runtime initialization failed/);
  assert.equal(h.monitor.waInstances['findhub-test'], existing);
  assert.equal(h.rows.size, 1);
  assert.equal(h.calls.filter(([name]) => name.includes('delete')).length, 0);
});

test('assignment failure removes only the row inserted by that Find Hub request', async () => {
  const h = harness({ setInstanceError: true });
  h.rows.set('other', { id: 'other-id', name: 'other', integration: Integration.WHATSAPP_ZAPO });
  await assert.rejects(h.controller.createInstance(findHub()), /runtime assignment failed/);
  assert.equal(h.rows.size, 1);
  assert.ok(h.rows.has('other'));
  const cleanup = h.calls.find(([name]) => name === 'db.deleteMany')[1];
  assert.equal(cleanup.integration, Integration.GOOGLE_FIND_HUB);
  assert.equal(cleanup.id, h.calls.find(([name]) => name === 'db.create')[1].id);
});

test('creation awaits rollback after post-persistence configuration failure', async () => {
  let release;
  let deleting;
  const started = new Promise((resolve) => { deleting = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const h = harness({ eventsError: true, beforeDelete: async () => { deleting(); await gate; } });
  let settled = false;
  const operation = h.controller.createInstance(findHub());
  const rejection = assert.rejects(operation, /event configuration failed/);
  void operation.then(() => { settled = true; }, () => { settled = true; });
  await started;
  await Promise.resolve();
  assert.equal(settled, false);
  release();
  await rejection;
  assert.equal(h.rows.size, 0);
  assert.equal(Object.keys(h.monitor.waInstances).length, 0);
});

test('asynchronous creation event failure is caught and cleaned, not left unhandled', async () => {
  const h = harness({ creationEventError: true });
  await assert.rejects(h.controller.createInstance(findHub()), /creation event failed/);
  assert.equal(h.rows.size, 0);
  assert.equal(Object.keys(h.monitor.waInstances).length, 0);
});

test('Find Hub connect without credentials remains WAITING_AUTH; devices stay instance-scoped', async () => {
  const h = harness();
  const created = await h.controller.createInstance(findHub());
  const result = await h.controller.connectToWhatsapp({ instanceName: 'findhub-test' });
  assert.equal(result.auth.state, 'WAITING_AUTH');
  assert.equal(result.auth.ready, false);
  assert.equal(result.instance.status, 'connecting');
  assert.equal(h.rows.get('findhub-test').connectionStatus, 'connecting');
  const devices = await h.monitor.waInstances['findhub-test'].devices();
  assert.equal(devices.length, 0);
  assert.equal(h.calls.find(([name]) => name === 'devices.findMany')[1].where.instanceId, created.instance.instanceId);
});

for (const connected of [false, true]) {
  test(`Find Hub deletion works with global Chatwoot enabled, waiting=${connected}`, async () => {
    const h = harness();
    const created = await h.controller.createInstance(findHub());
    if (connected) await h.controller.connectToWhatsapp({ instanceName: 'findhub-test' });
    const result = await h.controller.deleteInstance({ instanceName: 'findhub-test' });
    assert.equal(result.status, 'SUCCESS');
    assert.equal(h.rows.size, 0);
    assert.equal(Object.keys(h.monitor.waInstances).length, 0);
    assert.ok(h.calls.some(([name, id]) => name === 'auth.clear' && id === created.instance.instanceId));
    assert.equal(h.calls.filter(([name]) => name === 'wa.clearCacheChatwoot').length, 0);
  });
}

test('failed asynchronous deletion event does not prevent instance cleanup', async () => {
  const h = harness({ deletionEventError: true });
  await h.controller.createInstance(findHub());
  const result = await h.controller.deleteInstance({ instanceName: 'findhub-test' });
  assert.equal(result.status, 'SUCCESS');
  assert.equal(h.rows.size, 0);
});

test('Find Hub WhatsApp settings and presence requests have explicit semantics, not TypeErrors', async () => {
  const h = harness();
  await h.controller.createInstance(findHub());
  await assert.rejects(h.settings.create({ instanceName: 'findhub-test' }, { readMessages: true }),
    (error) => error.status === 400 && /Google Find Hub/.test(error.message));
  assert.equal(await h.settings.find({ instanceName: 'findhub-test' }), null);
  await assert.rejects(h.controller.setPresence({ instanceName: 'findhub-test' }, { presence: 'available' }),
    (error) => error.status === 400 && /Google Find Hub/.test(error.message));
});

test('generic logout event skips the WhatsApp-only Chatwoot runtime hook', async () => {
  const h = harness();
  await h.controller.createInstance(findHub());
  await h.emitter.listeners('logout.instance')[0]('findhub-test');
  assert.equal(h.calls.filter(([name]) => name === 'wa.clearCacheChatwoot').length, 0);
  assert.equal(h.rows.get('findhub-test').connectionStatus, 'close');
});

test('generic no.connection event does not fabricate WhatsApp QR state on Find Hub', async () => {
  const h = harness();
  await h.controller.createInstance(findHub());
  const runtime = h.monitor.waInstances['findhub-test'];
  await h.emitter.listeners('no.connection')[0]('findhub-test');
  assert.equal(runtime.instance.qrcode, undefined);
  assert.equal(runtime.connectionStatus.state, 'close');
  assert.equal(h.errors.length, 0);
});

for (const integration of [Integration.WHATSAPP_BAILEYS, Integration.WHATSAPP_ZAPO, Integration.WHATSAPP_BUSINESS]) {
  test(`${integration}: existing settings, presence and deletion hooks remain active`, async () => {
    const h = harness();
    const result = await h.controller.createInstance({ instanceName: 'wa-test', integration,
      number: '15555550100', readMessages: true, alwaysOnline: true });
    assert.equal(result.settings.readMessages, true);
    assert.equal(result.settings.alwaysOnline, true);
    assert.equal(h.calls.filter(([name]) => name === 'wa.setSettings').length, 1);
    assert.equal((await h.settings.find({ instanceName: 'wa-test' })).readMessages, true);
    await h.controller.setPresence({ instanceName: 'wa-test' }, { presence: 'available' });
    assert.equal(h.calls.filter(([name]) => name === 'wa.setPresence').length, 1);
    await h.controller.deleteInstance({ instanceName: 'wa-test' });
    assert.equal(h.calls.filter(([name]) => name === 'wa.clearCacheChatwoot').length, 1);
    assert.equal(h.rows.size, 0);
  });
}

test('WhatsApp proxy and Chatwoot configuration are not disabled by the Find Hub fix', async () => {
  const h = harness();
  const result = await h.controller.createInstance({ instanceName: 'wa-test', integration: Integration.WHATSAPP_ZAPO,
    proxyHost: 'localhost', proxyPort: '1080', proxyProtocol: 'socks5', chatwootAccountId: 1,
    chatwootToken: 'test-token', chatwootUrl: 'https://example.invalid', chatwootSignMsg: true,
    chatwootReopenConversation: false, chatwootConversationPending: false });
  assert.equal(result.chatwoot.enabled, true);
  assert.equal(h.calls.filter(([name]) => name === 'proxy.create').length, 1);
  assert.equal(h.calls.filter(([name]) => name === 'chatwoot.create').length, 1);
});

for (const integration of [Integration.WHATSAPP_BAILEYS, Integration.WHATSAPP_ZAPO]) {
  test(`${integration}: QR and pairing still use their separate existing paths`, async () => {
    const h = harness();
    h.controller.requestExplicitQrCode = async () => ({ code: 'test-qr' });
    h.controller.requestExplicitPairingCode = async (_runtime, number) => ({ pairingCode: `test-${number}` });
    const qr = await h.controller.createInstance({ instanceName: 'wa-qr', integration, qrcode: true });
    const pairing = await h.controller.createInstance({ instanceName: 'wa-pairing', integration, qrcode: true, number: '15555550100' });
    assert.equal(qr.qrcode.code, 'test-qr');
    assert.equal(pairing.qrcode.pairingCode, 'test-15555550100');
  });
}

test('legacy monitor save error handling is unchanged for WhatsApp', async () => {
  const h = harness({ saveError: true });
  await h.monitor.saveInstance({ instanceName: 'wa-test', integration: Integration.WHATSAPP_ZAPO });
  assert.equal(h.rows.size, 0);
  assert.equal(h.errors.length, 1);
});


test('restoring a failed Google account does not reject loading unrelated WhatsApp runtimes', async () => {
  const h = harness({ factoryError: true });
  const whatsapp = { instanceId: 'stable-wa', integration: Integration.WHATSAPP_ZAPO };
  h.monitor.waInstances['whatsapp-already-online'] = whatsapp;
  await h.monitor.setInstance({ instanceId: 'google-id', instanceName: 'google-restore', integration: Integration.GOOGLE_FIND_HUB, connectionStatus: 'open' });
  assert.equal(h.monitor.waInstances['whatsapp-already-online'], whatsapp);
  assert.equal(h.monitor.waInstances['google-restore'], undefined);
  assert.ok(h.errors.length > 0);
});

test('restored Google account registers its own runtime even while awaiting login', async () => {
  const h = harness();
  await h.controller.createInstance(findHub());
  const row = h.rows.get('findhub-test');
  delete h.monitor.waInstances['findhub-test'];
  await h.monitor.setInstance({ instanceName: row.name, instanceId: row.id, integration: Integration.GOOGLE_FIND_HUB, token: row.token, connectionStatus: 'connecting' });
  assert.equal(h.monitor.waInstances['findhub-test'].integration, Integration.GOOGLE_FIND_HUB);
  assert.equal(h.monitor.waInstances['findhub-test'].connectionStatus.state, 'connecting');
  assert.equal(h.calls.filter(([name]) => name === 'wa.setSettings').length, 0);
});
