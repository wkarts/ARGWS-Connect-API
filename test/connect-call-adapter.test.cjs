'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../src/api/integrations/channel/whatsapp/voip/connect-call-adapter.plugin.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded.require = request => {
  if (request === '@innovatorssoft/zapo-js') return { defineWaClientPlugin: definition => definition };
  if (request === '@innovatorssoft/voip') return { voipPlugin() { throw new Error('Factory injection required'); } };
  if (request === './connect-voip.plugin') return { connectVoipPlugin() { throw new Error('Factory injection required'); } };
  return module.require(request);
};
loaded._compile(compiled, filename);
const { createConnectCallAdapter } = loaded.exports;

function stanza(tag, callId, video = false, id = `${tag}-${callId}`) {
  return {
    tag: 'call', attrs: { id, from: '111:18@lid' },
    content: [{ tag, attrs: { 'call-id': callId, 'call-creator': '111:18@lid' },
      content: video ? [{ tag: 'video', attrs: { enc: 'h264' } }] : [] }],
  };
}

function fixture(t, options = {}, controls = {}) {
  const handlers = [];
  const outgoing = [];
  const events = [];
  const engines = {};
  class LowLevel {
    #brand = 'original';
    async sendNode(node) { assert.equal(this.#brand, 'original'); outgoing.push(node); }
    brand() { return this.#brand; }
  }
  const lowLevel = new LowLevel();
  const ctx = {
    deps: Object.freeze({ lowLevelCoordinator: lowLevel }),
    options: {}, stores: {}, client: {}, logger: {},
    emit(...args) { events.push(args); return true; },
    registerIncomingHandler(registration) {
      if (registration.prepend) handlers.unshift(registration); else handlers.push(registration);
      return () => { const index = handlers.indexOf(registration); if (index >= 0) handlers.splice(index, 1); };
    },
  };
  const originalSend = lowLevel.sendNode;
  function factory(owner) {
    return () => ({ setup(context) {
      const engine = new EventEmitter();
      Object.assign(engine, {
        context, calls: new Map(), received: [], operations: [], disposed: 0,
        getCall(id) { return this.calls.get(id) || null; },
        getCalls() { return [...this.calls.values()]; },
        put(id, incoming = false) {
          const call = { callId: id, isEnded: false, isInitiator: !incoming, direction: incoming ? 'incoming' : 'outgoing' };
          this.calls.set(id, call);
          context.emit('voip_call_state', call);
          return call;
        },
        async startCall(request) {
          this.operations.push(['startCall', request]);
          if (controls.beforeStart) await controls.beforeStart(owner);
          const id = `${owner}-${this.operations.length}`;
          this.put(id);
          if (controls.afterStart) await controls.afterStart(owner);
          return id;
        },
        async acceptCall(id) { this.operations.push(['acceptCall', id]); },
        async rejectCall(id, reason) { this.operations.push(['rejectCall', id, reason]); this.calls.delete(id); },
        async endCall(id, reason) {
          this.operations.push(['endCall', id, reason]);
          context.emit('voip_call_ended', { callId: id, isEnded: true });
          this.calls.delete(id);
        },
        loadAudio(id, input) { this.operations.push(['loadAudio', id, input]); },
        setMute(id, input) { this.operations.push(['setMute', id, input]); },
        setExternalAudioMode(id, input) { this.operations.push(['setExternalAudioMode', id, input]); },
        feedLiveAudio(id, input) { this.operations.push(['feedLiveAudio', id, input]); return 23; },
        feedLiveVideo(id, input, timestamp) { this.operations.push(['feedLiveVideo', id, input, timestamp]); return 7; },
        requestVideoKeyFrame(id) { this.operations.push(['requestVideoKeyFrame', id]); return true; },
        getLiveBufferMs() { return 23; },
        getFeedWatermarksMs() { return { pauseMs: 1000, resumeMs: 500 }; },
        dispose() { this.disposed++; for (const remove of removers) remove(); this.removeAllListeners(); },
      });
      const removers = ['call', 'ack', 'receipt'].map(tag => context.registerIncomingHandler({
        tag, prepend: true,
        async handler(node) {
          engine.received.push(node);
          if (node.tag === 'call' && node.content?.[0]?.tag === 'offer') {
            const id = node.content[0].attrs['call-id'];
            if (controls.beforeIncoming) await controls.beforeIncoming(owner, id);
            engine.put(id, true);
          }
          return true;
        },
      }));
      engines[owner] = engine;
      return engine;
    } });
  }
  const adapter = createConnectCallAdapter(ctx, { maxConcurrentCalls: 4, ...options }, { voice: factory('voice'), video: factory('video') });
  t.after(() => adapter.dispose());
  const dispatch = async node => {
    for (const registration of [...handlers]) {
      if (registration.tag === node.tag && await registration.handler(node)) return true;
    }
    return false;
  };
  return { adapter, engines, dispatch, outgoing, events, ctx, handlers, originalSend };
}

test('audio offers and controls are delegated once, with the original node object and bytes', async t => {
  const f = fixture(t);
  const node = stanza('offer', 'audio-call');
  node.content[0].content.push({ tag: 'enc', attrs: {}, content: Buffer.from([1, 2, 3, 4]) });
  const before = JSON.stringify(node);
  await f.dispatch(node);
  await f.dispatch(stanza('accept', 'audio-call'));
  assert.equal(f.engines.voice.received.length, 2);
  assert.equal(f.engines.video.received.length, 0);
  assert.equal(f.engines.voice.received[0], node);
  assert.equal(JSON.stringify(node), before);
  assert.equal(f.engines.voice.context.deps, f.ctx.deps);
  assert.equal(f.ctx.deps.lowLevelCoordinator.sendNode, f.originalSend);
});

test('video offer and subsequent audio-less controls are consumed only by the video owner', async t => {
  const f = fixture(t);
  await f.dispatch(stanza('offer', 'video-call', true));
  await f.dispatch(stanza('transport', 'video-call'));
  await f.dispatch(stanza('terminate', 'video-call'));
  assert.equal(f.engines.video.received.length, 3);
  assert.equal(f.engines.voice.received.length, 0);
});

test('call-class ACK without call-id is correlated to the video stanza before the original send', async t => {
  const f = fixture(t);
  const request = stanza('offer', 'video-call', true, 'video-request');
  await f.engines.video.context.deps.lowLevelCoordinator.sendNode(request);
  const ack = { tag: 'ack', attrs: { class: 'call', id: 'video-request', type: 'offer' } };
  await f.dispatch(ack);
  assert.deepEqual(f.outgoing, [request]);
  assert.deepEqual(f.engines.video.received, [ack]);
  assert.deepEqual(f.engines.voice.received, []);
});

test('dependency views preserve public method private-field binding and never change the original deps', async t => {
  const f = fixture(t);
  const view = f.engines.video.context.deps;
  assert.notEqual(view, f.ctx.deps);
  assert.notEqual(view.lowLevelCoordinator, f.ctx.deps.lowLevelCoordinator);
  assert.equal(view.lowLevelCoordinator.brand(), 'original');
  await view.lowLevelCoordinator.sendNode(stanza('offer', 'video-1', true));
  assert.equal(f.ctx.deps.lowLevelCoordinator.sendNode, f.originalSend);
});

test('a known voice call wins a colliding video id and ignores video payload injection', async t => {
  const f = fixture(t);
  f.engines.voice.put('same-id');
  f.engines.video.put('same-id');
  await f.dispatch(stanza('offer', 'same-id', true));
  await f.adapter.acceptCall('same-id');
  assert.equal(f.engines.voice.received.length, 1);
  assert.equal(f.engines.video.received.length, 0);
  assert.equal(f.adapter.feedLiveVideo('same-id', Buffer.from([1]), 0), 0);
  assert.equal(f.adapter.getCalls().length, 1);
  assert.equal(f.adapter.getCall('same-id'), f.engines.voice.getCall('same-id'));
});

test('facade starts select engine by isVideo while preserving the exact audio request', async t => {
  const f = fixture(t);
  const request = { peerJid: '111:18@lid', isVideo: false, audioFile: '/tmp/test.wav' };
  assert.match(await f.adapter.startCall(request), /^voice-/);
  assert.equal(f.engines.voice.operations[0][1], request);
  assert.match(await f.adapter.startCall({ peerJid: '222:25@lid', isVideo: true }), /^video-/);
});

test('mute, PCM and live audio mode follow the call owner without changing frame data', t => {
  const f = fixture(t);
  f.engines.voice.put('voice'); f.engines.video.put('video');
  const pcm = new Float32Array([0.25, -0.25]);
  f.adapter.setMute('voice', true);
  f.adapter.setMute('video', false);
  f.adapter.setExternalAudioMode('video', true);
  assert.equal(f.adapter.feedLiveAudio('video', pcm), 23);
  assert.deepEqual(f.engines.voice.operations, [['setMute', 'voice', true]]);
  assert.equal(f.engines.video.operations.at(-1)[2], pcm);
  assert.deepEqual(f.adapter.getFeedWatermarksMs(), { pauseMs: 1000, resumeMs: 500 });
});

test('video frames and keyframe requests cannot migrate unknown/audio calls to the video engine', t => {
  const f = fixture(t);
  f.engines.video.put('video');
  const data = Buffer.from([0, 0, 0, 1, 0x65]);
  assert.equal(f.adapter.feedLiveVideo('video', data, 40_000), 7);
  assert.equal(f.engines.video.operations[0][2], data);
  assert.equal(f.adapter.requestVideoKeyFrame('video'), true);
  assert.equal(f.adapter.feedLiveVideo('unknown', data, 40_000), 0);
  assert.equal(f.adapter.requestVideoKeyFrame('unknown'), false);
});

test('terminal video ownership and delayed ACKs survive session removal', async t => {
  const f = fixture(t);
  f.engines.video.put('video');
  await f.engines.video.context.deps.lowLevelCoordinator.sendNode(stanza('accept', 'video', false, 'late-ack'));
  await f.adapter.endCall('video');
  await f.dispatch({ tag: 'ack', attrs: { class: 'call', id: 'late-ack', type: 'accept' } });
  await f.dispatch(stanza('terminate', 'video'));
  assert.equal(f.engines.video.received.length, 2);
  assert.equal(f.engines.voice.received.length, 0);
});

test('expired video correlations return to the original unknown-call handler', async t => {
  const f = fixture(t);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  await f.engines.video.context.deps.lowLevelCoordinator.sendNode(stanza('accept', 'video', false, 'late'));
  Date.now.mock.mockImplementation(() => now + 120_001);
  await f.dispatch({ tag: 'ack', attrs: { class: 'call', id: 'late' } });
  assert.equal(f.engines.voice.received.length, 1);
  assert.equal(f.engines.video.received.length, 0);
});

test('correlation floods retain the latest 4096 ids and do not grow indefinitely', async t => {
  const f = fixture(t);
  for (let n = 0; n < 4097; n++) {
    await f.engines.video.context.deps.lowLevelCoordinator.sendNode(stanza('accept', `video-${n}`, false, `id-${n}`));
  }
  await f.dispatch({ tag: 'ack', attrs: { class: 'call', id: 'id-0' } });
  await f.dispatch({ tag: 'ack', attrs: { class: 'call', id: 'id-4096' } });
  assert.equal(f.engines.voice.received.length, 1);
  assert.equal(f.engines.video.received.length, 1);
});

test('unknown controls remain delegated to the voice coordinator', async t => {
  const f = fixture(t);
  await f.dispatch(stanza('terminate', 'unknown'));
  await f.dispatch({ tag: 'ack', attrs: { class: 'call', id: 'unknown' } });
  await f.adapter.endCall('unknown');
  assert.equal(f.engines.voice.received.length, 2);
  assert.deepEqual(f.engines.voice.operations, [['endCall', 'unknown', undefined]]);
});

test('global once listeners fire only once across both public engines', t => {
  const f = fixture(t);
  const received = [];
  f.adapter.once('call_state', event => received.push(event));
  f.engines.video.emit('call_state', 'video');
  f.engines.voice.emit('call_state', 'voice');
  assert.deepEqual(received, ['video']);
  assert.equal(f.engines.voice.listenerCount('call_state'), 0);
  assert.equal(f.engines.video.listenerCount('call_state'), 0);
});

test('off removes a shared subscription from both engines', t => {
  const f = fixture(t);
  let calls = 0;
  const listener = () => calls++;
  f.adapter.on('call_state', listener).off('call_state', listener);
  f.engines.voice.emit('call_state'); f.engines.video.emit('call_state');
  assert.equal(calls, 0);
});

test('concurrent starts reserve a shared slot before either engine allocates its session', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { maxConcurrentCalls: 1 }, { beforeStart: () => gate });
  const first = f.adapter.startCall({ peerJid: '111@lid' });
  await assert.rejects(f.adapter.startCall({ peerJid: '222@lid', isVideo: true }), /max concurrent calls/);
  release(); await first;
  assert.equal(f.engines.video.operations.length, 0);
});

test('a published session is not double-counted while its start promise is still pending', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { maxConcurrentCalls: 2 }, { afterStart: owner => owner === 'voice' ? gate : undefined });
  const first = f.adapter.startCall({ peerJid: '111@lid' });
  const second = await f.adapter.startCall({ peerJid: '222@lid', isVideo: true });
  assert.match(second, /^video-/);
  release(); await first;
});

