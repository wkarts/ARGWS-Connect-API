'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = module.paths;
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : module.require(name);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, filename);
  return loaded.exports;
}
const { sanitizeDiagnostic, pseudonym } = load('../src/diagnostics/diagnostic-sanitizer.ts');
const secret = 'SECRET-CONVERSATION-TOKEN-DO-NOT-PERSIST';
const instanceName = 'customer-5511999887766';
const callId = '11111111000040008000000000000001';

class Socket extends EventEmitter {
  readyState = 1;
  sent = [];
  send(payload, options) { this.sent.push({ payload, options }); }
  close(code, reason) { this.readyState = 3; this.emit('close', code, reason); }
  async message(payload, isBinary = false) {
    await Promise.all(this.listeners('message').map(listener => listener(payload, isBinary)));
  }
}

function setup(overrides = {}, recordOverride) {
  const events = [];
  const fed = [];
  const modes = [];
  let inbound;
  let unsubscribed = 0;
  const provider = { token: secret, listCalls: async () => [{ callId, state: 'incoming_ringing' }],
    setExternalAudioMode: (id, enabled) => modes.push({ id, enabled }),
    feedLiveAudio: (id, pcm) => fed.push({ id, pcm }),
    onInboundVoiceAudio: callback => { inbound = callback; return () => { unsubscribed++; }; },
    ...overrides };
  const { VoiceMediaService } = load('../src/api/services/voice-media.service.ts', {
    '@config/env.config': { configService: { get: () => ({ API_KEY: { KEY: 'server-secret-global-key' } }) } },
    '@config/logger.config': { Logger: class { info() {} error() {} } },
    '@exceptions': { BadRequestException: Error, NotFoundException: Error },
    '../../diagnostics/diagnostics.service': { diagnostics: { record: recordOverride || (input => {
      const event = sanitizeDiagnostic(input);
      if (event) events.push(event);
    }) } },
    ws: { WebSocketServer: class { handleUpgrade(request, socket, head, callback) { callback(socket); } } },
  });
  const service = new VoiceMediaService({ waInstances: { [instanceName]: provider } });
  const server = new EventEmitter();
  service.attach(server);
  const ws = new Socket();
  server.emit('upgrade', { url: `/voice/media?secret=${secret}` }, ws, Buffer.from(secret));
  return { service, ws, events, provider, fed, modes, emitInbound: data => inbound(data),
    get unsubscribed() { return unsubscribed; } };
}

async function auth(ctx, overrides = {}) {
  await ctx.ws.message(Buffer.from(JSON.stringify({ token: secret, callId, instanceName, ...overrides })));
}

function assertPrivate(events) {
  const serialized = JSON.stringify(events);
  for (const forbidden of [secret, instanceName, '5511999887766', 'server-secret-global-key',
    '"payload"', 'byteLength', 'sampleRate', 'ticket', '"pcm"', 'f32le', '/voice/media', 'SECRET-AUDIO']) {
    assert.equal(serialized.includes(forbidden), false, `Sensitive content leaked: ${forbidden}`);
  }
}

