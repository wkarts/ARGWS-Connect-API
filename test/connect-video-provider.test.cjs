'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function evaluate(source, context) {
  const loaded = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { module: loaded, exports: loaded.exports, ...context });
  return loaded.exports;
}

function fixture(env = {}) {
  const config = evaluate(fs.readFileSync(path.join(root,
    'src/api/integrations/channel/whatsapp/voip/connect-voip.config.ts'), 'utf8'), { process: { env } });
  const file = path.join(root, 'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts');
  const source = fs.readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const klass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'ZapoStartupService');
  const names = new Set(['getCallCapabilities', 'feedLiveVideo', 'requestVideoKeyFrame', 'acceptCall',
    'onInboundVideo', 'onVideoKeyFrameRequest', 'onCallEnded', 'bindClientEvents', 'normalizeCall',
    'listCalls', 'emitCall', 'isVideoCall']);
  const methods = klass.members.filter(n => ts.isMethodDeclaration(n) && names.has(n.name.getText(ast)));
  assert.equal(methods.length, names.size);
  const { Provider } = evaluate(`export class Provider { ${methods.map(n => n.getText(ast)).join('\n')} }`, {
    ...config, process: { env }, BadRequestException: Error,
    Integration: { WHATSAPP_ZAPO: 'WHATSAPP-ZAPO' }, Events: { CALL: 'CALL' },
    createJid: value => `${value}@s.whatsapp.net`,
  });
  const p = new Provider();
  p.videoEmitter = new EventEmitter();
  p.audioEmitter = new EventEmitter();
  p.client = new EventEmitter();
  p.client.voip = { engine: 'connect-video-adapter', videoEnabled: true, feedLiveVideo: () => 7, requestVideoKeyFrame: () => {} };
  p.ensureVoip = () => {};
  p.ensureConnected = async () => {};
  p.ensureClient = async () => {};
  p.toJson = value => JSON.parse(JSON.stringify(value));
  p.callMuteStates = new Map();
  p.outgoingCallPeers = new Map();
  p.sendDataWebhook = () => assert.fail('video must never be published as a webhook');
  return { p, config, env };
}

test('video is available only on the active qualified Connect engine', () => {
  const { p, env } = fixture();
  assert.equal(p.getCallCapabilities().video, true);
  p.client.voip.videoEnabled = false;
  assert.equal(p.getCallCapabilities().video, false, 'capability follows the actual installed video engine');
  p.client.voip.videoEnabled = true;
  p.client.voip.engine = 'zapo-native';
  assert.equal(p.getCallCapabilities().video, false, 'method presence is insufficient for native qualification');
  assert.throws(() => p.feedLiveVideo('call', new Uint8Array(8), 0));
  p.client.voip.engine = 'connect-video-adapter';
  env.CONNECT_VIDEO_ENABLED = 'false';
  assert.equal(p.getCallCapabilities().video, true, 'video is enabled without environment configuration');
  env.ZAPO_VOIP_ENABLED = 'false';
  assert.equal(p.getCallCapabilities().audio, false);
  assert.equal(p.getCallCapabilities().video, false);
  p.client = null;
  assert.equal(p.getCallCapabilities().video, false);
});

test('disabled video prevents acceptance while voice still delegates to the engine', async () => {
  const { p } = fixture();
  p.client.voip.videoEnabled = false;
  let accepted = 0;
  let isVideo = true;
  p.client.voip.getCall = callId => ({ callId, isVideo });
  p.client.voip.acceptCall = async () => { accepted++; };
  await assert.rejects(p.acceptCall('call'), /vídeo/);
  assert.equal(accepted, 0);
  isVideo = false;
  await p.acceptCall('call');
  assert.equal(accepted, 1);
});