test('an excess incoming video call is rejected through its own engine without ending voice', async t => {
  const f = fixture(t, { maxConcurrentCalls: 1 });
  f.engines.voice.put('active-voice');
  await f.dispatch(stanza('offer', 'excess-video', true));
  assert.deepEqual(f.engines.video.operations, [['rejectCall', 'excess-video', 'busy']]);
  assert.ok(f.engines.voice.getCall('active-voice'));
  assert.equal(f.engines.voice.operations.length, 0);
});

test('disabled video installs only native voice and rejects video start explicitly', async t => {
  const f = fixture(t, { videoEnabled: false });
  assert.equal(f.engines.video, undefined);
  assert.equal(f.handlers.length, 3);
  await assert.rejects(f.adapter.startCall({ peerJid: '111@lid', isVideo: true }), /disabled/);
  assert.equal(f.adapter.videoEnabled, false);
});

test('dispose unregisters both engines and callbacks exactly once', async t => {
  const f = fixture(t);
  f.adapter.on('call_state', () => {});
  f.adapter.dispose(); f.adapter.dispose();
  assert.equal(f.handlers.length, 0);
  assert.equal(f.engines.voice.disposed, 1);
  assert.equal(f.engines.video.disposed, 1);
  await assert.rejects(f.adapter.startCall({ peerJid: '111@lid' }), /disposed/);
  assert.equal(await f.dispatch(stanza('offer', 'later')), false);
});

