import * as s3Service from '@api/integrations/storage/s3/libs/minio.server';
import { Events } from '@api/types/wa.types';
import { Chatwoot, Database, S3 } from '@config/env.config';
import { prismaJsonPath } from '@utils/prismaJsonPath';
import mimeTypes from 'mime-types';
import { join } from 'path';

import { ZapoIdentityStartupService } from './zapo.identity.extensions';

type ZapoParityStatus = 'ERROR' | 'PENDING' | 'SERVER_ACK' | 'DELIVERY_ACK' | 'READ' | 'PLAYED';

type ZapoMediaSnapshot = {
  buffer: Buffer;
  mediaType: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  mimetype: string;
  fileName: string;
};

const STATUS_RANK: Record<ZapoParityStatus, number> = {
  ERROR: 0,
  PENDING: 1,
  SERVER_ACK: 2,
  DELIVERY_ACK: 3,
  READ: 4,
  PLAYED: 5,
};

const RECEIPT_STATUS: Record<string, ZapoParityStatus> = {
  delivered: 'DELIVERY_ACK',
  inactive: 'DELIVERY_ACK',
  read: 'READ',
  played: 'PLAYED',
};

const MEDIA_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
] as const;

const MEDIA_TYPES = [
  ['imageMessage', 'image', 'image/jpeg'],
  ['videoMessage', 'video', 'video/mp4'],
  ['ptvMessage', 'video', 'video/mp4'],
  ['audioMessage', 'audio', 'audio/ogg'],
  ['documentMessage', 'document', 'application/octet-stream'],
  ['stickerMessage', 'sticker', 'image/webp'],
] as const;

/**
 * Runtime parity layer for WHATSAPP-ZAPO.
 *
 * Baileys is the compatibility reference and is deliberately left untouched.
 * This layer supplies the pieces that the native Zapo transport exposes but
 * the Connect|API adapter did not yet translate into the established contract:
 *
 * - media bytes are resolved before MESSAGES_UPSERT and persisted in the same
 *   Media/S3 model consumed by Meta-compatible media endpoints;
 * - webhookBase64 receives message.base64 just like Baileys;
 * - Zapo receipt events become MESSAGES_UPDATE with the same status vocabulary
 *   (SERVER_ACK, DELIVERY_ACK, READ, PLAYED);
 * - live MESSAGES_UPSERT delivery is serialized so a slow media download cannot
 *   be overtaken by a later text message.
 */
export class ZapoParityStartupService extends ZapoIdentityStartupService {
  private readonly parityBoundClients = new WeakSet<object>();
  private readonly mediaDownloads = new Map<string, Promise<ZapoMediaSnapshot | null>>();
  private readonly mediaCleanupTimers = new Map<string, NodeJS.Timeout>();
  private readonly emittedStatusRank = new Map<string, number>();
  private messageWebhookQueue: Promise<void> = Promise.resolve();
  private receiptQueue: Promise<void> = Promise.resolve();

  public async connectToWhatsapp(): Promise<any> {
    const client = await super.connectToWhatsapp();
    this.bindParityEvents(client);
    return client;
  }

  public async prepareQrConnection(): Promise<any> {
    const client = await super.prepareQrConnection();
    this.bindParityEvents(client);
    return client;
  }

  public async preparePairingConnection(number: string): Promise<any> {
    const client = await super.preparePairingConnection(number);
    this.bindParityEvents(client);
    return client;
  }

  public async sendDataWebhook<T extends object = any>(
    event: Events,
    data: T,
    local = true,
    integration?: string[],
    extra?: Record<string, any>,
  ) {
    if (event !== Events.MESSAGES_UPSERT || !data || typeof data !== 'object') {
      return super.sendDataWebhook(event, data, local, integration, extra);
    }

    const run = this.messageWebhookQueue.then(async () => {
      // The core Zapo listener is registered before this parity listener. Yield
      // one turn so the raw `message` event can seed mediaDownloads first.
      await new Promise<void>((resolve) => setImmediate(resolve));
      const payload = data as any;
      await this.enrichMessageMedia(payload);
      await super.sendDataWebhook(event, payload, local, integration, extra);

      if (payload?.key?.fromMe === true && payload?.key?.id) {
        await this.publishMessageStatus(payload.key.id, 'SERVER_ACK', {
          remoteJid: payload.key.remoteJid,
          remoteJidAlt: payload.key.remoteJidAlt,
          fromMe: true,
          participant: payload.key.participant,
          participantAlt: payload.key.participantAlt,
        });
      }
    });

    this.messageWebhookQueue = run.catch((error: Error) => {
      this.logger.error(`Zapo parity message pipeline failed: ${error?.message || error}`);
    });
    return this.messageWebhookQueue;
  }

