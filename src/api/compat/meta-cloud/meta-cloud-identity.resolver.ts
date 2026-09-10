import { PrismaRepository } from '@api/repository/repository.service';

import { MetaCloudGraphError } from './meta-cloud.error';
import { MetaCloudIdentity } from './types/meta-response.types';

export class MetaCloudIdentityResolver {
  constructor(private readonly prisma: PrismaRepository) {}

  public normalizePhone(value?: string | null): string | null {
    if (!value) return null;
    const withoutJid = String(value).split('@', 1)[0];
    const digits = withoutJid.replace(/\D/g, '');
    return digits.length >= 8 ? digits : null;
  }

  public identityFromInstance(instance: any): MetaCloudIdentity {
    const provider = String(instance?.integration || '');
    let phoneNumberId: string | null = null;
    let businessAccountId: string | null = null;
    let displayPhoneNumber: string | null = null;

    if (provider === 'WHATSAPP-BUSINESS') {
      phoneNumberId = this.normalizePhone(instance?.number) || String(instance?.number || '') || null;
      businessAccountId = instance?.businessId ? String(instance.businessId) : null;
      displayPhoneNumber = this.normalizePhone(instance?.number) || phoneNumberId;
    } else if (provider === 'WHATSAPP-BAILEYS' || provider === 'WHATSAPP-ZAPO') {
      const stablePhone = this.normalizePhone(instance?.number) || this.normalizePhone(instance?.ownerJid);
      phoneNumberId = stablePhone;
      businessAccountId = stablePhone;
      displayPhoneNumber = stablePhone;
    }

    if (!phoneNumberId || !businessAccountId || !displayPhoneNumber) {
      throw new MetaCloudGraphError(
        400,
        `Meta Cloud compatibility requires a stable phone identity for instance ${instance?.name || 'unknown'}.`,
      );
    }

    return {
      instanceId: String(instance.id),
      instanceName: String(instance.name),
      provider,
      phoneNumberId,
      businessAccountId,
      displayPhoneNumber,
      token: instance?.token || undefined,
      instance,
    };
  }

  public async resolveContactProfile(instanceId: string, jidCandidates: string[]) {
    const candidates = [...new Set((jidCandidates || []).map((value) => String(value || '').trim()).filter(Boolean))];
    if (!candidates.length) return null;

    const contacts = await this.prisma.contact.findMany({
      where: {
        instanceId,
        remoteJid: { in: candidates },
      },
      select: {
        remoteJid: true,
        pushName: true,
        profilePicUrl: true,
        updatedAt: true,
      },
    });
    if (!contacts.length) return null;

    return contacts.sort((left: any, right: any) => {
      const leftScore = Number(Boolean(left.pushName)) + Number(Boolean(left.profilePicUrl));
      const rightScore = Number(Boolean(right.pushName)) + Number(Boolean(right.profilePicUrl));
      if (leftScore !== rightScore) return rightScore - leftScore;
      return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
    })[0];
  }

  public async resolveByInstanceName(instanceName: string): Promise<MetaCloudIdentity> {
    const instance = await this.prisma.instance.findUnique({ where: { name: instanceName } });
    if (!instance) throw new MetaCloudGraphError(404, `Instance ${instanceName} was not found.`);
    return this.identityFromInstance(instance);
  }

  public async resolveByPhoneNumberId(phoneNumberId: string): Promise<MetaCloudIdentity> {
    const target = this.normalizePhone(phoneNumberId);
    if (!target) throw new MetaCloudGraphError(404, 'phoneNumberId was not found.');

    const instances = await this.prisma.instance.findMany({
      where: { integration: { in: ['WHATSAPP-BUSINESS', 'WHATSAPP-BAILEYS', 'WHATSAPP-ZAPO'] } },
    });

    for (const instance of instances) {
      try {
        const identity = this.identityFromInstance(instance);
        if (identity.phoneNumberId === target || String(identity.phoneNumberId) === String(phoneNumberId))
          return identity;
      } catch {
        // Instances without a stable identity are not Graph-addressable.
      }
    }
    throw new MetaCloudGraphError(404, `phoneNumberId ${phoneNumberId} was not found.`);
  }

  public async resolveByBusinessAccountId(businessAccountId: string): Promise<MetaCloudIdentity> {
    const instances = await this.prisma.instance.findMany({
      where: { integration: { in: ['WHATSAPP-BUSINESS', 'WHATSAPP-BAILEYS', 'WHATSAPP-ZAPO'] } },
    });
    for (const instance of instances) {
      try {
        const identity = this.identityFromInstance(instance);
        if (identity.businessAccountId === businessAccountId) return identity;
      } catch {
        // Ignore non-addressable instances.
      }
    }
    throw new MetaCloudGraphError(404, `businessAccountId ${businessAccountId} was not found.`);
  }
}
