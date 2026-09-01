from pathlib import Path
import json

ROOT = Path('.')

def write(path: str, content: str):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content.strip() + '\n', encoding='utf-8')


def patch_once(path: str, old: str, new: str):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f'Patch anchor not found in {path}: {old!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

write('src/api/compat/meta-cloud/types/meta-message.types.ts', r'''
export type MetaCloudMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'document'
  | 'audio'
  | 'location'
  | 'contacts'
  | 'reaction'
  | 'interactive';

export interface MetaCloudMessageRequest {
  messaging_product?: string;
  recipient_type?: string;
  to?: string;
  type?: MetaCloudMessageType;
  text?: { body?: string };
  image?: { link?: string; id?: string; caption?: string; mime_type?: string };
  video?: { link?: string; id?: string; caption?: string; mime_type?: string };
  document?: { link?: string; id?: string; filename?: string; caption?: string; mime_type?: string };
  audio?: { link?: string; id?: string; mime_type?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: any[];
  reaction?: { message_id?: string; emoji?: string };
  interactive?: any;
  status?: 'read';
  message_id?: string;
}
''')

write('src/api/compat/meta-cloud/types/meta-webhook.types.ts', r'''
export interface MetaCloudEventData {
  instanceName: string;
  origin?: string;
  event: string;
  data: any;
  serverUrl?: string;
  dateTime?: string;
  sender?: string;
  apiKey?: string;
  local?: boolean;
  integration?: string[];
  extra?: Record<string, any>;
}

export interface MetaCloudWebhookEnvelope {
  webhookUrl: string;
  payload: Record<string, any>;
  context: {
    instanceId: string;
    instanceName: string;
    provider: string;
    phoneNumberId: string;
    graphVersion?: string;
    messageId?: string;
  };
  attempt: number;
}
''')

write('src/api/compat/meta-cloud/meta-cloud-response.serializer.ts', r'''
import { MetaCloudGraphError } from './meta-cloud.error';

export class MetaCloudResponseSerializer {
  public messageResponse(to: string, providerResult: any) {
    const id = this.providerMessageId(providerResult);
    if (!id) throw new MetaCloudGraphError(500, 'Provider did not return a message identifier.');
    const normalized = String(to || '').replace(/\D/g, '');
    return {
      messaging_product: 'whatsapp',
      contacts: [{ input: normalized || to, wa_id: normalized || to }],
      messages: [{ id }],
    };
  }

  public providerMessageId(result: any): string | null {
    const id =
      result?.key?.id ??
      result?.id ??
      result?.message?.key?.id ??
      result?.data?.key?.id ??
      result?.messages?.[0]?.id ??
      result?.data?.messages?.[0]?.id;
    return id ? String(id) : null;
  }
}
''')

write('src/api/compat/meta-cloud/meta-cloud-rate-limiter.ts', r'''
import { MetaCloudGraphError } from './meta-cloud.error';

export class MetaCloudRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly maxRequests = 120,
    private readonly windowMs = 60_000,
  ) {}

  public assertAllowed(key: string): void {
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > this.maxRequests) {
      throw new MetaCloudGraphError(429, 'Too many requests.');
    }
  }
}
''')

write('src/api/compat/meta-cloud/meta-cloud-media.service.ts', r'''
import { getObjectUrl, uploadFile } from '@api/integrations/storage/s3/libs/minio.server';
import { PrismaRepository } from '@api/repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { prismaJsonPath } from '@utils/prismaJsonPath';
import { randomUUID } from 'crypto';

import { MetaCloudGraphError } from './meta-cloud.error';
import { metaCloudMetrics } from './meta-cloud.metrics';
import { MetaCloudIdentity } from './types/meta-response.types';

interface UploadedMediaRef {
  id: string;
  instanceId: string;
  fileName: string;
  mimetype: string;
  createdAt: number;
}

export class MetaCloudMediaService {
  private readonly memoryUploads = new Map<string, UploadedMediaRef>();

  constructor(
    private readonly prisma: PrismaRepository,
    private readonly cache: CacheService,
  ) {}

  public async upload(identity: MetaCloudIdentity, file: Express.Multer.File | undefined, declaredType?: string) {
    if (!file?.buffer?.length) throw new MetaCloudGraphError(400, 'A multipart file is required.');
    const id = randomUUID().replace(/-/g, '');
    const safeName = String(file.originalname || 'media.bin').replace(/[^A-Za-z0-9._-]/g, '_');
    const fileName = `meta-compat/${identity.instanceId}/${id}/${safeName}`;
    const mimetype = String(declaredType || file.mimetype || 'application/octet-stream');
    const result = await uploadFile(fileName, file.buffer, file.size, { 'Content-Type': mimetype } as any);
    if (!result) throw new MetaCloudGraphError(500, 'Media storage is not available.');

    const ref: UploadedMediaRef = { id, instanceId: identity.instanceId, fileName, mimetype, createdAt: Date.now() };
    this.memoryUploads.set(id, ref);
    await this.cache.set(this.cacheKey(id), JSON.stringify(ref), 3600);
    metaCloudMetrics.increment('connect_meta_compat_media_requests_total');
    return { id };
  }

  public async resolveOutbound(media: { link?: string; id?: string } | undefined, identity: MetaCloudIdentity) {
    if (media?.link) return media.link;
    if (!media?.id) throw new MetaCloudGraphError(400, 'Media must contain link or id.');
    const ref = await this.getUploadRef(media.id);
    if (!ref || ref.instanceId !== identity.instanceId) throw new MetaCloudGraphError(404, `Media ${media.id} was not found.`);
    const url = await getObjectUrl(ref.fileName, 300);
    if (!url) throw new MetaCloudGraphError(500, 'Unable to create a temporary media URL.');
    return url;
  }

  public async locate(mediaId: string): Promise<{ instance: any; id: string; fileName: string; mimetype: string }> {
    const message = await this.prisma.message.findFirst({
      where: {
        key: { path: prismaJsonPath('id'), equals: mediaId } as any,
      },
      include: { Media: true, Instance: true },
    });
    if (message?.Media && message?.Instance) {
      return {
        instance: message.Instance,
        id: mediaId,
        fileName: message.Media.fileName,
        mimetype: message.Media.mimetype,
      };
    }

    const ref = await this.getUploadRef(mediaId);
    if (ref) {
      const instance = await this.prisma.instance.findUnique({ where: { id: ref.instanceId } });
      if (instance) return { instance, id: mediaId, fileName: ref.fileName, mimetype: ref.mimetype };
    }
    throw new MetaCloudGraphError(404, `Media ${mediaId} was not found.`);
  }

  public async describe(located: { id: string; fileName: string; mimetype: string }) {
    const url = await getObjectUrl(located.fileName, 300);
    if (!url) throw new MetaCloudGraphError(500, 'Unable to create a temporary media URL.');
    metaCloudMetrics.increment('connect_meta_compat_media_requests_total');
    return { id: located.id, mime_type: located.mimetype, url };
  }

  private async getUploadRef(id: string): Promise<UploadedMediaRef | null> {
    const local = this.memoryUploads.get(id);
    if (local) return local;
    const cached = await this.cache.get(this.cacheKey(id));
    if (!cached) return null;
    try {
      const ref = typeof cached === 'string' ? JSON.parse(cached) : cached;
      if (ref?.id && ref?.instanceId && ref?.fileName) {
        this.memoryUploads.set(id, ref);
        return ref;
      }
    } catch {
      return null;
    }
    return null;
  }

  private cacheKey(id: string) {
    return `meta-cloud:media:${id}`;
  }
}
''')

