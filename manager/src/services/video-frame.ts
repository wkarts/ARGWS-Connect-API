export const VIDEO_HEADER_BYTES = 16
export const VIDEO_MAX_FRAME_BYTES = 8 * 1024 * 1024

export type VideoAccessUnit = { data: Uint8Array; timestampUs: number; keyFrame: boolean }

// RFC 6381 avc1.PPCCLL comes from the SPS profile/compatibility/level bytes.
// H.264 Annex-B may carry multiple NAL units and either start-code length.
export function h264DecoderCodec(data: Uint8Array): string | null {
  let spsStart = -1
  let selected: string | null = null
  const inspect = (end: number) => {
    if (spsStart < 0) return
    if (end - spsStart < 4) throw new Error('SPS de vídeo incompleto.')
    const codec = `avc1.${[data[spsStart + 1], data[spsStart + 2], data[spsStart + 3]].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()}`
    if (selected && selected !== codec) throw new Error('Perfis H.264 incompatíveis no mesmo quadro.')
    selected = codec
  }
  for (let index = 0; index + 3 < data.length; index += 1) {
    if (data[index] !== 0 || data[index + 1] !== 0) continue
    const prefix = data[index + 2] === 1 ? 3 : data[index + 2] === 0 && data[index + 3] === 1 ? 4 : 0
    if (!prefix) continue
    inspect(index)
    const nal = index + prefix
    spsStart = nal < data.length && (data[nal] & 0x1f) === 7 ? nal : -1
    index = nal - 1
  }
  inspect(data.length)
  return selected
}

export function encodeVideoFrame(frame: VideoAccessUnit, maxBytes = VIDEO_MAX_FRAME_BYTES): ArrayBuffer {
  if (!frame.data.byteLength || frame.data.byteLength > maxBytes || !Number.isSafeInteger(frame.timestampUs) || frame.timestampUs < 0) {
    throw new Error('Quadro de vídeo inválido.')
  }
  const packet = new ArrayBuffer(VIDEO_HEADER_BYTES + frame.data.byteLength)
  const view = new DataView(packet)
  view.setUint16(0, 0x4356)
  view.setUint8(2, 1)
  view.setUint8(3, frame.keyFrame ? 1 : 0)
  view.setBigUint64(4, BigInt(frame.timestampUs))
  view.setUint32(12, frame.data.byteLength)
  new Uint8Array(packet, VIDEO_HEADER_BYTES).set(frame.data)
  return packet
}

export function decodeVideoFrame(packet: ArrayBuffer, maxBytes = VIDEO_MAX_FRAME_BYTES): VideoAccessUnit {
  if (packet.byteLength <= VIDEO_HEADER_BYTES || packet.byteLength > maxBytes + VIDEO_HEADER_BYTES) {
    throw new Error('Tamanho do quadro de vídeo inválido.')
  }
  const view = new DataView(packet)
  if (view.getUint16(0) !== 0x4356 || view.getUint8(2) !== 1 || (view.getUint8(3) & ~1) !== 0) {
    throw new Error('Formato do quadro de vídeo inválido.')
  }
  const length = view.getUint32(12)
  const timestampUs = Number(view.getBigUint64(4))
  if (length !== packet.byteLength - VIDEO_HEADER_BYTES || !Number.isSafeInteger(timestampUs)) {
    throw new Error('Cabeçalho do quadro de vídeo inválido.')
  }
  return { data: new Uint8Array(packet, VIDEO_HEADER_BYTES), timestampUs, keyFrame: Boolean(view.getUint8(3) & 1) }
}
