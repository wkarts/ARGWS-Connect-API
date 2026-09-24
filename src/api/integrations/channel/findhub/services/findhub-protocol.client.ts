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
import { comparePositionPreference, isNewPositionObservation, locationTimeoutMs, positionFingerprint, validPosition } from './findhub-tracking.policy';

type PendingLocation = {
  device: FindHubDevice;
  afterTimestamp: number;
  reports: Map<string, FindHubPosition>;
  submitted: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
  retain: boolean;
};

type RecentLocation = { device: FindHubDevice; expiresAt: number; seen: Set<string> };
const OBSERVATION_TTL_MS = 120_000;
const MAX_RECENT_REQUESTS = 256;

function commandTimeoutMs(): number {
  const value = Number(process.env.FINDHUB_COMMAND_TIMEOUT_MS || 30000);
  if (!Number.isInteger(value) || value < 1 || value > 2147483647)
    throw new Error('FINDHUB_COMMAND_TIMEOUT_MS must be an integer between 1 and 2147483647.');
  return value;
}

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

  public async requestLocation(device: FindHubDevice): Promise<string> {
    if (!this.ready) throw new Error('Google Find Hub push connection is not authenticated');
    this.pruneRecent();
    const requestUuid = randomUUID();
    this.rememberRecent(requestUuid, device);
    try {
      await this.nova.locate(
        {
          googleDeviceId: device.googleDeviceId,
          fcmRegistrationId: this.fcm.registrationToken,
          requestUuid,
          clientUuid: this.clientUuid,
        },
        AbortSignal.timeout(commandTimeoutMs()),
      );
      return requestUuid;
    } catch (error) {
      this.recent.delete(requestUuid);
      throw error;
    }
  }

  public async locate(device: FindHubDevice, timeoutMs?: number): Promise<FindHubPosition[]> {
    if (!this.ready) throw new Error('Google Find Hub push connection is not authenticated');
    if (this.pending.size >= 128) throw new Error('Too many pending Find Hub location requests');
    this.pruneRecent();
    const requestUuid = randomUUID();
    const timeout = locationTimeoutMs(timeoutMs);
    const afterPosition = device.latestPosition || null;

    // The operator timeout controls how long the HTTP caller waits for a new observation.
    // It never cancels the command submission itself. Once Google accepts the command,
    // the correlation remains active so a later FCM observation can still update SSE/map/history.
    return new Promise<FindHubPosition[]>((resolve, reject) => {
      const finish = (error?: Error) => {
        const pending = this.pending.get(requestUuid);
        if (!pending) return;
        if (pending.timer) clearTimeout(pending.timer);
        this.pending.delete(requestUuid);
        if (!this.closing && this.onObservation && pending.retain && pending.submitted) {
          this.rememberRecent(requestUuid, pending.device, pending.reports.keys());
        }
        if (error) reject(error);
        else resolve([...pending.reports.values()].sort(comparePositionPreference));
      };
      const pending: PendingLocation = {
        device,
        afterTimestamp: Date.parse(afterPosition?.timestamp || '') || 0,
        reports: new Map(),
        submitted: false,
        retain: true,
        resolve: () => finish(),
        reject: (error) => finish(error),
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
          AbortSignal.timeout(commandTimeoutMs()),
        )
        .then(() => {
          if (this.pending.get(requestUuid) !== pending) return;
          pending.submitted = true;
          if ([...pending.reports.values()].some((position) => isNewPositionObservation(position, afterPosition))) {
            pending.resolve();
            return;
          }
          const timer = setTimeout(() => pending.resolve(), timeout);
          timer.unref?.();
          pending.timer = timer;
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
            .sort((a, b) => comparePositionPreference(a[1], b[1]))
            .slice(0, 128),
        );
      }
      if (
        pending.submitted &&
        [...pending.reports.values()].some((position) =>
          isNewPositionObservation(position, pending.device.latestPosition || null),
        )
      )
        pending.resolve();
    } catch {
      // Ignore malformed/unrelated pushes. They cannot mark a request successful.
    }
  }

  private rememberRecent(requestUuid: string, device: FindHubDevice, seen: Iterable<string> = []): void {
    this.pruneRecent();
    const existing = this.recent.get(requestUuid);
    if (existing) {
      for (const fingerprint of seen) existing.seen.add(fingerprint);
      existing.expiresAt = Date.now() + OBSERVATION_TTL_MS;
      return;
    }
    if (this.recent.size >= MAX_RECENT_REQUESTS) this.recent.delete(this.recent.keys().next().value!);
    this.recent.set(requestUuid, {
      device,
      expiresAt: Date.now() + OBSERVATION_TTL_MS,
      seen: new Set(seen),
    });
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
