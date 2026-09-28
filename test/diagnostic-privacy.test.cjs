'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

function load(name) {
  const filename = path.resolve(__dirname, '../src/diagnostics', name);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
  return loaded.exports;
}
const { sanitizeDiagnostic, diagnosticError, pseudonym } = load('diagnostic-sanitizer.ts');
const { DIAGNOSTIC_CODES } = load('diagnostic-types.ts');
const secret = 'CONVERSA CONFIDENCIAL 5511999887766 TOKEN@segredo';
const traceId = '58d2a2cd-1c0e-4bb9-b0e4-5e2ae2b4b37e';
const callId = '9FEE5B052B0041829F1410B3A5C2EE83';

function assertPrivate(value) {
  const json = JSON.stringify(value);
  for (const content of [secret, '5511999887766', 'TOKEN@segredo', 'Bearer abc123', 'senha-interna', 'SELECT *']) {
    assert.equal(json.includes(content), false, `Sensitive content leaked: ${content}`);
  }
  return json;
}

test('persisted accept metadata preserves only tag-specific protocol enums and ciphertext length', () => {
  const event = sanitizeDiagnostic({ code: 'call.signaling', node: {
    tag: 'call', attrs: {}, children: [{ tag: 'accept', attrs: { 'call-id': callId }, children: [
      { tag: 'audio', attrs: { enc: 'opus', rate: 16000, medium: '3', keygen: '2', text: secret }, content: secret },
      { tag: 'net', attrs: { medium: 3, enc: 'opus', rate: '16000', keygen: '2', address: secret }, payload: secret },
      { tag: 'encopt', attrs: { keygen: 2, enc: 'opus', rate: '16000', medium: '3', key: secret }, byteLength: 20, content: secret },
      { tag: 'enc', attrs: { type: 'msg', keygen: '2', key: secret }, byteLength: 98, content: secret },
      { tag: 'message', attrs: { enc: 'opus', rate: '16000' }, content: secret },
    ] }],
  } });
  const children = event.details.node.children[0].children;
  assert.deepEqual(children, [
    { tag: 'audio', attrs: { enc: 'opus', rate: '16000' } },
    { tag: 'net', attrs: { medium: '3' } },
    { tag: 'encopt', attrs: { keygen: '2' }, byteLength: 20 },
    { tag: 'enc', attrs: { type: 'msg' }, byteLength: 98 },
  ]);
  assertPrivate(event);
});

test('persisted accept metadata rejects free text, oversized numbers and user-defined coercion', () => {
  const poison = { toString() { throw Error(secret); } };
  for (const value of [secret, -1, 1e9, NaN, true, poison, null]) {
    const event = sanitizeDiagnostic({ code: 'call.signaling', node: {
      tag: 'call', attrs: {}, children: [{ tag: 'accept', attrs: {}, children: [
        { tag: 'audio', attrs: { enc: value, rate: value } },
        { tag: 'net', attrs: { medium: value } },
        { tag: 'encopt', attrs: { keygen: value } },
      ] }],
    } });
    assert.deepEqual(event.details.node.children[0].children.map(child => child.attrs), [{}, {}, {}]);
    assertPrivate(event);
  }
});

test('every persisted event is rebuilt from a fixed schema and rejects unknown codes', () => {
  const now = Date.parse('2026-09-13T10:00:00.000Z');
  for (const code of DIAGNOSTIC_CODES) {
    const input = { code, id: secret, timestamp: secret, level: secret, summary: secret, category: secret,
      details: { conversation: secret }, request: { headers: { authorization: 'Bearer abc123' }, body: secret },
      headers: secret, data: secret, payload: secret, message: secret, stack: secret, environment: secret };
    const safe = sanitizeDiagnostic(input, now);
    assert.equal(safe.code, code);
    assert.match(safe.id, /^[a-f0-9-]{36}$/);
    assert.equal(safe.timestamp, '2026-09-13T10:00:00.000Z');
    assert.ok(['info', 'warn', 'error'].includes(safe.level));
    assertPrivate(safe);
  }
  for (const code of ['message.upsert', 'log', 'constructor', '__proto__', secret, null]) {
    assert.equal(sanitizeDiagnostic({ code, message: secret }), null);
  }
});

