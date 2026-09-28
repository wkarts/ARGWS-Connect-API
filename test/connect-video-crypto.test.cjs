const assert = require('node:assert/strict');
const { createCipheriv, createHmac } = require('node:crypto');
const { before, test } = require('node:test');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

let SrtpContext, SrtpSession, SrtcpContext, RtpHeader, RtpPacket;
let buildPictureLossIndication, buildFullIntraRequest, buildSenderReportWithSdes;
let parseVideoKeyFrameFeedback, validateRtcpCompound;
const engine = resolve(__dirname, '../src/api/integrations/channel/whatsapp/voip/engine');
const keying = {
  masterKey: Buffer.from('e1f97a0d3e018be0d64fa32c06de4139', 'hex'),
  masterSalt: Buffer.from('0ec675ad498afeebb6960b3aabe6', 'hex'),
};
const otherKeying = { masterKey: Buffer.alloc(16, 0x52), masterSalt: Buffer.alloc(14, 0x63) };

before(async () => {
  ({ SrtpContext, SrtpSession, SrtcpContext } = await import(pathToFileURL(resolve(engine, 'crypto/srtp.js')).href));
  ({ RtpHeader, RtpPacket } = await import(pathToFileURL(resolve(engine, 'media/rtp.js')).href));
  ({ buildPictureLossIndication, buildFullIntraRequest, buildSenderReportWithSdes,
    parseVideoKeyFrameFeedback, validateRtcpCompound } = await import(pathToFileURL(resolve(engine, 'media/rtcp.js')).href));
});

function packet(ssrc, sequence, payloadType = 96) {
  return new RtpPacket(new RtpHeader(payloadType, sequence, 90000, ssrc), Uint8Array.of(0x65, 1, 2, 3));
}

function hasType(type) {
  return (error) => error.type === type;
}

// Independent construction for authenticated malformed/clear input. This helper
// uses Node's crypto primitives rather than the implementation under test.
function referenceSrtcp(rtcp, index, encrypted = true, authLength = 4, material = keying) {
  const derive = (label, length) => {
    const iv = Buffer.alloc(16);
    Buffer.from(material.masterSalt).copy(iv);
    iv[7] ^= label;
    const cipher = createCipheriv('aes-128-ctr', material.masterKey, iv);
    return Buffer.concat([cipher.update(Buffer.alloc(length)), cipher.final()]);
  };
  const bytes = Buffer.from(rtcp);
  const indexWord = Buffer.alloc(4);
  indexWord.writeUInt32BE((index | (encrypted ? 0x80000000 : 0)) >>> 0);
  let payload = bytes.subarray(8);
  if (encrypted) {
    const iv = Buffer.alloc(16);
    derive(5, 14).copy(iv);
    for (let i = 0; i < 4; i += 1) iv[4 + i] ^= bytes[4 + i];
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(index));
    for (let i = 0; i < 6; i += 1) iv[8 + i] ^= counter[2 + i];
    const cipher = createCipheriv('aes-128-ctr', derive(3, 16), iv);
    payload = Buffer.concat([cipher.update(payload), cipher.final()]);
  }
  const authenticated = Buffer.concat([bytes.subarray(0, 8), payload, indexWord]);
  const tag = createHmac('sha1', derive(4, 20)).update(authenticated).digest().subarray(0, authLength);
  return Buffer.concat([authenticated, tag]);
}

test('SRTP keeps audio/video replay and rollover counters independent', () => {
  const sender = new SrtpSession(keying, otherKeying);
  const receiver = new SrtpSession(otherKeying, keying);
  const packets = [packet(100, 65535), packet(200, 8, 111), packet(100, 0), packet(200, 9, 111), packet(300, 0)];
  for (const expected of packets) {
    const wire = sender.protect(expected);
    const decoded = receiver.unprotect(wire);
    assert.equal(decoded.header.ssrc, expected.header.ssrc);
    assert.equal(decoded.header.sequenceNumber, expected.header.sequenceNumber);
    assert.deepEqual(decoded.payload, expected.payload);
    assert.throws(() => receiver.unprotect(wire), hasType('replay'));
  }
});