  private bindParityEvents(client: any): void {
    if (!client || (typeof client !== 'object' && typeof client !== 'function')) return;
    if (this.parityBoundClients.has(client)) return;
    this.parityBoundClients.add(client);

    // Keep the raw Zapo event long enough to use the library's verified media
    // decryption path. The normal adapter serializes Uint8Array fields for DB
    // storage, which is intentionally not used as the primary media source.
    client.on('message', (event: any) => this.captureIncomingMedia(client, event));

    client.on('receipt', (event: any) => {
      const messageBarrier = this.messageWebhookQueue;
      const run = this.receiptQueue.then(async () => {
        // A delivery/read receipt must never overtake the corresponding
        // MESSAGES_UPSERT, especially when that message is downloading media.
        await messageBarrier;
        await this.handleReceipt(event);
      });
      this.receiptQueue = run.catch((error: Error) => {
        this.logger.error(`Zapo receipt parity failed: ${error?.message || error}`);
      });
    });
  }

  private captureIncomingMedia(client: any, event: any): void {
    const messageId = String(event?.key?.id || '').trim();
    if (!messageId || !event?.message || this.mediaDownloads.has(messageId)) return;

    const descriptor = this.mediaDescriptor(event.message, messageId);
    if (!descriptor || !this.shouldResolveMedia(descriptor.mediaType)) return;

    const download = Promise.resolve(client.message.downloadBytes(event))
      .then((bytes: Uint8Array) => ({ ...descriptor, buffer: Buffer.from(bytes) }))
      .catch((error: Error) => {
        this.logger.error(`Unable to hydrate Zapo media ${messageId}: ${error?.message || error}`);
        return null;
      });

    this.mediaDownloads.set(messageId, download);
    const timer = setTimeout(
      () => {
        this.mediaDownloads.delete(messageId);
        this.mediaCleanupTimers.delete(messageId);
      },
      2 * 60 * 1000,
    );
    timer.unref?.();
    this.mediaCleanupTimers.set(messageId, timer);
  }

  private shouldResolveMedia(mediaType: ZapoMediaSnapshot['mediaType']): boolean {
    const s3 = this.configService.get<S3>('S3');
    const base64 = Boolean(this.localWebhook?.enabled && this.localWebhook?.webhookBase64);
    const store = Boolean(s3?.ENABLE && (mediaType !== 'video' || s3.SAVE_VIDEO));
    return base64 || store;
  }

  private async enrichMessageMedia(payload: any): Promise<void> {
    const messageId = String(payload?.key?.id || '').trim();
    const descriptor = this.mediaDescriptor(payload?.message, messageId);
    if (!messageId || !descriptor) return;

    let media = await this.mediaDownloads.get(messageId);
    if (!media) media = await this.fallbackMedia(payload, descriptor);
    if (!media?.buffer?.length) return;

    // Persist first, before base64 is attached, matching Baileys: database/S3
    // records remain compact while webhook consumers can still opt into base64.
    await this.persistMedia(payload, media);

    if (this.localWebhook?.enabled && this.localWebhook?.webhookBase64) {
      payload.message = { ...(payload.message || {}), base64: media.buffer.toString('base64') };
    }
  }

  private async fallbackMedia(payload: any, descriptor: Omit<ZapoMediaSnapshot, 'buffer'>) {
    try {
      const result = await this.getBase64FromMediaMessage({ message: payload } as any, true);
      if (!result?.buffer) return null;
      return {
        buffer: Buffer.from(result.buffer),
        mediaType: (result.mediaType || descriptor.mediaType) as ZapoMediaSnapshot['mediaType'],
        mimetype: String(result.mimetype || descriptor.mimetype),
        fileName: String(result.fileName || descriptor.fileName),
      } satisfies ZapoMediaSnapshot;
    } catch (error) {
      this.logger.warn(
        `Stored Zapo media fallback failed for ${payload?.key?.id}: ${(error as Error)?.message || error}`,
      );
      return null;
    }
  }

