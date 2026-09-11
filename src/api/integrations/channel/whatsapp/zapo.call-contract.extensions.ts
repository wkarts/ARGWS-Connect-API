import { Events } from '@api/types/wa.types';

import { ZapoParityStartupService } from './zapo.parity.extensions';

export type CanonicalCallStatus =
  | 'ringing'
  | 'answered'
  | 'rejected'
  | 'missed'
  | 'unanswered'
  | 'ended'
  | 'failed'
  | 'answered_elsewhere'
  | 'unknown';

const TERMINAL_CALL_STATUSES = new Set<CanonicalCallStatus>([
  'rejected',
  'missed',
  'unanswered',
  'ended',
  'failed',
  'answered_elsewhere',
]);

const ANSWERED_ELSEWHERE_REASONS = new Set([
  'ANSWERED_ELSEWHERE',
  'ANSWERED_ON_OTHER_DEVICE',
  'ACCEPTED_ON_OTHER_DEVICE',
  'ACCEPTED_BY_OTHER_DEVICE',
]);

const normalizeToken = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();

/**
 * Zapo emits the delivery acknowledgement as `status: "receipt"`.
 * The existing parity layer consumes `delivered`, so translate only this
 * provider-native alias. No delivery event is synthesized when Zapo sends
 * only a read acknowledgement.
 */
export const normalizeZapoReceiptStatusForParity = (status: unknown): unknown => {
  return normalizeToken(status) === 'RECEIPT' ? 'delivered' : status;
};

const getProviderState = (call: any): string => normalizeToken(call?.stateData?.state ?? call?.state);

const getProviderReason = (call: any): string =>
  normalizeToken(call?.stateData?.reason ?? call?.stateData?.endReason ?? call?.endReason ?? call?.reason);

export const canonicalizeZapoCallStatus = (action: unknown, call: any): CanonicalCallStatus => {
  const providerState = getProviderState(call);
  const providerReason = getProviderReason(call);
  const direction = normalizeToken(call?.direction);
  const normalizedAction = normalizeToken(action);

  if (ANSWERED_ELSEWHERE_REASONS.has(providerState) || ANSWERED_ELSEWHERE_REASONS.has(providerReason)) {
    return 'answered_elsewhere';
  }

  if (normalizedAction === 'ERROR' || providerState === 'FAILED') return 'failed';
  if (providerState === 'REJECTED') return 'rejected';

  if (providerState === 'ENDED' || normalizedAction === 'ENDED') {
    if (providerReason === 'TIMEOUT') {
      return direction === 'INCOMING' ? 'missed' : 'unanswered';
    }

    if (providerReason === 'REJECTED' || providerReason === 'USER_BUSY') return 'rejected';
    if (providerReason === 'NETWORK_ERROR' || providerReason === 'MEDIA_ERROR' || providerReason === 'SIGNALING_ERROR') {
      return 'failed';
    }

    return 'ended';
  }

  if (providerState === 'ACCEPT_RECEIVED' || providerState === 'CONNECTED') return 'answered';

  if (
    providerState === 'CALLING' ||
    providerState === 'OFFER_RECEIVED' ||
    providerState === 'PRE_ACCEPT_RECEIVED' ||
    normalizedAction === 'INCOMING'
  ) {
    return 'ringing';
  }

  return 'unknown';
};

export const normalizeZapoCallWebhook = <T extends object = any>(data: T): T => {
  if (!data || typeof data !== 'object') return data;

  const payload = data as any;
  const call = payload.call;
  if (!call || typeof call !== 'object') return data;

  const status = canonicalizeZapoCallStatus(payload.action, call);
  const providerState = String(call?.stateData?.state ?? call?.state ?? '').trim() || undefined;
  const providerReason =
    String(call?.stateData?.reason ?? call?.stateData?.endReason ?? call?.endReason ?? call?.reason ?? '').trim() ||
    undefined;

  return {
    ...payload,
    call: {
      ...call,
      status,
      providerState,
      providerReason,
      terminal: TERMINAL_CALL_STATUSES.has(status),
    },
  } as T;
};

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
