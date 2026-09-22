import { createHash, randomBytes, timingSafeEqual } from 'crypto';

import { decryptOwnerKey } from '../crypto/findhub-crypto';
import { GOOGLE_ENDPOINTS } from '../findhub.constants';
import { FindHubAasCredentials } from '../findhub.types';
import { encodeSecurityUnlockExtras } from '../protocol/findhub-proto';
import { FindHubSpotClient } from '../protocol/spot.client';
import { FindHubStartupService } from '../services/findhub-runtime.service';
import { FindHubAuthError, safeFindHubAuthError } from './findhub-auth.error';
import { GooglePlayAuthClient } from './google-play-auth.client';

type Stage = 'WAITING_USER' | 'EXCHANGING' | 'WAITING_VAULT_KEY' | 'VERIFYING';
type Proof = { sessionId: string; bridgeToken: string };
type Attempt = {
  instanceId: string;
  instanceName: string;
  email: string;
  secretHash: Buffer;
  expiresAt: number;
  stage: Stage;
  credentials?: FindHubAasCredentials;
  timer: NodeJS.Timeout;
};
const digest = (value: string) => createHash('sha256').update(value).digest();

/** Parse only finder_hw material, never arbitrary Google vault domains. */
export function findHubVaultKeys(input: unknown): Buffer[] {
  if (typeof input !== 'string' || input.length > 65536) throw new Error('Resposta do cofre Google inválida.');
  let parsed: any;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error('Resposta do cofre Google inválida.');
  }
  const records = parsed?.finder_hw;
  if (!Array.isArray(records) || !records.length || records.length > 32) {
    throw new Error('O Google não retornou chaves do domínio Find Hub.');
  }
  return [...records]
    .sort((a, b) => Number(b?.epoch || 0) - Number(a?.epoch || 0))
    .map((entry) => {
      const value = entry?.key;
      if (!value || typeof value !== 'object') throw new Error('Chave Find Hub inválida.');
      const size = Object.keys(value).length;
      if (![16, 24, 32].includes(size)) throw new Error('Comprimento de chave Find Hub inválido.');
      const bytes = Array.from({ length: size }, (_, index) => value[index]);
      if (!bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
        throw new Error('Formato de chave Find Hub inválido.');
      }
      return Buffer.from(bytes);
    });
}

export class FindHubBrowserAuthService {
  private readonly starting = new Set<string>();
  private readonly attempts = new Map<string, Attempt>();
  private readonly google = new GooglePlayAuthClient();

  public async start(runtime: FindHubStartupService, email: string) {
    if (runtime.connectionStatus.state === 'open')
      throw new Error('Desconecte a conta antes de iniciar outra vinculação.');
    const normalized = String(email || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320)
      throw new Error('Informe um e-mail válido.');
    for (const [id, attempt] of this.attempts) {
      if (attempt.instanceId === runtime.instanceId) {
        if (attempt.stage === 'VERIFYING') throw new Error('A verificação anterior ainda está em andamento.');
        this.discard(id);
      }
    }
    if (this.attempts.size >= 128) throw new Error('Limite de vinculações simultâneas atingido.');
    if (this.starting.has(runtime.instanceId)) throw new Error('A vinculação desta conta está sendo iniciada.');
    this.starting.add(runtime.instanceId);
    let session: Awaited<ReturnType<ReturnType<FindHubStartupService['auth']>['start']>>;
    try {
      session = await runtime.auth().start(runtime.instanceName, normalized);
    } finally {
      this.starting.delete(runtime.instanceId);
    }
    const expiresAt = Date.parse(session.expiresAt);
    const timer = setTimeout(() => this.discard(session.sessionId), Math.max(1, expiresAt - Date.now()));
    timer.unref?.();
    this.attempts.set(session.sessionId, {
      instanceId: runtime.instanceId,
      instanceName: runtime.instanceName,
      email: normalized,
      secretHash: digest(session.bridgeToken),
      expiresAt,
      stage: 'WAITING_USER',
      timer,
    });
    return {
      ...session,
      authMode: 'browser-extension',
      state: 'WAITING_USER',
      loginUrl: GOOGLE_ENDPOINTS.embeddedSetup,
      browserRequired: true,
      helperRequired: true,
    };
  }

