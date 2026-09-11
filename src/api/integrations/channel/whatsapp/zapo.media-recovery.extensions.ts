import { getBase64FromMediaMessageDto } from '@api/dto/chat.dto';
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

  public async getBase64FromMediaMessage(data: getBase64FromMediaMessageDto, getBuffer = false) {
    const input = data?.message as any;
    const messageId = String(input?.key?.id ?? '').trim();
    let recovered = input;

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
      if (stored?.message && typeof stored.message === 'object') {
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
