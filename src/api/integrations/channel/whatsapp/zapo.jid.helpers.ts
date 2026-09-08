import {
  isBroadcastJid,
  isGroupJid,
  isLidJid,
  isStatusBroadcastJid,
  isUserJid,
  normalizeRecipientJid,
  splitJid,
  toUserJid,
} from '@innovatorssoft/zapo-js';

/**
 * ZAPO-native JID helpers used only by the ZAPO provider adapter.
 *
 * Keep PN and LID semantics from zapo-js itself. In particular, a LID is an
 * opaque privacy identifier and MUST NOT be interpreted as a phone number.
 * LID -> PN is accepted only when WhatsApp/ZAPO supplied an explicit mapping.
 */
export function zapoNormalizeJid(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('WhatsApp number or JID is required');

  const jid = raw.includes('@') ? raw : normalizeRecipientJid(raw);
  return toUserJid(jid, { canonicalizeSignalServer: true });
}

export function zapoTryNormalizeJid(value: unknown): string | null {
  try {
    return zapoNormalizeJid(value);
  } catch {
    return null;
  }
}

export function zapoPhoneJid(value: unknown): string | null {
  const jid = zapoTryNormalizeJid(value);
  return jid && isUserJid(jid) ? jid : null;
}

export function zapoLidJid(value: unknown): string | null {
  const jid = zapoTryNormalizeJid(value);
  return jid && isLidJid(jid) ? jid : null;
}

export function zapoJidUser(value: unknown): string | null {
  const jid = zapoTryNormalizeJid(value);
  if (!jid) return null;
  try {
    return splitJid(jid).user;
  } catch {
    return null;
  }
}

export function zapoIsUserJid(value: unknown): boolean {
  const jid = zapoTryNormalizeJid(value);
  return Boolean(jid && isUserJid(jid));
}

export function zapoIsLidJid(value: unknown): boolean {
  const jid = zapoTryNormalizeJid(value);
  return Boolean(jid && isLidJid(jid));
}

export function zapoIsGroupJid(value: unknown): boolean {
  const jid = zapoTryNormalizeJid(value);
  return Boolean(jid && isGroupJid(jid));
}

export function zapoIsBroadcastJid(value: unknown): boolean {
  const jid = zapoTryNormalizeJid(value);
  return Boolean(jid && (isBroadcastJid(jid) || isStatusBroadcastJid(jid)));
}

export function zapoIsOwnAccountJid(value: unknown, meJid?: string | null, meLid?: string | null): boolean {
  const jid = zapoTryNormalizeJid(value);
  if (!jid) return false;

  const normalizedMeJid = zapoTryNormalizeJid(meJid);
  const normalizedMeLid = zapoTryNormalizeJid(meLid);
  return jid === normalizedMeJid || jid === normalizedMeLid;
}