test('SRTP accepts out-of-order packets once within each SSRC window', () => {
  const sender = new SrtpSession(keying, keying);
  const receiver = new SrtpSession(keying, keying);
  const packets = [1, 2, 3].map((seq) => sender.protect(packet(7, seq)));
  receiver.unprotect(packets[2]);
  receiver.unprotect(packets[0]);
  receiver.unprotect(packets[1]);
  assert.throws(() => receiver.unprotect(packets[0]), hasType('replay'));
});

test('SRTP rejects a 33rd sender SSRC without discarding the first context', () => {
  const sender = new SrtpSession(keying, keying);
  const receiver = new SrtpSession(keying, keying);
  const first = sender.protect(packet(1, 65535));
  receiver.unprotect(first);
  for (let ssrc = 2; ssrc <= 32; ssrc += 1) sender.protect(packet(ssrc, 1));
  assert.throws(() => sender.protect(packet(33, 1)), hasType('context_limit'));
  assert.equal(receiver.unprotect(sender.protect(packet(1, 0))).header.sequenceNumber, 0);
  assert.throws(() => receiver.unprotect(first), hasType('replay'));
});

test('SRTP rejects a 33rd receiving SSRC and still rejects replay on the oldest SSRC', () => {
  const receiver = new SrtpSession(keying, keying);
  let first;
  for (let ssrc = 1; ssrc <= 32; ssrc += 1) {
    const wire = new SrtpContext(keying).protect(packet(ssrc, 1));
    if (ssrc === 1) first = wire;
    receiver.unprotect(wire);
  }
  assert.throws(() => receiver.unprotect(new SrtpContext(keying).protect(packet(33, 1))), hasType('context_limit'));
  assert.throws(() => receiver.unprotect(first), hasType('replay'));
  assert.equal(receiver.unprotect(new SrtpContext(keying).protect(packet(1, 2))).header.sequenceNumber, 2);
});

test('invalid SRTP authentication cannot consume the SSRC context budget', () => {
  const receiver = new SrtpSession(keying, keying);
  for (let ssrc = 1; ssrc <= 40; ssrc += 1) {
    const wire = new SrtpContext(otherKeying).protect(packet(ssrc, 1));
    assert.throws(() => receiver.unprotect(wire), hasType('auth_failed'));
  }
  assert.equal(receiver.unprotect(new SrtpContext(keying).protect(packet(99, 1))).header.ssrc, 99);
});

test('SRTP repaired authentication keying applies to current and future SSRCs', () => {
  const sender = new SrtpSession(keying, keying);
  sender.protect(packet(1, 1));
  sender.setSendAuthKeying(otherKeying);
  for (const ssrc of [1, 2]) {
    const receiver = new SrtpContext(keying);
    receiver.setAuthKeying(otherKeying);
    assert.equal(receiver.unprotect(sender.protect(packet(ssrc, 2))).header.ssrc, ssrc);
  }
});

for (const authLength of [4, 10]) {
  test(`SRTCP ${authLength}-byte authentication matches independent encryption and decodes PLI`, () => {
    const plain = buildPictureLossIndication(0x10203040, 0xaabbccdd);
    const sender = new SrtcpContext(keying, authLength);
    const wire = sender.protect(plain, 0x10203040);
    assert.deepEqual(Buffer.from(wire), referenceSrtcp(plain, 0, true, authLength));
    const decoded = new SrtcpContext(keying, authLength).unprotect(wire);
    assert.deepEqual(decoded, plain);
    assert.deepEqual(parseVideoKeyFrameFeedback(decoded), [{ type: 'pli', senderSsrc: 0x10203040, mediaSsrc: 0xaabbccdd }]);
  });
}

test('SRTCP decrypts a compound sender report/SDES/PLI/FIR before parsing feedback', () => {
  const plain = Buffer.concat([
    buildSenderReportWithSdes(123, 3, 1024, 90000, Buffer.alloc(18, 0x42)),
    buildPictureLossIndication(123, 456),
    buildFullIntraRequest(123, 789, 7),
  ]);
  const wire = new SrtcpContext(keying).protect(plain, 123);
  const decoded = new SrtcpContext(keying).unprotect(wire);
  assert.deepEqual(Buffer.from(decoded), plain);
  assert.deepEqual(parseVideoKeyFrameFeedback(decoded), [
    { type: 'pli', senderSsrc: 123, mediaSsrc: 456 },
    { type: 'fir', senderSsrc: 123, mediaSsrc: 789, sequenceNumber: 7 },
  ]);
});

