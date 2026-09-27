import { GooglePlayAuthClient } from '../auth/google-play-auth.client';
import { GOOGLE_ADM_CONFIG, GOOGLE_ENDPOINTS, NOVA_SCOPES } from '../findhub.constants';
import { FindHubAasCredentials } from '../findhub.types';
import {
  decodeDevicesList,
  DeviceType,
  encodeDeviceListRequest,
  encodeExecuteLocateRequest,
  encodeExecuteSoundRequest,
} from './findhub-proto';

export class FindHubNovaClient {
  constructor(
    private readonly auth: GooglePlayAuthClient,
    private readonly credentials: FindHubAasCredentials,
  ) {}

  private async request(scope: string, payload: Buffer, signal?: AbortSignal): Promise<Buffer> {
    signal?.throwIfAborted();
    const token = await this.auth.serviceToken(this.credentials, 'adm');
    signal?.throwIfAborted();
    const response = await fetch(`${GOOGLE_ENDPOINTS.novaBase}/${scope}`, {
      method: 'POST',
      signal: signal ?? AbortSignal.timeout(30_000),
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
    return Buffer.from(await response.arrayBuffer());
  }

  public buildDevicesListRequest(
    catalog: 'spot' | 'android' | 'auto' | 'fastpair' | 'supervised',
  ): Buffer {
    const deviceType = {
      spot: DeviceType.SPOT,
      android: DeviceType.ANDROID,
      auto: DeviceType.AUTO,
      fastpair: DeviceType.FASTPAIR,
      supervised: DeviceType.SUPERVISED_ANDROID,
    }[catalog];
    return encodeDeviceListRequest(undefined, deviceType);
  }

  public async captureDevicesListRaw(
    catalog: 'spot' | 'android' | 'auto' | 'fastpair' | 'supervised',
  ): Promise<Buffer> {
    return await this.request(NOVA_SCOPES.listDevices, this.buildDevicesListRequest(catalog));
  }

  public async listDevices() {
    const capture = async (catalog: 'spot' | 'android' | 'auto' | 'fastpair' | 'supervised') => {
      try {
        return {
          catalog,
          devices: decodeDevicesList(await this.captureDevicesListRaw(catalog)),
          error: undefined,
        };
      } catch (error) {
        return { catalog, devices: [], error };
      }
    };

    // Preserve the previous request profile: SPOT first, then complementary selectors in parallel.
    // Unlike the legacy behavior, a SPOT failure no longer aborts discovery.
    const primary = await capture('spot');
    const complementary = await Promise.all(
      (['android', 'auto', 'fastpair', 'supervised'] as const).map((catalog) => capture(catalog)),
    );
    const results = [primary, ...complementary];
    const available = results.filter((result) => result.error === undefined);
    if (!available.length) {
      const failure = results.find((result) => result.error !== undefined)?.error;
      if (failure instanceof Error) throw failure;
      throw new Error(
        failure === undefined ? 'Google Find Hub did not return any readable device catalogue' : String(failure),
      );
    }

    // Live 2026 captures from the same account returned byte-identical DeviceMetadata
    // (apart from providerResponseAt) for every selector above. Treat the selector as a
    // discovery path, not as the semantic type of the returned device. Keep SPOT as the
    // final tie-breaker for backward compatibility, but never make it a hard dependency.
    const ordered = [
      ...available.filter((result) => result.catalog !== 'spot'),
      ...available.filter((result) => result.catalog === 'spot'),
    ];
    const newestResponseAt = new Map<string, string>();
    for (const result of available) {
      for (const device of result.devices) {
        if (!device.providerResponseAt) continue;
        const current = newestResponseAt.get(device.googleDeviceId);
        if (!current || Date.parse(device.providerResponseAt) > Date.parse(current)) {
          newestResponseAt.set(device.googleDeviceId, device.providerResponseAt);
        }
      }
    }

    const devices = new Map(
      ordered.flatMap((result) => result.devices).map((device) => [device.googleDeviceId, device]),
    );
    return [...devices.values()].map((device) => ({
      ...device,
      providerResponseAt: newestResponseAt.get(device.googleDeviceId) || device.providerResponseAt,
    }));
  }

  public async locate(
    args: {
      googleDeviceId: string;
      fcmRegistrationId: string;
      requestUuid: string;
      clientUuid: string;
    },
    signal?: AbortSignal,
  ) {
    await this.request(NOVA_SCOPES.executeAction, encodeExecuteLocateRequest(args), signal);
  }

  public async sound(
    args: {
      googleDeviceId: string;
      fcmRegistrationId: string;
      requestUuid: string;
      clientUuid: string;
    },
    operation: 'start' | 'stop',
    component: 'UNSPECIFIED' | 'RIGHT' | 'LEFT' | 'CASE' = 'UNSPECIFIED',
    signal?: AbortSignal,
  ) {
    await this.request(NOVA_SCOPES.executeAction, encodeExecuteSoundRequest(args, operation, component), signal);
  }
}
