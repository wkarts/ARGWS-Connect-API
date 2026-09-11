const BINARY_MEDIA_FIELDS = new Map<string, number>([
  ['mediaKey', 32],
  ['fileSha256', 32],
  ['fileEncSha256', 32],
]);

const MEDIA_MESSAGE_KEYS = new Set([
  'imageMessage',
  'videoMessage',
  'ptvMessage',
  'audioMessage',
  'documentMessage',
  'stickerMessage',
]);

const MEDIA_WRAPPER_KEYS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
] as const;

type LongCompatible = {
  low: number;
  high: number;
  unsigned: boolean;
  toNumber: () => number;
  toString: () => string;
};

/**
 * ZAPO media descriptors use Uint8Array for encryption/hash material.
 * Connect|API intentionally serializes Uint8Array values to Base64 before
 * persisting/emitting JSON. Rehydrate only the known binary media fields when
 * a persisted/webhook copy is handed back to the native ZAPO downloader.
 *
 * Zapo 1.6.x also expects protobuf int64 values such as fileLength to retain a
 * Long-like toNumber() method. JSON persistence removes that prototype, so the
 * recovery layer restores a minimal Long-compatible value without changing the
 * canonical JSON representation stored by Connect|API.
 */
export function restorePersistedZapoMedia<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return value;

  if (Array.isArray(value)) {
    return value.map((entry) => restorePersistedZapoMedia(entry)) as unknown as T;
  }

  if (typeof value !== 'object') return value;

  const restored: Record<string, unknown> = {};
  for (const [key, current] of Object.entries(value as Record<string, unknown>)) {
    const expectedLength = BINARY_MEDIA_FIELDS.get(key);
    if (expectedLength && typeof current === 'string') {
      restored[key] = restoreBase64Field(current, expectedLength);
      continue;
    }

    if (key === 'fileLength') {
      restored[key] = restoreLongCompatibleField(current);
      continue;
    }

    restored[key] = restorePersistedZapoMedia(current);
  }

  return restored as unknown as T;
}

export function isZapoMediaMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;

  for (const key of MEDIA_MESSAGE_KEYS) {
    if (message[key] && typeof message[key] === 'object') return true;
  }

  for (const wrapper of MEDIA_WRAPPER_KEYS) {
    const wrapped = message[wrapper];
    if (!wrapped || typeof wrapped !== 'object') continue;
    if (isZapoMediaMessage((wrapped as Record<string, unknown>).message)) return true;
  }

  return false;
}

function restoreBase64Field(value: string, expectedLength: number): Uint8Array | string {
  const normalized = value.trim();
  if (!normalized) return value;

  try {
    const decoded = Buffer.from(normalized, 'base64');
    const canonicalInput = normalized.replace(/=+$/u, '');
    const canonicalDecoded = decoded.toString('base64').replace(/=+$/u, '');

    if (decoded.length !== expectedLength || canonicalInput !== canonicalDecoded) return value;
    return new Uint8Array(decoded);
  } catch {
    return value;
  }
}

function restoreLongCompatibleField(value: unknown): unknown {
  if (value && typeof value === 'object' && typeof (value as { toNumber?: unknown }).toNumber === 'function') {
    return value;
  }

  let numeric: number | null = null;

  if (typeof value === 'number') {
    numeric = value;
  } else if (typeof value === 'string' && /^\d+$/u.test(value.trim())) {
    numeric = Number(value);
  } else if (value && typeof value === 'object') {
    const raw = value as { low?: unknown; high?: unknown; unsigned?: unknown };
    if (typeof raw.low === 'number' && typeof raw.high === 'number') {
      const low = raw.low >>> 0;
      const high = raw.high >>> 0;
      numeric = high * 0x100000000 + low;
    }
  }

  if (numeric === null || !Number.isSafeInteger(numeric) || numeric < 0) return value;

  const low = numeric >>> 0;
  const high = Math.floor(numeric / 0x100000000) >>> 0;
  const compatible: LongCompatible = {
    low,
    high,
    unsigned: true,
    toNumber: () => numeric,
    toString: () => String(numeric),
  };
  return compatible;
}
