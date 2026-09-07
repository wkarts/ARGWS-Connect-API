import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { hashPassword, validatePassword } from './security.mjs';

const DEFAULT_DATA = { version: 2, users: [], audit: [], settings: {} };

function assertPassword(password) {
  const error = validatePassword(password);
  if (error) throw new Error(error);
}

export class Store {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) this.write(DEFAULT_DATA);
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return {
        ...DEFAULT_DATA,
        ...parsed,
        version: Math.max(Number(parsed.version || 1), 2),
        users: parsed.users || [],
        audit: parsed.audit || [],
        settings: parsed.settings || {},
      };
    } catch {
      return structuredClone(DEFAULT_DATA);
    }
  }

  write(data) {
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...data, version: 2 }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  bootstrap(email, password, name = 'Administrador') {
    const data = this.read();
    if (data.users.length) return data.users[0];
    assertPassword(password);
    const user = {
      id: crypto.randomUUID(),
      email: String(email).trim().toLowerCase(),
      name: String(name || 'Administrador').trim(),
      passwordHash: hashPassword(password),
      roles: ['administrator'],
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: null,
      lastMfaAt: null,
      sessionVersion: 1,
      failedLoginAttempts: 0,
      lockUntil: null,
      failedMfaAttempts: 0,
      mfaLockUntil: null,
      twoFactorEnabled: false,
      twoFactorEnabledAt: null,
      totpSecretEncrypted: null,
      totpPendingSecretEncrypted: null,
      lastTotpCounter: -1,
      recoveryCodeHashes: [],
    };
    data.users.push(user);
    this.write(data);
    return user;
  }

  listUsers() {
    return this.read().users.map((user) => this.publicUser(user));
  }

  findUserByEmail(email) {
    return this.read().users.find((user) => user.email === String(email).trim().toLowerCase()) || null;
  }

  findUserById(id) {
    return this.read().users.find((user) => user.id === id) || null;
  }

  createUser(input) {
    const data = this.read();
    const email = String(input.email || '').trim().toLowerCase();
    if (!email) throw new Error('E-mail obrigatório.');
    if (data.users.some((user) => user.email === email)) throw new Error('Já existe um usuário com este e-mail.');
    assertPassword(input.password);
    const user = {
      id: crypto.randomUUID(),
      email,
      name: String(input.name || email).trim(),
      passwordHash: hashPassword(input.password),
      roles: Array.isArray(input.roles) && input.roles.length ? input.roles : ['viewer'],
      active: input.active !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: null,
      lastMfaAt: null,
      sessionVersion: 1,
      failedLoginAttempts: 0,
      lockUntil: null,
      failedMfaAttempts: 0,
      mfaLockUntil: null,
      twoFactorEnabled: false,
      twoFactorEnabledAt: null,
      totpSecretEncrypted: null,
      totpPendingSecretEncrypted: null,
      lastTotpCounter: -1,
      recoveryCodeHashes: [],
    };
    data.users.push(user);
    this.write(data);
    return this.publicUser(user);
  }

  updateUser(id, input) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) throw new Error('Usuário não encontrado.');
    if (input.name != null) user.name = String(input.name).trim();
    if (input.email != null) {
      const email = String(input.email).trim().toLowerCase();
      if (!email) throw new Error('E-mail obrigatório.');
      if (data.users.some((item) => item.id !== id && item.email === email)) throw new Error('E-mail já utilizado.');
      user.email = email;
    }
    if (input.roles != null) user.roles = Array.isArray(input.roles) && input.roles.length ? input.roles : ['viewer'];
    if (input.active != null) user.active = Boolean(input.active);
    if (input.password) {
      assertPassword(input.password);
      user.passwordHash = hashPassword(input.password);
      user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    }
    user.updatedAt = new Date().toISOString();
    this.write(data);
    return this.publicUser(user);
  }

  changePassword(id, currentPasswordHash, newPassword) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) throw new Error('Usuário não encontrado.');
    if (currentPasswordHash && user.passwordHash !== currentPasswordHash) throw new Error('A conta foi alterada durante a operação.');
    assertPassword(newPassword);
    user.passwordHash = hashPassword(newPassword);
    user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    user.updatedAt = new Date().toISOString();
    this.write(data);
    return user;
  }

  deleteUser(id, actorId) {
    const data = this.read();
    if (id === actorId) throw new Error('Você não pode excluir sua própria conta.');
    const before = data.users.length;
    data.users = data.users.filter((user) => user.id !== id);
    if (data.users.length === before) throw new Error('Usuário não encontrado.');
    if (!data.users.some((user) => user.active && user.roles.includes('administrator'))) {
      throw new Error('Deve existir pelo menos um administrador ativo.');
    }
    this.write(data);
  }

  touchLogin(id) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) return;
    user.lastLoginAt = new Date().toISOString();
    this.write(data);
  }

  touchMfa(id) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) return;
    user.lastMfaAt = new Date().toISOString();
    this.write(data);
  }

  recordLoginFailure(id) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) return null;
    const now = Date.now();
    if (user.lockUntil && new Date(user.lockUntil).getTime() <= now) user.failedLoginAttempts = 0;
    user.failedLoginAttempts = Number(user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= 8) user.lockUntil = new Date(now + 30 * 60_000).toISOString();
    else if (user.failedLoginAttempts >= 5) user.lockUntil = new Date(now + 5 * 60_000).toISOString();
    this.write(data);
    return user.lockUntil || null;
  }

  resetLoginFailures(id) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) return;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    this.write(data);
  }

  isLoginLocked(user) {
    if (!user?.lockUntil) return false;
    return new Date(user.lockUntil).getTime() > Date.now();
  }

  recordMfaFailure(id) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) return null;
    const now = Date.now();
    if (user.mfaLockUntil && new Date(user.mfaLockUntil).getTime() <= now) user.failedMfaAttempts = 0;
    user.failedMfaAttempts = Number(user.failedMfaAttempts || 0) + 1;
    if (user.failedMfaAttempts >= 8) user.mfaLockUntil = new Date(now + 30 * 60_000).toISOString();
    else if (user.failedMfaAttempts >= 5) user.mfaLockUntil = new Date(now + 5 * 60_000).toISOString();
    this.write(data);
    return user.mfaLockUntil || null;
  }

  resetMfaFailures(id) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) return;
    user.failedMfaAttempts = 0;
    user.mfaLockUntil = null;
    this.write(data);
  }

  isMfaLocked(user) {
    if (!user?.mfaLockUntil) return false;
    return new Date(user.mfaLockUntil).getTime() > Date.now();
  }

  beginTwoFactorSetup(id, encryptedSecret) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) throw new Error('Usuário não encontrado.');
    if (user.twoFactorEnabled) throw new Error('A autenticação em dois fatores já está ativa.');
    user.totpPendingSecretEncrypted = encryptedSecret;
    user.updatedAt = new Date().toISOString();
    this.write(data);
  }

  enableTwoFactor(id, encryptedSecret, recoveryCodeHashes, counter) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) throw new Error('Usuário não encontrado.');
    user.twoFactorEnabled = true;
    user.twoFactorEnabledAt = new Date().toISOString();
    user.totpSecretEncrypted = encryptedSecret;
    user.totpPendingSecretEncrypted = null;
    user.lastTotpCounter = Number(counter ?? -1);
    user.recoveryCodeHashes = [...recoveryCodeHashes];
    user.failedMfaAttempts = 0;
    user.mfaLockUntil = null;
    user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    user.updatedAt = new Date().toISOString();
    this.write(data);
    return user;
  }

  disableTwoFactor(id) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) throw new Error('Usuário não encontrado.');
    user.twoFactorEnabled = false;
    user.twoFactorEnabledAt = null;
    user.totpSecretEncrypted = null;
    user.totpPendingSecretEncrypted = null;
    user.lastTotpCounter = -1;
    user.recoveryCodeHashes = [];
    user.failedMfaAttempts = 0;
    user.mfaLockUntil = null;
    user.sessionVersion = Number(user.sessionVersion || 0) + 1;
    user.updatedAt = new Date().toISOString();
    this.write(data);
    return user;
  }

  setRecoveryCodes(id, hashes) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) throw new Error('Usuário não encontrado.');
    user.recoveryCodeHashes = [...hashes];
    user.updatedAt = new Date().toISOString();
    this.write(data);
    return user;
  }

  consumeRecoveryHash(id, expectedHash) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) return false;
    const index = (user.recoveryCodeHashes || []).findIndex((hash) => hash === expectedHash);
    if (index < 0) return false;
    user.recoveryCodeHashes.splice(index, 1);
    user.lastMfaAt = new Date().toISOString();
    this.write(data);
    return true;
  }

  consumeTotpCounter(id, counter) {
    const data = this.read();
    const user = data.users.find((item) => item.id === id);
    if (!user) return false;
    const current = Number(user.lastTotpCounter ?? -1);
    if (Number(counter) <= current) return false;
    user.lastTotpCounter = Number(counter);
    user.lastMfaAt = new Date().toISOString();
    this.write(data);
    return true;
  }

  audit(actor, action, resource, detail = {}) {
    const data = this.read();
    data.audit.unshift({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      actorId: actor?.id || null,
      actorEmail: actor?.email || 'system',
      action,
      resource,
      detail,
    });
    data.audit = data.audit.slice(0, 5000);
    this.write(data);
  }

  listAudit(limit = 200) {
    return this.read().audit.slice(0, Math.min(Math.max(Number(limit) || 200, 1), 1000));
  }

  publicUser(user) {
    if (!user) return null;
    const {
      passwordHash,
      totpSecretEncrypted,
      totpPendingSecretEncrypted,
      recoveryCodeHashes,
      lastTotpCounter,
      failedLoginAttempts,
      lockUntil,
      failedMfaAttempts,
      mfaLockUntil,
      ...safe
    } = user;
    return {
      ...safe,
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
      recoveryCodesRemaining: Array.isArray(recoveryCodeHashes) ? recoveryCodeHashes.length : 0,
    };
  }
}
