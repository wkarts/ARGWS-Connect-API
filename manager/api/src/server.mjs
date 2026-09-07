import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import {
  clearMfaChallengeCookie,
  clearSessionCookie,
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  mfaChallengeCookie,
  parseCookies,
  randomToken,
  sessionCookie,
  signSession,
  totpUri,
  verifyPassword,
  verifySession,
  verifyTotp,
} from './security.mjs';
import { EngineClient } from './engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.MANAGER_API_PORT || 3100);
const HOST = env.MANAGER_API_HOST || '0.0.0.0';
const DATA_FILE = env.MANAGER_DATA_FILE || path.resolve(__dirname, '..', 'data', 'manager-data.json');
const ENGINE_URL = env.MANAGER_ENGINE_URL || 'http://api:8080';
const ENGINE_KEY = env.MANAGER_ENGINE_API_KEY || env.AUTHENTICATION_API_KEY || '';
const SESSION_SECRET = env.MANAGER_SESSION_SECRET || '';
const COOKIE_SECURE = String(env.MANAGER_COOKIE_SECURE ?? 'true').toLowerCase() !== 'false';
const SESSION_TTL_SECONDS = Math.max(900, Number(env.MANAGER_SESSION_TTL_SECONDS || 43200));
const SETUP_TOKEN = env.MANAGER_SETUP_TOKEN || '';
const LICENSE_URL = String(env.MANAGER_LICENSE_URL || '').replace(/\/+$/, '');
const TELEMETRY_URL = String(env.MANAGER_TELEMETRY_URL || '').replace(/\/+$/, '');
const RELEASE_URL = String(env.MANAGER_RELEASE_URL || '').replace(/\/+$/, '');
const INSTALLATION_ID = env.MANAGER_INSTALLATION_ID || 'local';
const MFA_CHALLENGE_TTL_SECONDS = Math.max(120, Math.min(900, Number(env.MANAGER_MFA_CHALLENGE_TTL_SECONDS || 300)));
const MFA_REQUIRED_FOR_ADMIN = String(
  env.MANAGER_2FA_REQUIRED_FOR_ADMIN ?? (env.NODE_ENV === 'production' ? 'true' : 'false'),
).toLowerCase() === 'true';

if (env.NODE_ENV === 'production' && SESSION_SECRET.length < 32) {
  throw new Error('MANAGER_SESSION_SECRET deve possuir pelo menos 32 caracteres em produção.');
}
const effectiveSecret = SESSION_SECRET || randomToken(48);
const MFA_KEY = env.MANAGER_MFA_ENCRYPTION_KEY || SESSION_SECRET || effectiveSecret;
if (env.NODE_ENV === 'production' && MFA_KEY.length < 32) {
  throw new Error('MANAGER_MFA_ENCRYPTION_KEY ou MANAGER_SESSION_SECRET deve possuir pelo menos 32 caracteres em produção.');
}
const store = new Store(DATA_FILE);
const engine = new EngineClient(ENGINE_URL, ENGINE_KEY);

if (!store.listUsers().length && env.MANAGER_BOOTSTRAP_EMAIL && env.MANAGER_BOOTSTRAP_PASSWORD) {
  store.bootstrap(env.MANAGER_BOOTSTRAP_EMAIL, env.MANAGER_BOOTSTRAP_PASSWORD, env.MANAGER_BOOTSTRAP_NAME || 'Administrador');
}

const ROLE_PERMISSIONS = {
  administrator: ['*'],
  supervisor: ['dashboard.read', 'instances.read', 'instances.manage', 'messages.read', 'messages.send', 'pbx.read', 'studio.read', 'integrations.read', 'logs.read', 'audit.read'],
  operator: ['dashboard.read', 'instances.read', 'messages.read', 'messages.send'],
  pbx_operator: ['dashboard.read', 'instances.read', 'pbx.read', 'pbx.manage'],
  studio_author: ['dashboard.read', 'instances.read', 'studio.read', 'studio.manage', 'integrations.read'],
  viewer: ['dashboard.read', 'instances.read', 'pbx.read', 'studio.read', 'integrations.read'],
};

