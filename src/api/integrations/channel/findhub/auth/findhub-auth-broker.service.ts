import { PrismaRepository } from '@api/repository/repository.service';
import { randomBytes, randomUUID, timingSafeEqual } from 'crypto';

import { FindHubAuthSession, FindHubStoredCredentials } from '../findhub.types';
import { FindHubCredentialVault } from './findhub-credential-vault';

export type FindHubCredentialBundle = {
  sessionId: string;
  bridgeToken: string;
  email: string;
  androidId: string;
  accountToken: string;
  sharedKey: string;
  fcm?: any;
};

export class FindHubAuthBrokerService {
  private readonly sessions = new Map<string, FindHubAuthSession>();
  private readonly vault = new FindHubCredentialVault();

  constructor(private readonly prisma: PrismaRepository) {}

  public async start(instanceName: string, email: string) {
    const instance = await this.prisma.instance.findUnique({
      where: { name: instanceName },
      select: { id: true },
    });
    if (!instance) throw new Error('Find Hub instance not found');

    // A new attempt invalidates previous attempts for this account, without touching stored keys.
    for (const [id, previous] of this.sessions) {
      if (previous.instanceName === instanceName || previous.expiresAt <= Date.now()) this.sessions.delete(id);
    }
    const previous = await (this.prisma as any).findHubAccount.findUnique({ where: { instanceId: instance.id } });
    const preservedDevices = previous
      ? await (this.prisma as any).findHubDevice.count({ where: { instanceId: instance.id } })
      : 0;
    const hasPreservedAccountData = Boolean(
      preservedDevices > 0 || previous?.trackingSettings || previous?.encryptedTraccar,
    );
    if (
      hasPreservedAccountData &&
      previous?.googleEmail &&
      String(previous.googleEmail).trim().toLowerCase() !== String(email).trim().toLowerCase()
    ) {
      throw new Error('Esta instância possui dados preservados de outra conta Google. Reconecte a mesma conta ou exclua a instância.');
    }
    const hasStoredCredentialMaterial = Boolean(previous?.encryptedCredentials || previous?.encryptedSharedKey);
    const renewal = hasStoredCredentialMaterial && previous?.authState === 'AUTH_REQUIRED';
    if (hasStoredCredentialMaterial && !renewal) {
      throw new Error('A conta já possui credenciais válidas armazenadas. Use a reconexão existente.');
    }
    if (
      renewal &&
      previous?.googleEmail &&
      String(previous.googleEmail).trim().toLowerCase() !== String(email).trim().toLowerCase()
    ) {
      throw new Error('A renovação deve usar a mesma conta Google já vinculada.');
    }

    const bridgeToken = randomBytes(32).toString('base64url');
    const session: FindHubAuthSession = {
      id: randomUUID(),
      instanceName,
      email,
      state: 'WAITING_AUTH',
      bridgeTokenHash: this.vault.hash(bridgeToken),
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
    this.sessions.set(session.id, session);

    if (!renewal) {
      await (this.prisma as any).findHubAccount.upsert({
        where: { instanceId: instance.id },
        update: {
          googleEmail: email,
          authState: 'WAITING_AUTH',
        },
        create: {
          instanceId: instance.id,
          googleEmail: email,
          authState: 'WAITING_AUTH',
          clientUuid: randomUUID(),
        },
      });
    }

    return {
      sessionId: session.id,
      bridgeToken,
      state: session.state,
      authMode: 'credential-provider',
      renewal,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  public async importBundle(
    instanceName: string,
    data: FindHubCredentialBundle,
    options: { validated?: boolean } = {},
  ) {
    const session = this.requireSession(instanceName, data.sessionId, data.bridgeToken);
    const instance = await this.prisma.instance.findUnique({
      where: { name: instanceName },
      select: { id: true },
    });
    if (!instance) throw new Error('Find Hub instance not found');

    if (String(data.email).trim().toLowerCase() !== session.email.trim().toLowerCase()) {
      throw new Error('A conta do bundle não corresponde à sessão de vinculação.');
    }
    const sharedKey = this.decodeKey(data.sharedKey);
    if (sharedKey.length < 16) throw new Error('Invalid Find Hub shared key');

    const credentials: FindHubStoredCredentials = {
      aas: {
        email: data.email || session.email,
        androidId: data.androidId,
        aasToken: data.accountToken,
      },
      ...(data.fcm ? { fcm: data.fcm } : {}),
    };

    await (this.prisma as any).findHubAccount.update({
      where: { instanceId: instance.id },
      data: {
        googleEmail: credentials.aas.email,
        authState: options.validated === true ? 'READY' : 'VERIFYING',
        encryptedCredentials: this.vault.encrypt(credentials),
        encryptedSharedKey: this.vault.encrypt({ key: sharedKey.toString('base64') }),
      },
    });

    this.sessions.delete(session.id);
    return {
      state: options.validated === true ? 'READY' : 'VERIFYING',
      email: credentials.aas.email,
    };
  }

  public async status(instanceName: string) {
    const instance = await this.prisma.instance.findUnique({
      where: { name: instanceName },
      select: { id: true },
    });
    if (!instance) throw new Error('Find Hub instance not found');

    const account = await (this.prisma as any).findHubAccount.findUnique({
      where: { instanceId: instance.id },
    });

    const linked = Boolean(account?.encryptedCredentials && account?.encryptedSharedKey);
    return {
      state: account?.authState || 'WAITING_AUTH',
      email: account?.googleEmail || null,
      linked,
      ready: account?.authState === 'READY' && linked,
    };
  }

  public async load(
    instanceId: string,
  ): Promise<{ credentials: FindHubStoredCredentials; sharedKey: Buffer; account: any } | null> {
    const account = await (this.prisma as any).findHubAccount.findUnique({
      where: { instanceId },
    });
    if (!account?.encryptedCredentials || !account?.encryptedSharedKey) return null;

    const credentials = this.vault.decrypt<FindHubStoredCredentials>(account.encryptedCredentials);
    const shared = this.vault.decrypt<{ key: string }>(account.encryptedSharedKey);
    if (!credentials || !shared?.key) return null;

    return {
      credentials,
      sharedKey: Buffer.from(shared.key, 'base64'),
      account,
    };
  }

  public async persistCredentials(instanceId: string, credentials: FindHubStoredCredentials): Promise<void> {
    await (this.prisma as any).findHubAccount.update({
      where: { instanceId },
      data: {
        encryptedCredentials: this.vault.encrypt(credentials),
      },
    });
  }

  public async setAuthState(instanceId: string, authState: 'READY' | 'AUTH_REQUIRED'): Promise<void> {
    await (this.prisma as any).findHubAccount.updateMany({ where: { instanceId }, data: { authState } });
  }

  public cancel(instanceName: string, id: string, token: string): void {
    this.requireSession(instanceName, id, token);
    this.sessions.delete(id);
  }

  public async unlink(instanceId: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      const instance = await this.prisma.instance.findUnique({
        where: { name: session.instanceName },
        select: { id: true },
      });
      if (instance?.id === instanceId) this.sessions.delete(id);
    }
    await (this.prisma as any).findHubAccount.updateMany({
      where: { instanceId },
      data: {
        authState: 'WAITING_AUTH',
        encryptedCredentials: null,
        encryptedSharedKey: null,
      },
    });
  }

  public async clear(instanceId: string): Promise<void> {
    this.sessions.clear();
    await (this.prisma as any).findHubAccount.deleteMany({
      where: { instanceId },
    });
  }

  private requireSession(instanceName: string, id: string, bridgeToken: string): FindHubAuthSession {
    const session = this.sessions.get(id);

    if (!session || session.instanceName !== instanceName || session.expiresAt < Date.now()) {
      if (session) this.sessions.delete(id);
      throw new Error('Find Hub authentication session expired or invalid');
    }

    if (
      !timingSafeEqual(Buffer.from(this.vault.hash(bridgeToken), 'hex'), Buffer.from(session.bridgeTokenHash, 'hex'))
    ) {
      throw new Error('Invalid Find Hub bridge token');
    }

    return session;
  }

  private decodeKey(value: string): Buffer {
    const normalized = String(value).trim();
    if (/^[0-9a-f]+$/i.test(normalized) && normalized.length % 2 === 0) {
      return Buffer.from(normalized, 'hex');
    }
    return Buffer.from(normalized, 'base64');
  }
}
