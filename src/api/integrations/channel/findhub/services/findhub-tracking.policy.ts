import { createHash } from 'crypto';

import { FindHubPosition } from '../findhub.types';

export interface FindHubTrackingSettings {
  intervalSeconds: number;
  timeoutMs: number;
  staleAfterSeconds: number;
  historyEnabled: boolean;
  retentionDays: number;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error('Parâmetro de rastreamento fora dos limites.');
  return number;
}
export function trackingMinimum(): number {
  // Compatibility field: the installation recommendation is no longer a mandatory floor.
  return 0;
}
export function trackingSettings(value: any = {}): FindHubTrackingSettings {
  const minimum = trackingMinimum();
  if (value.historyEnabled !== undefined && typeof value.historyEnabled !== 'boolean')
    throw new Error('Histórico deve ser booleano.');
  return {
    intervalSeconds: integer(
      value.intervalSeconds,
      Math.max(minimum, Number(process.env.FINDHUB_DEFAULT_TRACKING_INTERVAL_SECONDS || 60)),
      minimum,
      86400,
    ),
    timeoutMs: integer(value.timeoutMs, Number(process.env.FINDHUB_LOCATION_TIMEOUT_MS || 30000), 5000, 120000),
    staleAfterSeconds: integer(value.staleAfterSeconds, 300, 30, 604800),
    historyEnabled:
      value.historyEnabled ?? String(process.env.FINDHUB_STORE_POSITION_HISTORY ?? 'true').toLowerCase() === 'true',
    retentionDays: integer(value.retentionDays, Number(process.env.FINDHUB_HISTORY_RETENTION_DAYS || 30), 0, 36500),
  };
}
/** Delay after a completed request. Zero is continuous serialized tracking, not parallel requests. */
export function trackingDelayMs(intervalSeconds: number, failures = 0): number {
  const interval = integer(intervalSeconds, 60, 0, 86400) * 1000;
  return failures > 0 ? Math.min(86400000, Math.max(1000, interval) * 2 ** Math.min(failures, 4)) : interval;
}
export function positionFingerprint(position: FindHubPosition): string {
  return createHash('sha256')
    .update(JSON.stringify([position.timestamp, position.latitude, position.longitude, position.source]))
    .digest('hex');
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