test('HTTP keeps a route template and timings without URL, params, query or body', () => {
  const event = sanitizeDiagnostic({ code: 'http.request', method: 'POST', route: '/call/accept/:instanceName',
    status: 422, durationMs: 25.75, traceId, instanceId: 'cliente-5511999887766',
    params: { instanceName: secret }, url: `https://${secret}`, originalUrl: secret,
    body: { text: secret }, query: { token: secret }, headers: { authorization: 'Bearer abc123' }, aborted: false });
  assert.deepEqual(event.details, { method: 'POST', route: '/call/accept/:instanceName', status: 422,
    durationMs: 25.75, aborted: false });
  assert.equal(event.traceId, traceId);
  assert.equal(event.instanceId, `instance-${pseudonym('cliente-5511999887766')}`);
  assert.equal(event.level, 'warn');
  assertPrivate(event);
  assert.equal(sanitizeDiagnostic({ code: 'http.request', route: '/call/accept/5511999887766' }).details.route,
    '/call/accept/:value');
  for (const route of [`https://host/${secret}`, `/call/accept?token=${secret}`, `/call#${secret}`]) {
    assert.equal(sanitizeDiagnostic({ code: 'http.request', route }).details.route, undefined);
  }
  assert.equal(sanitizeDiagnostic({ code: 'http.request', status: 503 }).level, 'error');
  assert.equal(sanitizeDiagnostic({ code: 'http.request', status: 200, aborted: true }).level, 'warn');
});

test('video authorization routes remain identifiable without retaining instance names or ticket content', () => {
  for (const operation of ['capabilities', 'videoMediaTicket']) {
    const event = sanitizeDiagnostic({ code: 'http.request', method: 'POST',
      route: `/call/${operation}/5511999887766`, status: 404,
      body: { ticket: secret, camera: secret }, params: { instanceName: secret } });
    assert.equal(event.details.route, `/call/${operation}/:value`);
    assertPrivate(event);
  }
});

test('errors retain safe classes, codes, status and source locations, never message/SQL/context', () => {
  const error = Object.assign(new Error(secret), {
    name: 'AxiosError', code: 'ETIMEDOUT', request: { data: secret },
    response: { status: 502, data: secret, headers: { authorization: 'Bearer abc123' } },
    cause: { sql: 'SELECT * FROM secret', params: secret },
    stack: `AxiosError: ${secret}\n    at senha-interna (/home/5511999887766/src/main.ts:41:9)\n` +
      `    at foo (/secret/5511999887766/token-senha-interna.ts:84:2)\n${secret}\n` +
      `    at request (/app/node_modules/axios/index.js:35:6)`,
  });
  const details = diagnosticError(error);
  assert.equal(details.name, 'AxiosError');
  assert.equal(details.code, 'ETIMEDOUT');
  assert.equal(details.status, 502);
  assert.deepEqual(details.frames[0], { file: 'main.ts', line: 41, column: 9 });
  assert.match(details.frames[1].file, /^source-[a-f0-9]{12}\.ts$/);
  assert.equal(details.frames[2].file, 'index.js');
  assertPrivate(details);
  assert.equal(details.fingerprint, diagnosticError(error).fingerprint);
  const safe = sanitizeDiagnostic({ code: 'runtime.error', level: 'warn', error, component: secret });
  assert.equal(safe.level, 'warn');
  assert.match(safe.component, /^component-[a-f0-9]{12}$/);
  assertPrivate(safe);
});

test('generic or hostile errors produce no raw strings and never execute serializers', () => {
  for (const error of [secret, 42, null, { name: secret, code: secret, stack: secret },
    { toJSON() { throw Error('must not run'); } }, new Proxy({}, { get() { throw Error(secret); } })]) {
    assert.doesNotThrow(() => diagnosticError(error));
    const safe = diagnosticError(error);
    assert.equal(safe.name, 'Error');
    assertPrivate(safe);
  }
  const prisma = diagnosticError({ name: 'PrismaClientKnownRequestError', code: 'P2002',
    message: 'SELECT * FROM secret', meta: { target: secret } });
  assert.equal(prisma.code, 'P2002');
  assertPrivate(prisma);
});

