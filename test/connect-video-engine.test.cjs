const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '../src/api/integrations/channel/whatsapp/voip/engine');
const moduleAt = name => import(pathToFileURL(path.join(root, name)));
const loaded = Promise.all([
  moduleAt('call/WaCallMediaSession.js'), moduleAt('call/call-state.js'),
  moduleAt('types.js'), moduleAt('crypto/srtp.js'), moduleAt('media/rtcp.js'),
  moduleAt('media/rtp.js'), moduleAt('crypto/encryption.js'), moduleAt('crypto/ssrc.js'),
]).then(([session, state, types, srtp, rtcp, rtp, key, ssrc]) => ({ ...session, ...state, ...types, ...srtp, ...rtcp, ...rtp, ...key, ...ssrc }));
const logger = { debug() {}, trace() {}, warn() {}, error() {}, child() { return this; } };
const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const callId = 'AABBCCDDEEFF00112233445566778899';
const aJid = '111111:18@lid';
const bJid = '222222:25@lid';
const au = Uint8Array.from([0, 0, 0, 1, 0x67, 1, 2, 0, 0, 0, 1, 0x68, 3, 4, 0, 0, 0, 1, 0x65, ...Array.from({ length: 1700 }, (_, i) => i % 250 + 1)]);

async function pair(options = {}) {
  const m = await loaded;
  function endpoint(own, peer, outgoing) {
    const info = outgoing ? m.CallInfo.newOutgoing(callId, peer, own, m.CallMediaType.Video)
      : m.CallInfo.newIncoming(callId, peer, aJid, undefined, m.CallMediaType.Video);
    info.encryptionKey = key;
    info.stateData.state = m.CallState.Active;
    info.stateData.connectedAt = new Date();
    const frames = [], feedback = [], packets = [], control = [];
    const deps = { authClient: { getCurrentCredentials: () => ({ meLid: own, meJid: own }) } };
    const session = new m.WaCallMediaSession({ deps, logger, info, maxVideoFps: options.maxVideoFps,
      delegate: { emitState() {}, emitIncoming() {}, emitEnded() {}, emitInboundAudio() {}, emitOutboundAudioFinished() {},
        emitInboundVideo: (_, frame) => frames.push(frame), emitVideoKeyFrameRequest: () => feedback.push(callId) } });
    session.sctpRelay = { hasConnection: () => true, canSendVideo: () => true, setStreamSsrcs() {}, setSubscriptionSsrc() {},
      setParticipantIds() {}, resendSubscriptions() {}, cleanup() {},
      broadcastVideo: data => { packets.push(new Uint8Array(data)); return true; }, broadcast: data => control.push(new Uint8Array(data)) };
    session.acceptedByJid = peer;
    session.initVideoStreams(own, peer);
    session.initSrtpKeys();
    return { session, frames, feedback, packets, control };
  }
  const a = endpoint(aJid, bJid, true), b = endpoint(bJid, aJid, false);
  return { m, a, b, close: () => { a.session.cleanup(); b.session.cleanup(); } };
}

test('two Connect video sessions exchange encrypted H264 in both directions with microsecond timestamps', async () => {
  const p = await pair();
  try {
    assert.ok(p.a.session.feedLiveVideo(au, 1_000_000) > 1);
    for (const packet of p.a.packets) p.b.session.onRelayData(packet);
    assert.equal(p.b.frames.length, 1);
    assert.equal(p.b.frames[0].codec, 'h264');
    assert.equal(p.b.frames[0].timestampUs, 0);
    assert.equal(p.b.frames[0].keyFrame, true);
    assert.deepEqual(p.b.frames[0].data, au);
    assert.ok(p.b.session.feedLiveVideo(au, 2_000_000) > 1);
    for (const packet of p.b.packets) p.a.session.onRelayData(packet);
    assert.equal(p.a.frames.length, 1);
    assert.deepEqual(p.a.frames[0].data, au);
    const before = p.a.packets.length;
    p.a.session.feedLiveVideo(au, 1_100_000);
    for (const packet of p.a.packets.slice(before)) p.b.session.onRelayData(packet);
    assert.equal(p.b.frames[1].timestampUs, 100_000);
  } finally { p.close(); }
});

