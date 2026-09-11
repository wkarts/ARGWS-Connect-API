import { PrismaRepository } from '@api/repository/repository.service';
import { timingSafeEqual } from 'crypto';

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

  /** Phone/JID validation for events; intentionally separate from Graph object IDs. */
  public normalizeContactJid(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || text.length > 100) return null;
    const jid = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|c\.us|lid)$/.exec(text);
    if (jid) {
      if (jid[2] === 'lid') return `${jid[1]}@lid`;
      return /^\d{8,15}$/.test(jid[1]) ? `${jid[1]}@s.whatsapp.net` : null;
    }
    if (text.includes('@') || !/^\+?[\d\s().-]+$/.test(text)) return null;
    const digits = text.replace(/\D/g, '');
    return /^\d{8,15}$/.test(digits) ? `${digits}@s.whatsapp.net` : null;
  }

  public contactPhone(value: unknown): string | null {
    const jid = this.normalizeContactJid(value);
    return jid?.endsWith('@s.whatsapp.net') ? jid.split('@')[0] : null;
  }

  public async resolveContactProfile(instanceId: string, jidCandidates: string[]) {
    // Bounded, exact, instance-scoped lookup. No provider calls or history scans.
    const candidates = new Set<string>();
    for (const value of (jidCandidates || []).slice(0, 24)) {
      const jid = this.normalizeContactJid(value);
      if (!jid) continue;
      candidates.add(value.trim());
      candidates.add(jid);
      if (jid.endsWith('@s.whatsapp.net')) candidates.add(jid.replace('@s.whatsapp.net', '@c.us'));
    }
    if (!instanceId || !candidates.size) return null;
    const contacts = await this.prisma.contact.findMany({
      where: { instanceId, remoteJid: { in: [...candidates] } },
      select: { remoteJid: true, pushName: true, profilePicUrl: true, updatedAt: true },
      take: candidates.size,
    });
    const score = (contact: (typeof contacts)[number]) =>
      Number(Boolean(contact.pushName?.trim())) + Number(Boolean(contact.profilePicUrl?.trim()));
    const time = (value: Date | null) => new Date(value || 0).getTime() || 0;
    return (
      contacts.sort((left, right) => score(right) - score(left) || time(right.updatedAt) - time(left.updatedAt))[0] ||
      null
    );
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

  public async resolveByInstanceName(instanceName: string): Promise<MetaCloudIdentity> {
    const instance = await this.prisma.instance.findUnique({ where: { name: instanceName } });
    if (!instance) throw new MetaCloudGraphError(404, `Instance ${instanceName} was not found.`);
    return this.identityFromInstance(instance);
  }

  public async resolveByPhoneNumberId(phoneNumberId: string, instanceToken?: string | null): Promise<MetaCloudIdentity> {
    const target = this.normalizePhone(phoneNumberId);
    if (!target) throw new MetaCloudGraphError(404, 'phoneNumberId was not found.');

    const instances = await this.prisma.instance.findMany({
      where: { integration: { in: ['WHATSAPP-BUSINESS', 'WHATSAPP-BAILEYS', 'WHATSAPP-ZAPO'] } },
    });

    const matches: MetaCloudIdentity[] = [];
    for (const instance of instances) {
      try {
        const identity = this.identityFromInstance(instance);
        if (identity.phoneNumberId === target || String(identity.phoneNumberId) === String(phoneNumberId))
          matches.push(identity);
      } catch {
        // Instances without a stable identity are not Graph-addressable.
      }
    }
    if (matches.length) return this.selectByInstanceToken(matches, instanceToken);
    throw new MetaCloudGraphError(404, `phoneNumberId ${phoneNumberId} was not found.`);
  }

  public async resolveByBusinessAccountId(
    businessAccountId: string,
    instanceToken?: string | null,
  ): Promise<MetaCloudIdentity> {
    const instances = await this.prisma.instance.findMany({
      where: { integration: { in: ['WHATSAPP-BUSINESS', 'WHATSAPP-BAILEYS', 'WHATSAPP-ZAPO'] } },
    });
    const matches: MetaCloudIdentity[] = [];
    for (const instance of instances) {
      try {
        const identity = this.identityFromInstance(instance);
        if (identity.businessAccountId === businessAccountId) matches.push(identity);
      } catch {
        // Ignore non-addressable instances.
      }
    }
    if (matches.length) return this.selectByInstanceToken(matches, instanceToken);
    throw new MetaCloudGraphError(404, `businessAccountId ${businessAccountId} was not found.`);
  }

  private selectByInstanceToken(identities: MetaCloudIdentity[], instanceToken?: string | null): MetaCloudIdentity {
    // A phone/WABA may belong to multiple persisted instances. Prefer the exact
    // credential only among matches for that object; authorization still runs
    // in the controller. Preserve the legacy fallback for administrative tokens.
    if (!instanceToken) return identities[0];
    const provided = Buffer.from(instanceToken);
    return (
      identities.find((identity) => {
        if (typeof identity.token !== 'string' || !identity.token) return false;
        const expected = Buffer.from(identity.token);
        return expected.length === provided.length && timingSafeEqual(expected, provided);
      }) || identities[0]
    );
  }
}