test('call signaling preserves stanza/call correlation and pseudonymous devices without ciphertext', () => {
  const source = { code: 'call.signaling', traceId, record: {
    instance: `instance-${pseudonym('instance-one')}`, kind: 'transport_in', callId,
    node: { tag: 'ack', attrs: { id: '3EB02C101ED1', class: 'call', type: 'accept', error: '403',
      from: '5511999887766:3@s.whatsapp.net', to: '444:6@lid', token: 'Bearer abc123', message: secret },
      children: [
        { tag: 'error', attrs: { code: '403', reason: 'forbidden', debug: secret } },
        { tag: 'accept', attrs: { 'call-id': callId, 'call-creator': '444:6@lid' },
          children: [{ tag: 'enc', attrs: { type: 'pkmsg', message: secret }, byteLength: 150, content: secret }],
          content: Buffer.from(secret) },
        { tag: 'message', attrs: {}, children: [{ tag: 'call', attrs: { id: secret } }] },
      ], content: secret,
    }, raw: secret, frame: Buffer.from(secret), encryptionKey: Buffer.from(secret),
  } };
  const event = sanitizeDiagnostic(source);
  assert.equal(event.traceId, traceId);
  assert.equal(event.callId, callId);
  assert.equal(event.instanceId, source.record.instance);
  assert.equal(event.details.node.attrs.from, `peer-${pseudonym('5511999887766@s.whatsapp.net')}:3@s.whatsapp.net`);
  assert.equal(event.details.node.attrs.error, 403);
  assert.equal(event.level, 'error');
  assert.equal(event.details.node.children.length, 2);
  assert.deepEqual(event.details.node.children[0], { tag: 'error', attrs: { code: 403, reason: 'forbidden' } });
  assert.deepEqual(event.details.node.children[1].children[0], { tag: 'enc', attrs: { type: 'pkmsg' }, byteLength: 150 });
  assertPrivate(event);
  const encoded = JSON.stringify(event);
  assert.equal(encoded.includes(Buffer.from(secret).toString('base64')), false);
  source.record.node.attrs.from = secret;
  assert.equal(JSON.stringify(event), encoded, 'snapshot must not retain references to provider objects');
});

test('already pseudonymized devices preserve their pseudonym and device suffix exactly once', () => {
  const jid = `peer-${pseudonym('5511999887766@lid')}:17@lid`;
  const event = sanitizeDiagnostic({ code: 'call.signaling', record: {
    instance: `instance-${pseudonym('server-one')}`, node: { tag: 'call', attrs: { from: jid, to: jid } },
  } });
  assert.equal(event.details.node.attrs.from, jid);
  assert.equal(event.details.node.attrs.to, jid);
  assert.equal(event.instanceId, `instance-${pseudonym('server-one')}`);
  assertPrivate(event);
});

test('state and actions keep technical transitions and error outcomes', () => {
  const state = sanitizeDiagnostic({ code: 'call.state', record: { callId, kind: 'state', direction: 'incoming',
    state: 'connecting', endReason: 'accepted_elsewhere', canAccept: false, peerName: secret, audio: secret } });
  assert.deepEqual(state.details, { kind: 'state', direction: 'incoming', state: 'connecting',
    endReason: 'accepted_elsewhere', canAccept: false });
  const action = sanitizeDiagnostic({ code: 'call.action', callId, traceId, action: 'accept', phase: 'failed',
    error: { name: 'Error', message: secret, code: 'ECONNRESET' }, payload: secret });
  assert.equal(action.details.action, 'accept');
  assert.equal(action.details.phase, 'failed');
  assert.equal(action.level, 'error');
  assert.equal(action.callId, callId);
  assert.equal(action.traceId, traceId);
  assertPrivate(action);
  const poisoned = sanitizeDiagnostic({ code: 'call.state', kind: secret, state: secret, direction: secret,
    endReason: secret, node: { tag: 'error', attrs: { error: secret, reason: secret, type: secret } } });
  assertPrivate(poisoned);
  assert.equal(poisoned.details.state, undefined);
  assert.deepEqual(poisoned.details.node.attrs, {});
});

