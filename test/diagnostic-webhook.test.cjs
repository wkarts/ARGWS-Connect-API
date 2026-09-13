'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function load(relative, mocks = {}) {
  const filename = path.join(root, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : module.require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
  return loaded.exports;
}
const { sanitizeDiagnostic } = load('src/diagnostics/diagnostic-sanitizer.ts');
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12);
const destination = 'https://private.example/webhooks/5511999999999?token=SECRET_URL';
const privateInstance = 'instance-secret-person-5511999999999';
const secrets = ['SECRET_BODY', 'SECRET_TOKEN', 'SECRET_RESPONSE', 'SECRET_URL', 'SECRET_ERROR',
  'SECRET_STACK', '5511999999999', 'private.example', privateInstance];
const quietLogger = class { log() {} warn() {} error() {} };
function diagnosticCapture() {
  const records = [];
  return { records, diagnostics: { traceId: () => 'request-trace', record: input => {
    const record = sanitizeDiagnostic(input);
    assert.ok(record, 'the real sanitizer must accept the instrumentation code');
    records.push(record);
  } } };
}
function assertPrivate(records) {
  const json = JSON.stringify(records);
  for (const secret of secrets) assert.ok(!json.includes(secret), `export retained ${secret}`);
}
function native(post) {
  const capture = diagnosticCapture();
  const config = { GLOBAL: { ENABLED: false }, REQUEST: {}, RETRY: {
    MAX_ATTEMPTS: 3, INITIAL_DELAY_SECONDS: 0, USE_EXPONENTIAL_BACKOFF: false,
    NON_RETRYABLE_STATUS_CODES: [400, 401, 403, 404, 422],
  } };
  const { WebhookController } = load('src/api/integrations/event/webhook/webhook.controller.ts', {
    '@config/env.config': { configService: { get: key => key === 'LOG' ? { LEVEL: [] } : config } },
    '@config/logger.config': { Logger: quietLogger },
    '../../../../diagnostics/diagnostics.service': capture,
    '../event.controller': { EventController: class { async get() {
      return { enabled: true, events: ['CALL', 'MESSAGES_UPSERT'], url: destination,
        headers: { Authorization: 'SECRET_TOKEN' } };
    } } },
    axios: { default: { create: () => ({ post }) } },
    jsonwebtoken: {},
  });
  return { ...capture, controller: new WebhookController({}, {}) };
}
function meta(post) {
  const capture = diagnosticCapture();
  const increments = [];
  const { MetaCloudWebhookDispatcher } = load('src/api/compat/meta-cloud/meta-cloud-webhook.dispatcher.ts', {
    '@config/logger.config': { Logger: quietLogger },
    '../../../diagnostics/diagnostics.service': capture,
    './meta-cloud.metrics': { metaCloudMetrics: { increment: metric => increments.push(metric) } },
    axios: { default: { post } },
  });
  return { ...capture, increments, MetaCloudWebhookDispatcher };
}
function failed(status = 403, code = 'ERR_BAD_REQUEST') {
  const error = new Error('SECRET_ERROR');
  error.name = 'AxiosError';
  error.code = code;
  error.response = { status, data: 'SECRET_RESPONSE', headers: { authorization: 'SECRET_TOKEN' } };
  error.config = { url: destination, data: 'SECRET_BODY', headers: { apikey: 'SECRET_TOKEN' } };
  error.stack = 'AxiosError: SECRET_ERROR\n at SECRET_STACK (https://private.example/SECRET_STACK:1:2)';
  return error;
}
function webhookPayload(event = 'call') {
  return { event, instance: privateInstance, data: { call: { callId: 'call-123', peerJid: '5511999999999@lid' },
    message: { conversation: 'SECRET_BODY' } }, apikey: 'SECRET_TOKEN' };
}
function envelope() {
  return { webhookUrl: destination, payload: { entry: [{ messages: [{ text: { body: 'SECRET_BODY' } }] }] },
    context: { instanceId: 'technical-instance-id', instanceName: privateInstance,
      phoneNumberId: '5511999999999', messageId: 'SECRET_BODY', provider: 'WHATSAPP-ZAPO',
      event: 'messages.upsert', traceId: 'queued-request-trace' }, attempt: 2 };
}

test('native emit traces CALL delivery and correlates its call without storing webhook content', async () => {
  let sent;
  const { controller, records } = native(async (_url, body) => { sent = body; return { status: 202, data: 'SECRET_RESPONSE' }; });
  const payload = webhookPayload();
  await controller.emit({ instanceName: privateInstance, origin: 'provider', event: 'call', data: payload.data,
    serverUrl: 'https://private.example', dateTime: new Date().toISOString(), sender: '5511999999999',
    apiKey: 'SECRET_TOKEN', local: true });
  assert.equal(sent.data, payload.data, 'instrumentation must not change delivery payload');
  assert.deepEqual(records.map(record => record.details.phase), ['started', 'succeeded']);
  assert.equal(records[1].details.status, 202);
  assert.equal(records[1].details.event, 'CALL');
  assert.equal(records[1].callId, 'call-123');
  assert.equal(records[1].traceId, 'request-trace');
  assert.equal(records[1].instanceId, `instance-${hash(privateInstance)}`);
  assert.equal(records[1].details.targetId, hash(destination));
  assertPrivate(records);
});

