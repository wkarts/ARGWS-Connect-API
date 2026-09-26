import { GooglePlayAuthClient } from '../auth/google-play-auth.client';
import { GOOGLE_ADM_CONFIG, GOOGLE_ENDPOINTS, NOVA_SCOPES } from '../findhub.constants';
import { FindHubAasCredentials } from '../findhub.types';
import {
  decodeDevicesList,
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

  public async listDevices() {
    const primary = decodeDevicesList(await this.request(NOVA_SCOPES.listDevices, encodeDeviceListRequest()));
    // The SPOT catalogue remains authoritative. An unsupported complementary catalogue must not erase it.
    let android: typeof primary = [];
    try {
      android = decodeDevicesList(await this.request(NOVA_SCOPES.listDevices, encodeDeviceListRequest(undefined, 1)));
    } catch {
      /* Not all Google accounts expose the complementary Android catalogue. */
    }
    const devices = new Map([...android, ...primary].map((device) => [device.googleDeviceId, device]));
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