write('src/api/compat/meta-cloud/meta-cloud-template.service.ts', r'''
import { TemplateController } from '@api/controllers/template.controller';

import { MetaCloudGraphError } from './meta-cloud.error';
import { MetaCloudIdentity } from './types/meta-response.types';

export class MetaCloudTemplateService {
  constructor(private readonly templateController: TemplateController) {}

  public async list(identity: MetaCloudIdentity) {
    if (identity.provider === 'WHATSAPP-BUSINESS') {
      const result = await this.templateController.findTemplate({
        instanceName: identity.instanceName,
        instanceId: identity.instanceId,
        integration: identity.provider,
        businessId: identity.businessAccountId,
        token: identity.token,
      });
      if (result && typeof result === 'object' && 'data' in result) return result;
      return { data: Array.isArray(result) ? result : result ? [result] : [] };
    }
    if (identity.provider === 'WHATSAPP-BAILEYS' || identity.provider === 'CONNECT') return { data: [] };
    throw new MetaCloudGraphError(400, `Templates are not supported by provider ${identity.provider}.`);
  }
}
''')

write('src/api/compat/meta-cloud/meta-cloud-message.adapter.ts', r'''
import { ChatController } from '@api/controllers/chat.controller';
import { SendMessageController } from '@api/controllers/sendMessage.controller';
import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { prismaJsonPath } from '@utils/prismaJsonPath';

import { MetaCloudGraphError } from './meta-cloud.error';
import { MetaCloudMediaService } from './meta-cloud-media.service';
import { MetaCloudResponseSerializer } from './meta-cloud-response.serializer';
import { MetaCloudMessageRequest } from './types/meta-message.types';
import { MetaCloudIdentity } from './types/meta-response.types';

export class MetaCloudMessageAdapter {
  constructor(
    private readonly sendController: SendMessageController,
    private readonly chatController: ChatController,
    private readonly prisma: PrismaRepository,
    private readonly monitor: WAMonitoringService,
    private readonly mediaService: MetaCloudMediaService,
    private readonly responseSerializer: MetaCloudResponseSerializer,
  ) {}

  public async execute(identity: MetaCloudIdentity, payload: MetaCloudMessageRequest) {
    this.assertConnected(identity);
    if (payload.messaging_product && payload.messaging_product !== 'whatsapp') {
      throw new MetaCloudGraphError(400, 'messaging_product must be whatsapp.');
    }
    if (payload.status === 'read') return this.markRead(identity, payload.message_id);
    const to = this.normalizeRecipient(payload.to);
    if (!payload.type) throw new MetaCloudGraphError(400, 'Message type is required.');
    const instance = this.instanceDto(identity);
    let result: any;

    switch (payload.type) {
      case 'text':
        if (!payload.text?.body) throw new MetaCloudGraphError(400, 'text.body is required.');
        result = await this.sendController.sendText(instance, { number: to, text: payload.text.body });
        break;
      case 'image':
      case 'video': {
        const media = payload[payload.type];
        const url = await this.mediaService.resolveOutbound(media, identity);
        result = await this.sendController.sendMedia(instance, {
          number: to,
          mediatype: payload.type,
          media: url,
          mimetype: media?.mime_type,
          caption: media?.caption,
        });
        break;
      }
      case 'document': {
        const media = payload.document;
        const url = await this.mediaService.resolveOutbound(media, identity);
        result = await this.sendController.sendMedia(instance, {
          number: to,
          mediatype: 'document',
          media: url,
          mimetype: media?.mime_type,
          fileName: media?.filename,
          caption: media?.caption,
        });
        break;
      }
      case 'audio': {
        const media = payload.audio;
        const url = await this.mediaService.resolveOutbound(media, identity);
        result = await this.sendController.sendWhatsAppAudio(instance, { number: to, audio: url });
        break;
      }
      case 'location':
        if (payload.location?.latitude === undefined || payload.location?.longitude === undefined) {
          throw new MetaCloudGraphError(400, 'location.latitude and location.longitude are required.');
        }
        result = await this.sendController.sendLocation(instance, {
          number: to,
          latitude: Number(payload.location.latitude),
          longitude: Number(payload.location.longitude),
          name: payload.location.name,
          address: payload.location.address,
        });
        break;
      case 'contacts':
        result = await this.sendController.sendContact(instance, {
          number: to,
          contact: this.mapContacts(payload.contacts || []),
        });
        break;
      case 'reaction':
        if (!payload.reaction?.message_id || payload.reaction.emoji === undefined) {
          throw new MetaCloudGraphError(400, 'reaction.message_id and reaction.emoji are required.');
        }
        result = await this.sendController.sendReaction(instance, {
          key: { id: payload.reaction.message_id, remoteJid: `${to}@s.whatsapp.net`, fromMe: true },
          reaction: payload.reaction.emoji,
        });
        break;
      case 'interactive':
        result = await this.sendInteractive(instance, to, payload.interactive);
        break;
      default:
        throw new MetaCloudGraphError(400, `Message type ${String(payload.type)} is not supported by this provider.`);
    }
    return this.responseSerializer.messageResponse(to, result);
  }

  private async sendInteractive(instance: any, to: string, interactive: any) {
    if (interactive?.type === 'button') {
      const buttons = interactive?.action?.buttons || [];
      if (!buttons.length) throw new MetaCloudGraphError(400, 'interactive.action.buttons is required.');
      return this.sendController.sendButtons(instance, {
        number: to,
        title: interactive?.body?.text || interactive?.header?.text || 'WhatsApp',
        description: interactive?.header?.text,
        footer: interactive?.footer?.text,
        buttons: buttons.map((button: any) => ({
          type: 'reply' as const,
          id: button?.reply?.id,
          displayText: button?.reply?.title,
        })),
      });
    }
    if (interactive?.type === 'list') {
      const sections = interactive?.action?.sections || [];
      if (!sections.length) throw new MetaCloudGraphError(400, 'interactive.action.sections is required.');
      return this.sendController.sendList(instance, {
        number: to,
        title: interactive?.header?.text || interactive?.body?.text || 'WhatsApp',
        description: interactive?.body?.text,
        footerText: interactive?.footer?.text,
        buttonText: interactive?.action?.button || 'Opções',
        sections: sections.map((section: any) => ({
          title: section?.title || '',
          rows: (section?.rows || []).map((row: any) => ({
            title: row?.title || '',
            description: row?.description || '',
            rowId: row?.id || '',
          })),
        })),
      });
    }
    throw new MetaCloudGraphError(400, `Interactive type ${String(interactive?.type || '')} is not supported by this provider.`);
  }

  private async markRead(identity: MetaCloudIdentity, messageId?: string) {
    if (!messageId) throw new MetaCloudGraphError(400, 'message_id is required for status=read.');
    const message = await this.prisma.message.findFirst({
      where: {
        instanceId: identity.instanceId,
        key: { path: prismaJsonPath('id'), equals: messageId } as any,
      },
    });
    if (!message) throw new MetaCloudGraphError(404, `Message ${messageId} was not found.`);
    const key: any = message.key;
    await this.chatController.readMessage(this.instanceDto(identity), {
      readMessages: [
        {
          id: messageId,
          remoteJid: key?.remoteJid,
          fromMe: Boolean(key?.fromMe),
          participant: key?.participant,
        },
      ],
    });
    return { success: true };
  }

  private mapContacts(contacts: any[]) {
    if (!contacts.length) throw new MetaCloudGraphError(400, 'contacts must not be empty.');
    return contacts.map((contact) => {
      const phone = String(contact?.phones?.[0]?.phone || contact?.phones?.[0]?.wa_id || '').replace(/\D/g, '');
      const fullName = contact?.name?.formatted_name ||
        [contact?.name?.first_name, contact?.name?.last_name].filter(Boolean).join(' ') ||
        phone;
      if (!phone || !fullName) throw new MetaCloudGraphError(400, 'Each contact requires a name and phone.');
      return {
        fullName,
        wuid: phone,
        phoneNumber: phone,
        organization: contact?.org?.company,
        email: contact?.emails?.[0]?.email,
        url: contact?.urls?.[0]?.url,
      };
    });
  }

  private assertConnected(identity: MetaCloudIdentity) {
    const instance = this.monitor.waInstances[identity.instanceName];
    if (!instance || (instance.connectionStatus?.state && instance.connectionStatus.state !== 'open')) {
      throw new MetaCloudGraphError(409, `Instance ${identity.instanceName} is disconnected.`);
    }
  }

  private normalizeRecipient(to?: string) {
    const value = String(to || '').replace(/\D/g, '');
    if (!value) throw new MetaCloudGraphError(400, 'to is required.');
    return value;
  }

  private instanceDto(identity: MetaCloudIdentity): any {
    return {
      instanceName: identity.instanceName,
      instanceId: identity.instanceId,
      integration: identity.provider,
      number: identity.displayPhoneNumber,
      businessId: identity.businessAccountId,
      token: identity.token,
    };
  }
}
''')

