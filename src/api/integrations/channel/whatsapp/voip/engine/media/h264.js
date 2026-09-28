// Packetization follows the video transport in vinikjkkj/zapo PR #274 (MIT).
// Bounds and loss handling are maintained by Connect API, independently of the SDK.
const START_CODE = new Uint8Array([0, 0, 0, 1]);
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const MAX_PARTS = 65536;

function startCodeSize(data, offset) {
  if (data[offset] !== 0 || data[offset + 1] !== 0) return 0;
  if (data[offset + 2] === 1) return 3;
  return data[offset + 2] === 0 && data[offset + 3] === 1 ? 4 : 0;
}

function splitAnnexB(data, whatsapp) {
  const nals = [];
  let start = -1;
  const append = (end) => {
    if (whatsapp) while (end > start && data[end - 1] === 0) end--;
    if (end > start && (!whatsapp || (data[start] & 0x1f) !== 9)) nals.push(data.subarray(start, end));
    if (nals.length > MAX_PARTS) throw new Error('H264 access unit contains too many NAL units');
  };
  for (let offset = 0; offset + 2 < data.length; ) {
    const size = startCodeSize(data, offset);
    if (size) {
      if (start !== -1) append(offset);
      start = offset + size;
      offset += size;
    } else offset++;
  }
  if (start !== -1) append(data.length);
  else if (data.length && (!whatsapp || (data[0] & 0x1f) !== 9)) nals.push(data);
  return nals;
}

function validatePacketizer(data, maxPayload) {
  if (!Number.isInteger(maxPayload) || maxPayload < 3 || maxPayload > 65535) {
    throw new Error('H264 RTP payload size must be an integer between 3 and 65535 bytes');
  }
  if (data.length > MAX_BUFFERED_BYTES) throw new Error('H264 access unit exceeds 8 MiB');
}

function packetizeNals(nals, maxPayload) {
  const packets = [];
  for (const nal of nals) {
    const count = nal.length <= maxPayload ? 1 : Math.ceil((nal.length - 1) / (maxPayload - 2));
    if (packets.length + count > MAX_PARTS) throw new Error('H264 access unit requires too many RTP packets');
    if (nal.length <= maxPayload) {
      packets.push(nal.slice());
      continue;
    }
    for (let offset = 1; offset < nal.length; offset += maxPayload - 2) {
      const end = Math.min(nal.length, offset + maxPayload - 2);
      const packet = new Uint8Array(2 + end - offset);
      packet[0] = (nal[0] & 0xe0) | 28;
      packet[1] = (nal[0] & 0x1f) | (offset === 1 ? 0x80 : 0) | (end === nal.length ? 0x40 : 0);
      packet.set(nal.subarray(offset, end), 2);
      packets.push(packet);
    }
  }
  return packets;
}

/** Generic RFC 6184 packetization: one single-NAL or FU-A series for each Annex-B NAL. */
export function packetizeH264AnnexB(data, maxPayload = 1100) {
  validatePacketizer(data, maxPayload);
  return packetizeNals(splitAnnexB(data, false), maxPayload);
}

/** WhatsApp packs SPS/PPS/IDR together before FU-A fragmentation; AUDs are omitted. */
export function packetizeWhatsAppH264AccessUnit(data, maxPayload = 800) {
  validatePacketizer(data, maxPayload);
  const nals = splitAnnexB(data, true);
  if (!nals.length) return [];
  const size = nals.reduce((total, nal, index) => total + nal.length + (index ? 4 : 0), 0);
  if (size > MAX_BUFFERED_BYTES) throw new Error('H264 access unit exceeds 8 MiB');
  const packed = new Uint8Array(size);
  let offset = 0;
  for (const [index, nal] of nals.entries()) {
    if (index) {
      packed.set(START_CODE, offset);
      offset += START_CODE.length;
    }
    packed.set(nal, offset);
    offset += nal.length;
  }
  return packetizeNals([packed], maxPayload);
}

/** Bounded RFC 6184 receiver. Pass the original primary RTP sequence, including for RTX.
 * Missing/reordered fragments discard the whole access unit instead of emitting a suffix.
 * Sequence omission supports legacy senders but cannot detect a missing middle FU-A packet.
 */
export class H264Depacketizer {
  constructor() {
    this.reset();
  }

  reset() {
    this.timestamp = null;
    this.lastSequence = undefined;
    this.resetFrame(null);
  }

  dispose() {
    this.reset();
  }

  resetFrame(timestamp) {
    this.timestamp = timestamp;
    this.parts = [];
    this.fuParts = [];
    this.fuHeader = null;
    this.bufferedBytes = 0;
    this.damaged = false;
    this.closed = false;
  }

  discardFrame() {
    this.parts = [];
    this.fuParts = [];
    this.fuHeader = null;
    this.bufferedBytes = 0;
    this.damaged = true;
  }

