import { createHash } from 'crypto';

import { FindHubPosition } from '../findhub.types';

export interface FindHubMonitoringSettings {
  historyEnabled: boolean;
  historyRetentionDays: number;
  defaultIntervalSeconds: number;
  locationTimeoutMs: number;
  uiRefreshSeconds: number;
}

export function boundedInteger(value: unknown, minimum: number, maximum: number, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`${field}: informe um inteiro entre ${minimum} e ${maximum}.`);
  return value;
}

export function minimumTrackingInterval(): number {
  const value = Number(process.env.FINDHUB_MIN_TRACKING_INTERVAL_SECONDS || 30);
  return Number.isSafeInteger(value) && value >= 15 && value <= 86400 ? value : 30;
}

export function monitoringSettings(value: any = {}): FindHubMonitoringSettings {
  const integer = (input: unknown, fallback: number, min: number, max: number) =>
    typeof input === 'number' && Number.isSafeInteger(input) && input >= min && input <= max ? input : fallback;
  const min = minimumTrackingInterval();
  return {
    historyEnabled:
      typeof value?.historyEnabled === 'boolean'
        ? value.historyEnabled
        : String(process.env.FINDHUB_STORE_POSITION_HISTORY || 'false').toLowerCase() === 'true',
    historyRetentionDays: integer(value?.historyRetentionDays, 0, 0, 3650),
    defaultIntervalSeconds: integer(
      value?.defaultIntervalSeconds,
      integer(Number(process.env.FINDHUB_DEFAULT_TRACKING_INTERVAL_SECONDS || 60), Math.max(60, min), min, 86400),
      min,
      86400,
    ),
    locationTimeoutMs: integer(
      value?.locationTimeoutMs,
      integer(Number(process.env.FINDHUB_LOCATION_TIMEOUT_MS || 30000), 30000, 5000, 180000),
      5000,
      180000,
    ),
    uiRefreshSeconds: integer(value?.uiRefreshSeconds, 5, 1, 60),
  };
}

export function validateMonitoringSettings(value: FindHubMonitoringSettings): FindHubMonitoringSettings {
  if (!value || typeof value.historyEnabled !== 'boolean') throw new Error('Informe a política de histórico.');
  return {
    historyEnabled: value.historyEnabled,
    historyRetentionDays: boundedInteger(value.historyRetentionDays, 0, 3650, 'Retenção em dias'),
    defaultIntervalSeconds: boundedInteger(value.defaultIntervalSeconds, minimumTrackingInterval(), 86400, 'Intervalo'),
    locationTimeoutMs: boundedInteger(value.locationTimeoutMs, 5000, 180000, 'Timeout de localização'),
    uiRefreshSeconds: boundedInteger(value.uiRefreshSeconds, 1, 60, 'Atualização visual'),
  };
}

export function positionKey(deviceId: string, position: FindHubPosition): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        deviceId,
        new Date(position.timestamp).toISOString(),
        position.latitude,
        position.longitude,
        position.source,
      ]),
    )
    .digest('hex');
}

export function validPosition(position: FindHubPosition): boolean {
  return (
    Number.isFinite(position.latitude) &&
    position.latitude >= -90 &&
    position.latitude <= 90 &&
    Number.isFinite(position.longitude) &&
    position.longitude >= -180 &&
    position.longitude <= 180 &&
    Number.isFinite(Date.parse(position.timestamp)) &&
    Date.parse(position.timestamp) > 0 &&
    Date.parse(position.timestamp) <= Date.now() + 300000
  );
}