test('nested ACK errors are errors, suppression is a warning and a generic numeric code is not an error', () => {
  const event = sanitizeDiagnostic({ code: 'call.signaling', node: { tag: 'ack', attrs: { class: 'call' },
    children: [{ tag: 'accept', attrs: {}, children: [{ tag: 'error', attrs: { code: '403' } }] }] } });
  assert.equal(event.level, 'error');
  assert.equal(sanitizeDiagnostic({ code: 'call.signaling', kind: 'suppressed', limitPerMinute: 300 }).level, 'warn');
  assert.equal(sanitizeDiagnostic({ code: 'call.signaling', node: { tag: 'call', attrs: { code: '200' } } }).level, 'info');
  const privateError = sanitizeDiagnostic({ code: 'call.signaling', node: { tag: 'ack', attrs: { error: secret } } });
  assert.equal(privateError.level, 'error');
  assert.equal(privateError.details.node.hasError, true);
  assertPrivate(privateError);
});

test('suppression buckets accept only fixed signaling values and never leak arbitrary input', () => {
  for (const bucket of ['lifecycle', 'relaylatency']) {
    for (const wrapped of [false, true]) {
      const record = { kind: 'suppressed', bucket, limitPerMinute: 300, payload: secret };
      const event = sanitizeDiagnostic({ code: 'call.signaling', ...(wrapped ? { record } : record) });
      assert.deepEqual(event.details, { kind: 'suppressed', limitPerMinute: 300, bucket });
      assert.equal(event.level, 'warn');
      assertPrivate(event);
    }
  }
  for (const bucket of [secret, 'arbitrary', 'Lifecycle', { value: secret }, null]) {
    const event = sanitizeDiagnostic({ code: 'call.signaling', record: {
      kind: 'suppressed', bucket, limitPerMinute: 300,
    } });
    assert.deepEqual(event.details, { kind: 'suppressed', limitPerMinute: 300 });
    assertPrivate(event);
  }
  for (const code of DIAGNOSTIC_CODES.filter((code) => code !== 'call.signaling')) {
    for (const bucket of ['lifecycle', 'relaylatency', secret]) {
      const event = sanitizeDiagnostic({ code, kind: 'suppressed', bucket,
        record: { kind: 'suppressed', bucket } });
      assert.equal(Object.hasOwn(event.details, 'bucket'), false, `${code} must reject bucket`);
      assertPrivate(event);
    }
  }
});

test('the diagnostic taxonomy preserves every state, direction and end reason of the installed VOIP provider', () => {
  const { CallState, CallDirection, EndCallReason } = require('../node_modules/@innovatorssoft/voip/dist/types.js');
  for (const state of Object.values(CallState)) {
    assert.equal(sanitizeDiagnostic({ code: 'call.state', state }).details.state, state);
  }
  for (const direction of Object.values(CallDirection)) {
    assert.equal(sanitizeDiagnostic({ code: 'call.state', direction }).details.direction, direction);
  }
  for (const endReason of Object.values(EndCallReason)) {
    assert.equal(sanitizeDiagnostic({ code: 'call.state', endReason }).details.endReason, endReason);
  }
});

test('frontend collection has only enums and trace ids, excluding browser errors and current URLs', () => {
  for (const kind of ['window_error', 'unhandled_rejection', 'vue_error']) {
    const event = sanitizeDiagnostic({ code: 'frontend.error', kind, page: 'calls', traceId,
      message: secret, reason: secret, stack: secret, url: `https://site/?token=${secret}`,
      component: { secret }, browser: secret, user: secret, screen: secret, history: secret });
    assert.equal(event.level, 'error');
    assert.deepEqual(event.details, { kind, page: 'calls' });
    assert.equal(event.traceId, traceId);
    assertPrivate(event);
  }
  assert.deepEqual(sanitizeDiagnostic({ code: 'frontend.error', kind: secret, page: secret }).details, {});
});

test('webhook delivery retains routing fingerprints, attempts and HTTP errors without the delivered conversation', () => {
  const event = sanitizeDiagnostic({ code: 'webhook.delivery', component: 'native-webhook',
    event: 'messages.upsert', phase: 'failed', attempt: 2, status: 503, durationMs: 29.2,
    targetId: pseudonym('https://internal/callback'), instanceId: 'customer-5511999887766',
    data: { conversation: secret }, body: secret, url: `https://${secret}`, headers: { authorization: 'Bearer abc123' },
    error: { name: 'AxiosError', code: 'ERR_BAD_RESPONSE', response: { status: 503, data: secret } } });
  assert.equal(event.details.event, 'MESSAGES_UPSERT');
  assert.equal(event.details.phase, 'failed');
  assert.equal(event.details.attempt, 2);
  assert.equal(event.details.targetId, pseudonym('https://internal/callback'));
  assert.equal(event.level, 'error');
  assertPrivate(event);
  assert.equal(sanitizeDiagnostic({ code: 'webhook.delivery', targetId: secret, event: secret }).details.targetId, undefined);
});

