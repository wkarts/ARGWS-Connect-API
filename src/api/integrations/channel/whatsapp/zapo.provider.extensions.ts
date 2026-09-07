import { OnWhatsAppDto, WhatsAppNumberDto } from '@api/dto/chat.dto';
import { HandleLabelDto, LabelDto } from '@api/dto/label.dto';
import { Events } from '@api/types/wa.types';
import { Database } from '@config/env.config';
import { BadRequestException, NotFoundException } from '@exceptions';
import { createJid } from '@utils/createJid';

import { ZapoStartupService } from './zapo.whatsapp.service';

type ZapoAppStateMutationEvent = {
  schema?: string;
  operation?: 'set' | 'remove';
  source?: string;
  timestamp?: number;
  id?: string;
  labelId?: string;
  chatJid?: string;
  labeled?: boolean;
  name?: string;
  color?: string | number;
  isActive?: boolean;
  predefinedId?: string;
  _raw?: { index?: string };
};

type ZapoRawMutation = {
  operation?: 'set' | 'remove';
  source?: string;
  timestamp?: number;
  index?: string;
  value?: {
    labelEditAction?: Record<string, unknown>;
    labelAssociationAction?: Record<string, unknown>;
  } | null;
};

type NumberPlan = {
  index: number;
  number: string;
  jid: string;
  kind: 'user' | 'lid' | 'group' | 'broadcast' | 'invalid';
  phoneNumber?: string;
};

/**
 * Provider-level compatibility additions that intentionally live outside the
 * native Zapo transport implementation. This keeps provider-specific protocol
 * code isolated while preserving the public Connect|API controller contract.
 */
export class ZapoExtendedStartupService extends ZapoStartupService {
  private readonly extendedBoundClients = new WeakSet<object>();
  private readonly recentMutationKeys = new Map<string, number>();
  private labelBootstrapAttempted = false;

  public async connectToWhatsapp(): Promise<any> {
    const client = await super.connectToWhatsapp();
    this.bindExtendedClientEvents(client);
    return client;
  }

  public async prepareQrConnection(): Promise<any> {
    const client = await super.prepareQrConnection();
    this.bindExtendedClientEvents(client);
    return client;
  }

  public async preparePairingConnection(number: string): Promise<any> {
    const client = await super.preparePairingConnection(number);
    this.bindExtendedClientEvents(client);
    return client;
  }

  private bindExtendedClientEvents(client: any) {
    if (!client || (typeof client !== 'object' && typeof client !== 'function')) return;
    if (this.extendedBoundClients.has(client)) return;
    this.extendedBoundClients.add(client);

    client.on('presence', (event: any) => {
      void this.handlePresenceEvent(event).catch((error: Error) => this.logger.error(error));
    });

    client.on('chatstate', (event: any) => {
      void this.handleChatstateEvent(event).catch((error: Error) => this.logger.error(error));
    });

    client.on('app_state_mutation', (event: ZapoAppStateMutationEvent) => {
      void this.handleAppStateMutation(event).catch((error: Error) => this.logger.error(error));
    });

    // The native coordinator emits the local action here immediately after a
    // successful app-state flush. Keeping this listener makes label updates
    // visible to the same webhook consumers that already receive Baileys label
    // events, without waiting for a later server echo.
    client.on('mutation_send', (event: ZapoAppStateMutationEvent) => {
      void this.handleAppStateMutation(event).catch((error: Error) => this.logger.error(error));
    });

    client.on('connection', (event: any) => {
      if (event?.status === 'open') {
        void this.bootstrapLabelsFromAppState().catch((error: Error) => this.logger.error(error));
      }
    });
  }

  private isGroupsIgnored(): boolean {
    return this.localSettings.groupsIgnore === true;
  }

  private async handlePresenceEvent(event: any) {
    const chatJid = this.tryNormalizeJid(event?.chatJid);
    if (!chatJid) return;
    if (this.isGroupsIgnored() && chatJid.endsWith('@g.us')) return;

    const participantJid = this.tryNormalizeJid(event?.participantJid) ?? chatJid;
    const presence: Record<string, unknown> = {
      lastKnownPresence: event?.type ?? 'unavailable',
    };

    if (event?.lastSeen?.kind === 'timestamp' && Number.isFinite(event.lastSeen.unixSeconds)) {
      presence.lastSeen = event.lastSeen.unixSeconds;
    }

    this.sendDataWebhook(Events.PRESENCE_UPDATE, {
      id: chatJid,
      presences: { [participantJid]: presence },
    });
  }

