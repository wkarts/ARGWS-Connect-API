import { describe, expect, it } from 'vitest';

import {
  canonicalizeZapoCallStatus,
  normalizeZapoCallWebhook,
  normalizeZapoReceiptStatusForParity,
} from './zapo.call-contract.helpers';

describe('Zapo call contract', () => {
  describe('receipt normalization', () => {
    it('maps the native receipt status to delivery acknowledgement', () => {
      expect(normalizeZapoReceiptStatusForParity('receipt')).toBe('delivered');
      expect(normalizeZapoReceiptStatusForParity('RECEIPT')).toBe('delivered');
    });

    it('does not fabricate delivery from read acknowledgements', () => {
      expect(normalizeZapoReceiptStatusForParity('read')).toBe('read');
      expect(normalizeZapoReceiptStatusForParity('played')).toBe('played');
      expect(normalizeZapoReceiptStatusForParity('unknown')).toBe('unknown');
    });
  });

  describe('call lifecycle normalization', () => {
    it.each(['CALLING', 'OFFER_RECEIVED', 'PRE_ACCEPT_RECEIVED'])('maps %s to ringing', (state) => {
      expect(canonicalizeZapoCallStatus('state', { state, direction: 'incoming' })).toBe('ringing');
    });

    it.each(['ACCEPT_RECEIVED', 'CONNECTED'])('maps %s to answered', (state) => {
      expect(canonicalizeZapoCallStatus('state', { state })).toBe('answered');
    });

    it('distinguishes incoming missed calls from outgoing unanswered calls', () => {
      expect(
        canonicalizeZapoCallStatus('ended', {
          state: 'ENDED',
          direction: 'incoming',
          stateData: { state: 'ENDED', reason: 'TIMEOUT' },
        }),
      ).toBe('missed');

      expect(
        canonicalizeZapoCallStatus('ended', {
          state: 'ENDED',
          direction: 'outgoing',
          stateData: { state: 'ENDED', reason: 'TIMEOUT' },
        }),
      ).toBe('unanswered');
    });

    it('maps explicit rejection and transport failures without provider branching', () => {
      expect(canonicalizeZapoCallStatus('state', { state: 'REJECTED' })).toBe('rejected');
      expect(canonicalizeZapoCallStatus('state', { state: 'FAILED' })).toBe('failed');
      expect(
        canonicalizeZapoCallStatus('ended', {
          stateData: { state: 'ENDED', reason: 'NETWORK_ERROR' },
        }),
      ).toBe('failed');
    });

    it('reports answered elsewhere only when the provider explicitly says so', () => {
      expect(
        canonicalizeZapoCallStatus('ended', {
          stateData: { state: 'ENDED', reason: 'ANSWERED_ON_OTHER_DEVICE' },
        }),
      ).toBe('answered_elsewhere');
      expect(canonicalizeZapoCallStatus('ended', { state: 'ENDED' })).toBe('ended');
    });

    it('keeps the existing payload and adds the canonical call contract', () => {
      const payload = normalizeZapoCallWebhook({
        action: 'state',
        provider: 'WHATSAPP-ZAPO',
        call: {
          callId: 'call-1',
          direction: 'incoming',
          state: 'CONNECTED',
          stateData: { state: 'CONNECTED' },
        },
      });

      expect(payload.action).toBe('state');
      expect(payload.provider).toBe('WHATSAPP-ZAPO');
      expect(payload.call).toMatchObject({
        callId: 'call-1',
        direction: 'incoming',
        state: 'CONNECTED',
        status: 'answered',
        providerState: 'CONNECTED',
        terminal: false,
      });
    });
  });
});
