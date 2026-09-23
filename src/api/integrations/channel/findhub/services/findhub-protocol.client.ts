import { randomUUID } from 'crypto';

import { GooglePlayAuthClient } from '../auth/google-play-auth.client';
import { decryptIdentityKey, decryptLocationReport, decryptOwnerKey } from '../crypto/findhub-crypto';
import { FindHubDevice, FindHubPosition, FindHubStoredCredentials } from '../findhub.types';
import { FindHubFcmClient } from '../protocol/fcm.client';
import { decodeDeviceRegistration, decodeDeviceUpdate, decodeLocationReports } from '../protocol/findhub-proto';
import { FindHubNovaClient } from '../protocol/nova.client';
import { FindHubSpotClient } from '../protocol/spot.client';

type PendingLocation = {
  resolve: (metadata: Buffer) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

export class FindHubProtocolClient {
  private readonly auth = new GooglePlayAuthClient();
  private readonly nova: FindHubNovaClient;
  private readonly spot: FindHubSpotClient;
  private readonly fcm: FindHubFcmClient;
  private readonly pending = new Map<string, PendingLocation>();
  private ownerKey?: Buffer;
  private readonly deviceKeys = new Map<string, { encryptedIdentityKey: Buffer; ownerKeyVersion: number }>();

  public get catalogStatus() {
    return this.nova.catalogStatus;
  }

  constructor(
    private credentials: FindHubStoredCredentials,
    private readonly sharedKey: Buffer,
    private readonly clientUuid: string,
    private readonly persistCredentials: (credentials: FindHubStoredCredentials) => Promise<void>,
  ) {
    this.nova = new FindHubNovaClient(this.auth, credentials.aas);
    this.spot = new FindHubSpotClient(this.auth, credentials.aas);
    this.fcm = new FindHubFcmClient(
      credentials.fcm ?? null,
      async (fcmCredentials) => {
        this.credentials = {
          ...this.credentials,
          fcm: fcmCredentials,
        };
        await this.persistCredentials(this.credentials);
      },
      (payload) => this.handlePushPayload(payload),
    );
  }

  public get ready(): boolean {
    return this.fcm.ready;
  }

  public async connect(): Promise<void> {
    await this.ensureOwnerKey();
    await this.fcm.start();
  }

  public async close(): Promise<void> {
    await this.fcm.stop();

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Find Hub connection closed'));
    }
    this.pending.clear();
  }

  public async listDevices(): Promise<Array<Omit<FindHubDevice, 'id'>>> {
    const devices = await this.nova.listDevices();
    for (const device of devices) {
      if (device.encryptedIdentityKey)
        for (const id of device.aliases || [device.googleDeviceId])
          this.deviceKeys.set(id, {
            encryptedIdentityKey: Buffer.from(device.encryptedIdentityKey, 'base64'),
            ownerKeyVersion: device.ownerKeyVersion || 0,
          });
    }
    return devices;
  }

  public async locate(device: FindHubDevice, timeoutMs?: number): Promise<FindHubPosition[]> {
    if (!this.ready) throw new Error('Google Find Hub push connection is not authenticated');
    if (this.pending.size >= 128) throw new Error('Too many pending Find Hub location requests');
    const requestUuid = randomUUID();
    const metadataPromise = this.waitForLocation(requestUuid, timeoutMs);
    // Attach immediately: a network call can outlive the push deadline.
    void metadataPromise.catch(() => undefined);

    try {
      await this.nova.locate(
        {
          googleDeviceId: device.googleDeviceId,
          fcmRegistrationId: this.fcm.registrationToken,
          requestUuid,
          clientUuid: this.clientUuid,
        },
        timeoutMs,
      );
    } catch (error) {
      this.rejectPending(requestUuid, error instanceof Error ? error : new Error(String(error)));
      throw error;
    }

    const metadata = await metadataPromise;
    let registration: ReturnType<typeof decodeDeviceRegistration>;
    try {
      registration = decodeDeviceRegistration(metadata);
    } catch {
      const cached = this.deviceKeys.get(device.googleDeviceId);
      if (!cached) throw new Error('O Google não forneceu a chave deste dispositivo para esta conta.');
      registration = cached;
    }
    const ownerKey = await this.ensureOwnerKey();
    const identityKey = decryptIdentityKey(ownerKey, registration.encryptedIdentityKey);

    return decodeLocationReports(metadata)
      .filter((report) => report.encryptedLocation.length > 0)
      .map((report): FindHubPosition | null => {
        const location = decryptLocationReport(identityKey, report);
        if (!location) return null;

        return {
          deviceId: device.id,
          googleDeviceId: device.googleDeviceId,
          latitude: location.latitude,
          longitude: location.longitude,
          altitude: location.altitude,
          accuracy: report.accuracy,
          timestamp: new Date(report.timestampSeconds * 1000).toISOString(),
          source: report.ownReport ? 'RECENT' : 'NETWORK',
          semanticLocation: report.semanticLocation,
          ownReport: report.ownReport,
        };
      })
      .filter((position): position is FindHubPosition => position !== null)
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  }

  private waitForLocation(requestUuid: string, requestedTimeout?: number): Promise<Buffer> {
    const timeoutMs = requestedTimeout ?? Math.max(5_000, Number(process.env.FINDHUB_LOCATION_TIMEOUT_MS || 30_000));
    if (!Number.isInteger(timeoutMs) || timeoutMs < 5000 || timeoutMs > 180000)
      throw new Error('Timeout de localização inválido.');

    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestUuid);
        reject(new Error('Google Find Hub location request timed out'));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(requestUuid, {
        resolve,
        reject,
        timer,
      });
    });
  }

  private handlePushPayload(payload: Buffer): void {
    let update: ReturnType<typeof decodeDeviceUpdate>;

    try {
      update = decodeDeviceUpdate(payload);
    } catch {
      return;
    }

    if (!update.requestUuid || !update.deviceMetadata) return;

    const pending = this.pending.get(update.requestUuid);
    if (!pending) return;

    // Google may first acknowledge the action with metadata but no usable position.
    // Keep listening until a location report arrives or the configured deadline expires.
    try {
      if (!decodeLocationReports(update.deviceMetadata).some((report) => report.encryptedLocation.length > 0)) return;
    } catch {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(update.requestUuid);
    pending.resolve(update.deviceMetadata);
  }

  private rejectPending(requestUuid: string, error: Error): void {
    const pending = this.pending.get(requestUuid);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(requestUuid);
    pending.reject(error);
  }

  private async ensureOwnerKey(): Promise<Buffer> {
    if (this.ownerKey) return this.ownerKey;

    if (this.credentials.ownerKey) {
      this.ownerKey = Buffer.from(this.credentials.ownerKey, 'base64');
      return this.ownerKey;
    }

    const envelope = await this.spot.ownerKeyEnvelope();
    this.ownerKey = decryptOwnerKey(this.sharedKey, envelope.encryptedOwnerKey);
    this.credentials = {
      ...this.credentials,
      ownerKey: this.ownerKey.toString('base64'),
    };
    await this.persistCredentials(this.credentials);
    return this.ownerKey;
  }
}
