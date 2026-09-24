import { randomUUID } from 'crypto';

import { GooglePlayAuthClient } from '../auth/google-play-auth.client';
import { decryptIdentityKey, decryptLocationReport, decryptOwnerKey } from '../crypto/findhub-crypto';
import { FindHubDevice, FindHubPosition, FindHubStoredCredentials } from '../findhub.types';
import { FindHubFcmClient } from '../protocol/fcm.client';
import {
  decodeDeviceMetadata,
  decodeDeviceRegistration,
  decodeDeviceUpdate,
  decodeLocationReports,
} from '../protocol/findhub-proto';
import { FindHubNovaClient } from '../protocol/nova.client';
import { FindHubSpotClient } from '../protocol/spot.client';
import { locationTimeoutMs, positionFingerprint, validPosition } from './findhub-tracking.policy';

type PendingLocation = {
  device: FindHubDevice;
  afterTimestamp: number;
  reports: Map<string, FindHubPosition>;
  submitted: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  retain: boolean;
};

type RecentLocation = { device: FindHubDevice; expiresAt: number; seen: Set<string> };
const OBSERVATION_TTL_MS = 120_000;
const MAX_RECENT_REQUESTS = 256;

export class FindHubProtocolClient {
  private readonly auth = new GooglePlayAuthClient();
  private readonly nova: FindHubNovaClient;
  private readonly spot: FindHubSpotClient;
  private readonly fcm: FindHubFcmClient;
  private readonly pending = new Map<string, PendingLocation>();
  private readonly recent = new Map<string, RecentLocation>();
  private closing = false;
  private ownerKey?: Buffer;

  constructor(
    private credentials: FindHubStoredCredentials,
    private readonly sharedKey: Buffer,
    private readonly clientUuid: string,
    private readonly persistCredentials: (credentials: FindHubStoredCredentials) => Promise<void>,
    private readonly onObservation?: (device: FindHubDevice, positions: FindHubPosition[]) => Promise<void>,
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
    this.closing = false;
    await this.ensureOwnerKey();
    await this.fcm.start();
  }

  public async close(): Promise<void> {
    this.closing = true;
    this.recent.clear();
    await this.fcm.stop();

    for (const pending of this.pending.values()) pending.reject(new Error('Find Hub connection closed'));
    this.pending.clear();
  }

  public async listDevices(): Promise<Array<Omit<FindHubDevice, 'id'>>> {
    return await this.nova.listDevices();
  }

