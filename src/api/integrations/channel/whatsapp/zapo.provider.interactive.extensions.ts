import {
  Button,
  SendButtonsDto,
  SendListDto,
  SendStatusDto,
  TypeButton,
} from '@api/dto/sendMessage.dto';
import { BadRequestException, InternalServerErrorException } from '@exceptions';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { createJid } from '@utils/createJid';
import axios from 'axios';
import { isBase64, isURL } from 'class-validator';
import { randomUUID } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import mimeTypes from 'mime-types';
import { PassThrough } from 'stream';

import { ZapoGroupStartupService } from './zapo.provider.group.extensions';

type ResolvedBinaryMedia = {
  buffer: Buffer;
  mimetype: string;
};

/**
 * Interactive/status compatibility facade. Zapo accepts raw Proto.IMessage
 * objects on its public message surface, so legacy Connect|API list/buttons
 * can be preserved without reaching into Zapo protocol internals.
 */
export class ZapoInteractiveStartupService extends ZapoGroupStartupService {
  private readonly buttonTypeMap = new Map<TypeButton, string>([
    ['reply', 'quick_reply'],
    ['copy', 'cta_copy'],
    ['url', 'cta_url'],
    ['call', 'cta_call'],
    ['pix', 'payment_info'],
  ]);

  private readonly pixKeyTypeMap = new Map<string, string>([
    ['phone', 'PHONE'],
    ['email', 'EMAIL'],
    ['cpf', 'CPF'],
    ['cnpj', 'CNPJ'],
    ['random', 'EVP'],
  ]);

  private interactiveClient(): any {
    if (!this.client || this.connectionStatus?.state !== 'open') {
      throw new BadRequestException('WhatsApp instance is not connected');
    }
    return this.client;
  }

  private normalizeRecipient(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw) throw new BadRequestException('WhatsApp number or JID is required');

