import { getBase64FromMediaMessageDto } from '@api/dto/chat.dto';
import * as s3Service from '@api/integrations/storage/s3/libs/minio.server';
import { Events } from '@api/types/wa.types';
import { S3 } from '@config/env.config';
import { prismaJsonPath } from '@utils/prismaJsonPath';
import { join } from 'path';

import { ZapoIdentityStartupService } from './zapo.identity.extensions';
import { containsZapoDownloadableMedia, restoreZapoMediaPayload } from './zapo.media.helpers';

/**
 * Provider-neutral media facade for the ZAPO transport.
 *
 * Public controllers keep using the same Connect|API methods regardless of
 * provider. This layer only translates ZAPO's persisted JSON representation
 * back to the native protobuf media descriptor expected by zapo-js, and gives
 * inbound ZAPO messages the same MinIO/mediaUrl enrichment already produced by
 * the Baileys provider.
 */
export class ZapoMediaStartupService extends ZapoIdentityStartupService {
  private async findPersistedMessageByKeyId(messageId: string) {
    if (!messageId) return null;

    return this.prismaRepository.message.findFirst({
      where: {
        instanceId: this.instanceId,
        key: { path: prismaJsonPath('id'), equals: messageId },
      },
    });
  }

  public async getBase64FromMediaMessage(data: getBase64FromMediaMessageDto, getBuffer = false) {
    const input = data?.message as any;
    const keyId = String(input?.key?.id ?? '').trim();
    let normalizedInput = input;

    if (input?.message && typeof input.message === 'object') {
      normalizedInput = {
        ...input,
        message: restoreZapoMediaPayload(input.message),
      };
    } else if (containsZapoDownloadableMedia(input)) {
      // Also accept a raw Proto.IMessage-shaped payload for compatibility with
      // callers that pass the media message without the Connect|API envelope.
      normalizedInput = {
        key: input?.key,
        message: restoreZapoMediaPayload(input),
      };
    } else if (keyId) {
      const stored = await this.findPersistedMessageByKeyId(keyId);
      if (stored?.message && typeof stored.message === 'object') {
        normalizedInput = {
          ...input,
          key: input?.key ?? stored.key,
          message: restoreZapoMediaPayload(stored.message),
        };
      }
    }

    return super.getBase64FromMediaMessage(
      {
        ...data,
        message: normalizedInput,
      } as getBase64FromMediaMessageDto,
      getBuffer,
    );
  }

  public async sendDataWebhook<T extends object = any>(
    event: Events,
    data: T,
    local = true,
    integration?: string[],
    extra?: Record<string, any>,
  ) {
    if (event === Events.MESSAGES_UPSERT && data && typeof data === 'object') {
      try {
        await this.attachIncomingMediaUrl(data as Record<string, any>);
      } catch (error) {
        // Media persistence must never block delivery of the WhatsApp event.
        // The provider-neutral download endpoint remains available as fallback.
        this.logger.error([
          'ZAPO inbound media enrichment failed',
          (error as Error)?.message ?? String(error),
          (error as Error)?.stack,
        ]);
      }
    }

    return super.sendDataWebhook(event, data, local, integration, extra);
  }

  private async attachIncomingMediaUrl(messageRaw: Record<string, any>): Promise<void> {
    const s3 = this.configService.get<S3>('S3');
    if (!s3?.ENABLE) return;

    // Outgoing media already originates inside Connect|API. This parity layer
    // concerns inbound provider media delivered to external consumers.
    if (messageRaw?.key?.fromMe === true) return;
    if (!messageRaw?.message || messageRaw.message.mediaUrl) return;
    if (!containsZapoDownloadableMedia(messageRaw.message)) return;

    const messageId = String(messageRaw?.key?.id ?? '').trim();
    const remoteJid = String(messageRaw?.key?.remoteJid ?? '').trim();
    if (!messageId || !remoteJid) return;

    const stored = await this.findPersistedMessageByKeyId(messageId);
    if (stored) {
      const existingMedia = await this.prismaRepository.media.findUnique({
        where: { messageId: stored.id },
      });

      if (existingMedia?.fileName) {
        const existingUrl = await s3Service.getObjectUrl(existingMedia.fileName);
        if (existingUrl) {
          messageRaw.message.mediaUrl = existingUrl;
          await this.prismaRepository.message.update({
            where: { id: stored.id },
            data: { message: messageRaw.message },
          });
        }
        return;
      }
    }

    const media = await this.getBase64FromMediaMessage({ message: messageRaw } as getBase64FromMediaMessageDto, true);
    const buffer = media?.buffer;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return;

    const mediaType = String(media?.mediaType ?? '').trim() || 'media';
    if ((mediaType === 'video' || mediaType === 'gif' || mediaType === 'ptv') && !s3.SAVE_VIDEO) {
      this.logger.warn('Video upload is disabled. Skipping ZAPO video upload.');
      return;
    }

    const fileName = String(media?.fileName ?? '').trim() || `${messageId}.bin`;
    const mimetype = String(media?.mimetype ?? '').trim() || 'application/octet-stream';
    const fullName = join(`${this.instance.id}`, remoteJid, messageId, mediaType, fileName);

    const uploadResult = await s3Service.uploadFile(fullName, buffer, buffer.length, {
      'Content-Type': mimetype,
    });
    if (!uploadResult || uploadResult instanceof Error) {
      throw uploadResult instanceof Error ? uploadResult : new Error('MinIO did not accept the ZAPO media upload');
    }

    if (stored) {
      await this.prismaRepository.media.upsert({
        where: { messageId: stored.id },
        update: {
          instanceId: this.instanceId,
          type: mediaType,
          fileName: fullName,
          mimetype,
        },
        create: {
          messageId: stored.id,
          instanceId: this.instanceId,
          type: mediaType,
          fileName: fullName,
          mimetype,
        },
      });
    }

    const mediaUrl = await s3Service.getObjectUrl(fullName);
    if (!mediaUrl) return;

    messageRaw.message.mediaUrl = mediaUrl;
    if (stored) {
      await this.prismaRepository.message.update({
        where: { id: stored.id },
        data: { message: messageRaw.message },
      });
    }
  }
}