  private async handleChatstateEvent(event: any) {
    const chatJid = this.tryNormalizeJid(event?.chatJid);
    if (!chatJid) return;
    if (this.isGroupsIgnored() && chatJid.endsWith('@g.us')) return;

    const participantJid = this.tryNormalizeJid(event?.participantJid) ?? chatJid;
    const state =
      event?.state === 'paused' ? 'paused' : event?.media === 'audio' ? 'recording' : 'composing';

    this.sendDataWebhook(Events.PRESENCE_UPDATE, {
      id: chatJid,
      presences: {
        [participantJid]: {
          lastKnownPresence: state,
        },
      },
    });
  }

  private mutationKey(event: ZapoAppStateMutationEvent): string {
    return [
      event.schema ?? '',
      event.operation ?? '',
      event.timestamp ?? '',
      event.id ?? '',
      event.labelId ?? '',
      event.chatJid ?? '',
      event.labeled ?? '',
    ].join('|');
  }

  private isDuplicateMutation(event: ZapoAppStateMutationEvent): boolean {
    const now = Date.now();
    const key = this.mutationKey(event);
    const previous = this.recentMutationKeys.get(key);

    for (const [entryKey, seenAt] of this.recentMutationKeys) {
      if (now - seenAt > 60_000) this.recentMutationKeys.delete(entryKey);
    }

    if (previous && now - previous < 30_000) return true;
    this.recentMutationKeys.set(key, now);

    if (this.recentMutationKeys.size > 1024) {
      const oldest = this.recentMutationKeys.keys().next().value as string | undefined;
      if (oldest) this.recentMutationKeys.delete(oldest);
    }

    return false;
  }

  private async handleAppStateMutation(event: ZapoAppStateMutationEvent) {
    if (!event?.schema || this.isDuplicateMutation(event)) return;

    if (event.schema === 'LabelEdit') {
      await this.handleLabelEditMutation(event);
      return;
    }

    if (event.schema === 'LabelJid') {
      await this.handleLabelAssociationMutation(event);
    }
  }

  private async handleLabelEditMutation(event: ZapoAppStateMutationEvent) {
    const labelId = String(event.id ?? '').trim();
    if (!labelId) return;

    const deleted = event.operation === 'remove' || event.isActive === false;
    const saved = await this.prismaRepository.label.findUnique({
      where: { labelId_instanceId: { labelId, instanceId: this.instanceId } },
    });

    const name = String(event.name ?? saved?.name ?? '').trim();
    const color = String(event.color ?? saved?.color ?? '0');

    if (deleted) {
      if (this.configService.get<Database>('DATABASE').SAVE_DATA.LABELS) {
        await this.prismaRepository.label.deleteMany({ where: { instanceId: this.instanceId, labelId } });
      }
    } else if (name && this.configService.get<Database>('DATABASE').SAVE_DATA.LABELS) {
      await this.prismaRepository.label.upsert({
        where: { labelId_instanceId: { labelId, instanceId: this.instanceId } },
        update: {
          name,
          color,
          predefinedId: event.predefinedId ?? saved?.predefinedId,
        },
        create: {
          labelId,
          name,
          color,
          predefinedId: event.predefinedId,
          instanceId: this.instanceId,
        },
      });
    }

    this.sendDataWebhook(Events.LABELS_EDIT, {
      id: labelId,
      name,
      color,
      predefinedId: event.predefinedId ?? saved?.predefinedId,
      deleted,
      instance: this.instance.name,
    });
  }

  private async handleLabelAssociationMutation(event: ZapoAppStateMutationEvent) {
    const labelId = String(event.labelId ?? '').trim();
    const chatJid = this.tryNormalizeJid(event.chatJid);
    if (!labelId || !chatJid) return;

    const type: 'add' | 'remove' =
      event.operation === 'remove' || event.labeled === false ? 'remove' : 'add';

    await this.updateLocalChatLabel(labelId, chatJid, type);

    this.sendDataWebhook(Events.LABELS_ASSOCIATION, {
      instance: this.instance.name,
      type,
      chatId: chatJid,
      labelId,
    });
  }

