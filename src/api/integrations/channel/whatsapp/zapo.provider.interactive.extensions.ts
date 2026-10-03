import { Button, SendButtonsDto, SendListDto, SendStatusDto, TypeButton } from '@api/dto/sendMessage.dto';
import { BadRequestException, InternalServerErrorException } from '@exceptions';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { createJid } from '@utils/createJid';
import { normalizeStatusRecipient, selectStatusRecipientJids } from '@utils/status-recipient.utils';
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

type StatusRecipientLookup = {
  queriedJid?: string;
  phoneJid?: string;
  lidJid?: string | null;
  exists?: boolean;
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
      const contentType = String(response.headers?.['content-type'] ?? '')
        .split(';')[0]
        .trim();
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
              (jid): jid is string =>
                typeof jid === 'string' &&
                (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) &&
                jid.split('@')[0].length > 0,
            ),
        ),
      ];
      if (recipients.length === 0) throw new BadRequestException('Contacts not found');

      const resolved = await this.resolveStatusRecipientLids(recipients);
      return { recipients: resolved.length > 0 ? resolved : recipients, statusSetting: 'contacts' };
    }

    if (!data.statusJidList?.length) throw new BadRequestException('StatusJidList is required');
    const recipients = await this.resolveStatusRecipientLids(data.statusJidList);
    if (recipients.length === 0) throw new BadRequestException('No valid status recipients found');
    return { recipients, statusSetting: 'allowlist' };
  }

  /**
   * Status distribution now expects the native LID form whenever WhatsApp
   * exposes one. The old generic number helper intentionally applies legacy
   * Brazilian-number shortening and only returned a `lid: 'lid'` marker, so
   * passing its phone JID to Zapo made the publish fan-out reach WhatsApp with
   * an incomplete identity and receive a server-side 400 NACK.
   */
  private async resolveStatusRecipientLids(values: readonly unknown[]): Promise<string[]> {
    const normalizedValues = values
      .map((value) => normalizeStatusRecipient(value))
      .filter((value): value is string => Boolean(value));
    if (normalizedValues.length === 0) return [];

    const phoneJids = [
      ...new Set(normalizedValues.filter((value) => value.endsWith('@s.whatsapp.net')).map((value) => value)),
    ];
    const profile = this.interactiveClient().profile;
    const lookup = profile?.getLidsByPhoneNumbers;

    if (phoneJids.length > 0 && typeof lookup === 'function') {
      const lookups: StatusRecipientLookup[] = [];
      try {
        // Keep usync payloads bounded when “all contacts” is used.
        for (let offset = 0; offset < phoneJids.length; offset += 100) {
          const chunk = phoneJids.slice(offset, offset + 100).map((jid) => jid.split('@', 1)[0]);
          const result = await lookup.call(profile, chunk);
          if (Array.isArray(result)) lookups.push(...result);
        }
        return selectStatusRecipientJids(normalizedValues, lookups);
      } catch (error) {
        this.logger.warn(
          `Zapo Status LID lookup failed; using canonical phone JIDs: ${(error as Error)?.message ?? error}`,
        );
      }
    }

    // Compatibility fallback for an older provider client without the native
    // LID lookup. This is intentionally limited to the already-normalized
    // values and never re-enters the legacy Brazil-number formatter.
    return selectStatusRecipientJids(normalizedValues);
  }

  public buttonMessage(): never;
  public buttonMessage(data: SendButtonsDto): Promise<any>;
  public buttonMessage(data?: SendButtonsDto): never | Promise<any> {
    if (!data) throw new BadRequestException('Buttons payload is required');
    return this.sendButtonMessage(data);
  }

  private async sendButtonMessage(data: SendButtonsDto) {
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
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error sending buttons message', (error as Error)?.toString());
    }
  }

  public listMessage(): never;
  public listMessage(data: SendListDto): Promise<any>;
  public listMessage(data?: SendListDto): never | Promise<any> {
    if (!data) throw new BadRequestException('List payload is required');
    return this.sendListMessage(data);
  }

  private async sendListMessage(data: SendListDto) {
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
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error sending list message', (error as Error)?.toString());
    }
  }

  public statusMessage(): never;
  public statusMessage(data: SendStatusDto, file?: any): Promise<any>;
  public statusMessage(data?: SendStatusDto, file?: any): never | Promise<any> {
    if (!data) throw new BadRequestException('Status payload is required');
    return this.sendStatusMessage(data, file);
  }

  private async sendStatusMessage(data: SendStatusDto, file?: any) {
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

      // Zapo does not emit an outgoing status echo when readStatus is off.
      // Keep a JSON-safe history row so the Manager/API can list and revoke
      // the exact status without storing the binary payload in PostgreSQL.
      if (result?.id) {
        const persistedMessage = type === 'text'
          ? content
          : { type, caption: data.caption || null, mimetype: content.mimetype || null };
        await this.prismaRepository.message.create({
          data: {
            key: { id: String(result.id), remoteJid: 'status@broadcast', fromMe: true },
            messageType: `status${type}`,
            message: { status: persistedMessage },
            messageTimestamp: Math.floor(Date.now() / 1000),
            source: 'web',
            instanceId: this.instanceId,
          },
        }).catch((error) => this.logger.warn('Unable to persist outgoing Zapo status: ' + (error?.message || error)));
      }

      return {
        key: { id: result?.id, remoteJid: 'status@broadcast', fromMe: true },
        statusJidList: recipients,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error sending status message', (error as Error)?.toString());
    }
  }
}
