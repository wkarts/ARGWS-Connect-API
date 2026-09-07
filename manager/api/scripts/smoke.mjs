import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const port = 31991;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-manager-api-'));
const child = spawn(process.execPath, ['src/server.mjs'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: {
    ...process.env,
    NODE_ENV: 'test',
    MANAGER_API_PORT: String(port),
    MANAGER_COOKIE_SECURE: 'false',
    MANAGER_SESSION_SECRET: 'test-secret-012345678901234567890123456789',
    MANAGER_2FA_REQUIRED_FOR_ADMIN: 'true',
    MANAGER_DATA_FILE: path.join(dir, 'data.json'),
    MANAGER_SETUP_TOKEN: 'setup-test-token',
    MANAGER_ENGINE_URL: 'http://127.0.0.1:9',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const base = `http://127.0.0.1:${port}`;

function cookieValue(response, name) {
  const value = response.headers.get('set-cookie') || '';
  const match = value.match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : '';
}

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = String(input).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of normalized) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

for (let i = 0; i < 60; i += 1) {
  try { const r = await fetch(`${base}/health`); if (r.ok) break; } catch {}
  await sleep(50);
}

try {
  const status = await fetch(`${base}/manager-api/v1/status`).then((r) => r.json());
  if (!status.setupRequired) throw new Error('setupRequired deveria ser true');

  const setup = await fetch(`${base}/manager-api/v1/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-setup-token': 'setup-test-token' },
    body: JSON.stringify({ email: 'admin@example.test', password: 'SenhaSegura123!', name: 'Admin' }),
  });
  if (setup.status !== 201) throw new Error(`setup falhou: ${setup.status} ${await setup.text()}`);

  const login = await fetch(`${base}/manager-api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.test', password: 'SenhaSegura123!' }),
  });
  if (!login.ok) throw new Error(`login inicial falhou: ${login.status}`);
  let cookie = cookieValue(login, 'connect_manager_session');
  let loginData = await login.json();
  if (!loginData.security?.enrollmentRequired) throw new Error('administrador deveria exigir configuração 2FA');

  const blocked = await fetch(`${base}/manager-api/v1/users`, { headers: { cookie } });
  if (blocked.status !== 403) throw new Error(`rota protegida deveria exigir setup 2FA: ${blocked.status}`);

  const setupMfa = await fetch(`${base}/manager-api/v1/auth/2fa/setup`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': loginData.csrf },
    body: JSON.stringify({ password: 'SenhaSegura123!' }),
  });
  if (!setupMfa.ok) throw new Error(`setup 2FA falhou: ${setupMfa.status} ${await setupMfa.text()}`);
  const setupMfaData = await setupMfa.json();
  if (!setupMfaData.secret || !setupMfaData.otpauthUri) throw new Error('setup 2FA sem secret/otpauthUri');

  const confirm = await fetch(`${base}/manager-api/v1/auth/2fa/confirm`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': loginData.csrf },
    body: JSON.stringify({ code: totp(setupMfaData.secret) }),
  });
  if (!confirm.ok) throw new Error(`confirm 2FA falhou: ${confirm.status} ${await confirm.text()}`);
  cookie = cookieValue(confirm, 'connect_manager_session');
  loginData = await confirm.json();
  if (!Array.isArray(loginData.recoveryCodes) || loginData.recoveryCodes.length !== 10) throw new Error('códigos de recuperação não gerados');
  if (!loginData.security?.twoFactorEnabled || !loginData.security?.mfaVerified) throw new Error('2FA não ficou ativo/verificado');

  const user = await fetch(`${base}/manager-api/v1/users`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': loginData.csrf },
    body: JSON.stringify({ email: 'viewer@example.test', password: 'SenhaViewer123!', name: 'Viewer', roles: ['viewer'] }),
  });
  if (user.status !== 201) throw new Error(`user create falhou: ${user.status} ${await user.text()}`);

  const logout = await fetch(`${base}/manager-api/v1/auth/logout`, {
    method: 'POST',
    headers: { cookie, 'x-csrf-token': loginData.csrf },
  });
  if (!logout.ok) throw new Error(`logout falhou: ${logout.status}`);

  const login2 = await fetch(`${base}/manager-api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.test', password: 'SenhaSegura123!' }),
  });
  if (login2.status !== 202) throw new Error(`login com 2FA deveria retornar 202: ${login2.status}`);
  const challengeCookie = cookieValue(login2, 'connect_manager_mfa');
  const challengeData = await login2.json();
  if (!challengeData.mfaRequired) throw new Error('challenge MFA ausente');

  // O código usado na ativação não pode ser reutilizado no mesmo time-step. Aguarda a próxima janela quando necessário.
  const dataFile = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'));
  const admin = dataFile.users.find((item) => item.email === 'admin@example.test');
  const currentCounter = Math.floor(Date.now() / 1000 / 30);
  if (Number(admin.lastTotpCounter) >= currentCounter) {
    await sleep((30 - (Math.floor(Date.now() / 1000) % 30) + 1) * 1000);
  }

  const verify = await fetch(`${base}/manager-api/v1/auth/2fa/verify`, {
    method: 'POST',
    headers: { cookie: challengeCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ code: totp(setupMfaData.secret) }),
  });
  if (!verify.ok) throw new Error(`verify 2FA falhou: ${verify.status} ${await verify.text()}`);
  const verifyData = await verify.json();
  if (!verifyData.security?.mfaVerified) throw new Error('sessão final não marcou MFA verificado');

  console.log('Manager API SMOKE OK: auth + mandatory 2FA + recovery + RBAC');
} finally {
  child.kill('SIGTERM');
  fs.rmSync(dir, { recursive: true, force: true });
}
