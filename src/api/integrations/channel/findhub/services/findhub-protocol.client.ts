import { GooglePlayAuthClient } from '../auth/google-play-auth.client';
import { decryptOwnerKey } from '../crypto/findhub-crypto';
import { FindHubDevice, FindHubPosition, FindHubStoredCredentials } from '../findhub.types';
import { FindHubNovaClient } from '../protocol/nova.client';
import { FindHubSpotClient } from '../protocol/spot.client';

export class FindHubProtocolClient {
  private readonly auth = new GooglePlayAuthClient();
  private readonly nova: FindHubNovaClient;
  private readonly spot: FindHubSpotClient;
  private ownerKey?: Buffer;

  constructor(
    private credentials: FindHubStoredCredentials,
    private readonly sharedKey: Buffer,
    private readonly persistCredentials: (credentials: FindHubStoredCredentials) => Promise<void>,
  ) {
    this.nova = new FindHubNovaClient(this.auth, credentials.aas);
    this.spot = new FindHubSpotClient(this.auth, credentials.aas);
  }

  public async connect(): Promise<void> {
    await this.ensureOwnerKey();
  }

  public async close(): Promise<void> {}

  public async listDevices(): Promise<Array<Omit<FindHubDevice, 'id'>>> {
    return await this.nova.listDevices();
  }

  public async locate(_device: FindHubDevice): Promise<FindHubPosition[]> {
    throw new Error(
      'Live Find Hub location requires the Google push transport. ' +
      'The native channel core is connected, but this transport is not enabled in this build.',
    );
  }

  private async ensureOwnerKey(): Promise<Buffer> {
    if (this.ownerKey) return this.ownerKey;

    if (this.credentials.ownerKey) {
      this.ownerKey = Buffer.from(this.credentials.ownerKey, 'base64');
      return this.ownerKey;
    }

    const envelope = await this.spot.ownerKeyEnvelope();
    this.ownerKey = decryptOwnerKey(this.sharedKey, envelope.encryptedOwnerKey);
    this.credentials = { ...this.credentials, ownerKey: this.ownerKey.toString('base64') };
    await this.persistCredentials(this.credentials);
    return this.ownerKey;
  }
}
