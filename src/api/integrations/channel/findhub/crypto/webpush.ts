import { createDecipheriv, createECDH, hkdfSync } from 'crypto';

function b64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function uint16(value: number): Buffer {
  const output = Buffer.alloc(2);
  output.writeUInt16BE(value);
  return output;
}

export function decryptLegacyWebPush(args: {
  privateKey: Buffer;
  publicKey: Buffer;
  authSecret: Buffer;
  senderPublicKey: Buffer;
  salt: Buffer;
  payload: Buffer;
}): Buffer {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(args.privateKey);
  const shared = ecdh.computeSecret(args.senderPublicKey);
  const authInfo = Buffer.from('Content-Encoding: auth\0');
  const prk = Buffer.from(hkdfSync('sha256', shared, args.authSecret, authInfo, 32));
  const context = Buffer.concat([
    Buffer.from('P-256\0'),
    uint16(args.publicKey.length),
    args.publicKey,
    uint16(args.senderPublicKey.length),
    args.senderPublicKey,
  ]);
  const keyInfo = Buffer.concat([Buffer.from('Content-Encoding: aesgcm\0'), context]);
  const nonceInfo = Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), context]);
  const key = Buffer.from(hkdfSync('sha256', prk, args.salt, keyInfo, 16));
  const nonce = Buffer.from(hkdfSync('sha256', prk, args.salt, nonceInfo, 12));
  if (args.payload.length < 16) throw new Error('Invalid WebPush payload');
  const ciphertext = args.payload.subarray(0, -16);
  const tag = args.payload.subarray(-16);
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const decoded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (decoded.length < 2) return decoded;
  const padding = decoded.readUInt16BE(0);
  return decoded.subarray(2 + padding);
}

export function webPushParams(appData: Record<string, string>): { senderPublicKey: Buffer; salt: Buffer } {
  const keyHeader = appData['crypto-key'] || appData['Crypto-Key'] || '';
  const encryption = appData.encryption || appData.Encryption || '';
  const dh = /(?:^|;)\s*dh=([^;]+)/i.exec(keyHeader)?.[1];
  const salt = /(?:^|;)\s*salt=([^;]+)/i.exec(encryption)?.[1];
  if (!dh || !salt) throw new Error('Missing WebPush encryption headers');
  return { senderPublicKey: b64url(dh), salt: b64url(salt) };
}
