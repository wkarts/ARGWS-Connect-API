import { createHash } from 'crypto';

import { FindHubPosition } from '../findhub.types';

export interface FindHubTrackingSettings {
  intervalSeconds: number;
  timeoutMs: number;
  staleAfterSeconds: number;
  historyEnabled: boolean;
  retentionDays: number;
  reconciliationEnabled: boolean;
  reconciliationOnBoot: boolean;
  reconciliationPeriodicEnabled: boolean;
  reconciliationPeriodSeconds: number;
  reconciliationMinGapSeconds: number;
  reconciliationAttempts: number;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error('Parâmetro de rastreamento fora dos limites.');
  return number;
}
/** Node timer range; 1 ms is accepted but is not a promised upstream response time. */
export function locationTimeoutMs(value?: unknown): number {
  return integer(value, Number(process.env.FINDHUB_LOCATION_TIMEOUT_MS || 30000), 1, 2147483647);
}
export function trackingMinimum(): number {
  // Compatibility field: the installation recommendation is no longer a mandatory floor.
  return 0;
}
export function trackingSettings(value: any = {}): FindHubTrackingSettings {
  const minimum = trackingMinimum();
  if (value.historyEnabled !== undefined && typeof value.historyEnabled !== 'boolean')
    throw new Error('Histórico deve ser booleano.');
  if (value.reconciliationEnabled !== undefined && typeof value.reconciliationEnabled !== 'boolean')
    throw new Error('Reconciliação deve ser booleana.');
  if (value.reconciliationOnBoot !== undefined && typeof value.reconciliationOnBoot !== 'boolean')
    throw new Error('Reconciliação no boot deve ser booleana.');
  if (value.reconciliationPeriodicEnabled !== undefined && typeof value.reconciliationPeriodicEnabled !== 'boolean')
    throw new Error('Reconciliação periódica deve ser booleana.');
  return {
    intervalSeconds: integer(
      value.intervalSeconds,
      Math.max(minimum, Number(process.env.FINDHUB_DEFAULT_TRACKING_INTERVAL_SECONDS || 60)),
      minimum,
      86400,
    ),
    timeoutMs: locationTimeoutMs(value.timeoutMs),
    staleAfterSeconds: integer(value.staleAfterSeconds, 300, 30, 604800),
    historyEnabled:
      value.historyEnabled ?? String(process.env.FINDHUB_STORE_POSITION_HISTORY ?? 'true').toLowerCase() === 'true',
    retentionDays: integer(value.retentionDays, Number(process.env.FINDHUB_HISTORY_RETENTION_DAYS || 30), 0, 36500),
    reconciliationEnabled:
      value.reconciliationEnabled ??
      String(process.env.FINDHUB_RECONCILIATION_ENABLED ?? 'true').toLowerCase() === 'true',
    reconciliationOnBoot:
      value.reconciliationOnBoot ??
      String(process.env.FINDHUB_RECONCILIATION_ON_BOOT ?? 'true').toLowerCase() === 'true',
    reconciliationPeriodicEnabled:
      value.reconciliationPeriodicEnabled ??
      String(process.env.FINDHUB_RECONCILIATION_PERIODIC_ENABLED ?? 'false').toLowerCase() === 'true',
    reconciliationPeriodSeconds: integer(
      value.reconciliationPeriodSeconds,
      Number(process.env.FINDHUB_RECONCILIATION_PERIOD_SECONDS || 3600),
      60,
      2592000,
    ),
    reconciliationMinGapSeconds: integer(
      value.reconciliationMinGapSeconds,
      Number(process.env.FINDHUB_RECONCILIATION_MIN_GAP_SECONDS || 300),
      30,
      2592000,
    ),
    reconciliationAttempts: integer(
      value.reconciliationAttempts,
      Number(process.env.FINDHUB_RECONCILIATION_ATTEMPTS || 3),
      1,
      10,
    ),
  };
}
/** Delay after a completed request. Zero is continuous serialized tracking, not parallel requests. */
export function trackingDelayMs(intervalSeconds: number, failures = 0): number {
  const interval = integer(intervalSeconds, 60, 0, 86400) * 1000;
  return failures > 0 ? Math.min(86400000, Math.max(1000, interval) * 2 ** Math.min(failures, 4)) : interval;
}
export function positionFingerprint(position: FindHubPosition): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        position.timestamp,
        position.latitude,
        position.longitude,
        position.altitude ?? null,
        position.accuracy ?? null,
        position.source,
        position.semanticLocation ?? null,
        position.ownReport ?? null,
      ]),
    )
    .digest('hex');
}

export function isNewPositionObservation(position: FindHubPosition, previous?: FindHubPosition | null): boolean {
  if (!previous) return true;
  const currentTime = Date.parse(position.timestamp);
  const previousTime = Date.parse(previous.timestamp);
  if (currentTime !== previousTime) return currentTime > previousTime;
  // Source/ownReport describe the transport/report kind and can change while referring
  // to the same physical observation. Equal timestamps count as a new observation only
  // when material location content changes (for example a more precise fix).
  return (
    JSON.stringify([
      position.latitude,
      position.longitude,
      position.altitude ?? null,
      position.accuracy ?? null,
      position.semanticLocation ?? null,
    ]) !==
    JSON.stringify([
      previous.latitude,
      previous.longitude,
      previous.altitude ?? null,
      previous.accuracy ?? null,
      previous.semanticLocation ?? null,
    ])
  );
}

export function comparePositionPreference(left: FindHubPosition, right: FindHubPosition): number {
  const byTime = Date.parse(right.timestamp) - Date.parse(left.timestamp);
  if (byTime) return byTime;
  const leftAccuracy = Number.isFinite(left.accuracy) ? Number(left.accuracy) : Number.POSITIVE_INFINITY;
  const rightAccuracy = Number.isFinite(right.accuracy) ? Number(right.accuracy) : Number.POSITIVE_INFINITY;
  if (leftAccuracy !== rightAccuracy) return leftAccuracy - rightAccuracy;
  return Number(Boolean(right.ownReport)) - Number(Boolean(left.ownReport));
}
export function validPosition(position: FindHubPosition, now = Date.now()): boolean {
  return (
    (position.accuracy == null ||
      (Number.isFinite(position.accuracy) && position.accuracy >= 0 && position.accuracy <= 40075017)) &&
    (position.altitude == null || (Number.isFinite(position.altitude) && Math.abs(position.altitude) <= 100000)) &&
    Number.isFinite(position.latitude) &&
    position.latitude >= -90 &&
    position.latitude <= 90 &&
    Number.isFinite(position.longitude) &&
    position.longitude >= -180 &&
    position.longitude <= 180 &&
    Number.isFinite(Date.parse(position.timestamp)) &&
    Date.parse(position.timestamp) > 0 &&
    Date.parse(position.timestamp) <= now + 300000
  );
}
export function locationAvailability(
  position: FindHubPosition | null | undefined,
  staleAfterSeconds: number,
  providerStatus?: string | null,
  now = Date.now(),
) {
  if (providerStatus === 'offline') return 'offline';
  if (!position || !validPosition(position, now)) return 'no_location';
  if (now - Date.parse(position.timestamp) > staleAfterSeconds * 1000) return 'stale';
  return providerStatus === 'online' ? 'online' : 'recent';
}
