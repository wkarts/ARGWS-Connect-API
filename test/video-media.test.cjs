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

const codec = load('../src/api/services/video-media.codec.ts');
const { encodeVideoFrame, decodeVideoFrame, inspectAnnexB } = codec;
const IDR = Uint8Array.from([0, 0, 0, 1, 0x65, 0x88, 0x84]);
const DELTA = Uint8Array.from([0, 0, 1, 0x41, 0x88, 0x84]);
const frame = (timestampUs = 1000, keyFrame = true) => ({ timestampUs, keyFrame, data: keyFrame ? IDR : DELTA });
const INSTANCE = 'tenant-a';
const CALL = 'call-1';
const limits = { enabled: true, maxFrameBytes: 8 * 1024 * 1024, maxFps: 30,
  width: 640, height: 480, bitrate: 800000 };

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  closed = null;
  rejectedResponse = '';
  destroyed = false;
  write(value) { this.rejectedResponse += value; }
  destroy() { this.destroyed = true; }
  send(payload, options) { this.sent.push({ payload, options }); }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; this.emit('close', code); }
  async message(payload, isBinary = false) {
    await Promise.all(this.listeners('message').map(listener => listener(payload, isBinary)));
  }
  controls() { return this.sent.filter(item => !item.options?.binary).map(item => JSON.parse(item.payload)); }
}

function setup(overrides = {}, config = {}) {
  const emitter = new EventEmitter();
  const events = [];
  const fed = [];
  const requested = [];
  let wsOptions;
  const provider = {
    getCallCapabilities: () => ({ audio: true, video: true, engine: 'connect', videoCodec: 'h264' }),
    listCalls: async () => [{ callId: CALL, isVideo: true, state: 'incoming_ringing' }],
    feedLiveVideo: (callId, data, timestampUs) => { fed.push({ callId, data, timestampUs }); return 1; },
    onInboundVideo: cb => { emitter.on('video', cb); return () => emitter.off('video', cb); },
    onVideoKeyFrameRequest: cb => { emitter.on('keyframe', cb); return () => emitter.off('keyframe', cb); },
    onCallEnded: cb => { emitter.on('ended', cb); return () => emitter.off('ended', cb); },
    requestVideoKeyFrame: callId => requested.push(callId),
    ...overrides,
  };
  const monitor = { waInstances: { [INSTANCE]: provider } };
  const { VideoMediaService } = load('../src/api/services/video-media.service.ts', {
    '@api/integrations/channel/whatsapp/voip/connect-voip.config': { getConnectVideoConfig: () => ({ ...limits, ...config }) },
    '@exceptions': { BadRequestException: Error, NotFoundException: Error },
    './video-media.codec': codec,
    '../../diagnostics/diagnostics.service': { diagnostics: { record: input => events.push(input) } },
    ws: { WebSocketServer: class {
      constructor(options) { wsOptions = options; }
      handleUpgrade(request, socket, head, callback) { callback(socket); }
      close() {}
    } },
  });
  const service = new VideoMediaService(monitor);
  const server = new EventEmitter();
  service.attach(server);
  const socket = () => {
    const ws = new Socket();
    server.emit('upgrade', { url: '/video/media' }, ws, Buffer.alloc(0));
    return ws;
  };
  const ws = socket();
  return { service, provider, monitor, server, ws, socket, emitter, fed, requested, events, wsOptions,
    close: () => server.emit('close'),
    inbound: (value = frame(), callId = CALL) => emitter.emit('video', { call: { callId }, frame: { codec: 'h264', ...value } }),
  };
}

async function authenticate(ctx, ws = ctx.ws) {
  const ticket = await ctx.service.createMediaTicket(INSTANCE, CALL);
  await ws.message(Buffer.from(JSON.stringify({ ticket: ticket.ticket })));
  return ticket;
}

test('CV envelope preserves H.264 bytes, keyframe and microsecond timestamp across large safe integers', () => {
  for (const timestampUs of [0, 1000, 4294967297, Number.MAX_SAFE_INTEGER]) {
    for (const keyFrame of [true, false]) {
      const input = frame(timestampUs, keyFrame);
      const result = decodeVideoFrame(encodeVideoFrame(input));
      assert.equal(result.timestampUs, timestampUs);
      assert.equal(result.keyFrame, keyFrame);
      assert.deepEqual([...result.data], [...input.data]);
    }
  }
});

