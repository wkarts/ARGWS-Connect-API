import { GooglePlayAuthClient } from '../auth/google-play-auth.client';
import { GOOGLE_ADM_CONFIG, GOOGLE_ENDPOINTS, NOVA_SCOPES } from '../findhub.constants';
import { FindHubAasCredentials } from '../findhub.types';
import { decodeDevicesList, encodeDeviceListRequest, encodeExecuteLocateRequest } from './findhub-proto';

export class FindHubNovaClient {
  constructor(private readonly auth: GooglePlayAuthClient, private readonly credentials: FindHubAasCredentials) {}

  private async request(scope: string, payload: Buffer): Promise<Buffer> {
    const token = await this.auth.serviceToken(this.credentials, 'adm');
    const response = await fetch(`${GOOGLE_ENDPOINTS.novaBase}/${scope}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Authorization: `Bearer ${token}`,
        'Accept-Language': 'en-US',
        'User-Agent': GOOGLE_ADM_CONFIG.fmdUserAgent,
      },
      body: payload,
    });
    if (!response.ok) throw new Error(`Google Find Hub Nova request failed (${response.status})`);
    return Buffer.from(await response.arrayBuffer());
  }

  public async listDevices() {
    return decodeDevicesList(await this.request(NOVA_SCOPES.listDevices, encodeDeviceListRequest()));
  }

  public async locate(args: { googleDeviceId: string; fcmRegistrationId: string; requestUuid: string; clientUuid: string }) {
    await this.request(NOVA_SCOPES.executeAction, encodeExecuteLocateRequest(args));
  }
}
