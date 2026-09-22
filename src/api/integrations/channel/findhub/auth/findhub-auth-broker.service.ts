import { randomBytes, randomUUID } from 'crypto';

import { PrismaRepository } from '@api/repository/repository.service';

import { GOOGLE_ENDPOINTS } from '../findhub.constants';
import { FindHubAuthSession, FindHubStoredCredentials } from '../findhub.types';
import { FindHubFcmClient } from '../protocol/fcm.client';
import { encodeSecurityUnlockExtras } from '../protocol/findhub-proto';
import { FindHubCredentialVault } from './findhub-credential-vault';
import { GooglePlayAuthClient } from './google-play-auth.client';

export class FindHubAuthBrokerService {
  private readonly sessions = new Map<string, FindHubAuthSession>();
  private readonly vault = new FindHubCredentialVault();
  private readonly googleAuth = new GooglePlayAuthClient();

  constructor(private readonly prisma: PrismaRepository) {}

  public async start(instanceName: string, email: string) {
    const instance = await this.prisma.instance.findUnique({ where: { name: instanceName }, select: { id: true, name: true } });
    if (!instance) throw new Error('Find Hub instance not found');
    const bridgeToken = randomBytes(32).toString('base64url');
    const session: FindHubAuthSession = {
      id: randomUUID(),
      instanceName,
      email,
      state: 'WAITING_OAUTH_TOKEN',
      bridgeTokenHash: this.vault.tokenHash(bridgeToken),
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    this.sessions.set(session.id, session);
    await this.accountUpsert(instance.id, { googleEmail: email, authState: session.state, clientUuid: randomUUID() });
    return {
      sessionId: session.id,
      bridgeToken,
      state: session.state,
      embeddedSetupUrl: GOOGLE_ENDPOINTS.embeddedSetup,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  public async exchange(instanceName: string, data: { sessionId: string; bridgeToken: string; email: string; oauthToken: string }) {
    const session = this.requireSession(instanceName, data.sessionId, data.bridgeToken);
    const instance = await this.prisma.instance.findUnique({ where: { name: instanceName }, select: { id: true } });
    if (!instance) throw new Error('Find Hub instance not found');
    const bootstrapFcm = new FindHubFcmClient(null, async () => undefined, () => undefined);
    const fcm = await bootstrapFcm.ensureRegistered();
    const aas = await this.googleAuth.exchangeEmbeddedOAuthToken(
      data.email || session.email,
      data.oauthToken,
      fcm.gcm.androidId,
    );
    const encryptedCredentials = this.vault.encrypt({ aas, fcm } satisfies FindHubStoredCredentials);
    const unlockPayload = encodeSecurityUnlockExtras();
    const unlockUrl = `https://accounts.google.com/encryption/unlock/android?kdi=${encodeURIComponent(unlockPayload.toString('base64'))}`;
    session.state = 'WAITING_VAULT_KEY';
    session.unlockUrl = unlockUrl;
    await this.accountUpsert(instance.id, {
      googleEmail: aas.email,
      authState: session.state,
      encryptedCredentials,
    });
    return { sessionId: session.id, state: session.state, unlockUrl };
  }

  public async vaultComplete(instanceName: string, data: { sessionId: string; bridgeToken: string; sharedKey?: string; vaultKeys?: any }) {
    const session = this.requireSession(instanceName, data.sessionId, data.bridgeToken);
    const instance = await this.prisma.instance.findUnique({ where: { name: instanceName }, select: { id: true } });
    if (!instance) throw new Error('Find Hub instance not found');
    const sharedKey = data.sharedKey ? this.decodeSharedKey(data.sharedKey) : this.sharedKeyFromVaultKeys(data.vaultKeys);
    if (sharedKey.length < 16) throw new Error('Invalid finder_hw shared key');
    session.state = 'READY';
    await this.accountUpsert(instance.id, {
      authState: 'READY',
      encryptedSharedKey: this.vault.encrypt({ key: sharedKey.toString('base64') }),
    });
    this.sessions.delete(session.id);
    return { state: 'READY' };
  }

  public async status(instanceName: string) {
    const instance = await this.prisma.instance.findUnique({ where: { name: instanceName }, select: { id: true } });
    if (!instance) throw new Error('Find Hub instance not found');
    const account = await (this.prisma as any).findHubAccount.findUnique({ where: { instanceId: instance.id } });
    return {
      state: account?.authState || 'WAITING_AUTH',
      email: account?.googleEmail || null,
      ready: account?.authState === 'READY' && Boolean(account?.encryptedCredentials && account?.encryptedSharedKey),
    };
  }

  public async load(instanceId: string): Promise<{ credentials: FindHubStoredCredentials; sharedKey: Buffer; account: any } | null> {
    const account = await (this.prisma as any).findHubAccount.findUnique({ where: { instanceId } });
    if (!account?.encryptedCredentials || !account?.encryptedSharedKey) return null;
    const credentials = this.vault.decrypt<FindHubStoredCredentials>(account.encryptedCredentials);
    const shared = this.vault.decrypt<{ key: string }>(account.encryptedSharedKey);
    if (!credentials || !shared?.key) return null;
    return { credentials, sharedKey: Buffer.from(shared.key, 'base64'), account };
  }

  public async persistCredentials(instanceId: string, credentials: FindHubStoredCredentials): Promise<void> {
    await (this.prisma as any).findHubAccount.update({
      where: { instanceId },
      data: { encryptedCredentials: this.vault.encrypt(credentials), authState: 'READY' },
    });
  }

  public async clear(instanceId: string): Promise<void> {
    await (this.prisma as any).findHubAccount.deleteMany({ where: { instanceId } });
  }

  private requireSession(instanceName: string, id: string, bridgeToken: string): FindHubAuthSession {
    const session = this.sessions.get(id);
    if (!session || session.instanceName !== instanceName || session.expiresAt < Date.now()) {
      if (session) this.sessions.delete(id);
      throw new Error('Find Hub authentication session expired or invalid');
    }
    if (this.vault.tokenHash(bridgeToken) !== session.bridgeTokenHash) throw new Error('Invalid Find Hub bridge token');
    return session;
  }

  private async accountUpsert(instanceId: string, data: Record<string, any>): Promise<void> {
    await (this.prisma as any).findHubAccount.upsert({
      where: { instanceId },
      update: data,
      create: { instanceId, authState: data.authState || 'WAITING_AUTH', ...data },
    });
  }

  private decodeSharedKey(value: string): Buffer {
    const normalized = String(value).trim();
    if (/^[0-9a-f]+$/i.test(normalized) && normalized.length % 2 === 0) return Buffer.from(normalized, 'hex');
    return Buffer.from(normalized, 'base64');
  }

  private sharedKeyFromVaultKeys(value: any): Buffer {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const finder = parsed?.finder_hw;
    if (!Array.isArray(finder) || !finder.length) throw new Error('finder_hw was not present in Google vault keys');
    const key = finder[0]?.key;
    if (Array.isArray(key)) return Buffer.from(key);
    if (key && typeof key === 'object') {
      return Buffer.from(Object.keys(key).sort((a, b) => Number(a) - Number(b)).map((index) => Number(key[index])));
    }
    throw new Error('Invalid finder_hw vault key');
  }
}