  private async persistMedia(payload: any, media: ZapoMediaSnapshot): Promise<void> {
    const s3 = this.configService.get<S3>('S3');
    if (!s3?.ENABLE) return;
    if (media.mediaType === 'video' && !s3.SAVE_VIDEO) return;

    const messageId = String(payload?.key?.id || '').trim();
    if (!messageId) return;

    const stored = await this.findParityStoredMessageWithRetry(messageId);
    if (!stored?.id) {
      this.logger.warn(`Zapo media ${messageId} could not be linked to the persisted Message row`);
      return;
    }

    const existingMedia = await this.prismaRepository.media.findUnique({ where: { messageId: stored.id } });
    if (existingMedia) {
      const mediaUrl = await s3Service.getObjectUrl(existingMedia.fileName).catch(() => null);
      if (mediaUrl) payload.message = { ...(payload.message || {}), mediaUrl };
      return;
    }

    const safeFileName = this.safeFileName(media.fileName || `${messageId}.bin`);
    const remoteJid = String(payload?.key?.remoteJid || 'unknown');
    const fullName = join(`${this.instance.id}`, remoteJid, media.mediaType, `${Date.now()}_${safeFileName}`);
    const mimetype = String(media.mimetype || 'application/octet-stream').slice(0, 100);

    const uploaded = await s3Service.uploadFile(fullName, media.buffer, media.buffer.length, {
      'Content-Type': mimetype,
    });
    if (!uploaded) {
      this.logger.warn(`Zapo media ${messageId} was not persisted because S3 is unavailable`);
      return;
    }

    await this.prismaRepository.media.upsert({
      where: { messageId: stored.id },
      update: {
        type: media.mediaType,
        fileName: fullName,
        mimetype,
        instanceId: this.instanceId,
      },
      create: {
        messageId: stored.id,
        instanceId: this.instanceId,
        type: media.mediaType,
        fileName: fullName,
        mimetype,
      },
    });

    const mediaUrl = await s3Service.getObjectUrl(fullName).catch(() => null);
    if (mediaUrl) {
      payload.message = { ...(payload.message || {}), mediaUrl };
      await this.prismaRepository.message
        .update({ where: { id: stored.id }, data: { message: payload.message } })
        .catch((error: Error) => this.logger.warn(`Unable to persist Zapo media URL: ${error?.message || error}`));
    }
  }