test('CV rejects malformed lengths, reserved flags, overflow timestamps and invalid Annex-B/NALs', () => {
  const valid = encodeVideoFrame(frame());
  const invalid = [valid.subarray(0, 15), Buffer.concat([valid, Buffer.from([1])]), Buffer.alloc(0)];
  for (const [offset, value] of [[0, 1], [1, 1], [2, 2], [3, 2], [12, 1], [16, 2], [20, 0x85], [20, 0x7f]]) {
    const modified = Buffer.from(valid); modified[offset] = value; invalid.push(modified);
  }
  const overflow = Buffer.from(valid); overflow.writeBigUInt64BE(2n ** 63n, 4); invalid.push(overflow);
  const falseFlag = Buffer.from(valid); falseFlag[3] = 0; invalid.push(falseFlag);
  for (const value of invalid) assert.throws(() => decodeVideoFrame(value));
  for (const timestampUs of [-1, NaN, Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => encodeVideoFrame(frame(timestampUs)));
  }
  assert.throws(() => encodeVideoFrame(frame(), 2));
  assert.throws(() => decodeVideoFrame(valid, 2));
  assert.throws(() => inspectAnnexB(Uint8Array.from([...IDR, 0, 0, 0, 1])));
  assert.equal(inspectAnnexB(Uint8Array.from([0, 0, 1, 0x67, 2, 0, 0, 1, 0x65, 4])).keyFrame, true);
});

