import { getBase64FromMediaMessageDto } from '@api/dto/chat.dto';
import * as s3Service from '@api/integrations/storage/s3/libs/minio.server';
import { Events } from '@api/types/wa.types';
import { prismaJsonPath } from '@utils/prismaJsonPath';

import {
  normalizeZapoCallSnapshot,
  normalizeZapoCallWebhook,
  normalizeZapoReceiptStatusForParity,
} from './zapo.call-contract.helpers';
import { isZapoMediaMessage, restorePersistedZapoMedia } from './zapo.media-recovery.helpers';
import { ZapoParityStartupService } from './zapo.parity.extensions';

/**
 * Final ZAPO compatibility layer.
 *
 * ZapoParityStartupService continues to own live raw-event media hydration, S3
 * and receipt parity. This class preserves that direct inheritance while adding
 * the provider-independent call contract and the native `receipt` delivery
 * alias required by current Zapo versions. The persisted-media fallback remains
 * unchanged for generic Connect|API consumers (HUB included).
 */
export class ZapoMediaRecoveryStartupService extends ZapoParityStartupService {
  private readonly callContractBoundClients = new WeakSet<object>();

  public async connectToWhatsapp(): Promise<any> {
    const client = await super.connectToWhatsapp();
    this.bindCallContractEvents(client);
    return client;
  }

  public async prepareQrConnection(): Promise<any> {
    const client = await super.prepareQrConnection();
    this.bindCallContractEvents(client);
    return client;
  }

  public async preparePairingConnection(number: string): Promise<any> {
    const client = await super.preparePairingConnection(number);
    this.bindCallContractEvents(client);
    return client;
  }

  public async listCalls() {
    const calls = await super.listCalls();
    return calls.map((call: any) => normalizeZapoCallSnapshot(call));
  }

  public async sendDataWebhook<T extends object = any>(
    event: Events,
    data: T,
    local = true,
    integration?: string[],
    extra?: Record<string, any>,
  ) {
    const payload = event === Events.CALL ? normalizeZapoCallWebhook(data) : data;
    return super.sendDataWebhook(event, payload, local, integration, extra);
  }

  private bindCallContractEvents(client: any): void {
    if (!client || (typeof client !== 'object' && typeof client !== 'function')) return;
    if (this.callContractBoundClients.has(client)) return;
    this.callContractBoundClients.add(client);

    if (typeof client.prependListener !== 'function') {
      this.logger.error('Zapo client does not expose prependListener; delivery receipt compatibility is unavailable');
      return;
    }

    client.prependListener('receipt', (event: any) => {
      if (!event || typeof event !== 'object') return;
      const normalized = normalizeZapoReceiptStatusForParity(event.status);
      if (normalized !== event.status) event.status = normalized;
    });
  }

  private async findPersistedMessage(messageId: string) {
    if (!messageId) return null;

    return this.prismaRepository.message.findFirst({
      where: {
        instanceId: this.instanceId,
        key: { path: prismaJsonPath('id'), equals: messageId } as any,
      },
    });
  }

  private async storedStatusMedia(messageId: string) {
    const stored = await this.findPersistedMessage(messageId);
    if (!stored || (stored.key as any)?.remoteJid !== 'status@broadcast' || (stored.key as any)?.fromMe !== true)
      return null;
    const media = await this.prismaRepository.media.findUnique({ where: { messageId: stored.id } });
    if (!media || media.instanceId !== this.instanceId || !/^(image|video|audio)\/[\w.+-]+$/i.test(media.mimetype))
      return null;
    const stream = await s3Service.getObjectStream(media.fileName);
    if (!stream) return null;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream) {
      size += chunk.length;
      if (size > 50 * 1024 * 1024) {
        stream.destroy();
        return null;
      }
      chunks.push(Buffer.from(chunk));
    }
    return { mimetype: media.mimetype, base64: Buffer.concat(chunks).toString('base64') };
  }

  private async mailboxStatusMessage(messageId: string) {
    const pool = this.storeBackend?.pool;
    if (!pool || !this.instanceId) return null;
    const prefix = process.env.ZAPO_STORE_TABLE_PREFIX || 'zapo_';
    if (!/^[A-Za-z0-9_]*$/.test(prefix)) return null;
    const table = `${prefix}mailbox_messages`;
    const exists = await pool.query('SELECT to_regclass($1) AS table_name', [table]);
    if (!exists.rows?.[0]?.table_name) return null;
    const row = await pool.query(
      `SELECT message_bytes FROM "${table}" WHERE session_id = $1 AND message_id = $2 AND thread_jid = 'status@broadcast' AND from_me = true LIMIT 1`,
      [this.instanceId, messageId],
    );
    if (!row.rows?.[0]?.message_bytes) return null;
    const { proto } = await import('zapo-js');
    return proto.Message.decode(row.rows[0].message_bytes);
  }

  public async getBase64FromMediaMessage(data: getBase64FromMediaMessageDto, getBuffer = false) {
    const input = data?.message as any;
    const messageId = String(input?.key?.id ?? '').trim();
    let recovered = input;

    if (messageId && input?.key?.remoteJid === 'status@broadcast' && input?.key?.fromMe === true) {
      const storedMedia = await this.storedStatusMedia(messageId).catch(() => null);
      if (storedMedia) return storedMedia;
    }

    if (input?.message && typeof input.message === 'object') {
      recovered = {
        ...input,
        message: restorePersistedZapoMedia(input.message),
      };
    } else if (isZapoMediaMessage(input)) {
      // Accept raw Proto.IMessage-shaped requests as well as WebMessageInfo.
      recovered = {
        key: input?.key,
        message: restorePersistedZapoMedia(input),
      };
    } else if (messageId) {
      const stored = await this.findPersistedMessage(messageId);
      const isStatus = input?.key?.remoteJid === 'status@broadcast' && input?.key?.fromMe === true;
      const mailbox = isStatus ? await this.mailboxStatusMessage(messageId) : null;
      if (mailbox) {
        recovered = { ...input, message: mailbox };
      } else if (stored?.message && typeof stored.message === 'object') {
        recovered = {
          ...input,
          key: input?.key ?? stored.key,
          message: restorePersistedZapoMedia(stored.message),
        };
      }
    }

    return super.getBase64FromMediaMessage(
      {
        ...data,
        message: recovered,
      } as getBase64FromMediaMessageDto,
      getBuffer,
    );
  }
}
