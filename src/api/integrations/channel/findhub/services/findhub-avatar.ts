import { inflateSync } from 'zlib';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PREFIX = 'data:image/png;base64,';
const MAX_BYTES = 128 * 1024;
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Accept a bounded raster only; remove metadata. Never fetch a caller-supplied URL. */
export function normalizeFindHubAvatar(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.startsWith(PREFIX) || value.length > 174786)
    throw new Error('Envie um avatar PNG de até 256 × 256 pixels e 128 KiB, ou null para remover.');
  const encoded = value.slice(PREFIX.length);
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.length > MAX_BYTES ||
    bytes.length < 57 ||
    bytes.toString('base64') !== encoded ||
    !bytes.subarray(0, 8).equals(SIGNATURE)
  )
    throw new Error('Avatar PNG inválido.');
  let offset = 8;
  let expected = 0;
  let rowSize = 0;
  let ended = false;
  let dataEnded = false;
  const chunks: Buffer[] = [SIGNATURE];
  const compressed: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error('Avatar PNG truncado.');
    const length = bytes.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > bytes.length) throw new Error('Avatar PNG truncado.');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4))
      throw new Error('Integridade do avatar PNG inválida.');
    const payload = bytes.subarray(offset + 8, end - 4);
    if (offset === 8 && type !== 'IHDR') throw new Error('Cabeçalho PNG ausente.');
    if (type === 'IHDR') {
      if (offset !== 8 || length !== 13) throw new Error('Cabeçalho PNG inválido.');
      const width = payload.readUInt32BE(0),
        height = payload.readUInt32BE(4),
        color = payload[9];
      if (
        !width ||
        !height ||
        width > 256 ||
        height > 256 ||
        payload[8] !== 8 ||
        ![2, 6].includes(color) ||
        payload[10] ||
        payload[11] ||
        payload[12]
      )
        throw new Error('Use um avatar PNG RGB/RGBA não entrelaçado de até 256 × 256 pixels.');
      rowSize = 1 + width * (color === 6 ? 4 : 3);
      expected = rowSize * height;
      chunks.push(bytes.subarray(offset, end));
    } else if (type === 'IDAT') {
      if (dataEnded || !expected) throw new Error('Ordem PNG inválida.');
      compressed.push(payload);
      chunks.push(bytes.subarray(offset, end));
    } else if (type === 'IEND') {
      if (length || !compressed.length || end !== bytes.length) throw new Error('Final PNG inválido.');
      chunks.push(bytes.subarray(offset, end));
      ended = true;
    } else {
      if (type[0] === type[0].toUpperCase()) throw new Error('Formato PNG não suportado.');
      if (compressed.length) dataEnded = true;
    }
    offset = end;
  }
  if (!ended) throw new Error('Final PNG ausente.');
  let pixels: Buffer;
  try {
    pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  } catch {
    throw new Error('Dados do avatar PNG inválidos.');
  }
  if (pixels.length !== expected) throw new Error('Dimensões PNG inconsistentes.');
  for (let row = 0; row < pixels.length; row += rowSize) {
    if (pixels[row] > 4) throw new Error('Filtro PNG inválido.');
  }
  return PREFIX + Buffer.concat(chunks).toString('base64');
}