test('media websocket connected/authenticated are distinct and never imply call acceptance', async () => {
  const ctx = setup({ acceptCall() { throw Error('media authentication must not accept the call'); } });
  assert.deepEqual(ctx.events.map(event => event.details.phase), ['connected']);
  assert.equal(ctx.events[0].callId, undefined);
  assert.equal(ctx.events[0].instanceId, undefined);
  await auth(ctx);
  assert.deepEqual(ctx.events.map(event => event.details.phase), ['connected', 'authenticated']);
  assert.equal(ctx.events[1].callId, callId);
  assert.equal(ctx.events[1].instanceId, `instance-${pseudonym(instanceName)}`);
  assert.equal(ctx.events[0].traceId, ctx.events[1].traceId);
  assert.match(ctx.events[0].traceId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(ctx.events[1].details, { phase: 'authenticated' });
  assert.equal(JSON.parse(ctx.ws.sent[0].payload).type, 'ready');
  ctx.ws.close(1000, secret);
  assert.equal(ctx.events.at(-1).details.phase, 'closed');
  assert.equal(ctx.events.at(-1).details.closeCode, 1000);
  assert.equal(ctx.unsubscribed, 1);
  assert.deepEqual(ctx.modes, [{ id: callId, enabled: true }, { id: callId, enabled: false }]);
  assertPrivate(ctx.events);
});

test('PCM continues both ways without logging payloads, byte counts or per-frame events', async () => {
  const ctx = setup();
  await auth(ctx);
  const pcm = Float32Array.from([0.1, 0.2, 0.3, 0.4]);
  const bytes = Buffer.from(pcm.buffer);
  for (let i = 0; i < 100; i++) {
    await ctx.ws.message(bytes, true);
    ctx.emitInbound({ call: { callId }, pcm });
  }
  assert.equal(ctx.fed.length, 100);
  assert.equal(ctx.ws.sent.filter(frame => frame.options?.binary).length, 100);
  assert.deepEqual(Array.from(ctx.fed[0].pcm), Array.from(pcm));
  assert.equal(ctx.events.length, 2);
  ctx.ws.close(1000);
  assert.equal(ctx.events.length, 3);
  assertPrivate(ctx.events);
});

test('unauthorized handshake does not retain attacker supplied instance/call identifiers or credentials', async () => {
  const ctx = setup();
  await auth(ctx, { token: 'wrong-secret', callId: 'FORGED-CALL', instanceName: 'FORGED-INSTANCE' });
  assert.deepEqual(ctx.events.map(event => event.details.phase), ['connected', 'failed', 'closed']);
  assert.equal(ctx.events[1].details.reason, 'auth_failed');
  assert.equal(ctx.events[1].details.closeCode, 4401);
  for (const event of ctx.events) {
    assert.equal(event.callId, undefined);
    assert.equal(event.instanceId, undefined);
  }
  assert.equal(ctx.modes.length, 0);
  assert.equal(JSON.stringify(ctx.events).includes('FORGED'), false);
  assertPrivate(ctx.events);
});

test('validated ticket authenticates the same channel without persisting its reusable secret', async () => {
  const ctx = setup();
  const ticket = await ctx.service.createMediaTicket(instanceName, callId);
  await ctx.ws.message(Buffer.from(JSON.stringify({ ticket: ticket.ticket, text: secret })));
  assert.equal(ctx.events[1].details.phase, 'authenticated');
  assert.equal(ctx.events[1].callId, callId);
  assert.equal(JSON.stringify(ctx.events).includes(ticket.ticket), false);
  ctx.ws.close(1000);
  assertPrivate(ctx.events);
});

test('provider unavailable and missing call fail before any authenticated identity is recorded', async () => {
  for (const [overrides, reason] of [[{ feedLiveAudio: null }, 'provider_unavailable'],
    [{ listCalls: async () => [] }, 'call_not_found']]) {
    const ctx = setup(overrides);
    await auth(ctx);
    assert.equal(ctx.events[1].details.reason, reason);
    assert.equal(ctx.events[1].details.closeCode, 4404);
    assert.equal(ctx.events.some(event => event.callId || event.instanceId), false);
    assertPrivate(ctx.events);
  }
});

test('invalid handshake, pre-auth binary and timeout keep existing socket outcomes without collecting contents', async () => {
  const invalid = setup();
  await invalid.ws.message(Buffer.from(`{broken:${secret}`));
  assert.equal(invalid.events[1].details.reason, 'invalid_payload');
  assert.equal(invalid.events[1].details.error.name, 'SyntaxError');
  invalid.ws.close(1000);
  assertPrivate(invalid.events);
  const binary = setup();
  await binary.ws.message(Buffer.from(secret), true);
  assert.equal(binary.events[1].details.reason, 'auth_failed');
  assertPrivate(binary.events);
  const empty = setup();
  await empty.ws.message(Buffer.alloc(0));
  assert.equal(empty.events[1].details.reason, 'invalid_payload');
  assert.equal(empty.events[1].details.closeCode, 4400);
  const originalSetTimeout = global.setTimeout;
  let fire;
  let timed;
  try {
    global.setTimeout = callback => { fire = callback; return { unref() {} }; };
    timed = setup();
  } finally { global.setTimeout = originalSetTimeout; }
  fire();
  assert.deepEqual(timed.events.map(event => event.details.phase), ['connected', 'failed', 'closed']);
  assert.equal(timed.events[1].details.reason, 'auth_timeout');
  assert.equal(timed.events[1].details.closeCode, 4401);
  assertPrivate(timed.events);
});

test('socket/provider failures emit only once even during repeated frame failures, with four records maximum', async () => {
  const ctx = setup({ feedLiveAudio() { throw Object.assign(new Error(secret), { code: 'EIO' }); } });
  await auth(ctx);
  for (let i = 0; i < 100; i++) await ctx.ws.message(Buffer.alloc(4), true);
  ctx.ws.emit('error', new Error(secret));
  ctx.ws.close(1006, secret);
  ctx.ws.emit('close', 1006, secret);
  assert.deepEqual(ctx.events.map(event => event.details.phase), ['connected', 'authenticated', 'failed', 'closed']);
  assert.equal(ctx.events[2].details.reason, 'provider_error');
  assert.equal(ctx.events[2].details.error.code, 'EIO');
  assert.equal(ctx.events[2].callId, callId);
  assertPrivate(ctx.events);
  const socket = setup();
  socket.ws.emit('error', new TypeError(secret));
  socket.ws.close(1006, secret);
  assert.equal(socket.events[1].details.reason, 'socket_error');
  assert.equal(socket.events[1].callId, undefined);
  assertPrivate(socket.events);
});

test('media observer failure cannot interrupt authentication or PCM forwarding', async () => {
  const ctx = setup({}, () => { throw Error('diagnostic storage failure'); });
  await auth(ctx);
  await ctx.ws.message(Buffer.alloc(4), true);
  assert.equal(JSON.parse(ctx.ws.sent[0].payload).type, 'ready');
  assert.equal(ctx.fed.length, 1);
  assert.doesNotThrow(() => ctx.ws.close(1000));
});
