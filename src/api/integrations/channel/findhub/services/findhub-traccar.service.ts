import { FindHubDevice, FindHubPosition, FindHubTraccarConfig } from '../findhub.types';
import { traccarDestination } from './traccar-client';

export class FindHubTraccarService {
  public async send(config: FindHubTraccarConfig, device: FindHubDevice, position: FindHubPosition): Promise<void> {
    if (!config.enabled || !config.url) return;
    const internal =
      process.env.TRACCAR_ENABLED === 'true' &&
      process.env.TRACCAR_MODE === 'internal' &&
      new URL(config.url).origin === new URL(process.env.TRACCAR_INTERNAL_RECEIVER_URL || 'http://traccar:5055').origin;
    traccarDestination(config.url, internal, true);
    const body = new URLSearchParams({
      id: config.deviceId || device.googleDeviceId,
      lat: String(position.latitude),
      lon: String(position.longitude),
      timestamp: String(Date.parse(position.timestamp) / 1000),
    });
    if (position.accuracy !== undefined) body.set('accuracy', String(position.accuracy));
    if (position.altitude !== undefined) body.set('altitude', String(position.altitude));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.FINDHUB_TRACCAR_TIMEOUT_MS || 10000));
    try {
      const response = await fetch(config.url, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Traccar rejected Find Hub position (${response.status})`);
    } finally {
      clearTimeout(timer);
    }
  }
}