test('authenticated PLI/FIR targets the local encoder, while tamper/replay/wrong target do not', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const p = await pair();
  try {
    assert.equal(p.b.session.requestVideoKeyFrame(), true);
    assert.equal(p.b.control.length, 1);
    const corrupt = p.b.control[0].slice(); corrupt[corrupt.length - 1] ^= 1;
    p.a.session.onRelayData(corrupt);
    assert.equal(p.a.feedback.length, 0);
    p.a.session.onRelayData(p.b.control[0]);
    assert.equal(p.a.feedback.length, 1);
    now += 500;
    p.a.session.onRelayData(p.b.control[0]);
    assert.equal(p.a.feedback.length, 1);
    assert.equal(p.b.session.requestVideoKeyFrame(), true);
    p.a.session.onRelayData(p.b.control[1]);
    assert.equal(p.a.feedback.length, 2);
    now += 750;
    assert.equal(p.b.session.requestVideoKeyFrame(), true);
    p.a.session.onRelayData(p.b.control[2]);
    assert.equal(p.a.feedback.length, 3);
    const sender = p.b.session.videoRtpSession.getSsrc();
    const wrong = p.m.buildPictureLossIndication(sender, 12345);
    now += 500;
    p.a.session.onRelayData(p.b.session.sendSrtcp.protect(wrong, sender));
    assert.equal(p.a.feedback.length, 3);
  } finally { p.close(); }
});

test('keyframe recovery sends PLI then PLI then FIR, throttles retries and resets on authenticated IDR', async (t) => {
  let now = 1000;
  t.mock.method(Date, 'now', () => now);
  const p = await pair();
  try {
    const feedbackTypes = () => p.b.control.map((packet) => p.m.parseVideoKeyFrameFeedback(p.a.session.recvSrtcp.unprotect(packet))[0].type);
    assert.equal(p.b.session.requestVideoKeyFrame(), true);
    for (let i = 0; i < 20; i++) assert.equal(p.b.session.requestVideoKeyFrame(), false);
    now = 1499;
    assert.equal(p.b.session.requestVideoKeyFrame(), false);
    now = 1500;
    assert.equal(p.b.session.requestVideoKeyFrame(), true);
    now = 2000;
    assert.equal(p.b.session.requestVideoKeyFrame(), false);
    now = 2250;
    assert.equal(p.b.session.requestVideoKeyFrame(), true);
    assert.deepEqual(feedbackTypes(), ['pli', 'pli', 'fir']);
    assert.equal(p.b.session.videoFirSequence, 1);
    assert.equal(p.b.session.videoRtcpTimer, null);
    assert.equal(p.b.session.videoSubscriptionTimer, null);

    now = 2750;
    assert.equal(p.b.session.requestVideoKeyFrame(), true);
    now = 3250;
    assert.equal(p.b.session.requestVideoKeyFrame(), true);
    assert.equal(p.b.session.videoPliAttempts, 2);
    p.a.session.feedLiveVideo(au, 1_000_000);
    const corrupt = p.a.packets[0].slice(); corrupt[corrupt.length - 1] ^= 1;
    p.b.session.onRelayData(corrupt);
    assert.equal(p.b.session.videoPliAttempts, 2, 'unauthenticated IDR cannot reset recovery');
    for (const packet of p.a.packets) p.b.session.onRelayData(packet);
    assert.equal(p.b.frames.length, 1);
    assert.equal(p.b.session.videoPliAttempts, 0);
    assert.equal(p.b.session.requestVideoKeyFrame(), false, 'IDR reset does not bypass the 500 ms throttle');
    now += 500;
    assert.equal(p.b.session.requestVideoKeyFrame(), true);
    const last = p.b.control.at(-1);
    assert.equal(p.m.parseVideoKeyFrameFeedback(p.a.session.recvSrtcp.unprotect(last))[0].type, 'pli');
    const count = p.b.control.length;
    p.b.session.cleanup();
    now += 10_000;
    assert.equal(p.b.session.requestVideoKeyFrame(), false);
    assert.equal(p.b.control.length, count);
    assert.equal(p.b.session.videoPliAttempts, 0);
    assert.equal(p.b.session.videoFirSequence, 0);
  } finally { p.close(); }
});

test('rounded browser 33 ms pacing does not reject alternate frames or request repeated IDRs', async () => {
  const p = await pair();
  try {
    for (let i = 0; i < 120; i++) {
      assert.ok(p.a.session.feedLiveVideo(au, 1_000_000 + i * 33_000) > 0, `frame ${i}`);
    }
    assert.equal(p.a.feedback.length, 0);
  } finally { p.close(); }
});

test('video pacing rejects 60 fps and same-timestamp bursts while preserving a bounded rate', async () => {
  const p = await pair();
  try {
    let accepted = 0;
    for (let i = 0; i < 120; i++) {
      const timestampUs = 1_000_000 + Math.round(i * 1_000_000 / 60);
      if (p.a.session.feedLiveVideo(au, timestampUs)) accepted++;
      assert.equal(p.a.session.feedLiveVideo(au, timestampUs), 0);
    }
    assert.equal(accepted, 60);
    assert.ok(accepted / 2 <= 32);
  } finally { p.close(); }
});

