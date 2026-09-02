import { PrismaRepository } from '@api/repository/repository.service';
import { Events } from '@api/types/wa.types';

import { MetaCloudGraphError } from './meta-cloud.error';
import { MetaCloudIdentity } from './types/meta-response.types';

export type MetaPolicyMode = 'PERMISSIVE' | 'OBSERVE' | 'STRICT';

const DEFAULT_WINDOW_SECONDS = 24 * 60 * 60;
const POLICY_MODES = new Set<MetaPolicyMode>(['PERMISSIVE', 'OBSERVE', 'STRICT']);

export class MetaCloudPolicyService {
  constructor(private readonly prisma: PrismaRepository) {}

  public normalizeMode(value?: string | null): MetaPolicyMode {
    const mode = String(value || 'PERMISSIVE').toUpperCase() as MetaPolicyMode;
    return POLICY_MODES.has(mode) ? mode : 'PERMISSIVE';
  }

  public normalizeWindowSeconds(value?: number | null): number {
    const numeric = Number(value || DEFAULT_WINDOW_SECONDS);
    if (!Number.isFinite(numeric)) return DEFAULT_WINDOW_SECONDS;
    return Math.min(Math.max(Math.round(numeric), 60), 30 * 24 * 60 * 60);
  }

  public async handleEvent(eventData: { instanceName: string; event: string; data: object }): Promise<void> {
    if (eventData.event !== Events.MESSAGES_UPSERT) return;
    const message = eventData.data as any;
    if (message?.key?.fromMe) return;

    const remoteJid = this.normalizeRecipient(message?.key?.remoteJid);
    if (!remoteJid) return;

    const instance = await this.prisma.instance.findUnique({
      where: { name: eventData.instanceName },
      select: { id: true },
    });
    if (!instance) return;

    const config = await this.getConfig(instance.id);
    const timestamp = Number(message?.messageTimestamp || 0);
    const inboundAt = timestamp > 1_000_000_000 ? new Date(timestamp * 1000) : new Date();
    const windowExpiresAt = new Date(inboundAt.getTime() + config.windowSeconds * 1000);

    await this.prisma.metaConversationWindow.upsert({
      where: { instanceId_remoteJid: { instanceId: instance.id, remoteJid } },
      create: {
        instanceId: instance.id,
        remoteJid,
        lastInboundAt: inboundAt,
        windowExpiresAt,
        lastPolicyDecision: 'WINDOW_OPENED_BY_INBOUND',
        lastPolicyAt: new Date(),
      },
      update: {
        lastInboundAt: inboundAt,
        windowExpiresAt,
        lastPolicyDecision: 'WINDOW_OPENED_BY_INBOUND',
        lastPolicyAt: new Date(),
      },
    });
  }

