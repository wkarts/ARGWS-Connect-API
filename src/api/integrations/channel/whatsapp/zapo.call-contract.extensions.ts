import { Events } from '@api/types/wa.types';

import {
  normalizeZapoCallSnapshot,
  normalizeZapoCallWebhook,
  normalizeZapoReceiptStatusForParity,
} from './zapo.call-contract.helpers';
import { ZapoParityStartupService } from './zapo.parity.extensions';

/**
 * Compatibility contract sitting above the Zapo parity layer.
 *
 * - fixes the provider-native delivery receipt alias before parity consumes it;
 * - adds a provider-independent call lifecycle status without removing or
 *   renaming the existing Zapo fields/action payload.
 */
export class ZapoCallContractStartupService extends ZapoParityStartupService {
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
}