write('src/api/compat/meta-cloud/meta-cloud-webhook.serializer.ts', r'''
import { MetaCloudIdentityResolver } from './meta-cloud-identity.resolver';
import { MetaCloudStatusMapper } from './meta-cloud-status.mapper';
import { MetaCloudEventData } from './types/meta-webhook.types';
import { MetaCloudIdentity } from './types/meta-response.types';

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
''')

write('src/api/compat/meta-cloud/meta-cloud-webhook.dispatcher.ts', r'''
import { RabbitmqController } from '@api/integrations/event/rabbitmq/rabbitmq.controller';
import { PrismaRepository } from '@api/repository/repository.service';
import { Logger } from '@config/logger.config';
import axios from 'axios';
import { Channel, Message } from 'amqplib/callback_api';

import { MetaCloudIdentityResolver } from './meta-cloud-identity.resolver';
import { metaCloudMetrics } from './meta-cloud.metrics';
import { MetaCloudWebhookSerializer } from './meta-cloud-webhook.serializer';
import { MetaCloudEventData, MetaCloudWebhookEnvelope } from './types/meta-webhook.types';

export class MetaCloudWebhookDispatcher {
  private readonly logger = new Logger('MetaCloudWebhookDispatcher');
  private consumerChannel: Channel | null = null;
  private consuming = false;
  private readonly mainQueue = 'argws.meta-compat.webhook';
  private readonly retryQueues = [
    { name: 'argws.meta-compat.webhook.retry.5s', ttl: 5000 },
    { name: 'argws.meta-compat.webhook.retry.30s', ttl: 30000 },
    { name: 'argws.meta-compat.webhook.retry.120s', ttl: 120000 },
  ];
  private readonly dlq = 'argws.meta-compat.webhook.dlq';

  constructor(
    private readonly prisma: PrismaRepository,
    private readonly resolver: MetaCloudIdentityResolver,
    private readonly serializer: MetaCloudWebhookSerializer,
    private readonly rabbitmq: RabbitmqController,
  ) {}

  public async handleEvent(eventData: MetaCloudEventData): Promise<void> {
    if (!['messages.upsert', 'messages.update', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE'].includes(eventData.event)) return;
    try {
      const identity = await this.resolver.resolveByInstanceName(eventData.instanceName);
      const config = await this.prisma.metaCompatibility.findUnique({ where: { instanceId: identity.instanceId } });
      if (!config?.enabled || !config.webhookUrl) return;
      const payload = await this.serializer.serialize(eventData);
      if (!payload) return;
      const envelope: MetaCloudWebhookEnvelope = {
        webhookUrl: config.webhookUrl,
        payload,
        context: {
          instanceId: identity.instanceId,
          instanceName: identity.instanceName,
          provider: identity.provider,
          phoneNumberId: identity.phoneNumberId,
          messageId: this.extractMessageId(payload),
        },
        attempt: 0,
      };
      if (await this.enqueue(envelope)) return;
      void this.deliverWithBackoff(envelope);
    } catch (error) {
      this.logger.error({
        metaCompatibility: true,
        operation: 'webhook.serialize',
        instanceName: eventData.instanceName,
        error: error?.message || String(error),
      });
    }
  }

  private async enqueue(envelope: MetaCloudWebhookEnvelope): Promise<boolean> {
    const channel = this.rabbitmq?.channel;
    if (!channel) return false;
    try {
      await this.ensureQueues(channel);
      channel.sendToQueue(this.mainQueue, Buffer.from(JSON.stringify(envelope)), { persistent: true });
      return true;
    } catch (error) {
      this.logger.warn({
        metaCompatibility: true,
        operation: 'webhook.enqueue',
        instanceName: envelope.context.instanceName,
        error: error?.message || String(error),
      });
      return false;
    }
  }

  private async ensureQueues(channel: Channel) {
    if (this.consumerChannel === channel && this.consuming) return;
    this.consumerChannel = channel;
    await channel.assertQueue(this.mainQueue, { durable: true });
    await channel.assertQueue(this.dlq, { durable: true });
    for (const retry of this.retryQueues) {
      await channel.assertQueue(retry.name, {
        durable: true,
        arguments: {
          'x-message-ttl': retry.ttl,
          'x-dead-letter-exchange': '',
          'x-dead-letter-routing-key': this.mainQueue,
        },
      });
    }
    if (!this.consuming) {
      this.consuming = true;
      channel.consume(this.mainQueue, (message) => void this.consume(channel, message), { noAck: false });
    }
  }

  private async consume(channel: Channel, message: Message | null) {
    if (!message) return;
    let envelope: MetaCloudWebhookEnvelope;
    try {
      envelope = JSON.parse(message.content.toString('utf8'));
    } catch {
      channel.ack(message);
      return;
    }
    try {
      await this.deliver(envelope);
      channel.ack(message);
    } catch (error) {
      const nextAttempt = envelope.attempt + 1;
      const retry = this.retryQueues[nextAttempt - 1];
      if (retry) {
        channel.sendToQueue(retry.name, Buffer.from(JSON.stringify({ ...envelope, attempt: nextAttempt })), {
          persistent: true,
        });
      } else {
        channel.sendToQueue(this.dlq, Buffer.from(JSON.stringify({ ...envelope, attempt: nextAttempt })), {
          persistent: true,
        });
        metaCloudMetrics.increment('connect_meta_compat_webhook_failures_total');
      }
      channel.ack(message);
      this.logger.warn({
        metaCompatibility: true,
        operation: 'webhook.retry',
        instanceId: envelope.context.instanceId,
        instanceName: envelope.context.instanceName,
        provider: envelope.context.provider,
        phoneNumberId: envelope.context.phoneNumberId,
        messageId: envelope.context.messageId,
        attempt: nextAttempt,
        error: error?.message || String(error),
      });
    }
  }

  private async deliverWithBackoff(envelope: MetaCloudWebhookEnvelope) {
    const delays = [0, 5000, 30000, 120000];
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt]) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
      try {
        await this.deliver({ ...envelope, attempt });
        return;
      } catch (error) {
        if (attempt === delays.length - 1) {
          metaCloudMetrics.increment('connect_meta_compat_webhook_failures_total');
          this.logger.error({
            metaCompatibility: true,
            operation: 'webhook.failed',
            instanceId: envelope.context.instanceId,
            instanceName: envelope.context.instanceName,
            provider: envelope.context.provider,
            phoneNumberId: envelope.context.phoneNumberId,
            messageId: envelope.context.messageId,
            error: error?.message || String(error),
          });
        }
      }
    }
  }

  private async deliver(envelope: MetaCloudWebhookEnvelope) {
    await axios.post(envelope.webhookUrl, envelope.payload, {
      timeout: 10_000,
      headers: { 'content-type': 'application/json', 'user-agent': 'ARGWS-Connect-Meta-Compatibility/1' },
      maxRedirects: 3,
    });
    metaCloudMetrics.increment('connect_meta_compat_webhooks_total');
  }

  private extractMessageId(payload: any) {
    return payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id ||
      payload?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.id;
  }
}
''')