  public async assertOutbound(identity: MetaCloudIdentity, recipient: string, messageType: string) {
    const remoteJid = this.normalizeRecipient(recipient);
    const config = await this.getConfig(identity.instanceId);
    const window = await this.prisma.metaConversationWindow.findUnique({
      where: { instanceId_remoteJid: { instanceId: identity.instanceId, remoteJid } },
    });
    const now = new Date();
    const windowOpen = Boolean(window?.windowExpiresAt && window.windowExpiresAt.getTime() > now.getTime());
    const template = String(messageType || '').toLowerCase() === 'template';

    // Meta Business continua soberana: registramos telemetria local, mas a Meta
    // decide as regras finais para o provider oficial.
    if (identity.provider === 'WHATSAPP-BUSINESS') {
      await this.recordDecision(identity.instanceId, remoteJid, 'DELEGATED_TO_META', false, now);
      return { mode: config.mode, windowOpen, decision: 'DELEGATED_TO_META' };
    }

    if (windowOpen || template || !config.templateRequiredOutsideWindow) {
      const decision = windowOpen ? 'ALLOW_WINDOW_OPEN' : template ? 'ALLOW_TEMPLATE' : 'ALLOW_POLICY_OVERRIDE';
      await this.recordDecision(identity.instanceId, remoteJid, decision, false, now);
      return { mode: config.mode, windowOpen, decision };
    }

    if (config.mode === 'PERMISSIVE') {
      await this.recordDecision(identity.instanceId, remoteJid, 'ALLOW_PERMISSIVE_OUTSIDE_WINDOW', true, now);
      return { mode: config.mode, windowOpen: false, decision: 'ALLOW_PERMISSIVE_OUTSIDE_WINDOW' };
    }

    if (config.mode === 'OBSERVE') {
      await this.recordDecision(identity.instanceId, remoteJid, 'WOULD_BLOCK_OUTSIDE_WINDOW', true, now);
      return { mode: config.mode, windowOpen: false, decision: 'WOULD_BLOCK_OUTSIDE_WINDOW' };
    }

    await this.recordDecision(identity.instanceId, remoteJid, 'BLOCK_OUTSIDE_WINDOW', true, now);
    throw new MetaCloudGraphError(
      400,
      'Re-engagement message outside the customer service window requires a template in STRICT Meta policy mode.',
      131047,
      'OAuthException',
    );
  }

  public async recordOutbound(instanceId: string, recipient: string) {
    const remoteJid = this.normalizeRecipient(recipient);
    if (!remoteJid) return;
    await this.prisma.metaConversationWindow.upsert({
      where: { instanceId_remoteJid: { instanceId, remoteJid } },
      create: { instanceId, remoteJid, lastOutboundAt: new Date() },
      update: { lastOutboundAt: new Date() },
    });
  }

  public async inspect(instanceId: string, recipient: string) {
    const remoteJid = this.normalizeRecipient(recipient);
    const config = await this.getConfig(instanceId);
    const row = await this.prisma.metaConversationWindow.findUnique({
      where: { instanceId_remoteJid: { instanceId, remoteJid } },
    });
    const now = Date.now();
    const expiresAt = row?.windowExpiresAt?.getTime() || 0;
    return {
      recipient: remoteJid,
      mode: config.mode,
      windowSeconds: config.windowSeconds,
      templateRequiredOutsideWindow: config.templateRequiredOutsideWindow,
      windowOpen: expiresAt > now,
      secondsRemaining: expiresAt > now ? Math.ceil((expiresAt - now) / 1000) : 0,
      lastInboundAt: row?.lastInboundAt || null,
      windowExpiresAt: row?.windowExpiresAt || null,
      lastOutboundAt: row?.lastOutboundAt || null,
      lastPolicyDecision: row?.lastPolicyDecision || null,
      lastPolicyAt: row?.lastPolicyAt || null,
      violationCount: row?.violationCount || 0,
    };
  }

  public async getConfig(instanceId: string) {
    const config = await this.prisma.metaCompatibility.findUnique({ where: { instanceId } });
    return {
      mode: this.normalizeMode(config?.policyMode),
      windowSeconds: this.normalizeWindowSeconds(config?.windowSeconds),
      templateRequiredOutsideWindow: config?.templateRequiredOutsideWindow !== false,
    };
  }

  private async recordDecision(instanceId: string, remoteJid: string, decision: string, violation: boolean, at: Date) {
    if (!remoteJid) return;
    await this.prisma.metaConversationWindow.upsert({
      where: { instanceId_remoteJid: { instanceId, remoteJid } },
      create: {
        instanceId,
        remoteJid,
        lastPolicyDecision: decision,
        lastPolicyAt: at,
        violationCount: violation ? 1 : 0,
      },
      update: {
        lastPolicyDecision: decision,
        lastPolicyAt: at,
        ...(violation ? { violationCount: { increment: 1 } } : {}),
      },
    });
  }

  private normalizeRecipient(value: unknown) {
    return String(value || '')
      .split('@')[0]
      .replace(/\D/g, '');
  }
}