  private require(runtime: FindHubStartupService, proof: Proof): Attempt {
    const attempt = this.attempts.get(proof.sessionId);
    if (
      !attempt ||
      attempt.instanceId !== runtime.instanceId ||
      attempt.expiresAt <= Date.now() ||
      typeof proof.bridgeToken !== 'string' ||
      !timingSafeEqual(digest(proof.bridgeToken), attempt.secretHash)
    ) {
      throw new FindHubAuthError(9110);
    }
    return attempt;
  }

  private discard(id: string): void {
    const attempt = this.attempts.get(id);
    if (attempt) {
      clearTimeout(attempt.timer);
      attempt.credentials = undefined;
    }
    this.attempts.delete(id);
  }

  public abort(runtime: FindHubStartupService): void {
    for (const [id, attempt] of this.attempts) {
      if (attempt.instanceId === runtime.instanceId) {
        if (attempt.stage === 'VERIFYING') throw new Error('Aguarde a verificação terminar antes de desconectar.');
        this.discard(id);
      }
    }
  }

  public pending(runtime: FindHubStartupService) {
    const active = [...this.attempts.entries()].find(
      ([, attempt]) => attempt.instanceId === runtime.instanceId && attempt.expiresAt > Date.now(),
    );
    return active ? { state: active[1].stage, expiresAt: new Date(active[1].expiresAt).toISOString() } : null;
  }

  public cancel(runtime: FindHubStartupService, proof: Proof) {
    const attempt = this.require(runtime, proof);
    if (attempt.stage === 'VERIFYING') throw new Error('Aguarde o término da verificação antes de desconectar.');
    runtime.auth().cancel(runtime.instanceName, proof.sessionId, proof.bridgeToken);
    this.discard(proof.sessionId);
    return { state: 'CANCELLED' };
  }

  public async exchange(runtime: FindHubStartupService, data: Proof & { oauthToken: string }) {
    const attempt = this.require(runtime, data);
    if (attempt.stage !== 'WAITING_USER') throw new Error('Este token já foi processado. Inicie outra vinculação.');
    attempt.stage = 'EXCHANGING';
    try {
      const credentials = await this.google.exchange(attempt.email, data.oauthToken, randomBytes(8).toString('hex'));
      this.require(runtime, data); // Cancellation/expiry during the network call must win.
      attempt.credentials = credentials;
      attempt.stage = 'WAITING_VAULT_KEY';
      const url = new URL('https://accounts.google.com/encryption/unlock/android');
      url.searchParams.set('kdi', encodeSecurityUnlockExtras(data.sessionId).toString('base64'));
      url.searchParams.set('authuser', credentials.email);
      return { state: attempt.stage, unlockUrl: url.toString() };
    } catch (error) {
      this.discard(data.sessionId);
      try {
        runtime.auth().cancel(runtime.instanceName, data.sessionId, data.bridgeToken);
      } catch {
        /* Already expired/cancelled. Never clear a previously persisted account here. */
      }
      throw safeFindHubAuthError(error, 9111);
    }
  }

  public async complete(runtime: FindHubStartupService, data: Proof & { vaultKeys: string }) {
    const attempt = this.require(runtime, data);
    if (attempt.stage !== 'WAITING_VAULT_KEY' || !attempt.credentials)
      throw new Error('O login Google ainda não foi validado.');
    const candidates = findHubVaultKeys(data.vaultKeys);
    attempt.stage = 'VERIFYING';
    try {
      const envelope = await new FindHubSpotClient(this.google, attempt.credentials).ownerKeyEnvelope();
      let sharedKey: Buffer | undefined;
      for (const candidate of candidates) {
        try {
          decryptOwnerKey(candidate, envelope.encryptedOwnerKey);
          sharedKey = candidate;
          break;
        } catch {
          /* Try retained key epochs. */
        }
      }
      if (!sharedKey) throw new FindHubAuthError(9112);
      this.require(runtime, data);
      await runtime.auth().importBundle(runtime.instanceName, {
        ...data,
        email: attempt.credentials.email,
        androidId: attempt.credentials.androidId,
        accountToken: attempt.credentials.aasToken,
        sharedKey: sharedKey.toString('base64'),
      });
      await runtime.connect();
      if (!runtime.transportReady) throw new FindHubAuthError(9113);
      return { state: 'READY', email: attempt.email, connected: runtime.transportReady };
    } catch (error) {
      throw safeFindHubAuthError(error, 9113);
    } finally {
      this.discard(data.sessionId);
    }
  }
}