write('src/api/compat/meta-cloud/meta-cloud-graph.controller.ts', r'''
import { Logger } from '@config/logger.config';

import { MetaCloudAuthService } from './meta-cloud-auth.service';
import { MetaCloudGraphError } from './meta-cloud.error';
import { MetaCloudIdentityResolver } from './meta-cloud-identity.resolver';
import { MetaCloudMediaService } from './meta-cloud-media.service';
import { MetaCloudMessageAdapter } from './meta-cloud-message.adapter';
import { metaCloudMetrics } from './meta-cloud.metrics';
import { MetaCloudTemplateService } from './meta-cloud-template.service';
import { MetaCloudMessageRequest } from './types/meta-message.types';
import { MetaCloudIdentity } from './types/meta-response.types';
import { PrismaRepository } from '@api/repository/repository.service';

export class MetaCloudGraphController {
  private readonly logger = new Logger('MetaCloudGraphController');

  constructor(
    private readonly prisma: PrismaRepository,
    private readonly resolver: MetaCloudIdentityResolver,
    private readonly auth: MetaCloudAuthService,
    private readonly adapter: MetaCloudMessageAdapter,
    private readonly media: MetaCloudMediaService,
    private readonly templates: MetaCloudTemplateService,
  ) {}

  public async send(version: string, phoneNumberId: string, authorization: any, payload: MetaCloudMessageRequest) {
    const identity = await this.resolvePhone(phoneNumberId, authorization);
    await this.assertEnabled(identity);
    this.log(identity, version, payload?.status === 'read' ? 'mark-read' : `send-${payload?.type || 'unknown'}`);
    const result = await this.adapter.execute(identity, payload || {});
    if (payload?.status !== 'read') metaCloudMetrics.increment('connect_meta_compat_messages_sent_total');
    return result;
  }

  public async upload(version: string, phoneNumberId: string, authorization: any, file: Express.Multer.File, type?: string) {
    const identity = await this.resolvePhone(phoneNumberId, authorization);
    await this.assertEnabled(identity);
    this.log(identity, version, 'media-upload');
    return this.media.upload(identity, file, type);
  }

  public async getMedia(version: string, mediaId: string, authorization: any) {
    const located = await this.media.locate(mediaId);
    const identity = this.resolver.identityFromInstance(located.instance);
    this.auth.assertAuthorized(identity, authorization);
    await this.assertEnabled(identity);
    this.log(identity, version, 'media-get', mediaId);
    return this.media.describe(located);
  }

  public async listTemplates(version: string, businessAccountId: string, authorization: any) {
    const identity = await this.resolver.resolveByBusinessAccountId(businessAccountId);
    this.auth.assertAuthorized(identity, authorization);
    await this.assertEnabled(identity);
    this.log(identity, version, 'templates-list');
    return this.templates.list(identity);
  }

  private async resolvePhone(phoneNumberId: string, authorization: any) {
    const identity = await this.resolver.resolveByPhoneNumberId(phoneNumberId);
    this.auth.assertAuthorized(identity, authorization);
    return identity;
  }

  private async assertEnabled(identity: MetaCloudIdentity) {
    const config = await this.prisma.metaCompatibility.findUnique({ where: { instanceId: identity.instanceId } });
    if (!config?.enabled) throw new MetaCloudGraphError(404, `Meta Cloud compatibility is not enabled for ${identity.instanceName}.`);
  }

  private log(identity: MetaCloudIdentity, graphVersion: string, operation: string, messageId?: string) {
    this.logger.log({
      metaCompatibility: true,
      graphVersion,
      instanceId: identity.instanceId,
      instanceName: identity.instanceName,
      provider: identity.provider,
      phoneNumberId: identity.phoneNumberId,
      messageId,
      operation,
    });
  }
}
''')

