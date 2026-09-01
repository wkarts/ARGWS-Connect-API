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

  public serializeIncoming(identity: MetaCloudIdentity, raw: any, dateTime?: string) {
    const record = raw?.data ?? raw;
    const key = record?.key || raw?.key || {};
    const message = record?.message || raw?.message || {};
    const id = String(key?.id || record?.id || '');
    if (!id) return null;
    const from = this.phoneFromJid(key?.remoteJid || record?.sender || raw?.sender);
    if (!from) return null;
    const mapped = this.mapMessageContent(id, message, record?.messageType);
    if (!mapped) return null;
    const timestamp = this.timestamp(record?.messageTimestamp || raw?.messageTimestamp, dateTime);
    return this.wrap(identity, {
      contacts: [{ profile: { name: record?.pushName || raw?.pushName || from }, wa_id: from }],
      messages: [{ from, id, timestamp, ...mapped }],
    });
  }

  public serializeStatus(identity: MetaCloudIdentity, raw: any, dateTime?: string) {
    const record = raw?.data ?? raw;
    const key = record?.key || raw?.key || {};
    const update = record?.update || raw?.update || record;
    const status = this.statusMapper.map(update?.status ?? record?.status);
    if (!status) return null;
    const id = String(key?.id || record?.keyId || record?.id || '');
    if (!id) return null;
    const recipient = this.phoneFromJid(key?.remoteJid || record?.remoteJid || raw?.sender) || '';
    return this.wrap(identity, {
      statuses: [
        {
          id,
          status,
          timestamp: this.timestamp(record?.messageTimestamp || update?.messageTimestamp, dateTime),
          recipient_id: recipient,
        },
      ],
    });
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

  private phoneFromJid(value?: string) {
    if (!value) return null;
    const local = String(value).split('@', 1)[0];
    const digits = local.replace(/\D/g, '');
    return digits || null;
  }
}
