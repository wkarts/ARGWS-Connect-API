export type ProtoWireType = 0 | 1 | 2 | 5;

export type ProtoField = {
  no: number;
  wire: ProtoWireType;
  value: bigint | Buffer;
};

export function concat(...parts: Array<Buffer | Uint8Array>): Buffer {
  return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

export function varint(value: number | bigint): Buffer {
  let current = typeof value === 'bigint' ? value : BigInt(value);
  if (current < 0n) current = BigInt.asUintN(64, current);
  const out: number[] = [];
  do {
    let byte = Number(current & 0x7fn);
    current >>= 7n;
    if (current !== 0n) byte |= 0x80;
    out.push(byte);
  } while (current !== 0n);
  return Buffer.from(out);
}

export function key(field: number, wire: ProtoWireType): Buffer {
  return varint((field << 3) | wire);
}

export function fieldVarint(field: number, value: number | bigint | boolean): Buffer {
  return concat(key(field, 0), varint(typeof value === 'boolean' ? (value ? 1 : 0) : value));
}

export function fieldFixed64(field: number, value: number | bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt.asUintN(64, BigInt(value)));
  return concat(key(field, 1), out);
}

export function fieldFixed32(field: number, value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return concat(key(field, 5), out);
}

export function fieldSFixed32(field: number, value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeInt32LE(value | 0);
  return concat(key(field, 5), out);
}

export function fieldFloat(field: number, value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeFloatLE(value);
  return concat(key(field, 5), out);
}

export function fieldBytes(field: number, value: Buffer | Uint8Array): Buffer {
  const data = Buffer.from(value);
  return concat(key(field, 2), varint(data.length), data);
}

export function fieldString(field: number, value: string): Buffer {
  return fieldBytes(field, Buffer.from(value, 'utf8'));
}

export function fieldMessage(field: number, value: Buffer): Buffer {
  return fieldBytes(field, value);
}

export function readVarint(buffer: Buffer, offset = 0): { value: bigint; offset: number } {
  let value = 0n;
  let shift = 0n;
  let cursor = offset;
  while (cursor < buffer.length) {
    const byte = buffer[cursor++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset: cursor };
    shift += 7n;
    if (shift > 70n) throw new Error('Invalid protobuf varint');
  }
  throw new Error('Unexpected protobuf EOF');
}

export function parseFields(buffer: Buffer): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const no = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n) as ProtoWireType;
    if (wire === 0) {
      const result = readVarint(buffer, offset);
      fields.push({ no, wire, value: result.value });
      offset = result.offset;
    } else if (wire === 1) {
      if (offset + 8 > buffer.length) throw new Error('Invalid fixed64 protobuf field');
      fields.push({ no, wire, value: buffer.subarray(offset, offset + 8) });
      offset += 8;
    } else if (wire === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const size = Number(length.value);
      if (offset + size > buffer.length) throw new Error('Invalid length-delimited protobuf field');
      fields.push({ no, wire, value: buffer.subarray(offset, offset + size) });
      offset += size;
    } else if (wire === 5) {
      if (offset + 4 > buffer.length) throw new Error('Invalid fixed32 protobuf field');
      fields.push({ no, wire, value: buffer.subarray(offset, offset + 4) });
      offset += 4;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
  }
  return fields;
}

export function fields(buffer: Buffer, no: number): ProtoField[] {
  return parseFields(buffer).filter((field) => field.no === no);
}

export function bytes(buffer: Buffer, no: number): Buffer | undefined {
  const field = fields(buffer, no).find((item) => item.wire === 2);
  return field?.value as Buffer | undefined;
}

export function repeatedBytes(buffer: Buffer, no: number): Buffer[] {
  return fields(buffer, no)
    .filter((item) => item.wire === 2)
    .map((item) => item.value as Buffer);
}

export function string(buffer: Buffer, no: number): string | undefined {
  return bytes(buffer, no)?.toString('utf8');
}

export function int(buffer: Buffer, no: number): bigint | undefined {
  const field = fields(buffer, no).find((item) => item.wire === 0);
  return field?.value as bigint | undefined;
}

export function bool(buffer: Buffer, no: number): boolean {
  return (int(buffer, no) ?? 0n) !== 0n;
}

export function sfixed32(buffer: Buffer, no: number): number | undefined {
  const field = fields(buffer, no).find((item) => item.wire === 5);
  return field ? (field.value as Buffer).readInt32LE(0) : undefined;
}

export function float32(buffer: Buffer, no: number): number | undefined {
  const field = fields(buffer, no).find((item) => item.wire === 5);
  return field ? (field.value as Buffer).readFloatLE(0) : undefined;
}

export function fixed64(buffer: Buffer, no: number): bigint | undefined {
  const field = fields(buffer, no).find((item) => item.wire === 1);
  return field ? (field.value as Buffer).readBigUInt64LE(0) : undefined;
}
