const MEDIA_BINARY_FIELDS = new Map<string, number>([
  ['mediaKey', 32],
  ['fileSha256', 32],
  ['fileEncSha256', 32],
]);

const MEDIA_MESSAGE_KEYS = new Set([
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
  'ptvMessage',
]);

/**
 * ZAPO protobuf messages carry mediaKey/file hashes as Uint8Array values.
 * Connect|API serializes inbound events before persisting/emitting webhooks,
 * which intentionally turns every Uint8Array into base64 JSON. Before the
 * ZAPO downloader sees a persisted/webhook copy we must restore only the
 * binary fields that belong to the encrypted media descriptor.
 *
 * Do not broaden this conversion to arbitrary strings: captions, ids and
 * other user data can also look like base64.
 */
export function restoreZapoMediaPayload<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return value;

  if (Array.isArray(value)) {
    return value.map((entry) => restoreZapoMediaPayload(entry)) as unknown as T;
  }

  if (typeof value !== 'object') return value;

  const restored: Record<string, unknown> = {};
  for (const [key, current] of Object.entries(value as Record<string, unknown>)) {
    const expectedLength = MEDIA_BINARY_FIELDS.get(key);
    if (expectedLength && typeof current === 'string') {
      restored[key] = restoreBase64Binary(current, expectedLength);
      continue;
    }

    if (key === 'fileLength' && typeof current === 'string' && /^\d+$/.test(current)) {
      const parsed = Number(current);
      restored[key] = Number.isSafeInteger(parsed) ? parsed : current;
      continue;
    }

    restored[key] = restoreZapoMediaPayload(current);
  }

  return restored as unknown as T;
}

export function containsZapoDownloadableMedia(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;

  if (Array.isArray(value)) {
    return value.some((entry) => containsZapoDownloadableMedia(entry));
  }

  const record = value as Record<string, unknown>;
  for (const mediaKey of MEDIA_MESSAGE_KEYS) {
    if (record[mediaKey] && typeof record[mediaKey] === 'object') return true;
  }

  const wrapperKeys = [
    'ephemeralMessage',
    'viewOnceMessage',
    'viewOnceMessageV2',
    'viewOnceMessageV2Extension',
    'documentWithCaptionMessage',
    'editedMessage',
  ];

  return wrapperKeys.some((wrapper) => {
    const nested = record[wrapper];
    if (!nested || typeof nested !== 'object') return false;
    return containsZapoDownloadableMedia((nested as Record<string, unknown>).message);
  });
}

function restoreBase64Binary(value: string, expectedLength: number): Uint8Array | string {
  const normalized = value.trim();
  if (!normalized) return value;

  // Connect|API emits standard RFC 4648 base64. Verify round-trip so malformed
  // or coincidentally base64-looking application strings are never converted.
  try {
    const decoded = Buffer.from(normalized, 'base64');
    const canonicalInput = normalized.replace(/=+$/u, '');
    const canonicalDecoded = decoded.toString('base64').replace(/=+$/u, '');

    if (decoded.length !== expectedLength || canonicalInput !== canonicalDecoded) {
      return value;
    }

    return new Uint8Array(decoded);
  } catch {
    return value;
  }
}
