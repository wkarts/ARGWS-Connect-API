import {
  ArchiveChatDto,
  BlockUserDto,
  DeleteMessage,
  getBase64FromMediaMessageDto,
  MarkChatUnreadDto,
  NumberBusiness,
  PrivacySettingDto,
  ReadMessageDto,
  UpdateMessageDto,
} from '@api/dto/chat.dto';
import { Events } from '@api/types/wa.types';
import type { Database } from '@config/env.config';
import { BadRequestException, InternalServerErrorException } from '@exceptions';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { createJid } from '@utils/createJid';
import { prismaJsonPath } from '@utils/prismaJsonPath';
import axios from 'axios';
import { isBase64, isURL } from 'class-validator';
import ffmpeg from 'fluent-ffmpeg';
import mimeTypes from 'mime-types';
import { PassThrough } from 'stream';

import { ZapoExtendedStartupService } from './zapo.provider.extensions';

type ZapoMediaEnvelope = {
  typeMessage: string;
  mediaType: string;
  message: Record<string, any>;
  mediaMessage: Record<string, any>;
};

/**
 * Connect|API account/chat compatibility built only on Zapo's public client
 * coordinators. Keeping this outside the transport provider avoids coupling
 * controller parity to Zapo protocol internals.
 */
export class ZapoAccountStartupService extends ZapoExtendedStartupService {
  private connectedClient(): any {
    if (!this.client || this.connectionStatus?.state !== 'open') {
      throw new BadRequestException('WhatsApp instance is not connected');
    }
    return this.client;
  }