test('capabilities and tickets expose effective limits while non-video providers/calls fail closed', async () => {
  const ctx = setup();
  const capabilities = await ctx.service.capabilities(INSTANCE);
  assert.equal(capabilities.video, true);
  assert.equal(capabilities.videoMedia.maxFps, 30);
  const ticket = await ctx.service.createMediaTicket(INSTANCE, CALL);
  assert.equal(ticket.mediaPath, '/video/media');
  assert.equal(ticket.codec, 'h264');
  assert.equal(ticket.expiresInSeconds, 30);
  assert.match(ticket.ticket, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(ctx.wsOptions.perMessageDeflate, false);
  assert.equal(ctx.wsOptions.maxPayload, limits.maxFrameBytes + 16);
  ctx.close();
  for (const [overrides, config] of [
    [{ getCallCapabilities: () => ({ audio: true, video: false, engine: 'zapo-native' }) }, {}],
    [{ onInboundVideo: null }, {}], [{}, { enabled: false }],
    [{ listCalls: async () => [{ callId: CALL, isVideo: false }] }, {}],
    [{ listCalls: async () => [{ callId: CALL, isVideo: true, state: 'ended' }] }, {}],
  ]) {
    const other = setup(overrides, config);
    await assert.rejects(other.service.createMediaTicket(INSTANCE, CALL));
    other.close();
  }
});

test('tickets are single-use, expire at 30 seconds, and cannot change instance or call through WS fields', async () => {
  const ctx = setup();
  const ticket = await ctx.service.createMediaTicket(INSTANCE, CALL);
  await ctx.ws.message(Buffer.from(JSON.stringify({ ticket: ticket.ticket, instanceName: 'tenant-b', callId: 'forged' })));
  await ctx.ws.message(encodeVideoFrame(frame()), true);
  assert.equal(ctx.fed[0].callId, CALL);
  ctx.ws.close(1000);
  const replay = ctx.socket();
  await replay.message(Buffer.from(JSON.stringify({ ticket: ticket.ticket })));
  assert.equal(replay.closed.code, 4401);
  const expired = await ctx.service.createMediaTicket(INSTANCE, CALL);
  const originalNow = Date.now;
  try {
    Date.now = () => new Date(expired.expiresAt).getTime();
    const socket = ctx.socket();
    await socket.message(Buffer.from(JSON.stringify({ ticket: expired.ticket })));
    assert.equal(socket.closed.code, 4401);
  } finally { Date.now = originalNow; ctx.close(); }
});

test('permanent token, query auth and binary-before-ticket never authenticate video', async () => {
  for (const [payload, binary] of [[JSON.stringify({ token: 'global', instanceName: INSTANCE, callId: CALL }), false],
    [encodeVideoFrame(frame()), true], ['{broken', false], [Buffer.alloc(4097), false]]) {
    const ctx = setup();
    await ctx.ws.message(Buffer.from(payload), binary);
    assert.ok(ctx.ws.closed);
    assert.equal(ctx.emitter.listenerCount('video'), 0);
    assert.equal(ctx.events.some(event => event.phase === 'authenticated'), false);
    ctx.close();
  }
});

test('video flows in both directions; cross-call frames and undecodable deltas are dropped', async () => {
  const ctx = setup();
  await authenticate(ctx);
  assert.equal(ctx.ws.controls()[0].type, 'ready');
  assert.equal(ctx.requested.length, 1);
  assert.equal(ctx.ws.controls().filter(item => item.type === 'request_keyframe').length, 1);
  await ctx.ws.message(encodeVideoFrame(frame(1000, false)), true);
  assert.equal(ctx.fed.length, 0);
  await ctx.ws.message(encodeVideoFrame(frame(2000)), true);
  await ctx.ws.message(encodeVideoFrame(frame(3000, false)), true);
  assert.equal(ctx.fed.length, 2);
  ctx.inbound(frame(1000, false));
  ctx.inbound(frame(2000), 'other-call');
  assert.equal(ctx.ws.sent.filter(item => item.options?.binary).length, 0);
  ctx.inbound(frame(2000));
  ctx.inbound(frame(3000, false));
  assert.equal(ctx.ws.sent.filter(item => item.options?.binary).length, 2);
  assert.deepEqual(ctx.events.map(item => item.phase), ['connected', 'authenticated']);
  assert.equal(JSON.stringify(ctx.events).includes('data'), false);
  assert.equal(JSON.stringify(ctx.events).includes('ticket'), false);
  ctx.emitter.emit('ended', CALL);
  assert.equal(ctx.ws.closed.code, 1000);
  for (const name of ['video', 'ended', 'keyframe']) assert.equal(ctx.emitter.listenerCount(name), 0);
  ctx.close();
});

test('duplicate camera session is rejected without disturbing the existing call or stream', async () => {
  const ctx = setup();
  await authenticate(ctx);
  const second = ctx.socket();
  await authenticate(ctx, second);
  assert.equal(second.closed.code, 4409);
  assert.equal(ctx.ws.closed, null);
  assert.equal(ctx.emitter.listenerCount('video'), 1);
  ctx.ws.close(1000);
  const replacement = ctx.socket();
  await authenticate(ctx, replacement);
  assert.equal(replacement.closed, null);
  assert.equal(ctx.emitter.listenerCount('video'), 1);
  ctx.close();
});

test('closing or sending a second auth while async authorization runs cannot attach late subscribers', async () => {
  for (const action of ['close', 'second-auth', 'ended']) {
    const ctx = setup();
    const ticket = await ctx.service.createMediaTicket(INSTANCE, CALL);
    let release;
    ctx.provider.listCalls = () => new Promise(resolve => { release = resolve; });
    const pending = ctx.ws.message(Buffer.from(JSON.stringify({ ticket: ticket.ticket })));
    await new Promise(resolve => setImmediate(resolve));
    if (action === 'close') ctx.ws.close(1000);
    else if (action === 'ended') ctx.emitter.emit('ended', CALL);
    else await ctx.ws.message(Buffer.from(JSON.stringify({ ticket: ticket.ticket })));
    release([{ callId: CALL, isVideo: true, state: 'active' }]);
    await pending;
    assert.equal(ctx.ws.controls().some(item => item.type === 'ready'), false);
    for (const name of ['video', 'ended', 'keyframe']) assert.equal(ctx.emitter.listenerCount(name), 0);
    ctx.close();
  }
});

test('ticket does not authorize a replacement runtime or a call that ended before consumption', async () => {
  for (const action of ['replace', 'ended']) {
    const ctx = setup();
    const ticket = await ctx.service.createMediaTicket(INSTANCE, CALL);
    if (action === 'replace') ctx.monitor.waInstances[INSTANCE] = { ...ctx.provider };
    else ctx.provider.listCalls = async () => [];
    await ctx.ws.message(Buffer.from(JSON.stringify({ ticket: ticket.ticket })));
    assert.ok(ctx.ws.closed);
    assert.equal(ctx.emitter.listenerCount('video'), 0);
    ctx.close();
  }
});

test('backpressure and rate loss wait for a new keyframe instead of forwarding dependent frames', async () => {
  const ctx = setup({}, { maxFps: 1 });
  const originalNow = Date.now;
  let now = Date.now();
  try {
    Date.now = () => now;
    await authenticate(ctx);
    for (let i = 1; i <= 5; i++) await ctx.ws.message(encodeVideoFrame(frame(i * 1000, i === 1)), true);
    assert.equal(ctx.fed.length, 3);
    now += 1100;
    await ctx.ws.message(encodeVideoFrame(frame(6000, false)), true);
    assert.equal(ctx.fed.length, 3);
    await ctx.ws.message(encodeVideoFrame(frame(7000)), true);
    assert.equal(ctx.fed.length, 4);
    ctx.inbound(frame(1000));
    ctx.ws.bufferedAmount = 17 * 1024 * 1024;
    ctx.inbound(frame(2000, false));
    ctx.ws.bufferedAmount = 0;
    ctx.inbound(frame(3000, false));
    ctx.inbound(frame(4000));
    assert.equal(ctx.ws.sent.filter(item => item.options?.binary).length, 2);
    assert.ok(ctx.requested.length <= 3);
  } finally { Date.now = originalNow; ctx.close(); }
});

test('keyframe controls are per call, rate limited, and provider failures never echo content', async () => {
  const ctx = setup();
  await authenticate(ctx);
  for (let i = 0; i < 100; i++) {
    await ctx.ws.message(Buffer.from(JSON.stringify({ type: 'request_keyframe' })));
    ctx.emitter.emit('keyframe', { callId: CALL });
    ctx.emitter.emit('keyframe', { callId: 'other-call' });
  }
  assert.equal(ctx.requested.length, 1);
  assert.equal(ctx.ws.controls().filter(item => item.type === 'request_keyframe').length, 1);
  ctx.provider.feedLiveVideo = () => { throw new Error('SECRET CAMERA CONTENT'); };
  await ctx.ws.message(encodeVideoFrame(frame()), true);
  assert.ok(ctx.ws.closed);
  assert.equal(JSON.stringify(ctx.events).includes('SECRET'), false);
  assert.equal(JSON.stringify(ctx.ws.sent).includes('SECRET'), false);
  ctx.close();
});

test('authentication expires without a frame and pending sockets have a hard admission limit', () => {
  const originalTimeout = global.setTimeout;
  let timeout;
  let ctx;
  try {
    global.setTimeout = callback => { timeout = callback; return { unref() {} }; };
    ctx = setup();
  } finally { global.setTimeout = originalTimeout; }
  timeout();
  assert.equal(ctx.ws.closed.code, 4401);
  ctx.close();
  const bounded = setup();
  for (let index = 1; index < 128; index++) bounded.socket();
  const rejected = bounded.socket();
  assert.match(rejected.rejectedResponse, /503 Service Unavailable/);
  assert.equal(rejected.destroyed, true);
  bounded.ws.close(1000);
  const released = bounded.socket();
  assert.equal(released.destroyed, false);
  bounded.close();
});

test('a synchronous ended subscription cannot leak its returned unsubscribe after closing', async () => {
  let removed = 0;
  const ctx = setup({ onCallEnded: callback => { callback(CALL); return () => { removed++; }; } });
  await authenticate(ctx);
  assert.equal(ctx.ws.closed.code, 1000);
  assert.equal(ctx.ws.controls().some(item => item.type === 'ready'), false);
  assert.equal(removed, 1);
  ctx.close();
});

test('lifecycle check closes orphan streams after runtime replacement or missing call without an ended event', async () => {
  for (const reason of ['replace', 'missing']) {
    const ctx = setup();
    const originalInterval = global.setInterval;
    let tick;
    try {
      global.setInterval = callback => { tick = callback; return { unref() {} }; };
      await authenticate(ctx);
    } finally { global.setInterval = originalInterval; }
    if (reason === 'replace') ctx.monitor.waInstances[INSTANCE] = { ...ctx.provider };
    else ctx.provider.listCalls = async () => [];
    await tick();
    assert.equal(ctx.ws.closed.code, 1000);
    for (const name of ['video', 'ended', 'keyframe']) assert.equal(ctx.emitter.listenerCount(name), 0);
    ctx.close();
  }
});