test('SRTCP authenticates clear packets and their E/index bits', () => {
  const plain = buildPictureLossIndication(123, 456, false);
  const receiver = new SrtcpContext(keying);
  const wire = referenceSrtcp(plain, 10, false);
  assert.deepEqual(receiver.unprotect(wire), plain);
  assert.throws(() => receiver.unprotect(wire), hasType('replay'));
  for (const offset of [0, 4, 8, 12, 15, 16]) {
    const altered = Buffer.from(wire);
    altered[offset] ^= 1;
    assert.throws(() => new SrtcpContext(keying).unprotect(altered), hasType('auth_failed'));
  }
});

test('SRTCP rejects encrypted payload/tag tampering and wrong key without accepting feedback', () => {
  const plain = buildFullIntraRequest(123, 456, 5);
  const wire = new SrtcpContext(keying).protect(plain, 123);
  for (const offset of [8, 12, wire.length - 5, wire.length - 1]) {
    const altered = new Uint8Array(wire);
    altered[offset] ^= 0x40;
    assert.throws(() => new SrtcpContext(keying).unprotect(altered), hasType('auth_failed'));
  }
  assert.throws(() => new SrtcpContext(otherKeying).unprotect(wire), hasType('auth_failed'));
});

test('SRTCP authenticates and validates compound lengths before committing replay state', () => {
  const receiver = new SrtcpContext(keying);
  const plain = buildPictureLossIndication(123, 456);
  const malformed = new Uint8Array(plain);
  malformed[3] = 8;
  assert.throws(() => receiver.unprotect(referenceSrtcp(malformed, 50)), /Truncated RTCP/);
  assert.deepEqual(receiver.unprotect(referenceSrtcp(plain, 50)), plain);
  assert.throws(() => receiver.unprotect(referenceSrtcp(plain, 50)), hasType('replay'));
});

test('SRTCP replay windows are independent per SSRC and allow late packets only once', () => {
  const receiver = new SrtcpContext(keying);
  const a = buildPictureLossIndication(1, 50);
  const b = buildPictureLossIndication(2, 50);
  receiver.unprotect(referenceSrtcp(a, 100));
  receiver.unprotect(referenceSrtcp(a, 99));
  receiver.unprotect(referenceSrtcp(b, 100));
  assert.throws(() => receiver.unprotect(referenceSrtcp(a, 99)), hasType('replay'));
  assert.throws(() => receiver.unprotect(referenceSrtcp(a, 36)), hasType('replay'));
  receiver.unprotect(referenceSrtcp(a, 37));
  receiver.unprotect(referenceSrtcp(a, 200));
  assert.throws(() => receiver.unprotect(referenceSrtcp(a, 100)), hasType('replay'));
});

test('SRTCP rejects a 33rd SSRC without evicting replay history', () => {
  const receiver = new SrtcpContext(keying);
  for (let ssrc = 1; ssrc <= 32; ssrc += 1) {
    receiver.unprotect(referenceSrtcp(buildPictureLossIndication(ssrc, 99), 1));
  }
  assert.throws(() => receiver.unprotect(referenceSrtcp(buildPictureLossIndication(33, 99), 1)), hasType('context_limit'));
  assert.throws(() => receiver.unprotect(referenceSrtcp(buildPictureLossIndication(1, 99), 1)), hasType('replay'));
  receiver.unprotect(referenceSrtcp(buildPictureLossIndication(1, 99), 2));
});

test('SRTCP unknown sources with bad authentication do not consume context budget', () => {
  const receiver = new SrtcpContext(keying);
  for (let ssrc = 1; ssrc <= 40; ssrc += 1) {
    assert.throws(() => receiver.unprotect(referenceSrtcp(buildPictureLossIndication(ssrc, 99), 1, true, 4, otherKeying)), hasType('auth_failed'));
  }
  receiver.unprotect(referenceSrtcp(buildPictureLossIndication(99, 1), 1));
});