    const jid = createJid(raw);
    const localPart = jid.split('@')[0];
    if (!jid.includes('@') || !localPart) throw new BadRequestException('Invalid WhatsApp number or JID');
    return jid;
  }

  private async resolveUserRecipient(value: string): Promise<string> {
    const jid = this.normalizeRecipient(value);
    if (jid.endsWith('@g.us')) return jid;

    const resolved = (await this.whatsappNumber({ numbers: [value] }))?.[0];
    if (!resolved?.exists) throw new BadRequestException('Number is not on WhatsApp');
    return resolved.jid;
  }

  private async applyInteractiveDelay(delay?: number): Promise<void> {
    const milliseconds = Number(delay ?? 0);
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private buttonParams(button: Button): string {
    switch (button.type) {
      case 'call':
        return JSON.stringify({ display_text: button.displayText, phone_number: button.phoneNumber });
      case 'reply':
        return JSON.stringify({ display_text: button.displayText, id: button.id });
      case 'copy':
        return JSON.stringify({ display_text: button.displayText, copy_code: button.copyCode });
      case 'url':
        return JSON.stringify({ display_text: button.displayText, url: button.url, merchant_url: button.url });
      case 'pix':
        return JSON.stringify({
          currency: button.currency,
          total_amount: { value: 0, offset: 100 },
          reference_id: randomUUID(),
          type: 'physical-goods',
          order: {
            status: 'pending',
            payment_settings: [
              {
                type: 'pix_static_code',
                pix_static_code: {
                  merchant_name: button.name,
                  key: button.key,
                  key_type: this.pixKeyTypeMap.get(String(button.keyType ?? '')),
                },
              },
            ],
            share_payment_status: false,
          },
        });
      default:
        throw new BadRequestException(`Unsupported button type: ${String(button.type)}`);
    }
  }

  private async resolveBinaryMedia(input: unknown, file?: any, fallbackMimetype = 'application/octet-stream') {
    if (file?.buffer) {
      return {
        buffer: Buffer.from(file.buffer),
        mimetype: String(file.mimetype ?? fallbackMimetype),
      } satisfies ResolvedBinaryMedia;
    }

    const value = String(input ?? '').trim();
    if (!value) throw new BadRequestException('Media content is required');

    if (isURL(value)) {
      const response = await axios.get(value, {
        responseType: 'arraybuffer',
        timeout: 30_000,
      });
      const contentType = String(response.headers?.['content-type'] ?? '').split(';')[0].trim();
      return {
        buffer: Buffer.from(response.data),
        mimetype: contentType || String(mimeTypes.lookup(value) || fallbackMimetype),
      } satisfies ResolvedBinaryMedia;
    }

    const normalizedBase64 = value.includes('base64,') ? value.slice(value.indexOf('base64,') + 7) : value;
    if (isBase64(normalizedBase64)) {
      return {
        buffer: Buffer.from(normalizedBase64, 'base64'),
        mimetype: fallbackMimetype,
      } satisfies ResolvedBinaryMedia;
    }

    throw new BadRequestException('Media content must be a url, base64, or uploaded file');
  }

  private async convertAudioToOggOpus(input: Buffer): Promise<Buffer> {
    ffmpeg.setFfmpegPath(ffmpegPath.path);

    return new Promise<Buffer>((resolve, reject) => {
      const inputStream = new PassThrough();
      const outputStream = new PassThrough();
      const chunks: Buffer[] = [];

      outputStream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      outputStream.on('error', reject);

      ffmpeg(inputStream)
        .noVideo()
        .audioCodec('libopus')
        .audioFrequency(48_000)
        .format('ogg')
        .on('error', reject)
        .on('end', () => resolve(Buffer.concat(chunks)))
        .pipe(outputStream, { end: true });

      inputStream.end(input);
    });
  }

  private parseArgb(color: string): number {
    const normalized = String(color ?? '')
      .trim()
      .replace(/^#/, '');
    if (!/^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(normalized)) {
      throw new BadRequestException('Background color must be #RRGGBB or #AARRGGBB');
    }

    const argb = normalized.length === 6 ? `FF${normalized}` : normalized;
    const unsigned = Number.parseInt(argb, 16) >>> 0;
    return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
  }

  private async resolveStatusRecipients(data: SendStatusDto): Promise<{
    recipients: string[];
    statusSetting: 'contacts' | 'allowlist';
  }> {
    if (data.allContacts) {
      const contacts = await this.prismaRepository.contact.findMany({
        where: { instanceId: this.instanceId },
      });
      const recipients = [
        ...new Set(
          contacts
            .filter((contact) => Boolean(contact.pushName))
            .map((contact) => contact.remoteJid)
            .filter(
              (jid) =>
                typeof jid === 'string' &&
                (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) &&
                jid.split('@')[0].length > 0,
            ),
        ),
      ];
      if (recipients.length === 0) throw new BadRequestException('Contacts not found');
      return { recipients, statusSetting: 'contacts' };
    }

    if (!data.statusJidList?.length) throw new BadRequestException('StatusJidList is required');
    const resolved = await this.whatsappNumber({ numbers: data.statusJidList });
    const recipients = [...new Set(resolved.filter((entry) => entry?.exists === true).map((entry) => entry.jid))];
    if (recipients.length === 0) throw new BadRequestException('No valid status recipients found');
    return { recipients, statusSetting: 'allowlist' };
  }

  public async buttonMessage(data: SendButtonsDto) {
    try {
      if (!Array.isArray(data?.buttons) || data.buttons.length === 0) {
        throw new BadRequestException('At least one button is required');
      }

      const jid = await this.resolveUserRecipient(data.number);
      await this.applyInteractiveDelay(data.delay);
      const buttons = data.buttons.map((button) => ({
        name: this.buttonTypeMap.get(button.type),
        buttonParamsJson: this.buttonParams(button),
      }));

      const message = {
        viewOnceMessage: {
          message: {
            interactiveMessage: {
              header: {
                title: data.title,
                hasMediaAttachment: false,
              },
              body: { text: data.description ?? '' },
              footer: { text: data.footer ?? '' },
              nativeFlowMessage: {
                buttons,
                messageParamsJson: JSON.stringify({ from: 'api', templateId: randomUUID() }),
              },
            },
          },
        },
      };

      const result = await this.interactiveClient().message.send(jid, message);
      return { key: { id: result?.id, remoteJid: jid, fromMe: true } };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error sending buttons message', (error as Error)?.toString());
    }
  }

  public async listMessage(data: SendListDto) {
    try {
      const jid = await this.resolveUserRecipient(data.number);
      await this.applyInteractiveDelay(data.delay);
      const result = await this.interactiveClient().message.send(jid, {
        listMessage: {
          title: data.title,
          description: data.description,
          buttonText: data.buttonText,
          footerText: data.footerText,
          sections: data.sections,
        },
      });

      return { key: { id: result?.id, remoteJid: jid, fromMe: true } };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error sending list message', (error as Error)?.toString());
    }
  }

  public async statusMessage(data: SendStatusDto, file?: any) {
    try {
      const type = String(data?.type ?? '').toLowerCase();
      if (!type) throw new BadRequestException('Type is required');
      if (!data?.content && !file?.buffer) throw new BadRequestException('Content is required');

      const { recipients, statusSetting } = await this.resolveStatusRecipients(data);
      let content: any;

      if (type === 'text') {
        if (!data.backgroundColor) throw new BadRequestException('Background color is required');
        if (!data.font) throw new BadRequestException('Font is required');
        content = {
          extendedTextMessage: {
            text: data.content,
            backgroundArgb: this.parseArgb(data.backgroundColor),
            font: data.font,
          },
        };
      } else if (type === 'image') {
        const media = await this.resolveBinaryMedia(data.content, file, 'image/jpeg');
        content = {
          type: 'image',
          media: media.buffer,
          mimetype: media.mimetype,
          ...(data.caption ? { caption: data.caption } : {}),
        };
      } else if (type === 'video') {
        const media = await this.resolveBinaryMedia(data.content, file, 'video/mp4');
        content = {
          type: 'video',
          media: media.buffer,
          mimetype: media.mimetype,
          ...(data.caption ? { caption: data.caption } : {}),
        };
      } else if (type === 'audio') {
        const media = await this.resolveBinaryMedia(data.content, file, 'audio/mpeg');
        const opus = await this.convertAudioToOggOpus(media.buffer);
        content = {
          type: 'audio',
          media: opus,
          mimetype: 'audio/ogg; codecs=opus',
          ptt: true,
        };
      } else {
        throw new BadRequestException(`Unsupported status type: ${type}`);
      }

      const result = await this.interactiveClient().status.send({
        content,
        recipients,
        statusSetting,
      });

      return {
        key: { id: result?.id, remoteJid: 'status@broadcast', fromMe: true },
        statusJidList: recipients,
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error sending status message', (error as Error)?.toString());
    }
  }
}
