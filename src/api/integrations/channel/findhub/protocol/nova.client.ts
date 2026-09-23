import { GooglePlayAuthClient } from '../auth/google-play-auth.client';
import { GOOGLE_ADM_CONFIG, GOOGLE_ENDPOINTS, NOVA_SCOPES } from '../findhub.constants';
import { FindHubAasCredentials } from '../findhub.types';
import {
  decodeDeviceMetadata,
  decodeDevicesList,
  DeviceType,
  encodeDeviceListRequest,
  encodeExecuteLocateRequest,
} from './findhub-proto';
import { repeatedBytes } from './protobuf';

export class FindHubNovaClient {
  public catalogStatus: {
    updatedAt: string;
    complete: boolean;
    sources: Array<{ type: number; status: string; returned: number; decoded: number }>;
  } | null = null;
  constructor(
    private readonly auth: GooglePlayAuthClient,
    private readonly credentials: FindHubAasCredentials,
  ) {}

  private async request(scope: string, payload: Buffer, timeoutMs = 30000): Promise<Buffer> {
    const controller = new AbortController();
    let abort: () => void;
    const deadline = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error('Google Find Hub request timed out'));
      controller.signal.addEventListener('abort', abort, { once: true });
    });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const request = (async () => {
      const token = await this.auth.serviceToken(this.credentials, 'adm');
      controller.signal.throwIfAborted();
      const response = await fetch(`${GOOGLE_ENDPOINTS.novaBase}/${scope}`, {
        method: 'POST',
        signal: controller.signal,
        redirect: 'error',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Authorization: `Bearer ${token}`,
          'Accept-Language': 'en-US',
          'User-Agent': GOOGLE_ADM_CONFIG.fmdUserAgent,
        },
        body: Uint8Array.from(payload),
      });
      if (!response.ok) throw new Error(`Google Find Hub Nova request failed (${response.status})`);
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 8388608) throw new Error('Google Find Hub response exceeds the permitted size');
      return body;
    })();
    try {
      return await Promise.race([request, deadline]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', abort!);
    }
  }

  public async listDevices() {
    const found: ReturnType<typeof decodeDevicesList> = [];
    const sources: Array<{ type: number; status: string; returned: number; decoded: number }> = [];
    for (const type of [DeviceType.SPOT, DeviceType.ANDROID, DeviceType.SUPERVISED, DeviceType.FASTPAIR]) {
      try {
        const payload = await this.request(NOVA_SCOPES.listDevices, encodeDeviceListRequest(undefined, type));
        const entries = repeatedBytes(payload, 2);
        const devices: ReturnType<typeof decodeDevicesList> = [];
        let decoded = 0;
        for (const entry of entries) {
          try {
            const rows = decodeDeviceMetadata(entry);
            if (rows.length) decoded++;
            devices.push(...rows);
          } catch {
            /* An unknown entry must not discard the rest of this catalog. */
          }
        }
        sources.push({ type, status: 'OK', returned: entries.length, decoded });
        for (const device of devices) {
          const aliases = device.aliases || [device.googleDeviceId];
          const previous = found.find((item) =>
            (item.aliases || [item.googleDeviceId]).some((id) => aliases.includes(id)),
          );
          if (previous) {
            previous.aliases = [...new Set([...(previous.aliases || []), ...aliases])];
            previous.catalogTypes = [...new Set([...(previous.catalogTypes || []), type])];
            if (!previous.encryptedIdentityKey && device.encryptedIdentityKey) {
              previous.encryptedIdentityKey = device.encryptedIdentityKey;
              previous.ownerKeyVersion = device.ownerKeyVersion;
            }
            for (const key of ['manufacturer', 'model', 'imageUrl'] as const) previous[key] ||= device[key];
            if (previous.deviceType === 'UNKNOWN') previous.deviceType = device.deviceType;
          } else found.push({ ...device, aliases, catalogTypes: [type] });
        }
      } catch {
        // Do not leak upstream response bodies or hide a partial discovery as a complete catalog.
        sources.push({ type, status: 'UNAVAILABLE', returned: 0, decoded: 0 });
      }
    }
    this.catalogStatus = {
      updatedAt: new Date().toISOString(),
      complete: sources.every((source) => source.status === 'OK' && source.decoded >= source.returned),
      sources,
    };
    if (sources.every((source) => source.status !== 'OK'))
      throw new Error('Não foi possível consultar o catálogo Google.');
    return found.map((device) => ({ ...device, locationSupported: Boolean(device.encryptedIdentityKey) }));
  }

  public async locate(
    args: {
      googleDeviceId: string;
      fcmRegistrationId: string;
      requestUuid: string;
      clientUuid: string;
    },
    timeoutMs = 30000,
  ) {
    await this.request(NOVA_SCOPES.executeAction, encodeExecuteLocateRequest(args), timeoutMs);
  }
}