  private async updateLocalChatLabel(labelId: string, chatJid: string, action: 'add' | 'remove') {
    if (!this.configService.get<Database>('DATABASE').SAVE_DATA.CHATS) return;

    const existing = await this.prismaRepository.chat.findUnique({
      where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: chatJid } },
    });
    const currentLabels = Array.isArray(existing?.labels)
      ? existing.labels.filter((value): value is string => typeof value === 'string')
      : [];
    const nextLabels =
      action === 'add'
        ? [...new Set([...currentLabels, labelId])]
        : currentLabels.filter((currentLabel) => currentLabel !== labelId);

    await this.prismaRepository.chat.upsert({
      where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: chatJid } },
      update: { labels: nextLabels },
      create: {
        instanceId: this.instanceId,
        remoteJid: chatJid,
        labels: nextLabels,
      },
    });
  }

  private async bootstrapLabelsFromAppState() {
    if (this.labelBootstrapAttempted || !this.client?.chat?.sync) return;
    this.labelBootstrapAttempted = true;

    try {
      const syncResult = await this.client.chat.sync({ collections: ['regular'] });
      for (const collection of syncResult?.collections ?? []) {
        for (const mutation of collection?.mutations ?? []) {
          await this.handleRawMutation(mutation as ZapoRawMutation);
        }
      }
    } catch (error) {
      // A fetch can happen before the connection reaches OPEN. Allow one later
      // retry in that case rather than permanently considering bootstrap done.
      if (String((error as Error)?.message ?? error).includes('not connected')) {
        this.labelBootstrapAttempted = false;
        return;
      }
      throw error;
    }
  }

  private async handleRawMutation(mutation: ZapoRawMutation) {
    if (!mutation?.index) return;

    let indexParts: unknown;
    try {
      indexParts = JSON.parse(mutation.index);
    } catch {
      return;
    }
    if (!Array.isArray(indexParts) || indexParts.length === 0) return;

    if (indexParts[0] === 'label_edit') {
      const action = mutation.value?.labelEditAction ?? {};
      await this.handleAppStateMutation({
        schema: 'LabelEdit',
        operation: mutation.operation,
        source: mutation.source,
        timestamp: mutation.timestamp,
        id: typeof indexParts[1] === 'string' ? indexParts[1] : undefined,
        name: typeof action.name === 'string' ? action.name : undefined,
        color:
          typeof action.color === 'string' || typeof action.color === 'number'
            ? (action.color as string | number)
            : undefined,
        isActive: typeof action.isActive === 'boolean' ? action.isActive : undefined,
      });
      return;
    }

    if (indexParts[0] === 'label_jid') {
      const action = mutation.value?.labelAssociationAction ?? {};
      await this.handleAppStateMutation({
        schema: 'LabelJid',
        operation: mutation.operation,
        source: mutation.source,
        timestamp: mutation.timestamp,
        labelId: typeof indexParts[1] === 'string' ? indexParts[1] : undefined,
        chatJid: typeof indexParts[2] === 'string' ? indexParts[2] : undefined,
        labeled: typeof action.labeled === 'boolean' ? action.labeled : undefined,
      });
    }
  }

  private tryNormalizeJid(value: unknown): string | null {
    try {
      return this.normalizeRequiredJid(value);
    } catch {
      return null;
    }
  }

  private normalizeRequiredJid(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw) throw new BadRequestException('WhatsApp number or JID is required');

    const jid = createJid(raw);
    const localPart = jid.split('@')[0];
    if (!jid.includes('@') || !localPart) {
      throw new BadRequestException('Invalid WhatsApp number or JID');
    }

    if ((jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) && !/^\d+@/.test(jid)) {
      throw new BadRequestException('Invalid WhatsApp user JID');
    }

    return jid;
  }

  /**
   * Zapo-native registration lookup. `getLidsByPhoneNumbers` uses the same
   * usync/LID path the transport uses for device addressing, so the response
   * includes server-side `exists` and canonical PN/LID forms.
   */
  public async whatsappNumber(data: WhatsAppNumberDto): Promise<OnWhatsAppDto[]> {
    const inputs = Array.isArray(data?.numbers) ? data.numbers : [];
    const plans: NumberPlan[] = inputs.map((number, index) => {
      const raw = String(number ?? '');
      const jid = this.tryNormalizeJid(raw);
      if (!jid) return { index, number: raw, jid: '', kind: 'invalid' };
      if (jid === 'status@broadcast') return { index, number: raw, jid, kind: 'broadcast' };
      if (jid.endsWith('@g.us')) return { index, number: raw, jid, kind: 'group' };
      if (jid.endsWith('@lid')) return { index, number: raw, jid, kind: 'lid' };
      return {
        index,
        number: raw,
        jid,
        kind: 'user',
        phoneNumber: jid.split('@')[0],
      };
    });

    const results = new Array<OnWhatsAppDto>(plans.length);
    const phonePlans = plans.filter((plan) => plan.kind === 'user');
    let lidLookup: readonly any[] = [];

    if (phonePlans.length > 0) {
      try {
        lidLookup = await this.client.profile.getLidsByPhoneNumbers(phonePlans.map((plan) => plan.phoneNumber));
      } catch (error) {
        this.logger.warn(`Zapo WhatsApp registration lookup failed: ${(error as Error)?.message ?? error}`);
      }
    }

    const lookupJids = new Set<string>();
    for (const plan of plans) if (plan.jid) lookupJids.add(plan.jid);
    for (const item of lidLookup) {
      if (item?.phoneJid) lookupJids.add(item.phoneJid);
      if (item?.lidJid) lookupJids.add(item.lidJid);
    }
    const contacts = lookupJids.size
      ? await this.prismaRepository.contact.findMany({
          where: { instanceId: this.instanceId, remoteJid: { in: [...lookupJids] } },
        })
      : [];
    const contactName = (...jids: Array<string | null | undefined>) =>
      contacts.find((contact) => jids.includes(contact.remoteJid))?.pushName;

    let phoneIndex = 0;
    for (const plan of plans) {
      if (plan.kind === 'invalid') {
        results[plan.index] = new OnWhatsAppDto('', false, plan.number);
        continue;
      }

      if (plan.kind === 'broadcast') {
        results[plan.index] = new OnWhatsAppDto(plan.jid, false, plan.number);
        continue;
      }

      if (plan.kind === 'lid') {
        results[plan.index] = new OnWhatsAppDto(plan.jid, true, plan.number, contactName(plan.jid), 'lid');
        continue;
      }

      if (plan.kind === 'group') {
        try {
          const group = await this.client.group.queryGroupMetadata(plan.jid);
          results[plan.index] = new OnWhatsAppDto(
            group?.id ?? group?.jid ?? plan.jid,
            true,
            plan.number,
            group?.subject,
          );
        } catch {
          results[plan.index] = new OnWhatsAppDto(plan.jid, false, plan.number);
        }
        continue;
      }

      const lookup = lidLookup[phoneIndex++];
      const canonicalJid = lookup?.phoneJid ?? plan.jid;
      results[plan.index] = new OnWhatsAppDto(
        canonicalJid,
        lookup?.exists === true,
        plan.number,
        contactName(canonicalJid, plan.jid, lookup?.lidJid),
        lookup?.lidJid ? 'lid' : undefined,
      );
    }

    return results;
  }

  public async profilePicture(number: string) {
    const jid = this.tryNormalizeJid(number);
    if (!jid) return { wuid: String(number ?? ''), profilePictureUrl: null };

    for (const type of ['image', 'preview'] as const) {
      const result = await this.client?.profile?.getProfilePicture?.(jid, type).catch(() => null);
      if (result?.url) return { wuid: jid, profilePictureUrl: result.url };
    }

    return { wuid: jid, profilePictureUrl: null };
  }

  public async fetchLabels(): Promise<LabelDto[]> {
    await this.bootstrapLabelsFromAppState();
    const labels = await this.prismaRepository.label.findMany({ where: { instanceId: this.instanceId } });

    return labels.map((label) => ({
      color: label.color,
      name: label.name,
      id: label.labelId,
      predefinedId: label.predefinedId,
    }));
  }

  public async handleLabel(data: HandleLabelDto) {
    const labelId = String(data?.labelId ?? '').trim();
    if (!labelId) throw new BadRequestException('Label ID is required');

    const contact = (await this.whatsappNumber({ numbers: [data.number] }))?.[0];
    if (!contact) throw new NotFoundException('Number not found');
    if (!contact.exists) throw new NotFoundException('Number is not on WhatsApp');

    try {
      const labeled = data.action === 'add';
      await this.client.chat.set({
        schema: 'LabelJid',
        labelId,
        chatJid: contact.jid,
        labelAssociationAction: { labeled },
      });

      // Keep REST reads immediately consistent. The mutation_send listener
      // remains responsible for the provider-neutral LABELS_ASSOCIATION event.
      await this.updateLocalChatLabel(labelId, contact.jid, labeled ? 'add' : 'remove');

      return labeled
        ? { numberJid: contact.jid, labelId, add: true }
        : { numberJid: contact.jid, labelId, remove: true };
    } catch (error) {
      throw new BadRequestException(`Unable to ${data.action} label to chat`, (error as Error)?.toString());
    }
  }
}
