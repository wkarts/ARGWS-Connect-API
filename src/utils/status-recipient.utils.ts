export type StatusRecipientLookup = {
  queriedJid?: string;
  phoneJid?: string;
  lidJid?: string | null;
  exists?: boolean;
};

const PHONE_JID_SUFFIX = '@s.whatsapp.net';
const LID_JID_SUFFIX = '@lid';

function numericJid(value: string, suffix: string): string | null {
  if (!value.endsWith(suffix)) return null;
  const localPart = value.slice(0, -suffix.length);
  return /^\d+$/.test(localPart) ? value : null;
}

/**
 * Normalizes a Status recipient without applying the legacy Brazilian-number
 * shortening used by the generic `createJid` helper. Status/LID lookup needs
 * the complete E.164 number so WhatsApp can return the canonical phone JID.
 */
export function normalizeStatusRecipient(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'status@broadcast') return null;

  const explicitLid = numericJid(raw, LID_JID_SUFFIX);
  if (explicitLid) return explicitLid;

  const explicitPhone = numericJid(raw, PHONE_JID_SUFFIX);
  if (explicitPhone) return explicitPhone;

  const digits = raw.replace(/\D/g, '');
  return digits ? `${digits}${PHONE_JID_SUFFIX}` : null;
}

function phoneKey(value: string): string | null {
  const normalized = normalizeStatusRecipient(value);
  return normalized?.endsWith(PHONE_JID_SUFFIX) ? normalized : null;
}

function validRecipient(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  return numericJid(raw, PHONE_JID_SUFFIX) || numericJid(raw, LID_JID_SUFFIX);
}

/**
 * Chooses LID recipients when the native Zapo lookup returns them and falls
 * back to the server-canonical phone JID when it does not. A lookup that
 * explicitly reports `exists: false` is never sent to WhatsApp.
 */
export function selectStatusRecipientJids(
  values: readonly unknown[],
  lookups: readonly StatusRecipientLookup[] = [],
): string[] {
  const byPhone = new Map<string, StatusRecipientLookup>();
  for (const lookup of lookups) {
    const keys = [lookup.queriedJid, lookup.phoneJid]
      .map((value) => phoneKey(String(value ?? '')))
      .filter((value): value is string => Boolean(value));
    for (const key of keys) byPhone.set(key, lookup);
  }

  const recipients: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeStatusRecipient(value);
    if (!normalized) continue;

    const lookup = normalized.endsWith(PHONE_JID_SUFFIX) ? byPhone.get(normalized) : undefined;
    if (lookup?.exists === false) continue;

    const candidate = lookup?.lidJid || lookup?.phoneJid || normalized;
    const recipient = validRecipient(candidate);
    if (!recipient || seen.has(recipient)) continue;
    seen.add(recipient);
    recipients.push(recipient);
  }

  return recipients;
}