test('Find Hub reconciliation diagnostics keep only bounded counters and enums', () => {
  const event = sanitizeDiagnostic({
    code: 'findhub.reconciliation',
    component: 'findhub',
    instanceId: 'customer-5511999887766',
    reconciliationId: '4c984a8c-538e-4d55-b65a-ecf275cb58d5',
    phase: 'completed',
    trigger: 'manual',
    status: 'duplicates_only',
    rangeSeconds: 25200,
    attemptsRequested: 3,
    attemptsCompleted: 3,
    providerReportsDecoded: 18,
    validReports: 12,
    alreadyStoredReports: 4,
    importedReports: 0,
    recoveredPositions: 0,
    latitude: -12.345,
    longitude: -39.123,
    providerPayload: secret,
    deviceName: secret,
    token: 'Bearer abc123',
  });
  assert.equal(event.code, 'findhub.reconciliation');
  assert.equal(event.component, 'findhub');
  assert.equal(event.details.status, 'duplicates_only');
  assert.equal(event.details.providerReportsDecoded, 18);
  assert.equal(event.details.validReports, 12);
  assert.equal(event.details.alreadyStoredReports, 4);
  assert.equal(event.details.latitude, undefined);
  assert.equal(event.details.longitude, undefined);
  assertPrivate(event);
});

test('runtime, settings, export and connection reject arbitrary strings and keep bounded numeric metadata', () => {
  const event = sanitizeDiagnostic({ code: 'runtime.sample', uptimeSeconds: 120, rssBytes: 300, heapUsedBytes: 40,
    heapTotalBytes: 100, cpuUserMicros: 3000, eventLoopDelayMs: 1.5, environment: secret, process: secret,
    externalBytes: Infinity, cpuSystemMicros: -1 });
  assert.deepEqual(event.details, { uptimeSeconds: 120, rssBytes: 300, heapUsedBytes: 40,
    heapTotalBytes: 100, cpuUserMicros: 3000, eventLoopDelayMs: 1.5 });
  assert.deepEqual(sanitizeDiagnostic({ code: 'runtime.started', version: secret, nodeVersion: secret }).details, {});
  assert.deepEqual(sanitizeDiagnostic({ code: 'diagnostics.exported', format: 'gzip', count: 200,
    filename: secret, filters: secret }).details, { format: 'gzip', count: 200 });
  assert.deepEqual(sanitizeDiagnostic({ code: 'diagnostics.settings', enabled: true, retentionDays: 7,
    maxStorageMb: 128, path: secret }).details, { enabled: true, retentionDays: 7, maxStorageMb: 128 });
  const connection = sanitizeDiagnostic({ code: 'connection.state', state: 'open', provider: 'ZAPO',
    reasonCode: 401, reason: secret, qrCode: secret, pairingCode: secret, credentials: secret });
  assert.deepEqual(connection.details, { state: 'open', reasonCode: 401, provider: 'ZAPO' });
  assert.equal(sanitizeDiagnostic({ code: 'connection.state', reasonCode: secret }).details.reasonCode, undefined);
  assertPrivate(connection);
});

test('hostile proxies, cycles and wide/deep signaling remain bounded and do not affect the application', () => {
  assert.equal(sanitizeDiagnostic(new Proxy({}, { get() { throw Error(secret); } })), null);
  const node = { tag: 'call', attrs: {}, children: [] };
  node.children = Array.from({ length: 5000 }, () => node);
  const event = sanitizeDiagnostic({ code: 'call.signaling', record: { node } });
  assert.ok(event);
  let count = 0;
  const visit = (n, depth = 0) => {
    count++;
    assert.ok(depth <= 3);
    assert.ok((n.children || []).length <= 12);
    for (const child of n.children || []) visit(child, depth + 1);
  };
  visit(event.details.node);
  assert.ok(count <= 48);
  assert.ok(JSON.stringify(event).length < 20_000);
  assert.equal(sanitizeDiagnostic({ code: 'runtime.error' }, Number.NaN), null);
});