write('src/api/compat/meta-cloud/meta-cloud-graph.router.ts', r'''
import {
  metaCloudAuthService,
  metaCloudGraphController,
  metaCloudIdentityResolver,
} from '@api/server.module';
import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';

import { MetaCloudGraphError } from './meta-cloud.error';
import { metaCloudMetrics } from './meta-cloud.metrics';
import { MetaCloudRateLimiter } from './meta-cloud-rate-limiter';

export const isMetaGraphVersion = (version: string) => /^v[0-9]+\.[0-9]+$/.test(version || '');

export class MetaCloudGraphRouter {
  public readonly router = Router();
  private readonly upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
  private readonly limiter = new MetaCloudRateLimiter();

  constructor() {
    this.router.use('/:version', (req, _res, next) => {
      try {
        if (!isMetaGraphVersion(req.params.version)) throw new MetaCloudGraphError(400, 'Invalid Graph API version.');
        this.limiter.assertAllowed(`${req.ip || 'unknown'}:${req.params.version}`);
        metaCloudMetrics.increment('connect_meta_compat_requests_total');
        next();
      } catch (error) {
        this.handleError(error, _res, next);
      }
    });

    this.router.post('/:version/:phoneNumberId/messages', this.wrap(async (req, res) => {
      res.json(await metaCloudGraphController.send(
        req.params.version,
        req.params.phoneNumberId,
        req.headers.authorization,
        req.body,
      ));
    }));

    this.router.post('/:version/:phoneNumberId/media', this.upload.single('file'), this.wrap(async (req, res) => {
      res.json(await metaCloudGraphController.upload(
        req.params.version,
        req.params.phoneNumberId,
        req.headers.authorization,
        req.file,
        req.body?.type,
      ));
    }));

    this.router.get('/:version/:businessAccountId/message_templates', this.wrap(async (req, res) => {
      res.json(await metaCloudGraphController.listTemplates(
        req.params.version,
        req.params.businessAccountId,
        req.headers.authorization,
      ));
    }));

    this.router.get('/:version/:mediaId', this.wrap(async (req, res) => {
      res.json(await metaCloudGraphController.getMedia(req.params.version, req.params.mediaId, req.headers.authorization));
    }));
  }

  private wrap(handler: (req: Request, res: Response) => Promise<void | Response>) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        await handler(req, res);
      } catch (error) {
        this.handleError(error, res, next);
      }
    };
  }

  private handleError(error: any, res: Response, next: NextFunction) {
    if (error instanceof MetaCloudGraphError) return res.status(error.httpStatus).json(error.toBody());
    const safe = new MetaCloudGraphError(500, 'Internal provider error.');
    if (res.headersSent) return next(error);
    return res.status(500).json(safe.toBody());
  }
}

// Keep explicit imports alive for dependency-graph visibility and avoid accidental native auth reuse.
void metaCloudAuthService;
void metaCloudIdentityResolver;
''')

