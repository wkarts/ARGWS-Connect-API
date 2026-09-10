import { MetaCloudIdentityResolver } from './meta-cloud-identity.resolver';
import { MetaCloudStatusMapper } from './meta-cloud-status.mapper';
import { MetaCloudIdentity } from './types/meta-response.types';
import { MetaCloudEventData } from './types/meta-webhook.types';

export class MetaCloudWebhookSerializer {
  constructor(
    private readonly resolver: MetaCloudIdentityResolver,
    private readonly statusMapper: MetaCloudStatusMapper,
  ) {}

  public async serialize(eventData: MetaCloudEventData): Promise<Record<string, any> | null> {
    const identity = await this.resolver.resolveByInstanceName(eventData.instanceName);
    if (eventData.event === 'messages.upsert' || eventData.event === 'MESSAGES_UPSERT') {
      return this.serializeIncoming(identity, eventData.data, eventData.dateTime);
    }
    if (eventData.event === 'messages.update' || eventData.event === 'MESSAGES_UPDATE') {
      return this.serializeStatus(identity, eventData.data, eventData.dateTime);
    }
    return null;
  }

  public async serializeIncoming(identity: MetaCloudIdentity, raw: any, dateTime?: string) {
    const record = raw?.data ?? raw;
    const key = { ...(raw?.key || {}), ...(record?.key || {}) };
    const message = record?.message || raw?.message || {};
    const id = String(key?.id || record?.id || '');
    if (!id) return null;
    const mapped = this.mapMessageContent(id, message, record?.messageType);
    if (!mapped) return null;

    const fromMe = this.fromMe(key?.fromMe, record?.fromMe, raw?.fromMe);
    const address = this.address(identity, key, record, raw);
    if (!address.group && !address.candidates.length) return null;
    const ownPhone = this.resolver.contactPhone(identity.displayPhoneNumber);
    const from = fromMe ? ownPhone : address.group ? address.authorPhone : address.phone;
    const profile = await this.resolver.resolveContactProfile(identity.instanceId, address.candidates);

    // pushName belongs to the author. On outgoing echoes it can be our own
    // profile, and on groups it belongs to a participant, not the group.
    const eventName = !fromMe ? this.text(record?.pushName, raw?.pushName) : null;
    const eventPicture = !fromMe ? this.text(record?.profilePicUrl, raw?.profilePicUrl) : null;
    const name = eventName || this.text(profile?.pushName) || address.phone;
    const picture = eventPicture || this.text(profile?.profilePicUrl);
    const timestamp = this.timestamp(record?.messageTimestamp || raw?.messageTimestamp, dateTime);
    return this.wrap(identity, {
      contacts: [{ profile: { name: name || '', ...(picture ? { picture } : {}) }, wa_id: address.phone || '' }],
      messages: [
        {
          from: from || '',
          id,
          timestamp,
          ...mapped,
          connect_api: this.extension(key, record, raw, fromMe, Boolean(address.phone)),
        },
      ],
    });
  }

  public serializeStatus(identity: MetaCloudIdentity, raw: any, dateTime?: string) {
    const record = raw?.data ?? raw;
    const key = { ...(raw?.key || {}), ...(record?.key || {}) };
    const update = record?.update || raw?.update || record;
    const status = this.statusMapper.map(update?.status ?? record?.status);
    if (!status) return null;
    const id = String(key?.id || record?.keyId || record?.id || '');
    if (!id) return null;
    const address = this.address(identity, key, record, raw);
    return this.wrap(identity, {
      statuses: [
        {
          id,
          status,
          timestamp: this.timestamp(record?.messageTimestamp || update?.messageTimestamp, dateTime),
          recipient_id: (!address.group && address.phone) || '',
        },
      ],
    });
  }

  private text(...values: unknown[]): string | null {
    for (const value of values) if (typeof value === 'string' && value.trim()) return value.trim();
    return null;
  }

  private fromMe(...values: unknown[]): boolean {
    for (const value of values) {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
    }
    return false;
  }

