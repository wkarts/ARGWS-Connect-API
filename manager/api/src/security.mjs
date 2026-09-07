import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b64url = (value) => Buffer.from(value).toString('base64url');
const fromB64url = (value) => Buffer.from(value, 'base64url').toString('utf8');

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 12) return 'A senha deve possuir pelo menos 12 caracteres.';
  if (value.length > 128) return 'A senha deve possuir no máximo 128 caracteres.';
  const normalized = value.toLowerCase();
  const blocked = new Set([
    '123456789012',
    'password1234',
    'senha12345678',
    'administrador',
    'administrator',
    'connectapi123',
  ]);
  if (blocked.has(normalized)) return 'Escolha uma senha menos previsível.';
  return null;
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, encoded) {
  const [kind, salt, expected] = String(encoded || '').split('$');
  if (kind !== 'scrypt' || !salt || !expected) return false;
  const actual = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

export function signSession(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifySession(token, secret) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(fromB64url(body));
    if (!payload?.exp || Date.now() >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    String(header)
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const index = entry.indexOf('=');
        return index >= 0 ? [decodeURIComponent(entry.slice(0, index)), decodeURIComponent(entry.slice(index + 1))] : [entry, ''];
      }),
  );
}

function cookie(name, value, secure, maxAge) {
  const secureFlag = secure ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureFlag}`;
}

export function sessionCookie(token, secure = true, maxAge = 43200) {
  return cookie('connect_manager_session', token, secure, maxAge);
}

export function clearSessionCookie(secure = true) {
  return cookie('connect_manager_session', '', secure, 0);
}

export function mfaChallengeCookie(token, secure = true, maxAge = 300) {
  return cookie('connect_manager_mfa', token, secure, maxAge);
}

export function clearMfaChallengeCookie(secure = true) {
  return cookie('connect_manager_mfa', '', secure, 0);
}

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const normalized = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

export function totpUri(secret, account, issuer = 'Connect|API') {
  const label = `${issuer}:${String(account || 'Administrador')}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function hotp(secret, counter, digits = 6) {
  const key = base32Decode(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, '0');
}

export function normalizeOtpCode(code) {
  return String(code || '').replace(/\D/g, '').slice(0, 8);
}

export function verifyTotp(secret, code, { window = 1, period = 30, timestamp = Date.now(), lastCounter = -1 } = {}) {
  const normalized = normalizeOtpCode(code);
  if (!/^\d{6}$/.test(normalized)) return { valid: false, counter: null };
  const current = Math.floor(timestamp / 1000 / period);
  for (let offset = -window; offset <= window; offset += 1) {
    const counter = current + offset;
    if (counter <= Number(lastCounter ?? -1)) continue;
    const expected = hotp(secret, counter);
    const left = Buffer.from(normalized);
    const right = Buffer.from(expected);
    if (left.length === right.length && crypto.timingSafeEqual(left, right)) return { valid: true, counter };
  }
  return { valid: false, counter: null };
}

function deriveEncryptionKey(keyMaterial) {
  return crypto.createHash('sha256').update(String(keyMaterial || '')).digest();
}

export function encryptSecret(value, keyMaterial) {
  if (!keyMaterial) throw new Error('Chave de criptografia do 2FA não configurada.');
  const iv = crypto.randomBytes(12);
  const key = deriveEncryptionKey(keyMaterial);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `aes256gcm$${iv.toString('base64url')}$${tag.toString('base64url')}$${encrypted.toString('base64url')}`;
}

export function decryptSecret(encoded, keyMaterial) {
  const [kind, ivEncoded, tagEncoded, dataEncoded] = String(encoded || '').split('$');
  if (kind !== 'aes256gcm' || !ivEncoded || !tagEncoded || !dataEncoded || !keyMaterial) throw new Error('Segredo 2FA inválido.');
  const key = deriveEncryptionKey(keyMaterial);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivEncoded, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataEncoded, 'base64url')), decipher.final()]).toString('utf8');
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(8).toString('hex').toUpperCase();
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  });
}

export function normalizeRecoveryCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-F0-9]/g, '');
}

export function hashRecoveryCode(code, keyMaterial) {
  if (!keyMaterial) throw new Error('Chave de proteção dos códigos de recuperação não configurada.');
  return crypto.createHmac('sha256', deriveEncryptionKey(keyMaterial)).update(normalizeRecoveryCode(code)).digest('hex');
}

export function verifyRecoveryCode(code, expectedHash, keyMaterial) {
  const actual = Buffer.from(hashRecoveryCode(code, keyMaterial), 'hex');
  const expected = Buffer.from(String(expectedHash || ''), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