test('native rejection preserves non-retryable behavior and safe HTTP failure metadata', async () => {
  const error = failed();
  let calls = 0;
  const { controller, records } = native(async () => { calls++; throw error; });
  await assert.rejects(controller.retryWebhookRequest({ post: async () => { calls++; throw error; } },
    webhookPayload(), 'provider', destination, 'https://private.example'), value => value === error);
  assert.equal(calls, 1);
  assert.deepEqual(records.map(record => record.details.phase), ['started', 'failed']);
  assert.equal(records[1].level, 'error');
  assert.equal(records[1].details.status, 403);
  assert.equal(records[1].details.error.code, 'ERR_BAD_REQUEST');
  assertPrivate(records);
});

test('native retry logs every attempt, retains original behavior and never uses message IDs as call IDs', async () => {
  let calls = 0;
  const { controller, records } = native(() => {});
  const payload = webhookPayload('messages.upsert');
  payload.data.id = 'SECRET_BODY';
  const post = async (_url, body) => {
    assert.equal(body, payload);
    if (++calls === 1) throw failed(504, 'ECONNABORTED');
    return { status: 200 };
  };
  await controller.retryWebhookRequest({ post }, payload, 'provider', destination, 'https://private.example');
  assert.equal(calls, 2);
  assert.deepEqual(records.map(record => [record.details.attempt, record.details.phase]),
    [[1, 'started'], [1, 'failed'], [2, 'started'], [2, 'succeeded']]);
  assert.ok(records.every(record => !record.callId));
  assertPrivate(records);
});

test('Meta compatible delivery keeps queue trace and excludes message, phone and response content', async () => {
  const item = envelope();
  const { MetaCloudWebhookDispatcher, records, increments } = meta(async (url, body, options) => {
    assert.equal(url, destination);
    assert.equal(body, item.payload);
    assert.equal(options.timeout, 10_000);
    return { status: 200, data: 'SECRET_RESPONSE' };
  });
  const dispatcher = new MetaCloudWebhookDispatcher({}, {}, {}, {});
  await dispatcher.deliver(item);
  assert.deepEqual(records.map(record => record.details.phase), ['started', 'succeeded']);
  assert.equal(records[1].traceId, 'queued-request-trace');
  assert.equal(records[1].details.attempt, 3);
  assert.equal(records[1].details.event, 'MESSAGES_UPSERT');
  assert.equal(records[1].details.status, 200);
  assert.equal(records[1].component, 'meta-webhook');
  assert.deepEqual(increments, ['connect_meta_compat_webhooks_total']);
  assertPrivate(records);
});

test('Meta failed delivery is traced and rethrown so existing retries remain in charge', async () => {
  const error = failed(502, 'ERR_BAD_RESPONSE');
  const { MetaCloudWebhookDispatcher, records, increments } = meta(async () => { throw error; });
  const dispatcher = new MetaCloudWebhookDispatcher({}, {}, {}, {});
  await assert.rejects(dispatcher.deliver(envelope()), value => value === error);
  assert.deepEqual(records.map(record => record.details.phase), ['started', 'failed']);
  assert.equal(records[1].details.status, 502);
  assert.equal(records[1].details.error.code, 'ERR_BAD_RESPONSE');
  assert.equal(increments.length, 0);
  assertPrivate(records);
});

test('Meta internal queue carries event and trace without changing the public webhook payload', async () => {
  const payload = envelope().payload;
  const { MetaCloudWebhookDispatcher } = meta(async () => { throw new Error('queued delivery should not run immediately'); });
  const dispatcher = new MetaCloudWebhookDispatcher(
    { metaCompatibility: { findUnique: async () => ({ webhookUrl: destination }) } },
    { resolveByInstanceName: async () => ({ instanceId: 'instance-id', instanceName: privateInstance, provider: 'WHATSAPP-ZAPO', phoneNumberId: '5511999999999' }) },
    { serialize: async () => payload }, {},
  );
  let queued;
  dispatcher.enqueue = async value => { queued = value; return true; };
  await dispatcher.handleEvent({ instanceName: privateInstance, event: 'messages.update', data: { text: 'SECRET_BODY' } });
  assert.equal(queued.context.traceId, 'request-trace');
  assert.equal(queued.context.event, 'messages.update');
  assert.equal(queued.payload, payload);
  assert.deepEqual(Object.keys(payload), ['entry']);
});

test('older Meta queued envelopes continue delivering without new optional diagnostic metadata', async () => {
  const { MetaCloudWebhookDispatcher, records } = meta(async () => ({ status: 204 }));
  const item = envelope();
  delete item.context.traceId;
  delete item.context.event;
  await new MetaCloudWebhookDispatcher({}, {}, {}, {}).deliver(item);
  assert.equal(records[1].details.status, 204);
  assert.equal(records[1].details.event, undefined);
  assertPrivate(records);
});