test('engine/capability markers are immutable', t => {
  const f = fixture(t);
  assert.equal(f.adapter.engine, 'connect-video-adapter');
  assert.throws(() => { f.adapter.engine = 'other'; }, TypeError);
  assert.throws(() => { f.adapter.videoEnabled = false; }, TypeError);
});

test('the real native public plugin produces identical voice ACK bytes when wrapped beside video', async t => {
  const { voipPlugin } = require('@innovatorssoft/voip');
  const { createNoopLogger } = require('zapo-js');
  const { encodeBinaryNodeStanza } = require('zapo-js/transport');
  function host() {
    const handlers = [];
    const sent = [];
    const ctx = {
      deps: { lowLevelCoordinator: { async sendNode(node) { sent.push(node); } } },
      stores: {}, logger: createNoopLogger(), emit() { return true; },
      registerIncomingHandler(handler) {
        if (handler.prepend) handlers.unshift(handler); else handlers.push(handler);
        return () => { const i = handlers.indexOf(handler); if (i >= 0) handlers.splice(i, 1); };
      },
    };
    const dispatch = async node => {
      for (const handler of handlers) if (handler.tag === node.tag && await handler.handler(node)) return true;
      return false;
    };
    return { ctx, handlers, sent, dispatch };
  }
  const direct = host();
  const wrapped = host();
  const native = voipPlugin({ maxConcurrentCalls: 1 }).setup(direct.ctx);
  const video = () => ({ setup() {
    return { getCall() { return null; }, getCalls() { return []; }, dispose() {} };
  } });
  const adapter = createConnectCallAdapter(wrapped.ctx, { videoEnabled: true }, { voice: voipPlugin, video });
  t.after(() => { native.dispose(); adapter.dispose(); });
  const inputs = [
    stanza('terminate', 'unknown-audio'),
    stanza('transport', 'unknown-audio'),
    { tag: 'ack', attrs: { class: 'call', type: 'offer', id: 'old-audio-offer' } },
    { tag: 'receipt', attrs: { id: 'audio-receipt', from: '111:18@lid', type: 'retry' },
      content: [{ tag: 'accept', attrs: { 'call-id': 'unknown-audio' } }] },
  ];
  for (const node of inputs) assert.equal(await wrapped.dispatch(node), await direct.dispatch(node));
  assert.deepEqual(wrapped.sent, direct.sent);
  assert.equal(wrapped.sent.length, 3);
  for (let i = 0; i < direct.sent.length; i++) {
    assert.deepEqual(encodeBinaryNodeStanza(wrapped.sent[i]), encodeBinaryNodeStanza(direct.sent[i]));
  }
  assert.deepEqual(adapter.getFeedWatermarksMs(), native.getFeedWatermarksMs());
  adapter.dispose();
  assert.equal(wrapped.handlers.length, 0);
});
