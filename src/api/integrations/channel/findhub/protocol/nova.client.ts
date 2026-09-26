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

  public async captureDevicesListRaw(
    catalog: 'spot' | 'android' | 'auto' | 'fastpair' | 'supervised',
  ): Promise<Buffer> {
    const deviceType = {
      spot: DeviceType.SPOT,
      android: DeviceType.ANDROID,
      auto: DeviceType.AUTO,
      fastpair: DeviceType.FASTPAIR,
      supervised: DeviceType.SUPERVISED_ANDROID,
    }[catalog];
    return await this.request(NOVA_SCOPES.listDevices, encodeDeviceListRequest(undefined, deviceType));
  }

  public async listDevices() {
    const catalogs = ['spot', 'android', 'auto', 'fastpair', 'supervised'] as const;
    const results = await Promise.all(
      catalogs.map(async (catalog) => {
        try {
          return {
            catalog,
            devices: decodeDevicesList(await this.captureDevicesListRaw(catalog)),
            error: undefined,
          };
        } catch (error) {
          return { catalog, devices: [], error };
        }
      }),
    );

    const available = results.filter((result) => result.devices.length);
    if (!available.length) {
      const failure = results.find((result) => result.error !== undefined)?.error;
      if (failure instanceof Error) throw failure;
      throw new Error(
        failure === undefined
          ? 'Google Find Hub did not return any readable device catalogue'
          : String(failure),
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
    const devices = new Map(
      ordered.flatMap((result) => result.devices).map((device) => [device.googleDeviceId, device]),
    );
    return [...devices.values()];
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