test('real incoming/outgoing engine video identity survives lists, acceptance and CALL webhooks', async () => {
  const { CallInfo } = require('../.generated/connect-voip/dist/call/call-state.js');
  const { p } = fixture();
  const outgoing = CallInfo.newOutgoing('outgoing-video', 'peer@lid', 'self@lid', 'video');
  const incoming = CallInfo.newIncoming('incoming-video', 'peer@lid', 'peer@lid', undefined, 'video');
  const voice = CallInfo.newOutgoing('voice', 'peer@lid', 'self@lid', 'audio');
  const calls = [outgoing, incoming, voice];
  p.client.voip.getCalls = () => calls;
  p.client.voip.getCall = id => calls.find(call => call.callId === id);
  p.client.voip.acceptCall = async id => p.client.voip.getCall(id).applyTransition({ type: 'local_accepted' });
  assert.equal(outgoing.isVideo, undefined, 'exercise the real mediaType contract, not a synthetic isVideo fixture');
  assert.deepEqual((await p.listCalls()).map(call => call.isVideo), [true, true, false]);
  p.client.voip.videoEnabled = false;
  await assert.rejects(p.acceptCall(incoming.callId), /vídeo/);
  assert.equal(incoming.stateData.state, 'incoming_ringing');
  p.client.voip.videoEnabled = true;
  const accepted = await p.acceptCall(incoming.callId);
  assert.equal(accepted.isVideo, true);
  assert.equal(accepted.state, 'connecting');
  incoming.applyTransition({ type: 'media_connected' });
  incoming.applyTransition({ type: 'video_state_changed', off: true });
  assert.equal(p.normalizeCall(incoming).isVideo, true, 'turning the camera off does not turn video into voice');
  const events = [];
  p.sendDataWebhook = (event, payload) => events.push({ event, payload });
  p.emitCall('incoming', incoming);
  p.emitCall('state', outgoing);
  assert.ok(events.every(event => event.event === 'CALL' && event.payload.call.isVideo === true));
  assert.equal(p.normalizeCall({ callId: 'legacy-video', isVideo: true }).isVideo, true);
  assert.equal(p.normalizeCall({ callId: 'legacy-voice', isVideo: false }).isVideo, false);
});

test('media keeps call scope, exact encoded bytes and microsecond timestamps', () => {
  const { p } = fixture();
  const data = new Uint8Array([0, 0, 0, 1, 0x65]);
  p.client.voip.feedLiveVideo = (id, actual, timestamp) => {
    assert.equal(id, 'video-call'); assert.equal(actual, data); assert.equal(timestamp, 1234567); return 3;
  };
  assert.equal(p.feedLiveVideo('video-call', data, 1234567), 3);
  p.client.voip.requestVideoKeyFrame = id => assert.equal(id, 'video-call');
  p.requestVideoKeyFrame('video-call');
});

test('inbound video and keyframe requests stay in private media emitters and unsubscribe cleanly', () => {
  const { p } = fixture();
  const received = [];
  const requests = [];
  const removeVideo = p.onInboundVideo(e => received.push(e));
  const removeKeyframe = p.onVideoKeyFrameRequest(e => requests.push(e));
  p.bindClientEvents();
  const frame = { codec: 'h264', timestampUs: 123456, keyFrame: true, data: new Uint8Array([1, 2, 3]) };
  p.client.emit('voip_call_inbound_video', { call: { callId: 'one', isVideo: true }, frame });
  p.client.emit('voip_call_video_keyframe_request', { callId: 'one' });
  assert.equal(received.length, 1); assert.equal(received[0].frame, frame);
  assert.equal(requests[0].callId, 'one');
  removeVideo(); removeKeyframe();
  p.client.emit('voip_call_inbound_video', { call: { callId: 'two' }, frame });
  assert.equal(received.length, 1);
  assert.equal(p.videoEmitter.listenerCount('video'), 0);
});

test('video uses fixed safe defaults without environment configuration', () => {
  const { config, env } = fixture();
  assert.equal(config.getConnectVoipEngine(), 'connect');
  assert.equal(config.getConnectVideoConfig().width, 640);
  assert.equal(config.getConnectVideoConfig().maxFrameBytes, 8388608);
  env.CONNECT_VIDEO_WIDTH = '99999'; env.CONNECT_VIDEO_HEIGHT = '121';
  env.CONNECT_VIDEO_MAX_FRAME_BYTES = 'Infinity'; env.CONNECT_VIDEO_MAX_FPS = '500';
  assert.equal(config.getConnectVideoConfig().width, 640);
  assert.equal(config.getConnectVideoConfig().height, 480);
  assert.equal(config.getConnectVideoConfig().maxFrameBytes, 8388608);
  assert.equal(config.getConnectVideoConfig().maxFps, 30);
  env.CONNECT_VOIP_ENGINE = 'unknown';
  assert.equal(config.getConnectVoipEngine(), 'connect');
});