  private async findParityStoredMessageWithRetry(messageId: string): Promise<any | null> {
    for (const delayMs of [0, 40, 120, 300]) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      const message = await this.findParityStoredMessage(messageId);
      if (message) return message;
    }
    return null;
  }

  private async findParityStoredMessage(messageId: string): Promise<any | null> {
    return this.prismaRepository.message.findFirst({
      where: {
        instanceId: this.instanceId,
        key: { path: prismaJsonPath('id'), equals: messageId } as any,
      },
    });
  }

  private async handleReceipt(event: any): Promise<void> {
    const status = RECEIPT_STATUS[String(event?.status || '').toLowerCase()];
    if (!status) return;

    const ids: string[] = Array.isArray(event?.messageIds)
      ? [...new Set<string>(event.messageIds.map((id: unknown) => String(id || '').trim()).filter(Boolean))]
      : [];

    for (const messageId of ids) {
      const stored = await this.findParityStoredMessage(messageId);
      const storedKey = this.record(stored?.key);
      const remoteJid = this.normalizeReceiptJid(
        storedKey.remoteJid || event?.chatJid || event?.recipientJid || event?.participantJid,
      );
      const fromMe = typeof storedKey.fromMe === 'boolean' ? storedKey.fromMe : event?.fromSelfDevice !== true;
      const participant = this.normalizeReceiptJid(storedKey.participant || event?.participantJid) || undefined;

      await this.publishMessageStatus(
        messageId,
        status,
        {
          remoteJid,
          remoteJidAlt: storedKey.remoteJidAlt,
          fromMe,
          participant,
          participantAlt: storedKey.participantAlt,
        },
        stored,
      );
    }
  }

  private async publishMessageStatus(
    messageId: string,
    status: ZapoParityStatus,
    key: {
      remoteJid?: string;
      remoteJidAlt?: string;
      fromMe: boolean;
      participant?: string;
      participantAlt?: string;
    },
    knownStored?: any,
  ): Promise<void> {
    const rank = STATUS_RANK[status];
    const memoryRank = this.emittedStatusRank.get(messageId) ?? -1;
    if (rank <= memoryRank) return;
    this.emittedStatusRank.set(messageId, rank);

    const stored = knownStored ?? (await this.findParityStoredMessageWithRetry(messageId));
    const storedStatus = String(stored?.status || '').toUpperCase() as ZapoParityStatus;
    const storedRank = STATUS_RANK[storedStatus] ?? -1;

    if (stored?.id && rank > storedRank) {
      await this.prismaRepository.message.update({ where: { id: stored.id }, data: { status } });
    }

    const update: any = {
      keyId: messageId,
      remoteJid: key.remoteJid,
      remoteJidAlt: key.remoteJidAlt,
      fromMe: key.fromMe,
      participant: key.participant,
      participantAlt: key.participantAlt,
      status,
      ...(stored?.id ? { messageId: stored.id } : {}),
      instanceId: this.instanceId,
    };

    const database = this.configService.get<Database>('DATABASE');
    if (stored?.id && database.SAVE_DATA.MESSAGE_UPDATE) {
      await this.prismaRepository.messageUpdate.create({
        data: {
          messageId: stored.id,
          keyId: messageId,
          remoteJid: key.remoteJid || '',
          fromMe: key.fromMe,
          participant: key.participant,
          status,
          instanceId: this.instanceId,
        },
      });
    }

    if ((status === 'READ' || status === 'PLAYED') && key.fromMe) {
      if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
        await this.chatwootService.eventWhatsapp(
          'messages.read',
          { instanceName: this.instance.name, instanceId: this.instanceId },
          {
            key: {
              id: messageId,
              remoteJid: key.remoteJid,
              fromMe: key.fromMe,
              participant: key.participant,
            },
          },
        );
      }
    }

    await super.sendDataWebhook(Events.MESSAGES_UPDATE, update);
  }

  private mediaDescriptor(message: any, messageId: string): Omit<ZapoMediaSnapshot, 'buffer'> | null {
    if (!message || typeof message !== 'object') return null;
    let current = message as Record<string, any>;

    for (let depth = 0; depth < 8; depth++) {
      for (const [key, mediaType, defaultMime] of MEDIA_TYPES) {
        const media = current?.[key];
        if (!media || typeof media !== 'object') continue;
        const mimetype = String(media.mimetype || media.mimeType || defaultMime).trim() || defaultMime;
        const extension = mimeTypes.extension(mimetype.split(';')[0]) || this.defaultExtension(mediaType);
        const fileName = String(media.fileName || '').trim() || `${messageId || Date.now()}.${extension}`;
        return { mediaType, mimetype, fileName };
      }

      const wrapper = MEDIA_WRAPPERS.find((key) => current?.[key]?.message && typeof current[key].message === 'object');
      if (!wrapper) break;
      current = current[wrapper].message;
    }

    return null;
  }

  private defaultExtension(mediaType: ZapoMediaSnapshot['mediaType']): string {
    switch (mediaType) {
      case 'image':
        return 'jpg';
      case 'video':
        return 'mp4';
      case 'audio':
        return 'ogg';
      case 'sticker':
        return 'webp';
      default:
        return 'bin';
    }
  }

  private safeFileName(value: string): string {
    return String(value || 'media.bin')
      .replace(/[\\/]/g, '_')
      .replace(/[^A-Za-z0-9._-]/g, '_')
      .slice(-180);
  }

  private normalizeReceiptJid(value: unknown): string | undefined {
    const jid = String(value || '').trim();
    if (!jid) return undefined;
    return jid.replace(/:\d+@/, '@');
  }

  private record(value: unknown): Record<string, any> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
  }
}