test('video RTP tamper, unknown SSRC and replay never emit frames', async () => {
  const p = await pair();
  try {
    p.a.session.feedLiveVideo(au, 1_000_000);
    const corrupt = p.a.packets[0].slice(); corrupt[corrupt.length - 1] ^= 1;
    const before = p.b.session.actualPeerSsrc;
    p.b.session.onRelayData(corrupt);
    const unknown = p.a.packets[0].slice(); unknown[8] ^= 1;
    p.b.session.onRelayData(unknown);
    assert.equal(p.b.frames.length, 0);
    assert.equal(p.b.session.actualPeerSsrc, before);
    for (const packet of p.a.packets) p.b.session.onRelayData(packet);
    assert.equal(p.b.frames.length, 1);
    for (const packet of p.a.packets) p.b.session.onRelayData(packet);
    assert.equal(p.b.frames.length, 1);
  } finally { p.close(); }
});

test('FU-A gap discards incomplete frame and requests an IDR instead of delivering corrupt video', async () => {
  const p = await pair();
  try {
    p.a.session.feedLiveVideo(au, 1_000_000);
    assert.ok(p.a.packets.length >= 3);
    p.b.session.onRelayData(p.a.packets[0]);
    p.b.session.onRelayData(p.a.packets.at(-1));
    assert.equal(p.b.frames.length, 0);
    assert.ok(p.b.control.length >= 1);
  } finally { p.close(); }
});

test('RTX original sequence is fed into primary video reassembly', async () => {
  const p = await pair();
  try {
    p.a.session.feedLiveVideo(au, 1_000_000);
    const decrypt = new p.m.SrtpSession(p.m.derivePerJidSrtpKey(key, bJid), p.m.derivePerJidSrtpKey(key, aJid), 4, 4);
    const plain = p.a.packets.map(packet => decrypt.unprotect(packet));
    p.b.session.onRelayData(p.a.packets[0]);
    const repairSsrc = p.m.generateSecureSsrc(callId, aJid, 3);
    const rtx = new p.m.RtpSession(repairSsrc, 103, 90000, 3000);
    const original = plain[1];
    const payload = Uint8Array.from([original.header.sequenceNumber >> 8, original.header.sequenceNumber & 255, ...original.payload]);
    const packet = rtx.createPacketAtTimestamp(payload, original.header.timestamp, original.header.marker);
    p.b.session.onRelayData(p.a.session.srtpSession.protect(packet));
    for (const rest of p.a.packets.slice(2)) p.b.session.onRelayData(rest);
    assert.equal(p.b.frames.length, 1);
    assert.deepEqual(p.b.frames[0].data, au);
  } finally { p.close(); }
});

test('inactive calls, invalid/oversized frames, frame rate and relay backpressure reject video without enqueue', async () => {
  const p = await pair({ maxVideoFps: 15 });
  try {
    for (const [data, timestamp] of [[au, NaN], [au, -1], [new Uint8Array(8 * 1024 * 1024 + 1), 0], [new Uint8Array(), 0]]) {
      assert.equal(p.a.session.feedLiveVideo(data, timestamp), 0);
    }
    p.a.session.info.stateData.state = p.m.CallState.Connecting;
    assert.equal(p.a.session.feedLiveVideo(au, 1_000_000), 0);
    p.a.session.info.stateData.state = p.m.CallState.Active;
    assert.ok(p.a.session.feedLiveVideo(au, 1_000_000) > 0);
    assert.equal(p.a.session.feedLiveVideo(au, 1_030_000), 0);
    p.a.session.sctpRelay.canSendVideo = () => false;
    assert.equal(p.a.session.feedLiveVideo(au, 2_000_000), 0);
    const count = p.a.packets.length;
    p.a.session.cleanup();
    assert.equal(p.a.session.feedLiveVideo(au, 3_000_000), 0);
    assert.equal(p.a.packets.length, count);
  } finally { p.close(); }
});

test('cleanup removes timers and buffered video state', async () => {
  const p = await pair();
  try {
    p.a.session.startVideoFeedback();
    assert.ok(p.a.session.videoRtcpTimer);
    assert.ok(p.a.session.videoSubscriptionTimer);
    p.a.session.cleanup();
    assert.equal(p.a.session.videoRtcpTimer, null);
    assert.equal(p.a.session.videoSubscriptionTimer, null);
    assert.equal(p.a.session.videoDepacketizers.size, 0);
    assert.equal(p.a.session.recvSrtcp, null);
  } finally { p.close(); }
});
