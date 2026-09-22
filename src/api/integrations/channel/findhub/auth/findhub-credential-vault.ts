import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function keyFromEnvironment(): Buffer {
  const raw = String(process.env.FINDHUB_CREDENTIALS_KEY || '').trim();
  if (!raw) throw new Error('FINDHUB_CREDENTIALS_KEY is required');
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('FINDHUB_CREDENTIALS_KEY must contain exactly 32 bytes');
  return key;
}

export class FindHubCredentialVault {
  private readonly key = keyFromEnvironment();

  public encrypt(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  public decrypt<T>(envelope?: string | null): T | null {
    if (!envelope) return null;
    const [version, iv, tag, payload] = envelope.split('.');
    if (version !== 'v1' || !iv || !tag || !payload) throw new Error('Invalid Find Hub credential envelope');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as T;
  }

  public hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