  private address(identity: MetaCloudIdentity, key: any, record: any, raw: any) {
    const field = (name: string) => this.text(key?.[name], record?.[name], raw?.[name]);
    const remoteJid = field('remoteJid');
    const remoteJidAlt = field('remoteJidAlt');
    const group = remoteJid?.endsWith('@g.us') || remoteJidAlt?.endsWith('@g.us');
    const ownPhone = this.resolver.contactPhone(identity.displayPhoneNumber);
    const remotes = [remoteJidAlt, remoteJid];
    const authorCandidates = [field('senderPn'), field('participantAlt'), field('participant'), field('sender')];
    const ordered = group ? authorCandidates : [...remotes, ...authorCandidates];
    const ownConversation = Boolean(ownPhone && remotes.some((jid) => this.resolver.contactPhone(jid) === ownPhone));
    const candidates = ordered.filter((jid) => {
      if (!this.resolver.normalizeContactJid(jid)) return false;
      // An envelope's sender is often the connected account, not the peer.
      return !ownPhone || ownConversation || this.resolver.contactPhone(jid) !== ownPhone;
    });
    const phone = candidates.map((jid) => this.resolver.contactPhone(jid)).find(Boolean) || null;
    // A different phone candidate is not evidence of the same person. Never
    // select a richer profile from another participant or from the instance.
    const peerFields = !group && remotes.some((jid) => this.resolver.normalizeContactJid(jid)) ? remotes : ordered;
    const peers = candidates.filter(
      (jid) =>
        peerFields.includes(jid) && (!this.resolver.contactPhone(jid) || this.resolver.contactPhone(jid) === phone),
    );
    const phoneCandidate = candidates.find((jid) => this.resolver.contactPhone(jid) === phone);
    if (phone && phoneCandidate && !peers.includes(phoneCandidate)) peers.push(phoneCandidate);
    return { remoteJid: remoteJid || remoteJidAlt, phone, candidates: peers, group, authorPhone: phone };
  }

  private extension(key: any, record: any, raw: any, fromMe: boolean, phoneResolved: boolean) {
    const field = (name: string) => this.text(key?.[name], record?.[name], raw?.[name]);
    const source = this.text(record?.source, raw?.source);
    return {
      from_me: fromMe,
      remote_jid: field('remoteJid'),
      remote_jid_alt: field('remoteJidAlt'),
      participant: field('participant'),
      participant_alt: field('participantAlt'),
      phone_resolved: phoneResolved,
      ...(source ? { source } : {}),
    };
  }

  private wrap(identity: MetaCloudIdentity, contents: Record<string, any>) {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: identity.businessAccountId,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  display_phone_number: identity.displayPhoneNumber,
                  phone_number_id: identity.phoneNumberId,
                },
                ...contents,
              },
            },
          ],
        },
      ],
    };
  }

  private mapMessageContent(id: string, message: any, declaredType?: string) {
    if (message?.conversation !== undefined) return { type: 'text', text: { body: message.conversation } };
    if (message?.extendedTextMessage?.text !== undefined) {
      return { type: 'text', text: { body: message.extendedTextMessage.text } };
    }
    const mediaTypes = [
      ['image', 'imageMessage'],
      ['video', 'videoMessage'],
      ['audio', 'audioMessage'],
      ['document', 'documentMessage'],
      ['sticker', 'stickerMessage'],
    ] as const;
    for (const [type, key] of mediaTypes) {
      const media = message?.[key];
      if (media) {
        return {
          type,
          [type]: {
            id,
            mime_type: media?.mimetype || media?.mimeType || 'application/octet-stream',
            ...(media?.caption ? { caption: media.caption } : {}),
            ...(media?.fileName ? { filename: media.fileName } : {}),
          },
        };
      }
    }
    if (message?.locationMessage) {
      return {
        type: 'location',
        location: {
          latitude: message.locationMessage.degreesLatitude,
          longitude: message.locationMessage.degreesLongitude,
          name: message.locationMessage.name,
          address: message.locationMessage.address,
        },
      };
    }
    if (message?.contactMessage) {
      return { type: 'contacts', contacts: [{ name: { formatted_name: message.contactMessage.displayName } }] };
    }
    if (declaredType === 'text' && message?.text) return { type: 'text', text: { body: message.text } };
    return null;
  }

  private timestamp(value?: number | string, dateTime?: string) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return String(Math.floor(numeric));
    const parsed = dateTime ? Date.parse(dateTime) : Date.now();
    return String(Math.floor((Number.isFinite(parsed) ? parsed : Date.now()) / 1000));
  }
}
