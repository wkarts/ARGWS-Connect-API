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
 * The parity layer already understands `delivered`; translate only this
 * provider-native alias and never synthesize delivery from a read receipt.
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
    if (
      providerReason === 'NETWORK_ERROR' ||
      providerReason === 'MEDIA_ERROR' ||
      providerReason === 'SIGNALING_ERROR'
    ) {
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

export const normalizeZapoCallSnapshot = (call: any, action: unknown = 'state'): any => {
  return normalizeZapoCallWebhook({ action, call }).call;
};
