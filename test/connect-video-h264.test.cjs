'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { before, test } = require('node:test');

let H264Depacketizer;
let packetizeH264AnnexB;
let packetizeWhatsAppH264AccessUnit;
before(async () => {
  ({ H264Depacketizer, packetizeH264AnnexB, packetizeWhatsAppH264AccessUnit } = await import(pathToFileURL(path.resolve(
    __dirname, '../src/api/integrations/channel/whatsapp/voip/engine/media/h264.js',
  ))));
});

const START = [0, 0, 0, 1];
const bytes = (...values) => new Uint8Array(values.flat());
const annexB = (...nals) => bytes(...nals.flatMap((nal) => [...START, ...nal]));
const MAX_BYTES = 8 * 1024 * 1024;
const largeNal = (length, header = 0x65) => {
  const nal = new Uint8Array(length).fill(0x55);
  nal[0] = header;
  return nal;
};
function receive(packets, timestamp = 9000, sequence = 1) {
  const depacketizer = new H264Depacketizer();
  return packets.flatMap((packet, index) => depacketizer.push(
    packet, timestamp, index === packets.length - 1, (sequence + index) & 65535,
  ));
}

test('generic packetization preserves separate Annex-B NALs and both start-code lengths', () => {
  const input = bytes([0, 0, 1, 0x67, 42], [...START, 0x68, 7], [0, 0, 1, 0x65, 8]);
  const packets = packetizeH264AnnexB(input);
  assert.deepEqual(packets, [bytes(0x67, 42), bytes(0x68, 7), bytes(0x65, 8)]);
  assert.deepEqual(receive(packets), [{ timestamp: 9000, keyFrame: true, data: annexB([0x67, 42], [0x68, 7], [0x65, 8]) }]);
});

test('generic FU-A fragmentation reconstructs a NAL and obeys the RTP payload bound', () => {
  const nal = largeNal(4200);
  const packets = packetizeH264AnnexB(nal, 800);
  assert.equal(packets.length, 6);
  assert.ok(packets.every((packet) => packet.length <= 800));
  assert.equal(packets[0][0], 0x7c);
  assert.equal(packets[0][1], 0x85);
  assert.equal(packets.at(-1)[1], 0x45);
  const result = receive(packets);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].data, bytes(START, [...nal]));
  assert.equal(result[0].keyFrame, true);
});

test('WhatsApp packetization packs SPS/PPS/IDR together, omits AUD and trims trailing zero bytes', () => {
  const input = annexB([0x09, 0x10], [0x67, 42, 0], [0x68, 7], [0x65, 8, 9, 0, 0]);
  const packets = packetizeWhatsAppH264AccessUnit(input, 8);
  assert.ok(packets.length > 1);
  assert.equal(packets[0][1], 0x87, 'first fragmented header belongs to SPS, not IDR');
  const [frame] = receive(packets);
  assert.deepEqual(frame.data, annexB([0x67, 42], [0x68, 7], [0x65, 8, 9]));
  assert.equal(frame.keyFrame, true, 'packed IDR behind the SPS/PPS must be recognized');
});

test('small WhatsApp access units remain one payload containing internal Annex-B delimiters', () => {
  const input = annexB([0x67, 42], [0x68, 7], [0x61, 8]);
  const [packet] = packetizeWhatsAppH264AccessUnit(input);
  assert.deepEqual(packet, bytes([0x67, 42], START, [0x68, 7], START, [0x61, 8]));
  assert.equal(receive([packet])[0].keyFrame, false);
  assert.deepEqual(packetizeWhatsAppH264AccessUnit(annexB([0x09, 0x10])), []);
  assert.deepEqual(packetizeH264AnnexB(new Uint8Array()), []);
});

test('packetizers reject invalid limits and prevent unbounded packet or NAL allocations', () => {
  for (const packetizer of [packetizeH264AnnexB, packetizeWhatsAppH264AccessUnit]) {
    for (const limit of [0, 2, 3.5, Infinity, NaN, 65536]) {
      assert.throws(() => packetizer(bytes(0x65, 1), limit), /payload size/);
    }
    assert.throws(() => packetizer(largeNal(MAX_BYTES + 1)), /8 MiB/);
    assert.throws(() => packetizer(largeNal(65538), 3), /too many RTP packets/);
  }
});

test('STAP-A is decoded into one complete access unit', () => {
  const [frame] = receive([bytes(0x78, 0, 2, 0x67, 42, 0, 3, 0x65, 7, 8)]);
  assert.deepEqual(frame.data, annexB([0x67, 42], [0x65, 7, 8]));
  assert.equal(frame.keyFrame, true);
});