# Wire full services/controllers.
patch_once(
    'src/api/server.module.ts',
    "import { MetaCloudController } from './compat/meta-cloud/meta-cloud.controller';\n",
    "import { MetaCloudController } from './compat/meta-cloud/meta-cloud.controller';\nimport { MetaCloudGraphController } from './compat/meta-cloud/meta-cloud-graph.controller';\nimport { MetaCloudMediaService } from './compat/meta-cloud/meta-cloud-media.service';\nimport { MetaCloudMessageAdapter } from './compat/meta-cloud/meta-cloud-message.adapter';\nimport { MetaCloudResponseSerializer } from './compat/meta-cloud/meta-cloud-response.serializer';\nimport { MetaCloudStatusMapper } from './compat/meta-cloud/meta-cloud-status.mapper';\nimport { MetaCloudTemplateService } from './compat/meta-cloud/meta-cloud-template.service';\nimport { MetaCloudWebhookDispatcher } from './compat/meta-cloud/meta-cloud-webhook.dispatcher';\nimport { MetaCloudWebhookSerializer } from './compat/meta-cloud/meta-cloud-webhook.serializer';\n",
)
patch_once(
    'src/api/server.module.ts',
    'export const labelController = new LabelController(waMonitor);\n\nexport const eventManager = new EventManager(prismaRepository, waMonitor);\n',
    '''export const labelController = new LabelController(waMonitor);\n\nexport const metaCloudMediaService = new MetaCloudMediaService(prismaRepository, cache);\nexport const metaCloudResponseSerializer = new MetaCloudResponseSerializer();\nexport const metaCloudStatusMapper = new MetaCloudStatusMapper();\nexport const metaCloudMessageAdapter = new MetaCloudMessageAdapter(\n  sendMessageController,\n  chatController,\n  prismaRepository,\n  waMonitor,\n  metaCloudMediaService,\n  metaCloudResponseSerializer,\n);\nexport const metaCloudTemplateService = new MetaCloudTemplateService(templateController);\nexport const metaCloudGraphController = new MetaCloudGraphController(\n  prismaRepository,\n  metaCloudIdentityResolver,\n  metaCloudAuthService,\n  metaCloudMessageAdapter,\n  metaCloudMediaService,\n  metaCloudTemplateService,\n);\nexport const metaCloudWebhookSerializer = new MetaCloudWebhookSerializer(metaCloudIdentityResolver, metaCloudStatusMapper);\n\nexport const eventManager = new EventManager(prismaRepository, waMonitor);\nexport const metaCloudWebhookDispatcher = new MetaCloudWebhookDispatcher(\n  prismaRepository,\n  metaCloudIdentityResolver,\n  metaCloudWebhookSerializer,\n  eventManager.rabbitmq,\n);\neventManager.setMetaCloudDispatcher(metaCloudWebhookDispatcher);\n''',
)