function permissionsFor(user) {
  return [...new Set((user?.roles || []).flatMap((role) => ROLE_PERMISSIONS[role] || []))];
}
function can(user, permission) {
  const permissions = permissionsFor(user);
  return permissions.includes('*') || permissions.includes(permission);
}
function requiresTwoFactor(user) {
  return MFA_REQUIRED_FOR_ADMIN && (user?.roles || []).includes('administrator');
}
function securityState(user, payload = null) {
  const twoFactorEnabled = Boolean(user?.twoFactorEnabled);
  const required = requiresTwoFactor(user);
  return {
    twoFactorEnabled,
    twoFactorRequired: required,
    enrollmentRequired: required && !twoFactorEnabled,
    mfaVerified: Boolean(payload?.mfa),
    recoveryCodesRemaining: Array.isArray(user?.recoveryCodeHashes) ? user.recoveryCodeHashes.length : 0,
    enabledAt: user?.twoFactorEnabledAt || null,
    lastMfaAt: user?.lastMfaAt || null,
  };
}
function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}
const rateBuckets = new Map();
function enforceRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  if (bucket.count >= limit) {
    const error = Object.assign(new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.'), {
      status: 429,
      code: 'RATE_LIMITED',
      retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    });
    throw error;
  }
  bucket.count += 1;
}
function issueSession(user, mfaVerified = false) {
  const csrf = randomToken(24);
  const payload = {
    uid: user.id,
    sv: user.sessionVersion || 1,
    csrf,
    mfa: Boolean(mfaVerified),
    exp: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  return { csrf, payload, token: signSession(payload, effectiveSecret) };
}
function sanitizeInstance(item = {}) {
  const allowed = [
    'id', 'name', 'instanceName', 'instanceId', 'integration', 'connectionStatus', 'number', 'profileName',
    'profilePicUrl', 'ownerJid', 'clientName', 'createdAt', 'updatedAt', 'disconnectionAt',
    'disconnectionReasonCode', 'state', 'status',
  ];
  const safe = Object.fromEntries(allowed.filter((key) => item[key] !== undefined).map((key) => [key, item[key]]));
  if (item._count && typeof item._count === 'object') {
    safe._count = {
      Contact: Number(item._count.Contact || 0),
      Chat: Number(item._count.Chat || 0),
      Message: Number(item._count.Message || 0),
    };
  }
  return safe;
}
function json(res, status, data, headers = {}) {
  const securityHeaders = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    ...(COOKIE_SECURE ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  };
  res.writeHead(status, { ...securityHeaders, ...headers });
  res.end(JSON.stringify(data));
}
function readBody(req, max = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > max) {
        reject(Object.assign(new Error('Payload muito grande.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text) return resolve({});
      try { resolve(JSON.parse(text)); } catch { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function route(pattern, pathname) {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:[A-Za-z0-9_]+/g, (match) => { keys.push(match.slice(1)); return '([^/]+)'; })}$`);
  const match = pathname.match(regex);
  if (!match) return null;
  return Object.fromEntries(keys.map((key, index) => [key, decodeURIComponent(match[index + 1])]));
}
function requestUser(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const payload = verifySession(cookies.connect_manager_session, effectiveSecret);
  if (!payload) return null;
  const user = store.findUserById(payload.uid);
  if (!user || !user.active || Number(user.sessionVersion || 1) !== Number(payload.sv || 1)) return null;
  return { user, payload };
}
function requireUser(req, permission, { allowMfaEnrollment = false } = {}) {
  const current = requestUser(req);
  if (!current) throw Object.assign(new Error('Sessão inválida ou expirada.'), { status: 401, code: 'SESSION_INVALID' });
  if (current.user.twoFactorEnabled && current.payload.mfa !== true) {
    throw Object.assign(new Error('Confirme a autenticação em dois fatores.'), { status: 401, code: 'MFA_REQUIRED' });
  }
  if (requiresTwoFactor(current.user) && !current.user.twoFactorEnabled && !allowMfaEnrollment) {
    throw Object.assign(new Error('Configure a autenticação em dois fatores para continuar.'), { status: 403, code: 'MFA_SETUP_REQUIRED' });
  }
  if (permission && !can(current.user, permission)) throw Object.assign(new Error('Você não possui permissão para esta operação.'), { status: 403, code: 'FORBIDDEN' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method || 'GET')) {
    const csrf = req.headers['x-csrf-token'];
    if (!csrf || csrf !== current.payload.csrf) throw Object.assign(new Error('Validação de segurança da sessão falhou.'), { status: 403, code: 'CSRF_INVALID' });
  }
  return current;
}
function readMfaChallenge(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const payload = verifySession(cookies.connect_manager_mfa, effectiveSecret);
  if (!payload || payload.kind !== 'mfa') return null;
  const user = store.findUserById(payload.uid);
  if (!user || !user.active || Number(user.sessionVersion || 1) !== Number(payload.sv || 1)) return null;
  return { user, payload };
}
function verifyUserSecondFactor(user, body) {
  if (!user?.twoFactorEnabled || !user.totpSecretEncrypted) return { ok: false, method: null };
  if (body?.recoveryCode) {
    const hash = hashRecoveryCode(body.recoveryCode, MFA_KEY);
    if (store.consumeRecoveryHash(user.id, hash)) return { ok: true, method: 'recovery' };
    return { ok: false, method: 'recovery' };
  }
  const secret = decryptSecret(user.totpSecretEncrypted, MFA_KEY);
  const result = verifyTotp(secret, body?.code, { lastCounter: Number(user.lastTotpCounter ?? -1) });
  if (!result.valid || !store.consumeTotpCounter(user.id, result.counter)) return { ok: false, method: 'totp' };
  return { ok: true, method: 'totp' };
}
async function externalJson(url, fallback) {
  if (!url) return fallback;
  try {
    const response = await fetch(url, { headers: { 'x-installation-id': INSTALLATION_ID }, signal: AbortSignal.timeout(10000) });
    if (!response.ok) return { ...fallback, status: 'unavailable', httpStatus: response.status };
    return await response.json();
  } catch (error) {
    return { ...fallback, status: 'unavailable', message: error.message };
  }
}

async function handler(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && pathname === '/health') {
    return json(res, 200, { status: 'ok', service: 'Connect|API Manager API', uptime: Math.floor(process.uptime()) });
  }
  if (req.method === 'GET' && pathname === '/manager-api/v1/status') {
    return json(res, 200, { setupRequired: store.listUsers().length === 0, installationId: INSTALLATION_ID });
  }
  if (req.method === 'POST' && pathname === '/manager-api/v1/setup') {
    if (store.listUsers().length) return json(res, 409, { message: 'A administração já foi configurada.' });
    if (!SETUP_TOKEN || req.headers['x-setup-token'] !== SETUP_TOKEN) return json(res, 403, { message: 'Token de configuração inválido.' });
    const body = await readBody(req);
    if (!body.email || !body.password) return json(res, 400, { message: 'Informe e-mail e senha.' });
    const user = store.bootstrap(body.email, body.password, body.name || 'Administrador');
    store.audit(user, 'manager.setup', 'manager', {});
    return json(res, 201, { user: store.publicUser(user) });
  }
  if (req.method === 'POST' && pathname === '/manager-api/v1/auth/login') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const ip = clientIp(req);
    enforceRateLimit(`login-ip:${ip}`, 40, 15 * 60_000);
    enforceRateLimit(`login-email:${email || 'empty'}`, 15, 15 * 60_000);
    const user = store.findUserByEmail(email);
    if (user && store.isLoginLocked(user)) {
      store.audit(user, 'auth.login_blocked', 'session', { ip });
      return json(res, 429, { message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.', code: 'ACCOUNT_TEMPORARILY_LOCKED' });
    }
    if (!user || !user.active || !verifyPassword(body.password, user.passwordHash)) {
      if (user) {
        store.recordLoginFailure(user.id);
        store.audit(user, 'auth.login_failed', 'session', { ip });
      }
      return json(res, 401, { message: 'E-mail ou senha inválidos.', code: 'INVALID_CREDENTIALS' });
    }
    store.resetLoginFailures(user.id);
    if (user.twoFactorEnabled) {
      const challenge = signSession({
        uid: user.id,
        sv: user.sessionVersion || 1,
        kind: 'mfa',
        nonce: randomToken(16),
        exp: Date.now() + MFA_CHALLENGE_TTL_SECONDS * 1000,
      }, effectiveSecret);
      store.audit(user, 'auth.password_verified', 'session', { ip });
      return json(res, 202, {
        mfaRequired: true,
        method: 'totp',
        recoveryAvailable: Array.isArray(user.recoveryCodeHashes) && user.recoveryCodeHashes.length > 0,
        user: { name: user.name, email: user.email },
      }, { 'set-cookie': mfaChallengeCookie(challenge, COOKIE_SECURE, MFA_CHALLENGE_TTL_SECONDS) });
    }
    const session = issueSession(user, false);
    store.touchLogin(user.id);
    const freshUser = store.findUserById(user.id);
    store.audit(freshUser, 'auth.login', 'session', { ip, mfa: false });
    return json(res, 200, {
      user: store.publicUser(freshUser),
      permissions: permissionsFor(freshUser),
      csrf: session.csrf,
      security: securityState(freshUser, session.payload),
    }, { 'set-cookie': sessionCookie(session.token, COOKIE_SECURE, SESSION_TTL_SECONDS) });
  }
  if (req.method === 'POST' && pathname === '/manager-api/v1/auth/2fa/verify') {
    const challenge = readMfaChallenge(req);
    if (!challenge) return json(res, 401, { message: 'A verificação expirou. Faça login novamente.', code: 'MFA_CHALLENGE_INVALID' }, { 'set-cookie': clearMfaChallengeCookie(COOKIE_SECURE) });
    const { user } = challenge;
    const ip = clientIp(req);
    enforceRateLimit(`mfa-ip:${ip}`, 30, 10 * 60_000);
    enforceRateLimit(`mfa-user:${user.id}`, 15, 10 * 60_000);
    if (store.isMfaLocked(user)) {
      store.audit(user, 'auth.mfa_blocked', 'session', { ip });
      return json(res, 429, { message: 'Muitas tentativas de verificação. Aguarde alguns minutos.', code: 'MFA_TEMPORARILY_LOCKED' });
    }
    const body = await readBody(req);
    const result = verifyUserSecondFactor(user, body);
    if (!result.ok) {
      store.recordMfaFailure(user.id);
      store.audit(user, 'auth.mfa_failed', 'session', { ip, method: result.method || 'unknown' });
      return json(res, 401, { message: 'Código de autenticação inválido.', code: 'MFA_INVALID' });
    }
    store.resetMfaFailures(user.id);
    store.touchLogin(user.id);
    store.touchMfa(user.id);
    const freshUser = store.findUserById(user.id);
    const session = issueSession(freshUser, true);
    store.audit(freshUser, 'auth.login', 'session', { ip, mfa: true, method: result.method });
    return json(res, 200, {
      user: store.publicUser(freshUser),
      permissions: permissionsFor(freshUser),
      csrf: session.csrf,
      security: securityState(freshUser, session.payload),
      recoveryCodeUsed: result.method === 'recovery',
    }, {
      'set-cookie': [sessionCookie(session.token, COOKIE_SECURE, SESSION_TTL_SECONDS), clearMfaChallengeCookie(COOKIE_SECURE)],
    });
  }
  if (req.method === 'POST' && pathname === '/manager-api/v1/auth/logout') {
    const current = requestUser(req);
    if (current) store.audit(current.user, 'auth.logout', 'session', {});
    return json(res, 200, { ok: true }, {
      'set-cookie': [clearSessionCookie(COOKIE_SECURE), clearMfaChallengeCookie(COOKIE_SECURE)],
    });
  }
  if (req.method === 'GET' && pathname === '/manager-api/v1/auth/me') {
    const current = requestUser(req);
    if (!current) return json(res, 401, { message: 'Sessão inválida ou expirada.', code: 'SESSION_INVALID' });
    if (current.user.twoFactorEnabled && current.payload.mfa !== true) {
      return json(res, 401, { message: 'Confirme a autenticação em dois fatores.', code: 'MFA_REQUIRED' });
    }
    return json(res, 200, {
      user: store.publicUser(current.user),
      permissions: permissionsFor(current.user),
      csrf: current.payload.csrf,
      security: securityState(current.user, current.payload),
    });
  }
  if (req.method === 'GET' && pathname === '/manager-api/v1/auth/security') {
    const { user, payload } = requireUser(req, null, { allowMfaEnrollment: true });
    return json(res, 200, { security: securityState(user, payload) });
  }
  if (req.method === 'POST' && pathname === '/manager-api/v1/auth/2fa/setup') {
    const { user } = requireUser(req, null, { allowMfaEnrollment: true });
    const body = await readBody(req);
    if (!verifyPassword(body.password, user.passwordHash)) return json(res, 403, { message: 'Senha atual inválida.', code: 'PASSWORD_INVALID' });
    if (user.twoFactorEnabled) return json(res, 409, { message: 'A autenticação em dois fatores já está ativa.', code: 'MFA_ALREADY_ENABLED' });
    const secret = generateTotpSecret();
    store.beginTwoFactorSetup(user.id, encryptSecret(secret, MFA_KEY));
    store.audit(user, 'auth.mfa_setup_started', 'account', { ip: clientIp(req) });
    return json(res, 200, {
      secret,
      otpauthUri: totpUri(secret, user.email),
      issuer: 'Connect|API',
      account: user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
    });
  }
  if (req.method === 'POST' && pathname === '/manager-api/v1/auth/2fa/confirm') {
    const { user } = requireUser(req, null, { allowMfaEnrollment: true });
    const body = await readBody(req);
    const fresh = store.findUserById(user.id);
    if (!fresh?.totpPendingSecretEncrypted) return json(res, 409, { message: 'Inicie a configuração do 2FA novamente.', code: 'MFA_SETUP_NOT_STARTED' });
    const secret = decryptSecret(fresh.totpPendingSecretEncrypted, MFA_KEY);
    const check = verifyTotp(secret, body.code, { lastCounter: -1 });
    if (!check.valid) return json(res, 401, { message: 'Código de autenticação inválido.', code: 'MFA_INVALID' });
    const recoveryCodes = generateRecoveryCodes(10);
    const hashes = recoveryCodes.map((code) => hashRecoveryCode(code, MFA_KEY));
    const enabled = store.enableTwoFactor(user.id, fresh.totpPendingSecretEncrypted, hashes, check.counter);
    const session = issueSession(enabled, true);
    store.touchMfa(enabled.id);
    store.audit(enabled, 'auth.mfa_enabled', 'account', { recoveryCodes: recoveryCodes.length });
    return json(res, 200, {
      user: store.publicUser(store.findUserById(enabled.id)),
      permissions: permissionsFor(enabled),
      csrf: session.csrf,
      security: securityState(store.findUserById(enabled.id), session.payload),
      recoveryCodes,
      message: '2FA ativado. Guarde os códigos de recuperação em local seguro; eles não serão exibidos novamente.',
    }, { 'set-cookie': sessionCookie(session.token, COOKIE_SECURE, SESSION_TTL_SECONDS) });
  }
  if (req.method === 'POST' && pathname === '/manager-api/v1/auth/2fa/recovery/regenerate') {
    const { user } = requireUser(req);
    const body = await readBody(req);
    if (!verifyPassword(body.password, user.passwordHash)) return json(res, 403, { message: 'Senha atual inválida.', code: 'PASSWORD_INVALID' });
    if (!user.twoFactorEnabled) return json(res, 409, { message: 'A autenticação em dois fatores não está ativa.', code: 'MFA_NOT_ENABLED' });
    const recoveryCodes = generateRecoveryCodes(10);
    store.setRecoveryCodes(user.id, recoveryCodes.map((code) => hashRecoveryCode(code, MFA_KEY)));
    store.audit(user, 'auth.mfa_recovery_regenerated', 'account', { recoveryCodes: recoveryCodes.length });
    return json(res, 200, { recoveryCodes, message: 'Novos códigos gerados. Os códigos anteriores foram invalidados.' });
  }
  if (req.method === 'DELETE' && pathname === '/manager-api/v1/auth/2fa') {
    const { user } = requireUser(req);
    const body = await readBody(req);
    if (!verifyPassword(body.password, user.passwordHash)) return json(res, 403, { message: 'Senha atual inválida.', code: 'PASSWORD_INVALID' });
    if (requiresTwoFactor(user)) return json(res, 409, { message: 'O 2FA é obrigatório para administradores nesta instalação.', code: 'MFA_REQUIRED_FOR_ROLE' });
    store.disableTwoFactor(user.id);
    store.audit(user, 'auth.mfa_disabled', 'account', {});
    return json(res, 200, { ok: true, reauthenticate: true }, { 'set-cookie': clearSessionCookie(COOKIE_SECURE) });
  }
  if (req.method === 'POST' && pathname === '/manager-api/v1/auth/password/change') {
    const { user } = requireUser(req, null, { allowMfaEnrollment: true });
    const body = await readBody(req);
    if (!verifyPassword(body.currentPassword, user.passwordHash)) return json(res, 403, { message: 'Senha atual inválida.', code: 'PASSWORD_INVALID' });
    if (body.currentPassword === body.newPassword) return json(res, 400, { message: 'A nova senha deve ser diferente da senha atual.' });
    store.changePassword(user.id, user.passwordHash, body.newPassword);
    store.audit(user, 'auth.password_changed', 'account', {});
    return json(res, 200, { ok: true, reauthenticate: true }, { 'set-cookie': clearSessionCookie(COOKIE_SECURE) });
  }
  if (req.method === 'GET' && pathname === '/manager-api/v1/dashboard') {
    requireUser(req, 'dashboard.read');
    const [root, health, rawInstances] = await Promise.allSettled([engine.root(), engine.health(), engine.instances()]);
    const instances = rawInstances.status === 'fulfilled' ? (Array.isArray(rawInstances.value) ? rawInstances.value : rawInstances.value ? [rawInstances.value] : []) : [];
    const connected = instances.filter((item) => String(item.connectionStatus).toLowerCase() === 'open').length;
    const totals = instances.reduce((acc, item) => {
      acc.contacts += Number(item._count?.Contact || 0);
      acc.chats += Number(item._count?.Chat || 0);
      acc.messages += Number(item._count?.Message || 0);
      return acc;
    }, { contacts: 0, chats: 0, messages: 0 });
    return json(res, 200, {
      engine: {
        status: health.status === 'fulfilled' ? health.value?.status || 'ok' : 'unavailable',
        version: root.status === 'fulfilled' ? root.value?.version || null : null,
        uptime: health.status === 'fulfilled' ? health.value?.uptime || 0 : 0,
      },
      instances: { total: instances.length, connected, disconnected: Math.max(0, instances.length - connected) },
      totals,
      services: {
        manager: { status: 'ok' },
        license: { status: LICENSE_URL ? 'configured' : 'not_configured' },
        telemetry: { status: TELEMETRY_URL ? 'configured' : 'not_configured' },
        updates: { status: RELEASE_URL ? 'configured' : 'not_configured' },
      },
    });
  }
  if (req.method === 'GET' && pathname === '/manager-api/v1/instances') {
    requireUser(req, 'instances.read');
    const data = await engine.instances();
    const items = Array.isArray(data) ? data : data ? [data] : [];
    return json(res, 200, items.map((item) => sanitizeInstance(item)));
  }
  if (req.method === 'POST' && pathname === '/manager-api/v1/instances') {
    const { user } = requireUser(req, 'instances.manage');
    const body = await readBody(req);
    if (!body.instanceName || !body.integration) return json(res, 400, { message: 'Nome e canal são obrigatórios.' });
    const payload = { ...body, token: body.token || randomToken(32) };
    const data = await engine.request('/instance/create', { method: 'POST', body: payload });
    store.audit(user, 'instance.create', body.instanceName, { integration: body.integration });
    return json(res, 201, data);
  }

  let params = route('/manager-api/v1/instances/:ref', pathname);
  if (params && req.method === 'GET') {
    requireUser(req, 'instances.read');
    const item = await engine.instance(params.ref);
    if (!item) return json(res, 404, { message: 'Instância não encontrada.' });
    return json(res, 200, sanitizeInstance(item));
  }
  params = route('/manager-api/v1/instances/:ref/restart', pathname);
  if (params && req.method === 'POST') {
    const { user } = requireUser(req, 'instances.manage');
    const data = await engine.instanceRequest(params.ref, '/instance/restart/:instanceName', { method: 'POST' });
    store.audit(user, 'instance.restart', params.ref, {});
    return json(res, 200, data);
  }
  params = route('/manager-api/v1/instances/:ref/logout', pathname);
  if (params && req.method === 'POST') {
    const { user } = requireUser(req, 'instances.manage');
    const data = await engine.instanceRequest(params.ref, '/instance/logout/:instanceName', { method: 'DELETE' });
    store.audit(user, 'instance.logout', params.ref, {});
    return json(res, 200, data);
  }
  params = route('/manager-api/v1/instances/:ref/connect', pathname);
  if (params && req.method === 'POST') {
    const { user } = requireUser(req, 'instances.manage');
    const body = await readBody(req);
    const instance = await engine.instance(params.ref);
    if (!instance) return json(res, 404, { message: 'Instância não encontrada.' });
    const name = encodeURIComponent(instance.name || instance.instanceName);
    const number = String(body.number || instance.number || '').replace(/\D/g, '');
    const suffix = body.pairing && number ? `?number=${encodeURIComponent(number)}` : '';
    const data = await engine.request(`/instance/connect/${name}${suffix}`, { token: instance.token });
    store.audit(user, body.pairing ? 'instance.pairing_code' : 'instance.qrcode', params.ref, {});
    return json(res, 200, data);
  }
  params = route('/manager-api/v1/instances/:ref', pathname);
  if (params && req.method === 'DELETE') {
    const { user } = requireUser(req, 'instances.manage');
    const data = await engine.instanceRequest(params.ref, '/instance/delete/:instanceName', { method: 'DELETE' });
    store.audit(user, 'instance.delete', params.ref, {});
    return json(res, 200, data);
  }

  params = route('/manager-api/v1/instances/:ref/chats', pathname);
  if (params && req.method === 'GET') {
    requireUser(req, 'messages.read');
    const data = await engine.instanceRequest(params.ref, '/chat/findChats/:instanceName', { method: 'POST', body: { where: {} } });
    return json(res, 200, Array.isArray(data) ? data : data?.records || data || []);
  }
  params = route('/manager-api/v1/instances/:ref/messages', pathname);
  if (params && req.method === 'GET') {
    requireUser(req, 'messages.read');
    const remoteJid = url.searchParams.get('remoteJid') || '';
    const data = await engine.instanceRequest(params.ref, '/chat/findMessages/:instanceName', { method: 'POST', body: { where: remoteJid ? { key: { remoteJid } } : {} } });
    return json(res, 200, data?.messages?.records || (Array.isArray(data) ? data : []));
  }
  params = route('/manager-api/v1/instances/:ref/messages/text', pathname);
  if (params && req.method === 'POST') {
    const { user } = requireUser(req, 'messages.send');
    const body = await readBody(req);
    if (!body.number || !body.text) return json(res, 400, { message: 'Número e mensagem são obrigatórios.' });
    const data = await engine.instanceRequest(params.ref, '/message/sendText/:instanceName', { method: 'POST', body: { number: String(body.number).replace(/@.+$/, '').replace(/\D/g, ''), text: String(body.text) } });
    store.audit(user, 'message.send', params.ref, { number: String(body.number).replace(/\D/g, '').slice(-4).padStart(String(body.number).replace(/\D/g, '').length, '*') });
    return json(res, 200, data);
  }

  params = route('/manager-api/v1/instances/:ref/calls', pathname);
  if (params && req.method === 'GET') {
    requireUser(req, 'pbx.read');
    const data = await engine.instanceRequest(params.ref, '/call/list/:instanceName');
    return json(res, 200, Array.isArray(data) ? data : data || []);
  }


  params = route('/manager-api/v1/instances/:ref/config/:kind', pathname);
  if (params && req.method === 'GET') {
    requireUser(req, 'instances.manage');
    const allowed = new Set(['settings', 'proxy', 'chatwoot', 'webhook', 'websocket', 'rabbitmq', 'sqs']);
    if (!allowed.has(params.kind)) return json(res, 404, { message: 'Configuração não suportada.' });
    const data = await engine.instanceRequest(params.ref, `/${params.kind}/find/:instanceName`);
    return json(res, 200, data || {});
  }
  if (params && (req.method === 'PUT' || req.method === 'POST')) {
    const { user } = requireUser(req, 'instances.manage');
    const allowed = new Set(['settings', 'proxy', 'chatwoot', 'webhook', 'websocket', 'rabbitmq', 'sqs']);
    if (!allowed.has(params.kind)) return json(res, 404, { message: 'Configuração não suportada.' });
    const body = await readBody(req);
    const data = await engine.instanceRequest(params.ref, `/${params.kind}/set/:instanceName`, { method: 'POST', body });
    store.audit(user, 'configuration.update', `${params.ref}:${params.kind}`, {});
    return json(res, 200, data);
  }

  params = route('/manager-api/v1/instances/:ref/integrations/:kind', pathname);
  if (params && req.method === 'GET') {
    requireUser(req, 'integrations.read');
    const allowed = new Set(['typebot', 'openai', 'dify', 'n8n', 'connectAI', 'connectBot', 'flowise']);
    if (!allowed.has(params.kind)) return json(res, 404, { message: 'Integração não suportada.' });
    const data = await engine.instanceRequest(params.ref, `/${params.kind}/find/:instanceName`);
    return json(res, 200, Array.isArray(data) ? data : data ? [data] : []);
  }
  if (params && req.method === 'POST') {
    const { user } = requireUser(req, 'studio.manage');
    const allowed = new Set(['typebot', 'openai', 'dify', 'n8n', 'connectAI', 'connectBot', 'flowise']);
    if (!allowed.has(params.kind)) return json(res, 404, { message: 'Integração não suportada.' });
    const body = await readBody(req);
    const data = await engine.instanceRequest(params.ref, `/${params.kind}/create/:instanceName`, { method: 'POST', body });
    store.audit(user, 'integration.create', `${params.ref}:${params.kind}`, {});
    return json(res, 201, data);
  }

  params = route('/manager-api/v1/instances/:ref/integrations/:kind/:id', pathname);
  if (params && req.method === 'PUT') {
    const { user } = requireUser(req, 'studio.manage');
    const allowed = new Set(['typebot', 'openai', 'dify', 'n8n', 'connectAI', 'connectBot', 'flowise']);
    if (!allowed.has(params.kind)) return json(res, 404, { message: 'Integração não suportada.' });
    const body = await readBody(req);
    const instance = await engine.instance(params.ref);
    if (!instance) return json(res, 404, { message: 'Instância não encontrada.' });
    const name = encodeURIComponent(instance.name || instance.instanceName);
    const data = await engine.request(`/${params.kind}/update/${encodeURIComponent(params.id)}/${name}`, { method: 'PUT', body, token: instance.token });
    store.audit(user, 'integration.update', `${params.ref}:${params.kind}:${params.id}`, {});
    return json(res, 200, data);
  }
  if (params && req.method === 'DELETE') {
    const { user } = requireUser(req, 'studio.manage');
    const allowed = new Set(['typebot', 'openai', 'dify', 'n8n', 'connectAI', 'connectBot', 'flowise']);
    if (!allowed.has(params.kind)) return json(res, 404, { message: 'Integração não suportada.' });
    const instance = await engine.instance(params.ref);
    if (!instance) return json(res, 404, { message: 'Instância não encontrada.' });
    const name = encodeURIComponent(instance.name || instance.instanceName);
    const data = await engine.request(`/${params.kind}/delete/${encodeURIComponent(params.id)}/${name}`, { method: 'DELETE', token: instance.token });
    store.audit(user, 'integration.delete', `${params.ref}:${params.kind}:${params.id}`, {});
    return json(res, 200, data);
  }

  params = route('/manager-api/v1/instances/:ref/calls/:action', pathname);
  if (params && req.method === 'POST') {
    const { user } = requireUser(req, 'pbx.manage');
    const allowed = new Set(['offer', 'accept', 'reject', 'end', 'mute']);
    if (!allowed.has(params.action)) return json(res, 404, { message: 'Ação de chamada não suportada.' });
    const body = await readBody(req);
    const data = await engine.instanceRequest(params.ref, `/call/${params.action}/:instanceName`, { method: 'POST', body });
    store.audit(user, `call.${params.action}`, params.ref, {});
    return json(res, 200, data);
  }

  if (req.method === 'GET' && pathname === '/manager-api/v1/users') {
    requireUser(req, 'users.read');
    return json(res, 200, store.listUsers());
  }
  if (req.method === 'POST' && pathname === '/manager-api/v1/users') {
    const { user } = requireUser(req, 'users.manage');
    const body = await readBody(req);
    const created = store.createUser(body);
    store.audit(user, 'user.create', created.id, { email: created.email, roles: created.roles });
    return json(res, 201, created);
  }
  params = route('/manager-api/v1/users/:id', pathname);
  if (params && req.method === 'PUT') {
    const { user } = requireUser(req, 'users.manage');
    const body = await readBody(req);
    const updated = store.updateUser(params.id, body);
    store.audit(user, 'user.update', params.id, { email: updated.email, roles: updated.roles, active: updated.active });
    return json(res, 200, updated);
  }
  if (params && req.method === 'DELETE') {
    const { user } = requireUser(req, 'users.manage');
    store.deleteUser(params.id, user.id);
    store.audit(user, 'user.delete', params.id, {});
    return json(res, 200, { ok: true });
  }
  params = route('/manager-api/v1/users/:id/2fa/reset', pathname);
  if (params && req.method === 'POST') {
    const { user } = requireUser(req, 'users.manage');
    if (params.id === user.id) return json(res, 400, { message: 'Use Segurança da conta para alterar o seu próprio 2FA.' });
    const target = store.findUserById(params.id);
    if (!target) return json(res, 404, { message: 'Usuário não encontrado.' });
    store.disableTwoFactor(params.id);
    store.audit(user, 'user.mfa_reset', params.id, { email: target.email });
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/manager-api/v1/roles') {
    requireUser(req, 'users.read');
    const labels = { administrator: 'Administrador', supervisor: 'Supervisor', operator: 'Atendimento', pbx_operator: 'Operador de Voz', studio_author: 'Autor do Studio', viewer: 'Visualizador' };
    return json(res, 200, Object.entries(ROLE_PERMISSIONS).map(([id, permissions]) => ({ id, label: labels[id] || id, permissions })));
  }
  if (req.method === 'GET' && pathname === '/manager-api/v1/audit') {
    requireUser(req, 'audit.read');
    return json(res, 200, store.listAudit(url.searchParams.get('limit') || 200));
  }
  if (req.method === 'GET' && pathname === '/manager-api/v1/system/health') {
    requireUser(req, 'dashboard.read');
    const [engineRoot, engineHealth] = await Promise.allSettled([engine.root(), engine.health()]);
    return json(res, 200, {
      manager: { status: 'ok', uptime: Math.floor(process.uptime()) },
      engine: {
        status: engineHealth.status === 'fulfilled' ? engineHealth.value?.status || 'ok' : 'unavailable',
        version: engineRoot.status === 'fulfilled' ? engineRoot.value?.version || null : null,
        message: engineHealth.status === 'rejected' ? engineHealth.reason?.message : null,
      },
      integrations: { license: Boolean(LICENSE_URL), telemetry: Boolean(TELEMETRY_URL), releases: Boolean(RELEASE_URL) },
    });
  }
  if (req.method === 'GET' && pathname === '/manager-api/v1/license') {
    requireUser(req, 'dashboard.read');
    const fallback = { status: LICENSE_URL ? 'unknown' : 'not_configured', installationId: INSTALLATION_ID, product: 'Connect|API' };
    return json(res, 200, await externalJson(LICENSE_URL ? `${LICENSE_URL}/v1/licenses/current?installation_id=${encodeURIComponent(INSTALLATION_ID)}` : '', fallback));
  }
  if (req.method === 'GET' && pathname === '/manager-api/v1/updates') {
    requireUser(req, 'dashboard.read');
    const fallback = { status: RELEASE_URL ? 'unknown' : 'not_configured', installationId: INSTALLATION_ID, channel: env.MANAGER_RELEASE_CHANNEL || 'stable' };
    return json(res, 200, await externalJson(RELEASE_URL ? `${RELEASE_URL}/v1/releases/latest?product=connect-api&channel=${encodeURIComponent(env.MANAGER_RELEASE_CHANNEL || 'stable')}` : '', fallback));
  }
  if (req.method === 'POST' && pathname === '/manager-api/v1/telemetry/heartbeat') {
    const { user } = requireUser(req, 'system.manage');
    if (!TELEMETRY_URL) return json(res, 409, { message: 'Telemetria não configurada.' });
    const health = await engine.health().catch(() => ({ status: 'unavailable' }));
    const instances = await engine.instances().catch(() => []);
    const payload = {
      installationId: INSTALLATION_ID,
      timestamp: new Date().toISOString(),
      engine: { status: health?.status || 'unknown', uptime: health?.uptime || 0 },
      instances: { total: Array.isArray(instances) ? instances.length : 0, connected: Array.isArray(instances) ? instances.filter((item) => item.connectionStatus === 'open').length : 0 },
    };
    const response = await fetch(`${TELEMETRY_URL}/v1/telemetry/heartbeat`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-installation-id': INSTALLATION_ID }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
    store.audit(user, 'telemetry.heartbeat', INSTALLATION_ID, { status: response.status });
    return json(res, response.ok ? 200 : 502, response.ok ? { ok: true } : { message: `Telemetria respondeu HTTP ${response.status}.` });
  }

  return json(res, 404, { message: 'Rota não encontrada.' });
}

const server = http.createServer((req, res) => {
  Promise.resolve(handler(req, res)).catch((error) => {
    const status = Number(error.status || 500);
    if (status >= 500) console.error('[manager-api]', error);
    json(res, status >= 400 && status < 600 ? status : 500, {
      message: error.message || 'Erro interno.',
      ...(error.code ? { code: error.code } : {}),
      ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
    }, error.retryAfter ? { 'retry-after': String(error.retryAfter) } : {});
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Connect|API Manager API listening on http://${HOST}:${PORT}`);
});