test('complete markerless access units flush on a timestamp boundary', () => {
  const depacketizer = new H264Depacketizer();
  assert.deepEqual(depacketizer.push(bytes(0x65, 7), 9000, false, 10), []);
  assert.deepEqual(depacketizer.push(bytes(0x61, 8), 18000, true, 11), [
    { timestamp: 9000, keyFrame: true, data: annexB([0x65, 7]) },
    { timestamp: 18000, keyFrame: false, data: annexB([0x61, 8]) },
  ]);
});

test('lost middle FU-A packet discards the whole access unit, including subsequent NALs', () => {
  const depacketizer = new H264Depacketizer();
  assert.deepEqual(depacketizer.push(bytes(0x67, 42), 9000, false, 9), []);
  assert.deepEqual(depacketizer.push(bytes(0x7c, 0x85, 7), 9000, false, 10), []);
  assert.deepEqual(depacketizer.push(bytes(0x7c, 0x45, 9), 9000, false, 12), []);
  assert.deepEqual(depacketizer.push(bytes(0x61, 10), 9000, true, 13), []);
  assert.deepEqual(depacketizer.push(bytes(0x65, 11), 18000, true, 14), [
    { timestamp: 18000, keyFrame: true, data: annexB([0x65, 11]) },
  ]);
});

test('a reordered FU-A cannot be emitted as a corrupt frame when its missing packet arrives late', () => {
  const depacketizer = new H264Depacketizer();
  assert.deepEqual(depacketizer.push(bytes(0x7c, 0x85, 7), 9000, false, 100), []);
  assert.deepEqual(depacketizer.push(bytes(0x7c, 0x45, 9), 9000, true, 102), []);
  assert.deepEqual(depacketizer.push(bytes(0x7c, 0x05, 8), 9000, false, 101), []);
  const next = depacketizer.push(bytes(0x65, 10), 18000, true, 103);
  assert.equal(next.length, 1);
  assert.equal(next[0].timestamp, 18000);
});

test('duplicate RTP fragments are ignored and sequence rollover is contiguous', () => {
  const depacketizer = new H264Depacketizer();
  const start = bytes(0x7c, 0x85, 7);
  assert.deepEqual(depacketizer.push(start, 9000, false, 65535), []);
  assert.deepEqual(depacketizer.push(start, 9000, false, 65535), []);
  const [frame] = depacketizer.push(bytes(0x7c, 0x45, 8), 9000, true, 0);
  assert.deepEqual(frame.data, annexB([0x65, 7, 8]));
  assert.deepEqual(depacketizer.push(bytes(0x7c, 0x45, 8), 9000, true, 0), []);
});

test('late packets from an older timestamp cannot flush or corrupt a newer access unit', () => {
  const depacketizer = new H264Depacketizer();
  depacketizer.push(bytes(0x65, 1), 9000, true, 10);
  assert.deepEqual(depacketizer.push(bytes(0x7c, 0x85, 2), 18000, false, 11), []);
  assert.deepEqual(depacketizer.push(bytes(0x65, 99), 9000, true, 10), []);
  const [frame] = depacketizer.push(bytes(0x7c, 0x45, 3), 18000, true, 12);
  assert.deepEqual(frame.data, annexB([0x65, 2, 3]));
});

test('timestamp rollover retains markerless frame boundaries', () => {
  const depacketizer = new H264Depacketizer();
  depacketizer.push(bytes(0x65, 1), 0xffffff00, false, 10);
  const frames = depacketizer.push(bytes(0x61, 2), 0x100, true, 11);
  assert.deepEqual(frames.map((frame) => frame.timestamp), [0xffffff00, 0x100]);
});

test('loss at a timestamp boundary cannot flush the previous partial access unit', () => {
  const depacketizer = new H264Depacketizer();
  depacketizer.push(bytes(0x67, 1), 9000, false, 10);
  assert.deepEqual(depacketizer.push(bytes(0x65, 2), 18000, true, 12), []);
  assert.equal(depacketizer.push(bytes(0x65, 3), 27000, true, 13).length, 1);
});

test('an incomplete markerless FU-A is dropped at the next timestamp', () => {
  const depacketizer = new H264Depacketizer();
  depacketizer.push(bytes(0x67, 1), 9000, false, 10);
  depacketizer.push(bytes(0x7c, 0x85, 2), 9000, false, 11);
  const frames = depacketizer.push(bytes(0x65, 3), 18000, true, 12);
  assert.deepEqual(frames.map((frame) => frame.timestamp), [18000]);
});

test('invalid FU-A headers and incomplete fragments discard earlier complete NALs too', () => {
  const invalid = [
    bytes(0x7c, 0x45, 9), // end without start
    bytes(0x7c, 0xc5, 9), // start and end together
    bytes(0x7c, 0xa5, 9), // reserved bit
    bytes(0x7c, 0x98, 9), // nested STAP-A
    bytes(0x7c, 0x85), // empty fragment
    bytes(0xfc, 0x85, 9), // forbidden bit
    bytes(0x7c, 0x85, 9), // marker before end
  ];
  for (const packet of invalid) {
    const depacketizer = new H264Depacketizer();
    depacketizer.push(bytes(0x67, 1), 9000, false, 1);
    assert.deepEqual(depacketizer.push(packet, 9000, true, 2), []);
    assert.deepEqual(depacketizer.push(bytes(0x65, 10), 9000, true, 3), []);
  }
});

