export const VIDEO_FRAME_HEADER_BYTES = 16;
export const VIDEO_MAX_FRAME_BYTES = 8 * 1024 * 1024;

export type VideoFrame = {
  timestampUs: number;
  keyFrame: boolean;
  data: Uint8Array;
};

/** Validate Annex-B access units without decoding or retaining camera content. */
export function inspectAnnexB(data: Uint8Array): { keyFrame: boolean } {
  const prefixLength = (offset: number) => {
    if (data[offset] !== 0 || data[offset + 1] !== 0) return 0;
    if (data[offset + 2] === 1) return 3;
    if (data[offset + 2] === 0 && data[offset + 3] === 1) return 4;
    return 0;
  };
  if (data.length < 5 || !prefixLength(0)) throw new Error('Invalid Annex-B access unit');
  let keyFrame = false;
  let offset = 0;
  let nalCount = 0;
  while (offset < data.length) {
    const start = offset + prefixLength(offset);
    if (start >= data.length || ++nalCount > 1024) throw new Error('Invalid Annex-B NAL unit');
    const header = data[start];
    const type = header & 0x1f;
    if (header & 0x80 || type === 0 || type > 23) throw new Error('Invalid H.264 NAL unit');
    if (type === 5) keyFrame = true;
    offset = start + 1;
    while (offset < data.length && !prefixLength(offset)) offset++;
  }
  return { keyFrame };
}

export function encodeVideoFrame(frame: VideoFrame, maxFrameBytes = VIDEO_MAX_FRAME_BYTES): Buffer {
  const { data, timestampUs, keyFrame } = frame;
  if (!Number.isSafeInteger(timestampUs) || timestampUs < 0) throw new Error('Invalid video timestamp');
  if (!data.byteLength || data.byteLength > maxFrameBytes) throw new Error('Invalid video frame size');
  if (inspectAnnexB(data).keyFrame !== keyFrame) throw new Error('Invalid video keyframe flag');
  const packet = Buffer.allocUnsafe(VIDEO_FRAME_HEADER_BYTES + data.byteLength);
  packet[0] = 0x43;
  packet[1] = 0x56;
  packet[2] = 1;
  packet[3] = keyFrame ? 1 : 0;
  packet.writeBigUInt64BE(BigInt(timestampUs), 4);
  packet.writeUInt32BE(data.byteLength, 12);
  packet.set(data, VIDEO_FRAME_HEADER_BYTES);
  return packet;
}

export function decodeVideoFrame(packet: Buffer, maxFrameBytes = VIDEO_MAX_FRAME_BYTES): VideoFrame {
  if (packet.length < VIDEO_FRAME_HEADER_BYTES) throw new Error('Incomplete video frame header');
  if (packet[0] !== 0x43 || packet[1] !== 0x56 || packet[2] !== 1 || packet[3] & ~1) {
    throw new Error('Unsupported video frame');
  }
  const size = packet.readUInt32BE(12);
  if (!size || size > maxFrameBytes || size !== packet.length - VIDEO_FRAME_HEADER_BYTES) {
    throw new Error('Invalid video frame size');
  }
  const timestamp = packet.readBigUInt64BE(4);
  if (timestamp > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid video timestamp');
  const data = packet.subarray(VIDEO_FRAME_HEADER_BYTES);
  const keyFrame = (packet[3] & 1) !== 0;
  if (inspectAnnexB(data).keyFrame !== keyFrame) throw new Error('Invalid video keyframe flag');
  return { timestampUs: Number(timestamp), keyFrame, data };
}