  private normalizeAccountJid(value: unknown): string {
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

  private resolveSelfJid(): string {
    const jid = this.instance.wuid ?? this.client?.getCredentials?.()?.meJid;
    return this.normalizeAccountJid(jid);
  }

  private resolveChatTarget(data: ArchiveChatDto | MarkChatUnreadDto): string {
    const number = data?.chat ?? data?.lastMessage?.key?.remoteJid;
    if (!number) throw new BadRequestException('Chat number or JID is required');
    return this.normalizeAccountJid(number);
  }

  private async findStoredMessage(messageId: string) {
    return this.prismaRepository.message.findFirst({
      where: {
        instanceId: this.instanceId,
        key: { path: prismaJsonPath('id'), equals: messageId },
      },
    });
  }

  private unwrapMediaMessage(message: unknown): ZapoMediaEnvelope | null {
    if (!message || typeof message !== 'object') return null;

    let current = message as Record<string, any>;
    const wrapperKeys = [
      'ephemeralMessage',
      'viewOnceMessage',
      'viewOnceMessageV2',
      'viewOnceMessageV2Extension',
      'documentWithCaptionMessage',
      'editedMessage',
    ];

    for (let depth = 0; depth < 8; depth++) {
      const mediaKeys = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
      const typeMessage = mediaKeys.find((key) => current?.[key] && typeof current[key] === 'object');
      if (typeMessage) {
        const mediaMessage = current[typeMessage] as Record<string, any>;
        const mediaType = typeMessage.replace(/Message$/, '');
        return { typeMessage, mediaType, message: current, mediaMessage };
      }

      const wrapper = wrapperKeys.find((key) => current?.[key]?.message && typeof current[key].message === 'object');
      if (!wrapper) return null;
      current = current[wrapper].message;
    }

    return null;
  }

  private async convertAudioToMp4(input: Buffer): Promise<Buffer> {
    ffmpeg.setFfmpegPath(ffmpegPath.path);

    return new Promise<Buffer>((resolve, reject) => {
      const inputStream = new PassThrough();
      const outputStream = new PassThrough();
      const chunks: Buffer[] = [];

      outputStream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      outputStream.on('error', reject);

      ffmpeg(inputStream)
        .noVideo()
        .audioCodec('aac')
        .format('mp4')
        .outputOptions(['-movflags frag_keyframe+empty_moov'])
        .on('error', reject)
        .on('end', () => resolve(Buffer.concat(chunks)))
        .pipe(outputStream, { end: true });

      inputStream.end(input);
    });
  }

  /** Mark one or more conversations read using Zapo's native receipt API. */
  public async markMessageAsRead(data: ReadMessageDto) {
    try {
      const client = this.connectedClient();
      const grouped = new Map<string, string[]>();

      for (const message of data?.readMessages ?? []) {
        if (!message?.id) continue;
        const jid = this.normalizeAccountJid(message.remoteJid);
        const ids = grouped.get(jid) ?? [];
        ids.push(message.id);
        grouped.set(jid, ids);
      }

      for (const [jid, ids] of grouped) {
        await client.message.sendReceipt(jid, ids, { type: 'read' });
      }

      return { message: 'Read messages', read: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Read messages fail', (error as Error)?.toString());
    }
  }

  /** Archive/unarchive using Zapo's public app-state mutation coordinator. */
  public async archiveChat(data: ArchiveChatDto) {
    try {
      const jid = this.resolveChatTarget(data);
      await this.connectedClient().chat.setChatArchive(jid, data.archive === true);

      return { chatId: jid, archived: data.archive === true };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error archiving chat', (error as Error)?.toString());
    }
  }

  /** Mark the conversation unread through app-state rather than a fake local flag. */
  public async markChatUnread(data: MarkChatUnreadDto) {
    try {
      const jid = this.resolveChatTarget(data);
      await this.connectedClient().chat.setChatRead(jid, false);

      return { chatId: jid, markedChatUnread: true };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error marking chat unread', (error as Error)?.toString());
    }
  }

  /** Revoke a message using Zapo's native message target model. */
  public async deleteMessage(data: DeleteMessage) {
    try {
      const jid = this.normalizeAccountJid(data?.remoteJid);
      const messageId = String(data?.id ?? '').trim();
      if (!messageId) throw new BadRequestException('Message ID is required');

      const target = {
        remoteJid: jid,
        id: messageId,
        fromMe: data.fromMe === true,
        ...(data.participant ? { participant: this.normalizeAccountJid(data.participant) } : {}),
      };
      const result = await this.connectedClient().message.send(jid, {
        type: 'revoke',
        target,
      });

      const storedMessage = await this.findStoredMessage(messageId);
      const logicalDelete = this.configService.get<Database>('DATABASE').DELETE_DATA.LOGICAL_MESSAGE_DELETE;
      let webhookMessage: any = storedMessage;

      if (storedMessage && logicalDelete) {
        const existingKey =
          typeof storedMessage.key === 'object' && storedMessage.key !== null ? (storedMessage.key as object) : {};
        webhookMessage = await this.prismaRepository.message.update({
          where: { id: storedMessage.id },
          data: {
            key: { ...existingKey, deleted: true },
            status: 'DELETED',
          },
        });

        if (this.configService.get<Database>('DATABASE').SAVE_DATA.MESSAGE_UPDATE) {
          await this.prismaRepository.messageUpdate.create({
            data: {
              messageId: storedMessage.id,
              keyId: messageId,
              remoteJid: jid,
              fromMe: data.fromMe === true,
              participant: data.participant ? this.normalizeAccountJid(data.participant) : undefined,
              status: 'DELETED',
              instanceId: this.instanceId,
            },
          });
        }
      } else if (storedMessage && !logicalDelete) {
        await this.prismaRepository.message.delete({ where: { id: storedMessage.id } });
      }

      this.sendDataWebhook(
        Events.MESSAGES_DELETE,
        webhookMessage ?? {
          key: target,
          status: 'DELETED',
          instanceId: this.instanceId,
        },
      );

      return {
        key: { id: result?.id, remoteJid: jid, fromMe: true },
        protocolMessage: { key: target },
        deleted: true,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error deleting message', (error as Error)?.toString());
    }
  }

  /** Edit an existing text message using Zapo's public `editKey` send option. */
  public async updateMessage(data: UpdateMessageDto) {
    try {
      const jid = this.normalizeAccountJid(data?.number);
      const messageId = String(data?.key?.id ?? '').trim();
      if (!messageId) throw new BadRequestException('Message ID is required');

      const storedMessage = await this.findStoredMessage(messageId);
      if (storedMessage?.messageTimestamp) {
        const ageSeconds = Math.floor(Date.now() / 1000) - storedMessage.messageTimestamp;
        if (ageSeconds > 15 * 60) {
          throw new BadRequestException('Message is older than 15 minutes');
        }
      }

      const result = await this.connectedClient().message.send(
        jid,
        { type: 'text', text: String(data.text ?? '') },
        {
          editKey: {
            id: messageId,
            ...(data.key.participant ? { participant: this.normalizeAccountJid(data.key.participant) } : {}),
          },
        },
      );

      let webhookMessage: any = null;
      if (storedMessage) {
        const current =
          typeof storedMessage.message === 'object' && storedMessage.message !== null
            ? (storedMessage.message as Record<string, any>)
            : {};
        const updatedPayload =
          typeof current.extendedTextMessage === 'object' && current.extendedTextMessage !== null
            ? {
                ...current,
                extendedTextMessage: {
                  ...current.extendedTextMessage,
                  text: String(data.text ?? ''),
                },
              }
            : { ...current, conversation: String(data.text ?? '') };

        webhookMessage = await this.prismaRepository.message.update({
          where: { id: storedMessage.id },
          data: {
            message: updatedPayload,
            messageTimestamp: Math.floor(Date.now() / 1000),
            status: 'EDITED',
          },
        });

        if (this.configService.get<Database>('DATABASE').SAVE_DATA.MESSAGE_UPDATE) {
          await this.prismaRepository.messageUpdate.create({
            data: {
              messageId: storedMessage.id,
              keyId: messageId,
              remoteJid: jid,
              fromMe: true,
              participant: data.key.participant ? this.normalizeAccountJid(data.key.participant) : undefined,
              status: 'EDITED',
              instanceId: this.instanceId,
            },
          });
        }

        this.sendDataWebhook(Events.MESSAGES_UPDATE, webhookMessage);
      }

      return {
        key: { id: result?.id, remoteJid: jid, fromMe: true },
        editedMessage: {
          key: data.key,
          text: String(data.text ?? ''),
        },
        message: webhookMessage,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error updating message', (error as Error)?.toString());
    }
  }

  /**
   * Download media with Zapo's verified media pipeline and preserve the public
   * Connect|API base64 response contract used by the Baileys provider.
   */
  public async getBase64FromMediaMessage(data: getBase64FromMediaMessageDto, getBuffer = false) {
    try {
      const input = data?.message as any;
      const keyId = String(input?.key?.id ?? '').trim();
      const stored = !input?.message && keyId ? await this.findStoredMessage(keyId) : null;
      const rawMessage = input?.message ?? stored?.message;
      if (!rawMessage || typeof rawMessage !== 'object') {
        throw new BadRequestException('Message not found');
      }

      const envelope = this.unwrapMediaMessage(rawMessage);
      if (!envelope) throw new BadRequestException('Message does not contain downloadable media');

      const bytes = await this.connectedClient().message.downloadBytes(envelope.message);
      let buffer = Buffer.from(bytes);
      let mimetype = String(envelope.mediaMessage.mimetype ?? 'application/octet-stream');

      if (data?.convertToMp4 === true && envelope.typeMessage === 'audioMessage') {
        buffer = await this.convertAudioToMp4(buffer);
        mimetype = 'audio/mp4';
      }

      const extension = mimeTypes.extension(mimetype) || 'bin';
      const fileName =
        String(envelope.mediaMessage.fileName ?? '').trim() ||
        `${String(input?.key?.id ?? stored?.id ?? Date.now())}.${extension}`;

      return {
        mediaType: envelope.mediaType,
        fileName,
        caption: envelope.mediaMessage.caption,
        size: {
          fileLength: envelope.mediaMessage.fileLength ?? buffer.length,
          height: envelope.mediaMessage.height,
          width: envelope.mediaMessage.width,
        },
        mimetype,
        base64: buffer.toString('base64'),
        buffer: getBuffer ? buffer : null,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      this.logger.error('Error processing media message:');
      this.logger.error(error);
      throw new InternalServerErrorException('Error processing media message', (error as Error)?.toString());
    }
  }

  /** Fetch a peer's legacy About/status text. */
  public async getStatus(number: string) {
    const jid = this.normalizeAccountJid(number);

    try {
      const status = await this.connectedClient().profile.getStatus(jid);
      return { wuid: jid, status: status?.status ?? null };
    } catch {
      return { wuid: jid, status: null };
    }
  }

  /**
   * Map Zapo's public business-profile model into the Connect|API compatibility
   * DTO used by the existing chat/profile routes.
   */
  public async fetchBusinessProfile(number?: string): Promise<NumberBusiness> {
    try {
      const jid = number ? this.normalizeAccountJid(number) : this.resolveSelfJid();
      const client = this.connectedClient();
      const profiles = await client.business.getBusinessProfile([jid]);
      const profile = profiles?.find((entry: any) => entry?.jid === jid) ?? profiles?.[0];

      if (!profile) {
        const info = number ? (await this.whatsappNumber({ numbers: [jid] }))?.[0] : null;
        return {
          isBusiness: false,
          message: 'Not is business profile',
          jid: info?.jid ?? jid,
          wid: info?.jid ?? jid,
          exists: number ? info?.exists === true : true,
          name: info?.name,
        };
      }

      const verifiedName = await client.business.getVerifiedName(jid).catch(() => null);
      const websites = Array.isArray(profile.websites)
        ? profile.websites
            .map((website: any) => (typeof website === 'string' ? website : website?.url))
            .filter((website: unknown): website is string => typeof website === 'string' && website.length > 0)
        : [];
      const category = Array.isArray(profile.categories) ? profile.categories[0] : undefined;
      const profileOptions =
        profile.profileOptions && typeof profile.profileOptions === 'object' ? profile.profileOptions : {};
      const profilehandle =
        profileOptions.profile_handle ?? profileOptions.profilehandle ?? profileOptions.username ?? profile.tag;

      return {
        isBusiness: true,
        wid: profile.jid ?? jid,
        jid: profile.jid ?? jid,
        exists: true,
        name: verifiedName?.name,
        description: profile.description,
        about: profile.description,
        address: profile.address,
        email: profile.email,
        websites,
        website: [...websites],
        vertical: category?.name,
        profilehandle,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error fetching business profile', (error as Error)?.toString());
    }
  }

  /** Full profile compatibility for both peer lookups and the current account. */
  public async fetchProfile(instanceName: string, number?: string) {
    const jid = number ? this.normalizeAccountJid(number) : this.resolveSelfJid();

    try {
      if (number) {
        const info = (await this.whatsappNumber({ numbers: [jid] }))?.[0];
        if (!info?.exists) throw new BadRequestException(info ?? { jid, exists: false, number });

        const picture = await this.profilePicture(info.jid);
        const status = await this.getStatus(info.jid);
        const business = await this.fetchBusinessProfile(info.jid);

        return {
          wuid: info.jid || jid,
          name: info.name,
          numberExists: info.exists,
          picture: picture?.profilePictureUrl,
          status: status?.status,
          isBusiness: business.isBusiness,
          email: business?.email,
          description: business?.description,
          website: business?.website?.[0],
        };
      }

      const business = await this.fetchBusinessProfile(jid);
      return {
        wuid: jid,
        name: await this.getProfileName(),
        numberExists: true,
        picture: this.profilePictureUrl ?? (await this.profilePicture(jid))?.profilePictureUrl,
        status: this.connectionStatus?.state,
        isBusiness: business.isBusiness,
        email: business?.email,
        description: business?.description,
        website: business?.website?.[0],
        instanceName,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      return { wuid: jid, name: null, picture: null, status: null, os: null, isBusiness: false };
    }
  }

  /** Return the legacy Connect|API privacy payload using Zapo's typed snapshot. */
  public async fetchPrivacySettings() {
    try {
      const privacy = await this.connectedClient().privacy.getPrivacySettings();
      return {
        readreceipts: privacy.readReceipts,
        profile: privacy.profilePicture,
        status: privacy.about,
        online: privacy.online,
        last: privacy.lastSeen,
        groupadd: privacy.groupAdd,
      };
    } catch (error) {
      throw new InternalServerErrorException('Error fetching privacy settings', (error as Error)?.toString());
    }
  }

  /**
   * Preserve the existing Connect|API privacy DTO while routing every category
   * through Zapo's public privacy coordinator.
   */
  public async updatePrivacySettings(settings: PrivacySettingDto) {
    try {
      const privacy = this.connectedClient().privacy;
      await privacy.setPrivacySetting('readReceipts', settings.readreceipts);
      await privacy.setPrivacySetting('profilePicture', settings.profile);
      await privacy.setPrivacySetting('about', settings.status);
      await privacy.setPrivacySetting('online', settings.online);
      await privacy.setPrivacySetting('lastSeen', settings.last);
      await privacy.setPrivacySetting('groupAdd', settings.groupadd);

      return { update: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error updating privacy settings', (error as Error)?.toString());
    }
  }

  /** Update the WhatsApp push/display name without reconnecting the session. */
  public async updateProfileName(name: string) {
    try {
      const normalized = String(name ?? '').trim();
      if (!normalized) throw new BadRequestException('Profile name is required');

      await this.connectedClient().profile.setPushName(normalized);
      return { update: 'success' };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error updating profile name', (error as Error)?.toString());
    }
  }

  /** Update the legacy WhatsApp About/status text. */
  public async updateProfileStatus(status: string) {
    try {
      await this.connectedClient().profile.setStatus(String(status ?? ''));
      return { update: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error updating profile status', (error as Error)?.toString());
    }
  }

  private async resolveProfilePicture(picture: string): Promise<Uint8Array> {
    const value = String(picture ?? '').trim();
    if (!value) throw new BadRequestException('"profilePicture" must be a url or a base64');

    if (isURL(value)) {
      const response = await axios.get(value, {
        responseType: 'arraybuffer',
        timeout: 30_000,
      });
      return new Uint8Array(Buffer.from(response.data));
    }

    if (isBase64(value)) {
      return new Uint8Array(Buffer.from(value, 'base64'));
    }

    throw new BadRequestException('"profilePicture" must be a url or a base64');
  }

  /** Update the current account picture through Zapo's public profile API. */
  public async updateProfilePicture(picture: string) {
    try {
      const bytes = await this.resolveProfilePicture(picture);
      await this.connectedClient().profile.setProfilePicture(bytes);
      return { update: 'success' };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error updating profile picture', (error as Error)?.toString());
    }
  }

  public async removeProfilePicture() {
    try {
      await this.connectedClient().profile.deleteProfilePicture();
      return { update: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error removing profile picture', (error as Error)?.toString());
    }
  }

  /** Block/unblock through Zapo's LID-aware blocklist implementation. */
  public async blockUser(data: BlockUserDto) {
    try {
      const contact = (await this.whatsappNumber({ numbers: [data.number] }))?.[0];
      if (!contact?.exists) {
        throw new BadRequestException('Number is not on WhatsApp');
      }

      const privacy = this.connectedClient().privacy;
      if (data.status === 'block') {
        await privacy.blockUser(contact.jid);
      } else {
        await privacy.unblockUser(contact.jid);
      }

      return { block: 'success' };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error blocking user', (error as Error)?.toString());
    }
  }
}