test('FU-A header mismatch or a second start discards the complete access unit', () => {
  for (const second of [bytes(0x5c, 0x45, 8), bytes(0x7c, 0x41, 8), bytes(0x7c, 0x85, 8)]) {
    const depacketizer = new H264Depacketizer();
    depacketizer.push(bytes(0x7c, 0x85, 7), 9000, false, 1);
    assert.deepEqual(depacketizer.push(second, 9000, false, 2), []);
    assert.deepEqual(depacketizer.push(bytes(0x7c, 0x45, 9), 9000, true, 3), []);
  }
});

test('malformed STAP-A never emits its valid prefix or a later suffix', () => {
  const malformed = [
    bytes(0x78, 0, 2, 0x65, 7, 0),
    bytes(0x78, 0, 2, 0x65, 7, 0, 0),
    bytes(0x78, 0, 2, 0x65, 7, 0, 4, 0x61),
    bytes(0x78, 0, 2, 0x65, 7, 0, 1, 0x78),
    bytes(0x78),
  ];
  for (const packet of malformed) {
    const depacketizer = new H264Depacketizer();
    assert.deepEqual(depacketizer.push(packet, 9000, true, 1), []);
    assert.deepEqual(depacketizer.push(bytes(0x65, 8), 9000, true, 2), []);
  }
});

test('the 8 MiB limit includes Annex-B start codes and retains no overflow suffix', () => {
  const depacketizer = new H264Depacketizer();
  const [frame] = depacketizer.push(largeNal(MAX_BYTES - 4), 9000, true, 1);
  assert.equal(frame.data.length, MAX_BYTES);
  assert.deepEqual(depacketizer.push(largeNal(MAX_BYTES - 3), 18000, false, 2), []);
  assert.deepEqual(depacketizer.push(bytes(0x65, 1), 18000, true, 3), []);
  assert.equal(depacketizer.push(bytes(0x65, 2), 27000, true, 4).length, 1);
});

test('STAP-A crossing the frame limit discards the whole aggregate, not just its overflowing NAL', () => {
  const depacketizer = new H264Depacketizer();
  depacketizer.push(largeNal(MAX_BYTES - 10, 0x61), 9000, false, 1);
  assert.deepEqual(depacketizer.push(bytes(0x78, 0, 2, 0x61, 1, 0, 2, 0x65, 2), 9000, true, 2), []);
  assert.deepEqual(depacketizer.push(bytes(0x65, 3), 9000, true, 3), []);
  assert.equal(depacketizer.bufferedBytes, 0);
  assert.equal(depacketizer.parts.length, 0);
  assert.equal(depacketizer.push(bytes(0x65, 4), 18000, true, 4).length, 1);
});

test('FU-A overflow cannot emit a partial frame and releases all fragment buffers', () => {
  const depacketizer = new H264Depacketizer();
  const oversized = new Uint8Array(MAX_BYTES).fill(7);
  oversized.set([0x7c, 0x85]);
  assert.deepEqual(depacketizer.push(oversized, 9000, false, 1), []);
  assert.deepEqual(depacketizer.push(bytes(0x7c, 0x45, 8), 9000, true, 2), []);
  assert.equal(depacketizer.bufferedBytes, 0);
  assert.equal(depacketizer.fuParts.length, 0);
  assert.equal(depacketizer.push(bytes(0x65, 9), 18000, true, 3).length, 1);
});

test('reset/dispose release incomplete frames and sequence history for a new stream', () => {
  const depacketizer = new H264Depacketizer();
  depacketizer.push(bytes(0x7c, 0x85, 7), 9000, false, 500);
  depacketizer.reset();
  assert.equal(depacketizer.push(bytes(0x65, 8), 1, true, 1).length, 1);
  depacketizer.push(bytes(0x7c, 0x85, 9), 2, false, 2);
  depacketizer.dispose();
  assert.equal(depacketizer.bufferedBytes, 0);
  assert.equal(depacketizer.fuParts.length, 0);
  assert.equal(depacketizer.parts.length, 0);
  assert.equal(depacketizer.push(bytes(0x65, 10), 1, true).length, 1);
});

test('invalid RTP sequence values are rejected instead of bypassing fragment continuity', () => {
  for (const sequence of [-1, 65536, NaN, 1.5]) {
    const depacketizer = new H264Depacketizer();
    depacketizer.push(bytes(0x7c, 0x85, 7), 9000, false, 1);
    assert.deepEqual(depacketizer.push(bytes(0x7c, 0x45, 8), 9000, true, sequence), []);
  }
});