  public async locate(device: FindHubDevice, timeoutMs?: number): Promise<FindHubPosition[]> {
    if (!this.ready) throw new Error('Google Find Hub push connection is not authenticated');
    if (this.pending.size >= 128) throw new Error('Too many pending Find Hub location requests');
    this.pruneRecent();
    const requestUuid = randomUUID();
    const timeout = locationTimeoutMs(timeoutMs);
    const controller = new AbortController();
    const afterTimestamp = Date.parse(device.latestPosition?.timestamp || '') || 0;

    // One absolute deadline covers both command submission and the correlated push response.
    // A cached report may arrive before a new fix. Do not consume the request on that first report.
    return new Promise<FindHubPosition[]>((resolve, reject) => {
      const finish = (error?: Error) => {
        const pending = this.pending.get(requestUuid);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(requestUuid);
        // Ending an HTTP wait must not discard a correlated push which Google delivers later.
        // Keep only bounded, recently requested contexts, never accept unsolicited device IDs.
        if (
          !this.closing &&
          this.onObservation &&
          pending.retain &&
          (!error || /location request timed out/i.test(error.message))
        ) {
          this.pruneRecent();
          if (this.recent.size >= MAX_RECENT_REQUESTS) this.recent.delete(this.recent.keys().next().value!);
          this.recent.set(requestUuid, {
            device: pending.device,
            expiresAt: Date.now() + OBSERVATION_TTL_MS,
            seen: new Set(pending.reports.keys()),
          });
        }
        controller.abort();
        if (error) reject(error);
        else resolve([...pending.reports.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)));
      };
      const timer = setTimeout(() => {
        const pending = this.pending.get(requestUuid);
        // Only return reports actually received for THIS request, never a database/cache substitute.
        if (pending?.submitted && pending.reports.size) finish();
        else finish(new Error('Google Find Hub location request timed out'));
      }, timeout);
      timer.unref?.();
      const pending: PendingLocation = {
        device,
        afterTimestamp,
        reports: new Map(),
        submitted: false,
        retain: true,
        resolve: () => finish(),
        reject: (error) => finish(error),
        timer,
      };
      this.pending.set(requestUuid, pending);
      void this.nova
        .locate(
          {
            googleDeviceId: device.googleDeviceId,
            fcmRegistrationId: this.fcm.registrationToken,
            requestUuid,
            clientUuid: this.clientUuid,
          },
          controller.signal,
        )
        .then(() => {
          if (this.pending.get(requestUuid) !== pending) return;
          pending.submitted = true;
          if ([...pending.reports.values()].some((p) => Date.parse(p.timestamp) > afterTimestamp)) pending.resolve();
        })
        .catch((error) => finish(error instanceof Error ? error : new Error(String(error))));
    });
  }

  private decodePositions(device: FindHubDevice, metadata: Buffer): FindHubPosition[] {
    const identifiers = decodeDeviceMetadata(metadata).map((value) => value.googleDeviceId);
    if (identifiers.length && !identifiers.includes(device.googleDeviceId)) return [];
    const registration = decodeDeviceRegistration(metadata);
    // connect() loads this key before starting the authenticated push receiver.
    const ownerKey = this.ownerKey || (this.credentials.ownerKey && Buffer.from(this.credentials.ownerKey, 'base64'));
    if (!ownerKey) return [];
    const identityKey = decryptIdentityKey(ownerKey, registration.encryptedIdentityKey);
    const positions: FindHubPosition[] = [];
    for (const report of decodeLocationReports(metadata)) {
      if (!report.encryptedLocation.length) continue;
      try {
        const location = decryptLocationReport(identityKey, report);
        if (!location) continue;
        const position: FindHubPosition = {
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
        if (validPosition(position)) positions.push(position);
      } catch {
        // An unusable individual report must not discard other reports or consume the waiter.
      }
    }
    return positions;
  }

  private handlePushPayload(payload: Buffer): void {
    try {
      const update = decodeDeviceUpdate(payload);
      if (!update.requestUuid || !update.deviceMetadata) return;
      const pending = this.pending.get(update.requestUuid);
      if (!pending) {
        this.pruneRecent();
        const recent = this.recent.get(update.requestUuid);
        if (!recent || !this.onObservation || this.closing) return;
        const positions = this.decodePositions(recent.device, update.deviceMetadata).filter((position) => {
          const fingerprint = positionFingerprint(position);
          if (recent.seen.has(fingerprint)) return false;
          recent.seen.add(fingerprint);
          if (recent.seen.size > 128) recent.seen.delete(recent.seen.values().next().value!);
          return true;
        });
        if (positions.length) void this.onObservation(recent.device, positions).catch(() => undefined);
        return;
      }
      for (const position of this.decodePositions(pending.device, update.deviceMetadata)) {
        pending.reports.set(positionFingerprint(position), position);
      }
      // Bound per-request memory while retaining the newest reports.
      if (pending.reports.size > 128) {
        pending.reports = new Map(
          [...pending.reports.entries()]
            .sort((a, b) => Date.parse(b[1].timestamp) - Date.parse(a[1].timestamp))
            .slice(0, 128),
        );
      }
      if (
        pending.submitted &&
        [...pending.reports.values()].some((position) => Date.parse(position.timestamp) > pending.afterTimestamp)
      )
        pending.resolve();
    } catch {
      // Ignore malformed/unrelated pushes. They cannot mark a request successful.
    }
  }

  public stopObserving(deviceId: string): void {
    for (const [id, context] of this.recent) if (context.device.id === deviceId) this.recent.delete(id);
    for (const pending of this.pending.values()) if (pending.device.id === deviceId) pending.retain = false;
  }

  private pruneRecent(): void {
    for (const [id, context] of this.recent) if (context.expiresAt <= Date.now()) this.recent.delete(id);
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