  push(payload, timestamp, marker, sequenceNumber) {
    if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffff) return [];
    // A late packet from an older frame must not flush or replace the current one.
    if (this.timestamp !== null && (timestamp - this.timestamp) >>> 0 >= 0x80000000) return [];
    if (
      sequenceNumber !== undefined &&
      (!Number.isInteger(sequenceNumber) || sequenceNumber < 0 || sequenceNumber > 65535)
    ) {
      this.discardFrame();
      return [];
    }
    const delta =
      sequenceNumber === undefined || this.lastSequence === undefined
        ? 1
        : (sequenceNumber - this.lastSequence + 65536) & 65535;
    // Exact duplicates and late packets add no data; a forward gap invalidates the frame below.
    if (delta === 0 || delta >= 32768) return [];
    if (sequenceNumber !== undefined) this.lastSequence = sequenceNumber;
    const completed = [];
    if (this.timestamp !== timestamp) {
      if (delta === 1) {
        const previous = this.flush();
        if (previous) completed.push(previous);
      }
      this.resetFrame(timestamp);
    }
    if (delta !== 1) this.discardFrame();
    if (this.closed || this.damaged) return completed;
    if (!payload.length || (payload[0] & 0x80) !== 0) {
      this.discardFrame();
      return completed;
    }
    const type = payload[0] & 0x1f;
    if (type >= 1 && type <= 23 && !this.fuParts.length) this.appendNal(payload);
    else if (type === 24 && !this.fuParts.length) this.appendStapA(payload);
    else if (type === 28) this.appendFuA(payload);
    else this.discardFrame();

    if (marker) {
      if (this.fuParts.length) this.discardFrame();
      const frame = this.flush();
      if (frame) completed.push(frame);
      this.closed = true;
    }
    return completed;
  }

  reserve(bytes, parts = 1) {
    const retainedParts = this.parts.length + this.fuParts.length + (this.fuParts.length ? 1 : 0);
    if (this.bufferedBytes + bytes > MAX_BUFFERED_BYTES || retainedParts + parts > MAX_PARTS) {
      this.discardFrame();
      return false;
    }
    this.bufferedBytes += bytes;
    return true;
  }

  appendNal(nal) {
    if (this.reserve(START_CODE.length + nal.length, 2)) this.parts.push(START_CODE, nal.slice());
  }

  appendStapA(payload) {
    // Validate the complete aggregate before retaining any NAL from it.
    const nals = [];
    let bytes = 0;
    for (let offset = 1; offset < payload.length; ) {
      if (offset + 2 > payload.length) return this.discardFrame();
      const size = (payload[offset] << 8) | payload[offset + 1];
      offset += 2;
      const type = payload[offset] & 0x1f;
      if (!size || offset + size > payload.length || payload[offset] & 0x80 || type < 1 || type > 23) {
        return this.discardFrame();
      }
      nals.push(payload.subarray(offset, offset + size));
      bytes += START_CODE.length + size;
      if (nals.length * 2 > MAX_PARTS || bytes > MAX_BUFFERED_BYTES) return this.discardFrame();
      offset += size;
    }
    if (!nals.length) return this.discardFrame();
    if (this.reserve(bytes, nals.length * 2)) {
      for (const nal of nals) this.parts.push(START_CODE, nal.slice());
    }
  }

  appendFuA(payload) {
    if (payload.length < 3) return this.discardFrame();
    const header = payload[1];
    const start = (header & 0x80) !== 0;
    const end = (header & 0x40) !== 0;
    const type = header & 0x1f;
    const nalHeader = (payload[0] & 0xe0) | type;
    if (header & 0x20 || type < 1 || type > 23 || (start && end)) return this.discardFrame();
    if (start) {
      if (this.fuParts.length) return this.discardFrame();
      if (!this.reserve(START_CODE.length + payload.length - 1, 3)) return;
      this.fuHeader = nalHeader;
      this.fuParts = [new Uint8Array([nalHeader]), payload.slice(2)];
    } else {
      if (!this.fuParts.length || this.fuHeader !== nalHeader) return this.discardFrame();
      if (!this.reserve(payload.length - 2)) return;
      this.fuParts.push(payload.slice(2));
    }
    if (end) {
      this.parts.push(START_CODE);
      for (const part of this.fuParts) this.parts.push(part);
      this.fuParts = [];
      this.fuHeader = null;
    }
  }

  flush() {
    if (this.timestamp === null || this.closed || this.damaged || this.fuParts.length || !this.parts.length)
      return null;
    const data = new Uint8Array(this.bufferedBytes);
    let offset = 0;
    for (const part of this.parts) {
      data.set(part, offset);
      offset += part.length;
    }
    // WhatsApp may pack the IDR behind SPS/PPS inside the reassembled first NAL.
    let keyFrame = false;
    for (let index = 0; index + 3 < data.length; index++) {
      const size = startCodeSize(data, index);
      if (size && (data[index + size] & 0x1f) === 5) {
        keyFrame = true;
        break;
      }
    }
    const result = { timestamp: this.timestamp, data, keyFrame };
    this.parts = [];
    this.bufferedBytes = 0;
    return result;
  }
}