# EventManager becomes an additional nonblocking consumer, not a new event bus.
patch_once(
    'src/api/integrations/event/event.manager.ts',
    "import { KafkaController } from '@api/integrations/event/kafka/kafka.controller';\n",
    "import { MetaCloudWebhookDispatcher } from '@api/compat/meta-cloud/meta-cloud-webhook.dispatcher';\nimport { KafkaController } from '@api/integrations/event/kafka/kafka.controller';\n",
)
patch_once(
    'src/api/integrations/event/event.manager.ts',
    '  private kafkaController: KafkaController;\n',
    '  private kafkaController: KafkaController;\n  private metaCloudDispatcher?: MetaCloudWebhookDispatcher;\n',
)
patch_once(
    'src/api/integrations/event/event.manager.ts',
    '  public init(httpServer: Server): void {\n',
    '''  public setMetaCloudDispatcher(dispatcher: MetaCloudWebhookDispatcher): void {\n    this.metaCloudDispatcher = dispatcher;\n  }\n\n  public init(httpServer: Server): void {\n''',
)
patch_once(
    'src/api/integrations/event/event.manager.ts',
    '  }): Promise<void> {\n    await this.websocket.emit(eventData);\n',
    '''  }): Promise<void> {\n    if (this.metaCloudDispatcher) {\n      void this.metaCloudDispatcher.handleEvent(eventData).catch(() => undefined);\n    }\n    await this.websocket.emit(eventData);\n''',
)

# Mount isolated /graph namespace before native routes.
patch_once(
    'src/api/routes/index.router.ts',
    "import { MetaCloudAdminRouter } from '@api/compat/meta-cloud/meta-cloud.router';\n",
    "import { MetaCloudGraphRouter } from '@api/compat/meta-cloud/meta-cloud-graph.router';\nimport { MetaCloudAdminRouter } from '@api/compat/meta-cloud/meta-cloud.router';\n",
)
patch_once(
    'src/api/routes/index.router.ts',
    "  .use('/compat/meta', new MetaCloudAdminRouter().router)\n",
    "  .use('/graph', new MetaCloudGraphRouter().router)\n  .use('/compat/meta', new MetaCloudAdminRouter().router)\n",
)

# Official Meta webhook verification: require hub.mode=subscribe.
patch_once(
    'src/api/integrations/channel/meta/meta.router.ts',
    "        const verifyToken = req.query['hub.verify_token'];\n",
    "        const mode = req.query['hub.mode'];\n        const verifyToken = req.query['hub.verify_token'];\n",
)
patch_once(
    'src/api/integrations/channel/meta/meta.router.ts',
    "        if (verifyToken !== expectedToken) {\n",
    "        if (mode !== 'subscribe') {\n          return res.status(403).type('text/plain').end('Invalid subscription mode');\n        }\n\n        if (verifyToken !== expectedToken) {\n",
)

# Point correction only: sender phone must be compared with display phone, never phone_number_id.
business = ROOT / 'src/api/integrations/channel/meta/whatsapp.business.service.ts'
business_text = business.read_text(encoding='utf-8')
wrong = 'message.from === received.metadata.phone_number_id'
correct = "String(message.from || '').replace(/\\D/g, '') === String(received.metadata.display_phone_number || '').replace(/\\D/g, '')"
if wrong in business_text:
    business_text = business_text.replace(wrong, correct)
business.write_text(business_text, encoding='utf-8')