test('SRTCP validates short/aligned packets, sender SSRC, tag length and key lifetime', () => {
  const ctx = new SrtcpContext(keying);
  for (const length of [0, 4, 8, 15]) {
    assert.throws(() => ctx.unprotect(new Uint8Array(length)), hasType('packet_too_short'));
  }
  assert.throws(() => ctx.unprotect(new Uint8Array(17)), hasType('invalid_packet'));
  assert.throws(() => ctx.protect(buildPictureLossIndication(1, 2), 99), hasType('invalid_packet'));
  for (const authLength of [0, 3, 21, 4.5, NaN]) {
    assert.throws(() => new SrtcpContext(keying, authLength), hasType('invalid_packet'));
  }
  ctx.index = 0x7fffffff;
  const receiver = new SrtcpContext(keying);
  receiver.unprotect(ctx.protect(buildPictureLossIndication(1, 2), 1));
  assert.throws(() => ctx.protect(buildPictureLossIndication(1, 2), 1), hasType('index_exhausted'));
});

test('RTCP parses standard and WhatsApp-profile PLI/FIR with multi-entry FIR', () => {
  const standardPli = buildPictureLossIndication(1, 2, false);
  const profileFir = new Uint8Array(28);
  profileFir.set(buildFullIntraRequest(1, 3, 255));
  profileFir[0] = 0x94;
  profileFir[3] = 6;
  profileFir.set(Uint8Array.of(0, 0, 0, 4, 7, 0, 0, 0), 20);
  assert.deepEqual(parseVideoKeyFrameFeedback(Buffer.concat([standardPli, profileFir])), [
    { type: 'pli', senderSsrc: 1, mediaSsrc: 2 },
    { type: 'fir', senderSsrc: 1, mediaSsrc: 3, sequenceNumber: 255 },
    { type: 'fir', senderSsrc: 1, mediaSsrc: 4, sequenceNumber: 7 },
  ]);
});

test('RTCP validates the entire compound before exposing a leading valid feedback entry', () => {
  const pli = buildPictureLossIndication(1, 2);
  for (const trailing of [Uint8Array.of(0x81, 206, 0, 2), Uint8Array.of(0, 206, 0, 0), Uint8Array.of(0x80, 10, 0, 0)]) {
    assert.throws(() => parseVideoKeyFrameFeedback(Buffer.concat([pli, trailing])), /RTCP/);
  }
  for (const bytes of [new Uint8Array(), new Uint8Array(65540), pli.subarray(0, 11)]) {
    assert.throws(() => validateRtcpCompound(bytes), /RTCP/);
  }
  const oversizePli = Buffer.concat([pli, Buffer.alloc(4)]);
  oversizePli[3] = 3;
  assert.throws(() => parseVideoKeyFrameFeedback(oversizePli), /PLI length/);
  const shortFir = new Uint8Array(12);
  shortFir.set([0x84, 206, 0, 2]);
  assert.throws(() => parseVideoKeyFrameFeedback(shortFir), /FIR length/);
});

test('RTCP ignores unrelated feedback and accepts valid padding only on the final packet', () => {
  const unrelated = buildPictureLossIndication(1, 2, false);
  unrelated[1] = 205;
  assert.deepEqual(parseVideoKeyFrameFeedback(unrelated), []);
  const padded = Buffer.concat([buildPictureLossIndication(1, 2, false), Buffer.from([0, 0, 0, 4])]);
  padded[0] |= 0x20;
  padded[3] = 3;
  assert.equal(parseVideoKeyFrameFeedback(padded).length, 1);
  assert.throws(() => parseVideoKeyFrameFeedback(Buffer.concat([padded, unrelated])), /padding/);
  for (const padding of [0, 16, 255]) {
    const invalid = Buffer.from(padded);
    invalid[15] = padding;
    assert.throws(() => parseVideoKeyFrameFeedback(invalid), /padding/);
  }
});
