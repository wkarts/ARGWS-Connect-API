import {
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  hkdfSync,
} from 'crypto';

import { decodePlainLocation, EncryptedLocationReport } from '../protocol/findhub-proto';

function aesGcmDecrypt(key: Buffer, value: Buffer, aad?: Buffer, ivLength = 12): Buffer {
  if (value.length < ivLength + 16) throw new Error('Invalid AES-GCM payload');
  const iv = value.subarray(0, ivLength);
  const body = value.subarray(ivLength, -16);
  const tag = value.subarray(-16);
  const cipherName = key.length === 16 ? 'aes-128-gcm' : key.length === 24 ? 'aes-192-gcm' : 'aes-256-gcm';
  const decipher = createDecipheriv(cipherName, key, iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

function aesCbcDecryptNoPadding(key: Buffer, value: Buffer): Buffer {
  const iv = value.subarray(0, 16);
  const body = value.subarray(16);
  const decipher = createDecipheriv(`aes-${key.length * 8}-cbc`, key, iv);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export function decryptOwnerKey(sharedKey: Buffer, encryptedOwnerKey: Buffer): Buffer {
  return aesGcmDecrypt(sharedKey, encryptedOwnerKey);
}

export function decryptIdentityKey(ownerKey: Buffer, encryptedIdentityKey: Buffer): Buffer {
  if (encryptedIdentityKey.length === 48) return aesCbcDecryptNoPadding(ownerKey, encryptedIdentityKey);
  if (encryptedIdentityKey.length === 60) return aesGcmDecrypt(ownerKey, encryptedIdentityKey);
  throw new Error(`Unsupported encrypted identity-key length: ${encryptedIdentityKey.length}`);
}

function aesEcb(key: Buffer, input: Buffer): Buffer {
  const cipher = createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(input), cipher.final()]);
}

const SECP160R1_ORDER = BigInt('0x0100000000000000000001F4C8F927AED3CA752257');
const ROTATION_BITS = 10;

function scalarFor(identityKey: Buffer, timestamp: number): Buffer {
  const masked = timestamp & ~((1 << ROTATION_BITS) - 1);
  const ts = Buffer.alloc(4);
  ts.writeUInt32BE(masked >>> 0);
  const structure = Buffer.alloc(32);
  structure.fill(0xff, 0, 11);
  structure[11] = ROTATION_BITS;
  ts.copy(structure, 12);
  structure.fill(0, 16, 27);
  structure[27] = ROTATION_BITS;
  ts.copy(structure, 28);
  const projected = BigInt(`0x${aesEcb(identityKey, structure).toString('hex')}`) % SECP160R1_ORDER;
  return Buffer.from(projected.toString(16).padStart(40, '0'), 'hex');
}

function subkey(key: Buffer): Buffer {
  const block = aesEcb(key, Buffer.alloc(16));
  const shifted = Buffer.alloc(16);
  let carry = 0;
  for (let index = 15; index >= 0; index--) {
    const next = block[index];
    shifted[index] = ((next << 1) & 0xff) | carry;
    carry = (next & 0x80) ? 1 : 0;
  }
  if (block[0] & 0x80) shifted[15] ^= 0x87;
  return shifted;
}

function xor(left: Buffer, right: Buffer): Buffer {
  const output = Buffer.alloc(left.length);
  for (let index = 0; index < left.length; index++) output[index] = left[index] ^ right[index];
  return output;
}

function cmac(key: Buffer, data: Buffer): Buffer {
  const k1 = subkey(key);
  const k2 = subkey(k1);
  const complete = data.length !== 0 && data.length % 16 === 0;
  const blocks = Math.max(1, Math.ceil(data.length / 16));
  let last: Buffer;
  if (complete) {
    last = xor(data.subarray((blocks - 1) * 16, blocks * 16), k1);
  } else {
    const partial = data.subarray((blocks - 1) * 16);
    const padded = Buffer.alloc(16);
    partial.copy(padded);
    padded[partial.length] = 0x80;
    last = xor(padded, k2);
  }
  let state: Buffer = Buffer.alloc(16);
  for (let index = 0; index < blocks - 1; index++) {
    state = aesEcb(key, xor(state, data.subarray(index * 16, (index + 1) * 16)));
  }
  return aesEcb(key, xor(state, last));
}

function eaxOmac(key: Buffer, domain: number, value: Buffer): Buffer {
  const prefix = Buffer.alloc(16);
  prefix[15] = domain;
  return cmac(key, Buffer.concat([prefix, value]));
}

function incrementCounter(counter: Buffer): void {
  for (let index = counter.length - 1; index >= 0; index--) {
    counter[index] = (counter[index] + 1) & 0xff;
    if (counter[index] !== 0) break;
  }
}

function aesCtrCrypt(key: Buffer, initialCounter: Buffer, input: Buffer): Buffer {
  const result = Buffer.alloc(input.length);
  const counter = Buffer.from(initialCounter);
  for (let offset = 0; offset < input.length; offset += 16) {
    const stream = aesEcb(key, counter);
    const end = Math.min(input.length, offset + 16);
    for (let index = offset; index < end; index++) result[index] = input[index] ^ stream[index - offset];
    incrementCounter(counter);
  }
  return result;
}

function decryptAesEax(key: Buffer, nonce: Buffer, ciphertextAndTag: Buffer): Buffer {
  if (ciphertextAndTag.length < 16) throw new Error('Invalid AES-EAX payload');
  const ciphertext = ciphertextAndTag.subarray(0, -16);
  const tag = ciphertextAndTag.subarray(-16);
  const nonceTag = eaxOmac(key, 0, nonce);
  const headerTag = eaxOmac(key, 1, Buffer.alloc(0));
  const messageTag = eaxOmac(key, 2, ciphertext);
  const expected = xor(xor(nonceTag, headerTag), messageTag);
  if (expected.length !== tag.length || !expected.equals(tag)) throw new Error('Find Hub AES-EAX authentication failed');
  return aesCtrCrypt(key, nonceTag, ciphertext);
}

function foreignDecrypt(identityKey: Buffer, report: EncryptedLocationReport): Buffer {
  const timestamp = Math.max(0, report.timestampSeconds - report.deviceTimeOffset);
  const r = scalarFor(identityKey, timestamp);
  const local = createECDH('secp160r1');
  local.setPrivateKey(r);
  const rPublic = local.getPublicKey(undefined, 'uncompressed');
  const rX = rPublic.subarray(1, 21);
  if (report.publicKeyRandom.length !== 20) throw new Error('Invalid Find Hub public-key random value');
  const remoteCompressed = Buffer.concat([Buffer.from([0x02]), report.publicKeyRandom]);
  const shared = local.computeSecret(remoteCompressed);
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.alloc(0), 32));
  const nonce = Buffer.concat([rX.subarray(12), report.publicKeyRandom.subarray(12)]);
  return decryptAesEax(key, nonce, report.encryptedLocation);
}

export function decryptLocationReport(identityKey: Buffer, report: EncryptedLocationReport) {
  if (!report.encryptedLocation.length) return null;
  let plain: Buffer;
  if (report.ownReport || report.publicKeyRandom.length === 0) {
    const hash = createHash('sha256').update(identityKey).digest();
    plain = aesGcmDecrypt(hash, report.encryptedLocation);
  } else {
    plain = foreignDecrypt(identityKey, report);
  }
  return decodePlainLocation(plain);
}