write('test/meta-cloud/contract.test.ts', r'''
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { MetaCloudMessageAdapter } from '../../src/api/compat/meta-cloud/meta-cloud-message.adapter';
import { MetaCloudResponseSerializer } from '../../src/api/compat/meta-cloud/meta-cloud-response.serializer';
import { MetaCloudStatusMapper } from '../../src/api/compat/meta-cloud/meta-cloud-status.mapper';
import { MetaCloudWebhookSerializer } from '../../src/api/compat/meta-cloud/meta-cloud-webhook.serializer';
import { isMetaGraphVersion } from '../../src/api/compat/meta-cloud/meta-cloud-graph.router';

const calls: string[] = [];
const send: any = {
  sendText: async () => (calls.push('text'), { key: { id: 'TEXT1' } }),
  sendMedia: async (_i: any, data: any) => (calls.push(data.mediatype), { key: { id: `${data.mediatype}1` } }),
  sendWhatsAppAudio: async () => (calls.push('audio'), { key: { id: 'AUDIO1' } }),
  sendLocation: async () => (calls.push('location'), { key: { id: 'LOCATION1' } }),
  sendContact: async () => (calls.push('contacts'), { key: { id: 'CONTACT1' } }),
  sendReaction: async () => (calls.push('reaction'), { key: { id: 'REACTION1' } }),
  sendButtons: async () => (calls.push('button'), { key: { id: 'BUTTON1' } }),
  sendList: async () => (calls.push('list'), { key: { id: 'LIST1' } }),
};
const chat: any = { readMessage: async () => calls.push('read') };
const prisma: any = {
  message: { findFirst: async () => ({ key: { id: 'M1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false } }) },
};
const monitor: any = { waInstances: { cliente01: { connectionStatus: { state: 'open' } } } };
const media: any = { resolveOutbound: async (value: any) => value?.link || 'https://signed.example/media' };
const responses = new MetaCloudResponseSerializer();
const adapter = new MetaCloudMessageAdapter(send, chat, prisma, monitor, media, responses);
const identity: any = {
  instanceId: 'i1', instanceName: 'cliente01', provider: 'WHATSAPP-BAILEYS', phoneNumberId: '5575999999999',
  businessAccountId: '5575999999999', displayPhoneNumber: '5575999999999', token: 'x', instance: {},
};

assert.equal(isMetaGraphVersion('v18.0'), true);
assert.equal(isMetaGraphVersion('v22.0'), true);
assert.equal(isMetaGraphVersion('20.0'), false);

assert.equal((await adapter.execute(identity, { messaging_product: 'whatsapp', to: '5511888888888', type: 'text', text: { body: 'Olá' } })).messages[0].id, 'TEXT1');
await adapter.execute(identity, { to: '5511888888888', type: 'image', image: { link: 'https://e/i.jpg' } });
await adapter.execute(identity, { to: '5511888888888', type: 'video', video: { link: 'https://e/v.mp4' } });
await adapter.execute(identity, { to: '5511888888888', type: 'document', document: { link: 'https://e/f.pdf', filename: 'f.pdf' } });
await adapter.execute(identity, { to: '5511888888888', type: 'audio', audio: { link: 'https://e/a.ogg' } });
await adapter.execute(identity, { to: '5511888888888', type: 'location', location: { latitude: -12.9, longitude: -38.5 } });
await adapter.execute(identity, { to: '5511888888888', type: 'contacts', contacts: [{ name: { formatted_name: 'Cliente' }, phones: [{ phone: '5511888888888' }] }] });
await adapter.execute(identity, { to: '5511888888888', type: 'reaction', reaction: { message_id: 'ABC', emoji: '👍' } });
await adapter.execute(identity, { to: '5511888888888', type: 'interactive', interactive: { type: 'button', body: { text: 'Escolha' }, action: { buttons: [{ type: 'reply', reply: { id: '1', title: 'Um' } }] } } });
await adapter.execute(identity, { to: '5511888888888', type: 'interactive', interactive: { type: 'list', body: { text: 'Escolha' }, action: { button: 'Abrir', sections: [{ title: 'S', rows: [{ id: '1', title: 'Um', description: 'D' }] }] } } });
await adapter.execute(identity, { status: 'read', message_id: 'M1' });
for (const name of ['text', 'image', 'video', 'document', 'audio', 'location', 'contacts', 'reaction', 'button', 'list', 'read']) {
  assert.ok(calls.includes(name), `missing adapter call: ${name}`);
}

const statusMapper = new MetaCloudStatusMapper();
const serializer = new MetaCloudWebhookSerializer({} as any, statusMapper);
const incoming = serializer.serializeIncoming(identity, {
  key: { id: 'ABC123', remoteJid: '5511888888888@s.whatsapp.net' },
  pushName: 'Cliente', messageTimestamp: 1788230000, message: { conversation: 'Olá' },
});
assert.equal(incoming?.entry[0].changes[0].value.messages[0].id, 'ABC123');
assert.equal(incoming?.entry[0].changes[0].value.messages[0].text.body, 'Olá');
const mediaWebhook = serializer.serializeIncoming(identity, {
  key: { id: 'MEDIA123', remoteJid: '5511888888888@s.whatsapp.net' },
  messageTimestamp: 1788230000, message: { imageMessage: { mimetype: 'image/jpeg' } },
});
assert.equal(mediaWebhook?.entry[0].changes[0].value.messages[0].image.id, 'MEDIA123');
const delivered = serializer.serializeStatus(identity, {
  key: { id: 'ABC123', remoteJid: '5511888888888@s.whatsapp.net' }, update: { status: 'DELIVERY_ACK' },
});
assert.equal(delivered?.entry[0].changes[0].value.statuses[0].id, 'ABC123');
assert.equal(delivered?.entry[0].changes[0].value.statuses[0].status, 'delivered');
assert.equal(serializer.serializeStatus(identity, { key: { id: 'ABC123' }, update: { status: 'PENDING' } }), null);

const eventManagerSource = fs.readFileSync('src/api/integrations/event/event.manager.ts', 'utf8');
assert.match(eventManagerSource, /metaCloudDispatcher\.handleEvent/);
const dispatcherSource = fs.readFileSync('src/api/compat/meta-cloud/meta-cloud-webhook.dispatcher.ts', 'utf8');
assert.doesNotMatch(dispatcherSource, /\.message\.create\s*\(/);
const adapterSource = fs.readFileSync('src/api/compat/meta-cloud/meta-cloud-message.adapter.ts', 'utf8');
assert.doesNotMatch(adapterSource, /makeWASocket|\.sendMessage\s*\(/);
const integrationTypes = fs.readFileSync('src/api/types/wa.types.ts', 'utf8');
assert.doesNotMatch(integrationTypes, /META-COMPATIBLE|META-CLOUD-COMPATIBLE|WHATSAPP-META-COMPAT|GRAPH-API/);
const officialBusiness = fs.readFileSync('src/api/integrations/channel/meta/whatsapp.business.service.ts', 'utf8');
assert.doesNotMatch(officialBusiness, /message\.from === received\.metadata\.phone_number_id/);
const officialRouter = fs.readFileSync('src/api/integrations/channel/meta/meta.router.ts', 'utf8');
assert.match(officialRouter, /mode !== 'subscribe'/);

console.log('meta-cloud contract compatibility: ok');
''')

pkg = ROOT / 'package.json'
data = json.loads(pkg.read_text(encoding='utf-8'))
if 'test/meta-cloud/contract.test.ts' not in data['scripts']['test:compat']:
    data['scripts']['test:compat'] += ' && tsx ./test/meta-cloud/contract.test.ts'
pkg.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
