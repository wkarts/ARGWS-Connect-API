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
    const id = String(key?.id || raw?.key?.id || record?.id || '');
    if (!id) return null;
    const mapped = this.mapMessageContent(id, message, record?.messageType);
    if (!mapped) return null;

    const fromMe = this.fromMe(record?.key?.fromMe, raw?.key?.fromMe, record?.fromMe, raw?.fromMe);
    const address = this.address(identity, key, record, raw);
    if (!address.group && !address.candidates.length) return null;
    const from = fromMe ? this.ownPhone(identity, record, raw) : address.phone;
    const peerCandidates = fromMe && address.group ? [] : address.candidates;
    const peerPhone = fromMe && address.group ? null : address.phone;
    let profile: Awaited<ReturnType<MetaCloudIdentityResolver['resolveContactProfile']>> = null;
    try {
      profile = await this.resolver.resolveContactProfile(identity.instanceId, peerCandidates);
    } catch {
      // Optional enrichment must not suppress an otherwise valid message event.
      // Retry/delivery policy remains owned by the existing dispatcher.
    }
    // pushName/photo in an outbound echo describe the local sender, not the peer.
    const eventName = !fromMe ? this.text(record?.pushName, raw?.pushName) : null;
    const eventPicture = !fromMe ? this.text(record?.profilePicUrl, raw?.profilePicUrl) : null;
    const name = eventName || this.text(profile?.pushName) || peerPhone;
    const picture = eventPicture || this.text(profile?.profilePicUrl);
    const source = this.text(record?.source, raw?.source);
    const field = (name: string) => this.text(key?.[name], raw?.key?.[name], record?.[name], raw?.[name]);
    const contact = {
      profile: { name: name || '', ...(picture ? { picture } : {}) },
      ...(peerPhone ? { wa_id: peerPhone } : {}),
    };
    return this.wrap(identity, {
      // Unknown LIDs remain in connect_api, not a fabricated or empty phone key.
      contacts: peerCandidates.length ? [contact] : [],
      messages: [
        {
          ...(from ? { from } : {}),
          id,
          timestamp: this.timestamp(record?.messageTimestamp || raw?.messageTimestamp, dateTime),
          ...mapped,
          connect_api: {
            from_me: fromMe,
            remote_jid: field('remoteJid'),
            remote_jid_alt: field('remoteJidAlt'),
            participant: field('participant'),
            participant_alt: field('participantAlt'),
            phone_resolved: Boolean(peerPhone),
            ...(source ? { source } : {}),
          },
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

  private ownPhone(identity: MetaCloudIdentity, record: any, raw: any): string | null {
    if (identity.provider !== 'WHATSAPP-BUSINESS') return this.resolver.contactPhone(identity.displayPhoneNumber);
    // A Cloud phone_number_id is an object ID, not a telephone. Preserve Graph
    // addressing/metadata untouched, but never use that ID as a message sender.
    const candidates = [
      record?.metadata?.display_phone_number,
      raw?.metadata?.display_phone_number,
      identity.instance?.ownerJid,
      identity.displayPhoneNumber !== identity.phoneNumberId ? identity.displayPhoneNumber : null,
    ];
    return candidates.map((value) => this.resolver.contactPhone(value)).find(Boolean) || null;
  }

  private address(identity: MetaCloudIdentity, key: any, record: any, raw: any) {
    const field = (name: string) => this.text(key?.[name], raw?.key?.[name], record?.[name], raw?.[name]);
    const remotes = [field('remoteJidAlt'), field('remoteJid')];
    const remoteJid = field('remoteJid') || field('remoteJidAlt');
    const group = remotes.some((jid) => jid?.endsWith('@g.us'));
    if (remotes.some((jid) => /@(broadcast|newsletter)$/.test(jid || ''))) {
      return { group: false, phone: null, candidates: [] as string[] };
    }
    const authors = [field('senderPn'), field('participantAlt'), field('participant'), field('sender')];
    const own = this.ownPhone(identity, record, raw);
    const selfChat = Boolean(own && remotes.some((jid) => this.resolver.contactPhone(jid) === own));
    const ordered = group ? authors : [...remotes, ...authors];
    const candidates = ordered.filter(
      (jid): jid is string =>
        Boolean(this.resolver.normalizeContactJid(jid)) &&
        (!own || selfChat || this.resolver.contactPhone(jid) !== own),
    );
    const phone = candidates.map((jid) => this.resolver.contactPhone(jid)).find(Boolean) || null;
    // An unrelated participant (or a different phone) is not an alias of a
    // directly addressed peer just because its profile happens to be richer.
    const peerFields = !group && this.resolver.normalizeContactJid(remoteJid) ? remotes : ordered;
    const peers = candidates.filter(
      (jid) =>
        peerFields.includes(jid) && (!this.resolver.contactPhone(jid) || this.resolver.contactPhone(jid) === phone),
    );
    const phoneCandidate = candidates.find((jid) => this.resolver.contactPhone(jid) === phone);
    if (phone && phoneCandidate && !peers.includes(phoneCandidate)) peers.push(phoneCandidate);
    return { group, phone, candidates: peers };
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
