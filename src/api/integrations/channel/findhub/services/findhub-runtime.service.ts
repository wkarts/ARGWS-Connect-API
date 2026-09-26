import { PrismaRepository } from '@api/repository/repository.service';
import { eventManager } from '@api/server.module';
import { ConfigService, HttpServer } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import EventEmitter2 from 'eventemitter2';

import { diagnostics } from '../../../../../diagnostics/diagnostics.service';
import { FindHubAuthError } from '../auth/findhub-auth.error';
import { FindHubAuthBrokerService } from '../auth/findhub-auth-broker.service';
import { FindHubCredentialVault } from '../auth/findhub-credential-vault';
import { FINDHUB_EVENTS, FINDHUB_INTEGRATION } from '../findhub.constants';
import {
  FindHubDevice,
  FindHubPosition,
  FindHubRuntimeState,
  FindHubSoundComponent,
  FindHubTraccarConfig,
} from '../findhub.types';
import { normalizeFindHubAvatar } from './findhub-avatar';
import { createFindHubLocateDiagnostics, FindHubProtocolClient } from './findhub-protocol.client';
import { FindHubTraccarService } from './findhub-traccar.service';
import {
  comparePositionPreference,
  FindHubTrackingSettings,
  isNewPositionObservation,
  locationAvailability,
  positionFingerprint,
  trackingDelayMs,
  trackingMinimum,
  trackingSettings,
  validPosition,
} from './findhub-tracking.policy';
import { resolveTraccarConnection, TraccarClient, TraccarConnection, traccarDestination } from './traccar-client';

type FindHubReconciliationTrigger = 'manual' | 'boot' | 'periodic';
type FindHubReconciliationCandidate = { deviceId: string; from: string; to: string };

export class FindHubStartupService {
  public readonly integration = FINDHUB_INTEGRATION;
  public readonly capabilities = Object.freeze({
    auth: true,
    messaging: false,
    contacts: false,
    chats: false,
    groups: false,
    statusRead: false,
    statusPublish: false,
    presence: false,
    chatState: false,
    pnLid: false,
    interactiveMessages: false,
    media: false,
    profile: false,
    privacy: false,
    labels: false,
    receipts: false,
    businessProfile: false,
    businessCatalog: false,
    calls: false,
    voice: false,
    qrCode: false,
    pairingCode: false,
    devices: true,
    location: true,
    tracking: true,
  });

  public stateConnection: { state: FindHubRuntimeState; statusReason?: number } = { state: 'close' };
  private readonly logger = new Logger('FindHubStartupService');
  private readonly authBroker: FindHubAuthBrokerService;
  private readonly traccar = new FindHubTraccarService();
  private protocol?: FindHubProtocolClient;
  private options?: FindHubTrackingSettings;
  private traccarClient?: TraccarClient;
  private traccarState = 'disabled';
  private retentionTimer?: NodeJS.Timeout;
  private reconciliationTimer?: NodeJS.Timeout;
  private reconciliationTickRunning = false;
  private pruning = false;
  private subscribers = 0;
  private readonly locating = new Map<string, Promise<FindHubPosition | null>>();
  private readonly dispatching = new Set<string>();
  private readonly locationQueries = new Map<
    string,
    { status: string; startedAt: string; completedAt: string; timeoutMs: number }
  >();
  private generation = 0;
  private readonly reconciliations = new Map<string, Promise<any>>();
  private readonly reconciliationStatus = new Map<string, any>();
  private readonly observationQueues = new Map<string, Promise<void>>();
  private readonly observationQueueSizes = new Map<string, number>();
  private tracking = new Map<string, NodeJS.Timeout>();
  private instance = { name: '', id: '', token: '', integration: FINDHUB_INTEGRATION };

  constructor(
    private readonly configService: ConfigService,
    private readonly _eventEmitter: EventEmitter2,
    private readonly prisma: PrismaRepository,
  ) {
    this.authBroker = new FindHubAuthBrokerService(prisma);
  }

  public setInstance(instance: any): void {
    this.instance = {
      name: instance.instanceName,
      id: instance.instanceId,
      token: instance.token,
      integration: FINDHUB_INTEGRATION,
    };
    this.logger.setInstance(instance.instanceName);
  }

  public get instanceName() {
    return this.instance.name;
  }
  public get instanceId() {
    return this.instance.id;
  }
  public get token() {
    return this.instance.token;
  }
  public get transportReady(): boolean {
    return this.stateConnection.state === 'open' && this.protocol?.ready === true;
  }

  public get connectionStatus() {
    return this.stateConnection;
  }

  public async connectToWhatsapp(): Promise<any> {
    return await this.connect();
  }

  public async connect(): Promise<any> {
    const loaded = await this.authBroker.load(this.instance.id);
    if (!loaded) {
      await this.setState('connecting');
      return {
        instance: { instanceName: this.instance.name, status: 'connecting' },
        auth: await this.authBroker.status(this.instance.name),
      };
    }

    // A previously validated account stays linked when a restart/reconnect fails.
    // Transport or provider availability must not be confused with credential revocation.
    const previousAuthState = loaded.account.authState;
    let credentialsValidated = previousAuthState === 'READY';

    clearInterval(this.retentionTimer);
    this.retentionTimer = undefined;
    clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = undefined;
    await this.protocol?.close().catch(() => undefined);
    let clientUuid = loaded.account.clientUuid;
    if (!clientUuid) {
      clientUuid = randomUUID();
      await (this.prisma as any).findHubAccount.update({
        where: { id: loaded.account.id },
        data: { clientUuid },
      });
    }

    const observationGeneration = this.generation;
    const protocol = new FindHubProtocolClient(
      loaded.credentials,
      loaded.sharedKey,
      clientUuid,
      (credentials) => this.authBroker.persistCredentials(this.instance.id, credentials),
      async (device, positions) => {
        if (observationGeneration !== this.generation || this.protocol !== protocol) return;
        await this.receiveObservation(device.id, positions, observationGeneration).catch(async () => {
          if (observationGeneration === this.generation && this.protocol === protocol)
            await this.emit(FINDHUB_EVENTS.ERROR, {
              deviceId: device.id,
              operation: 'receive',
              code: 'LOCATION_DELIVERY_FAILED',
            });
        });
      },
    );
    this.protocol = protocol;
    try {
      await this.setState('connecting');
      await this.protocol.connect();
      await this.refreshDevices();
      await this.authBroker.setAuthState(this.instance.id, 'READY');
      credentialsValidated = true;
      await this.setState('open');
      const settings = await this.settings();
      const reconciliationCandidates =
        settings.reconciliationEnabled && settings.reconciliationOnBoot
          ? await this.reconciliationCandidates(
              settings.reconciliationMinGapSeconds,
              settings.reconciliationLookbackHours,
            )
          : [];
      await this.restoreTracking();
      if (reconciliationCandidates.length) {
        void this.reconcileCandidates(reconciliationCandidates, 'boot').catch(async () => {
          await this.emit(FINDHUB_EVENTS.ERROR, {
            operation: 'reconciliation',
            code: 'RECONCILIATION_FAILED',
          });
        });
      }
      this.installReconciliationSchedule(settings);
      this.retentionTimer = setInterval(
        () => {
          void this.pruneHistory().catch(() => undefined);
        },
        60 * 60 * 1000,
      );
      this.retentionTimer.unref?.();
      void this.pruneHistory().catch(() => undefined);
      // Optional infrastructure cannot make a validated Google account fail authentication.
      void this.connectTraccar().catch(() => {
        this.traccarState = 'degraded';
      });
    } catch (error) {
      await this.closeClient().catch(() => undefined);
      const credentialRejected = error instanceof FindHubAuthError && [9102, 9103, 9104, 9105].includes(error.code);
      if (!credentialsValidated || credentialRejected) {
        await this.authBroker.setAuthState(this.instance.id, 'AUTH_REQUIRED');
      }
      diagnostics.record({
        code: 'runtime.error',
        component: error instanceof FindHubAuthError ? 'findhub-auth' : 'findhub',
        instanceId: this.instance.id,
        level: 'warn',
        error,
      });
      throw new Error(
        credentialRejected
          ? 'O Google recusou as credenciais armazenadas. Renove a autenticação desta mesma conta para preservar dispositivos, histórico e configurações.'
          : 'Não foi possível validar a conexão Google Find Hub. As credenciais armazenadas foram preservadas.',
      );
    }
    return { instance: { instanceName: this.instance.name, status: 'open' }, auth: { state: 'READY' } };
  }

  public async restart(): Promise<void> {
    await this.closeClient();
    await this.connect();
  }

  public async closeClient(): Promise<void> {
    this.generation++;
    clearInterval(this.retentionTimer);
    this.retentionTimer = undefined;
    clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = undefined;
    this.reconciliationTickRunning = false;
    this.traccarClient?.close();
    this.traccarClient = undefined;
    for (const timer of this.tracking.values()) clearInterval(timer);
    this.tracking.clear();
    this.locationQueries.clear();
    this.dispatching.clear();
    this.reconciliationStatus.clear();
    await this.protocol?.close().catch(() => undefined);
    this.protocol = undefined;
    await this.setState('close');
  }

  public async logoutInstance(): Promise<void> {
    await this.closeClient();
    await this.authBroker.unlink(this.instance.id);
    this.options = undefined;
  }

  public async purgeProviderState(): Promise<void> {
    await this.closeClient();
    await this.authBroker.clear(this.instance.id);
    this.options = undefined;
    await (this.prisma as any).findHubDevice.deleteMany({ where: { instanceId: this.instance.id } });
  }

  public auth(): FindHubAuthBrokerService {
    return this.authBroker;
  }

  public async refreshDevices(): Promise<FindHubDevice[]> {
    if (!this.protocol) throw new Error('Find Hub account is not connected');

    const discovered = await this.protocol.listDevices();
    const account = await (this.prisma as any).findHubAccount.findUnique({ where: { instanceId: this.instance.id } });
    if (!account) throw new Error('Find Hub account not found');

    const result: FindHubDevice[] = [];
    for (const device of discovered) {
      const stored = await (this.prisma as any).findHubDevice.upsert({
        where: {
          instanceId_googleDeviceId: {
            instanceId: this.instance.id,
            googleDeviceId: device.googleDeviceId,
          },
        },
        update: {
          name: device.name,
          identifierType: device.identifierType,
          deviceType: device.deviceType,
          manufacturer: device.manufacturer,
          model: device.model,
          fastPairModelId: device.fastPairModelId,
          pairedAt: device.pairedAt ? new Date(device.pairedAt) : null,
          canonicalIds: device.canonicalIds || [],
          accessInformation: device.accessInformation || [],
          ownerKeyVersion: device.ownerKeyVersion ?? null,
          identityKeyFingerprint: device.identityKeyFingerprint,
          accountKeyFingerprint: device.accountKeyFingerprint,
          publicAddressFingerprint: device.publicAddressFingerprint,
          secretsCreatedAt: device.secretsCreatedAt ? new Date(device.secretsCreatedAt) : null,
          networkAggregationMinReports: device.networkAggregationMinReports ?? null,
          imageUrl: device.imageUrl,
        },
        create: {
          instanceId: this.instance.id,
          accountId: account.id,
          googleDeviceId: device.googleDeviceId,
          name: device.name,
          identifierType: device.identifierType,
          deviceType: device.deviceType,
          manufacturer: device.manufacturer,
          model: device.model,
          fastPairModelId: device.fastPairModelId,
          pairedAt: device.pairedAt ? new Date(device.pairedAt) : null,
          canonicalIds: device.canonicalIds || [],
          accessInformation: device.accessInformation || [],
          ownerKeyVersion: device.ownerKeyVersion ?? null,
          identityKeyFingerprint: device.identityKeyFingerprint,
          accountKeyFingerprint: device.accountKeyFingerprint,
          publicAddressFingerprint: device.publicAddressFingerprint,
          secretsCreatedAt: device.secretsCreatedAt ? new Date(device.secretsCreatedAt) : null,
          networkAggregationMinReports: device.networkAggregationMinReports ?? null,
          imageUrl: device.imageUrl,
          trackingIntervalSeconds: (await this.settings()).intervalSeconds,
        },
      });
      result.push(this.toDevice(stored));
    }

    await this.emit(FINDHUB_EVENTS.DEVICES_UPDATED, {
      devices: result.map((device) => this.publicDevice(device)),
    });

    return result;
  }

  public async devices(): Promise<FindHubDevice[]> {
    const rows = await (this.prisma as any).findHubDevice.findMany({
      where: { instanceId: this.instance.id },
      orderBy: { name: 'asc' },
    });
    return rows.map((row: any) => this.toDevice(row));
  }

  public async device(deviceId: string): Promise<FindHubDevice> {
    const row = await (this.prisma as any).findHubDevice.findFirst({
      where: { id: deviceId, instanceId: this.instance.id },
    });
    if (!row) throw new Error('Find Hub device not found');
    return this.toDevice(row);
  }

  public async setDeviceAvatar(deviceId: string, avatar: unknown): Promise<FindHubDevice> {
    await this.device(deviceId); // Instance ownership must be checked before decoding or writing.
    const avatarData = normalizeFindHubAvatar(avatar);
    const result = await (this.prisma as any).findHubDevice.updateMany({
      where: { id: deviceId, instanceId: this.instance.id },
      data: { avatarData },
    });
    if (result.count !== 1) throw new Error('Find Hub device not found');
    await this.emit(FINDHUB_EVENTS.DEVICES_UPDATED, {
      devices: (await this.devices()).map((device) => this.publicDevice(device)),
    });
    return this.device(deviceId);
  }

  public async sound(
    deviceId: string,
    operation: 'start' | 'stop',
    component: FindHubSoundComponent = 'UNSPECIFIED',
  ): Promise<any> {
    if (!this.protocol) throw new Error('Find Hub account is not connected');
    const device = await this.device(deviceId);
    return await this.protocol.sound(device, operation, component);
  }

  public async captureProtocolCatalog(
    catalog: 'spot' | 'android' | 'auto' | 'fastpair' | 'supervised',
  ): Promise<Buffer> {
    if (!this.protocol) throw new Error('Find Hub account is not connected');
    return await this.protocol.captureDevicesListRaw(catalog);
  }

  public async captureProtocolDeviceUpdate(
    deviceId: string,
    timeoutMs?: number,
  ): Promise<{ payload: Buffer; deviceMetadata: Buffer }> {
    if (!this.protocol) throw new Error('Find Hub account is not connected');
    const device = await this.device(deviceId);
    return await this.protocol.captureDeviceUpdateRaw(device, timeoutMs);
  }

  public async locate(deviceId: string, timeoutMs?: number): Promise<FindHubPosition | null> {
    const existing = this.locating.get(deviceId);
    if (existing) return await existing;
    const operation = this.locateOnce(deviceId, timeoutMs);
    this.locating.set(deviceId, operation);
    try {
      return await operation;
    } finally {
      if (this.locating.get(deviceId) === operation) this.locating.delete(deviceId);
    }
  }

  private async locateOnce(deviceId: string, timeoutMs?: number): Promise<FindHubPosition | null> {
    if (!this.protocol) throw new Error('Find Hub account is not connected');
    const device = await this.device(deviceId);
    const settings = trackingSettings({
      ...(await this.settings()),
      timeoutMs: timeoutMs ?? device.locationTimeoutMs ?? (await this.settings()).timeoutMs,
    });
    const generation = this.generation;
    const protocol = this.protocol;
    const startedAt = new Date().toISOString();
    const queryResult = (status: string) => {
      const query = { status, startedAt, completedAt: new Date().toISOString(), timeoutMs: settings.timeoutMs };
      this.locationQueries.set(deviceId, query);
      return query;
    };
    try {
      await (this.prisma as any).findHubDevice.update({
        where: { id: deviceId },
        data: {
          lastAttemptAt: new Date(startedAt),
          lastErrorCode: null,
          providerRequestCount: { increment: 1 },
          lastProviderRequestAt: new Date(startedAt),
        },
      });
      const positions = (await protocol.locate(device, settings.timeoutMs))
        .filter((position) => validPosition(position))
        .sort(comparePositionPreference);
      await this.recordProviderReports(device, positions);
      return await this.queueObservation(deviceId, async () => {
        if (generation !== this.generation || protocol !== this.protocol)
          throw new Error('A conexão de localização foi encerrada.');
        const current = await this.device(deviceId);
        if (generation !== this.generation || protocol !== this.protocol)
          throw new Error('A conexão de localização foi encerrada.');
        if (!positions.length) {
          await this.emit(FINDHUB_EVENTS.TRACKING_UPDATE, { deviceId, query: queryResult('awaiting_realtime') });
          return null;
        }
        const position = positions[0];
        const previous = current.latestPosition;
        const newReport = isNewPositionObservation(position, previous);
        for (const report of [...positions].reverse()) await this.persistPosition(current, report);
        await this.emit(FINDHUB_EVENTS.LOCATION_UPDATED, {
          device: this.publicDevice(current),
          location: position,
          query: queryResult(newReport ? 'new_report' : 'known_position'),
        });
        if (newReport)
          await this.forwardTraccar(current, position).catch(async () => {
            await this.emit(FINDHUB_EVENTS.ERROR, { deviceId, operation: 'traccar', code: 'TRACCAR_FORWARD_FAILED' });
          });
        return position;
      });
    } catch (error) {
      if (generation === this.generation) {
        const message = String(error instanceof Error ? error.message : error);
        const commandTimedOut = /timed out|timeout/i.test(message);
        const code = commandTimedOut ? 'LOCATION_COMMAND_TIMEOUT' : 'LOCATION_UNAVAILABLE';
        await (this.prisma as any).findHubDevice.updateMany({
          where: { id: deviceId, instanceId: this.instance.id },
          data: { lastErrorCode: code },
        });
        await this.emit(FINDHUB_EVENTS.ERROR, {
          deviceId,
          operation: 'locate',
          code,
          query: queryResult(commandTimedOut ? 'command_timeout' : 'failed'),
        });
      }
      throw error;
    }
  }

  private queueObservation<T>(deviceId: string, action: () => Promise<T>): Promise<T> {
    const size = this.observationQueueSizes.get(deviceId) || 0;
    if (size >= 32) return Promise.reject(new Error('Fila de posições do dispositivo ocupada.'));
    this.observationQueueSizes.set(deviceId, size + 1);
    const operation = (this.observationQueues.get(deviceId) || Promise.resolve()).then(action);
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    this.observationQueues.set(deviceId, settled);
    void settled.then(() => {
      const remaining = (this.observationQueueSizes.get(deviceId) || 1) - 1;
      if (remaining) this.observationQueueSizes.set(deviceId, remaining);
      else this.observationQueueSizes.delete(deviceId);
      if (this.observationQueues.get(deviceId) === settled) this.observationQueues.delete(deviceId);
    });
    return operation;
  }

  private async receiveObservation(deviceId: string, reports: FindHubPosition[], generation: number): Promise<void> {
    await this.queueObservation(deviceId, async () => {
      if (generation !== this.generation) return;
      const device = await this.device(deviceId); // Never use an unscoped device from a push.
      if (generation !== this.generation) return;
      const previous = device.latestPosition || null;
      const providerReports = reports.filter(
        (position) =>
          validPosition(position) &&
          position.deviceId === device.id &&
          position.googleDeviceId === device.googleDeviceId,
      );
      await this.recordProviderReports(device, providerReports);
      const positions = providerReports
        .filter((position) => isNewPositionObservation(position, previous))
        .sort(comparePositionPreference);
      if (!positions.length) return;
      for (const position of positions) await this.persistPosition(device, position);
      const oldQuery = this.locationQueries.get(deviceId);
      const query = {
        status: 'new_report',
        startedAt: oldQuery?.startedAt || device.lastAttemptAt || new Date().toISOString(),
        completedAt: new Date().toISOString(),
        timeoutMs: oldQuery?.timeoutMs || device.locationTimeoutMs || (await this.settings()).timeoutMs,
      };
      this.locationQueries.set(deviceId, query);
      await this.emit(FINDHUB_EVENTS.LOCATION_UPDATED, {
        device: this.publicDevice(device),
        location: positions[0],
        query,
      });
      await this.forwardTraccar(device, positions[0]).catch(async () => {
        await this.emit(FINDHUB_EVENTS.ERROR, { deviceId, operation: 'traccar', code: 'TRACCAR_FORWARD_FAILED' });
      });
    });
  }

  public async startTracking(deviceId: string, intervalSeconds?: number, timeoutMs?: number): Promise<any> {
    const device = await this.device(deviceId);
    const selected = trackingSettings({
      ...(await this.settings()),
      intervalSeconds: intervalSeconds ?? device.trackingIntervalSeconds ?? (await this.settings()).intervalSeconds,
      timeoutMs: timeoutMs ?? device.locationTimeoutMs ?? (await this.settings()).timeoutMs,
    });
    const interval = selected.intervalSeconds;

    await (this.prisma as any).findHubDevice.update({
      where: { id: device.id },
      data: { trackingEnabled: true, trackingIntervalSeconds: interval, locationTimeoutMs: selected.timeoutMs },
    });

    this.installTracking(device.id, interval);
    await this.emit(FINDHUB_EVENTS.TRACKING_UPDATE, {
      deviceId: device.id,
      enabled: true,
      intervalSeconds: interval,
      timeoutMs: selected.timeoutMs,
    });

    return { deviceId: device.id, enabled: true, intervalSeconds: interval, timeoutMs: selected.timeoutMs };
  }

  public async stopTracking(deviceId: string): Promise<any> {
    const device = await this.device(deviceId);
    const timer = this.tracking.get(device.id);
    if (timer) clearInterval(timer);
    this.tracking.delete(device.id);
    this.protocol?.stopObserving?.(device.id);

    await (this.prisma as any).findHubDevice.update({
      where: { id: device.id },
      data: { trackingEnabled: false },
    });

    await this.emit(FINDHUB_EVENTS.TRACKING_UPDATE, {
      deviceId: device.id,
      enabled: false,
    });

    return { deviceId: device.id, enabled: false };
  }

  public async reconcileDevice(
    deviceId: string,
    input: {
      from?: string;
      to?: string;
      attempts?: number;
      timeoutMs?: number;
      automatic?: boolean;
      trigger?: FindHubReconciliationTrigger;
    } = {},
  ): Promise<any> {
    const existing = this.reconciliations.get(deviceId);
    if (existing) return await existing;
    if (this.dispatching.has(deviceId) || this.locating.has(deviceId)) {
      throw new Error('O dispositivo está executando uma consulta de localização. Tente a reconciliação novamente.');
    }

    const operation = this.reconcileDeviceOnce(deviceId, input);
    this.reconciliations.set(deviceId, operation);
    try {
      return await operation;
    } finally {
      if (this.reconciliations.get(deviceId) === operation) this.reconciliations.delete(deviceId);
    }
  }

  public async reconcileAll(
    input: { from?: string; to?: string; attempts?: number; timeoutMs?: number } = {},
  ): Promise<any> {
    const settings = await this.settings();
    const devices = (await this.devices()).filter((device) => device.trackingEnabled);
    const startedAt = new Date().toISOString();
    const results = [];
    for (const device of devices) {
      results.push(
        await this.reconcileDevice(device.id, input).catch((error) => ({
          deviceId: device.id,
          deviceName: device.name,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })),
      );
    }
    return {
      startedAt,
      completedAt: new Date().toISOString(),
      automatic: false,
      settings: {
        enabled: settings.reconciliationEnabled,
        minGapSeconds: settings.reconciliationMinGapSeconds,
        lookbackHours: settings.reconciliationLookbackHours,
        attempts: settings.reconciliationAttempts,
      },
      results,
    };
  }

  private installReconciliationSchedule(settings: FindHubTrackingSettings): void {
    clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = undefined;
    if (!settings.reconciliationEnabled || !settings.reconciliationPeriodicEnabled) return;

    this.reconciliationTimer = setInterval(() => {
      void this.runScheduledReconciliation().catch(() => undefined);
    }, settings.reconciliationPeriodSeconds * 1000);
    this.reconciliationTimer.unref?.();
  }

  private async runScheduledReconciliation(): Promise<void> {
    if (this.reconciliationTickRunning || !this.transportReady) return;
    this.reconciliationTickRunning = true;
    try {
      const settings = await this.settings();
      if (!settings.reconciliationEnabled || !settings.reconciliationPeriodicEnabled) return;
      const candidates = await this.reconciliationCandidates(
        settings.reconciliationMinGapSeconds,
        settings.reconciliationLookbackHours,
      );
      if (!candidates.length) return;
      await this.reconcileCandidates(candidates, 'periodic');
    } finally {
      this.reconciliationTickRunning = false;
    }
  }

  private async reconciliationCandidates(
    minGapSeconds: number,
    lookbackHours: number,
  ): Promise<FindHubReconciliationCandidate[]> {
    const now = new Date();
    const lookbackStart = new Date(now.getTime() - lookbackHours * 3600000);
    const rows = await (this.prisma as any).findHubDevice.findMany({
      where: { instanceId: this.instance.id, trackingEnabled: true },
      select: { id: true, lastLocationAt: true, trackingIntervalSeconds: true },
    });
    const candidates: FindHubReconciliationCandidate[] = [];

    for (const row of rows) {
      const thresholdMs = Math.max(minGapSeconds, Math.max(0, Number(row.trackingIntervalSeconds || 0)) * 2) * 1000;
      const recentPositions = await (this.prisma as any).findHubPosition.findMany({
        where: {
          instanceId: this.instance.id,
          deviceId: row.id,
          recordedAt: { gte: lookbackStart, lte: now },
        },
        orderBy: { recordedAt: 'desc' },
        select: { recordedAt: true },
        take: 5000,
      });
      const positions = [...recentPositions].reverse();

      let selected: { from: Date; to: Date; durationMs: number } | null = null;
      for (let index = 1; index < positions.length; index++) {
        const from = new Date(positions[index - 1].recordedAt);
        const to = new Date(positions[index].recordedAt);
        const durationMs = to.getTime() - from.getTime();
        if (durationMs >= thresholdMs && (!selected || durationMs > selected.durationMs)) {
          selected = { from, to, durationMs };
        }
      }

      // lastLocationAt is monotonic and authoritative for the tail. Do not infer a tail
      // from the last row in a bounded history page, because a high-cadence device may truncate that page.
      const lastKnownValue = row.lastLocationAt || positions[positions.length - 1]?.recordedAt;
      if (lastKnownValue) {
        const lastKnown = new Date(Math.max(new Date(lastKnownValue).getTime(), lookbackStart.getTime()));
        const durationMs = now.getTime() - lastKnown.getTime();
        if (durationMs >= thresholdMs && (!selected || durationMs > selected.durationMs)) {
          selected = { from: lastKnown, to: now, durationMs };
        }
      }

      if (selected) {
        candidates.push({
          deviceId: row.id,
          from: selected.from.toISOString(),
          to: selected.to.toISOString(),
        });
      }
    }

    return candidates;
  }

  private async reconcileCandidates(
    candidates: FindHubReconciliationCandidate[],
    trigger: Exclude<FindHubReconciliationTrigger, 'manual'>,
  ): Promise<void> {
    for (const candidate of candidates) {
      await this.reconcileDevice(candidate.deviceId, {
        from: candidate.from,
        to: candidate.to,
        automatic: true,
        trigger,
      }).catch(async (error) => {
        await this.emit(FINDHUB_EVENTS.ERROR, {
          deviceId: candidate.deviceId,
          operation: 'reconciliation',
          code: 'RECONCILIATION_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  private async reconcileDeviceOnce(
    deviceId: string,
    input: {
      from?: string;
      to?: string;
      attempts?: number;
      timeoutMs?: number;
      automatic?: boolean;
      trigger?: FindHubReconciliationTrigger;
    },
  ): Promise<any> {
    if (!this.protocol) throw new Error('Find Hub account is not connected');
    const settings = await this.settings();
    if (!settings.historyEnabled) throw new Error('O histórico precisa estar habilitado para reconciliar lacunas.');

    const device = await this.device(deviceId);
    const fromValue = input.from || device.lastLocationAt || device.latestPosition?.timestamp;
    if (!fromValue || !Number.isFinite(Date.parse(fromValue))) {
      throw new Error('Informe o início da lacuna para a primeira reconciliação deste dispositivo.');
    }

    const from = new Date(fromValue);
    const to = new Date(input.to || Date.now());
    if (!Number.isFinite(to.getTime()) || from.getTime() > to.getTime())
      throw new Error('Período de reconciliação inválido.');

    const attempts = Math.min(10, Math.max(1, input.attempts ?? settings.reconciliationAttempts));
    const timeoutMs = input.timeoutMs ?? device.locationTimeoutMs ?? settings.timeoutMs;
    const trigger: FindHubReconciliationTrigger = input.trigger || (input.automatic ? 'boot' : 'manual');
    const reconciliationId = randomUUID();
    const before = await (this.prisma as any).findHubPosition.count({
      where: { instanceId: this.instance.id, deviceId, recordedAt: { gt: from, lte: to } },
    });

    const startedAt = new Date().toISOString();
    this.reconciliationStatus.set(deviceId, {
      reconciliationId,
      status: 'running',
      trigger,
      automatic: trigger !== 'manual',
      from: from.toISOString(),
      to: to.toISOString(),
      startedAt,
      attemptsRequested: attempts,
    });
    await this.emit(FINDHUB_EVENTS.TRACKING_UPDATE, {
      deviceId,
      reconciliation: this.reconciliationStatus.get(deviceId),
    });

    const seen = new Set<string>();
    const attemptResults: any[] = [];
    const totals = {
      fcmPayloadsReceived: 0,
      deviceMismatchPayloads: 0,
      metadataDecodeFailures: 0,
      providerReportsDecoded: 0,
      reportsWithEncryptedLocation: 0,
      reportsWithoutEncryptedLocation: 0,
      decryptedReports: 0,
      decryptRejectedReports: 0,
      decryptErrors: 0,
      invalidReports: 0,
      validReports: 0,
      duplicateValidReports: 0,
      uniqueValidReports: 0,
      uniqueReportsReturned: 0,
      duplicateAcrossAttempts: 0,
      alreadyStoredReports: 0,
      importedReports: 0,
      reportsInTargetRange: 0,
      reportsOutsideTargetRange: 0,
      reportsSkippedByRetention: 0,
      recentReports: 0,
      networkReports: 0,
    };

    let attemptsCompleted = 0;
    let emptyAttempts = 0;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (!this.protocol) break;
      attemptsCompleted++;
      const attemptStarted = Date.now();
      const provider = createFindHubLocateDiagnostics();
      const reports = (await this.protocol.locate(device, timeoutMs, provider, { collectUntilTimeout: true }))
        .filter((position) => validPosition(position))
        .sort(comparePositionPreference);

      // Test doubles and alternate compatible protocol implementations may not fill the optional diagnostics object.
      if (!provider.providerReportsDecoded && reports.length) {
        provider.providerReportsDecoded = reports.length;
        provider.reportsWithEncryptedLocation = reports.length;
        provider.decryptedReports = reports.length;
        provider.validReports = reports.length;
        provider.uniqueValidReports = reports.length;
      }

      const attemptMetrics = {
        attempt: attempt + 1,
        durationMs: Date.now() - attemptStarted,
        ...provider,
        uniqueReportsReturned: 0,
        duplicateAcrossAttempts: 0,
        alreadyStoredReports: 0,
        importedReports: 0,
        reportsInTargetRange: 0,
        reportsOutsideTargetRange: 0,
        reportsSkippedByRetention: 0,
        recentReports: 0,
        networkReports: 0,
      };

      let discovered = 0;
      for (const report of [...reports].reverse()) {
        const fingerprint = positionFingerprint(report);
        if (seen.has(fingerprint)) {
          attemptMetrics.duplicateAcrossAttempts++;
          continue;
        }
        seen.add(fingerprint);
        discovered++;
        attemptMetrics.uniqueReportsReturned++;

        const reportTime = Date.parse(report.timestamp);
        if (reportTime > from.getTime() && reportTime <= to.getTime()) attemptMetrics.reportsInTargetRange++;
        else attemptMetrics.reportsOutsideTargetRange++;
        if (report.source === 'RECENT') attemptMetrics.recentReports++;
        if (report.source === 'NETWORK') attemptMetrics.networkReports++;

        const expiredByRetention =
          settings.retentionDays > 0 && Date.now() - reportTime > settings.retentionDays * 86400000;
        if (expiredByRetention) {
          attemptMetrics.reportsSkippedByRetention++;
          await this.persistPosition(device, report);
          continue;
        }

        const existing = await (this.prisma as any).findHubPosition.findUnique({
          where: {
            instanceId_deviceId_fingerprint: {
              instanceId: this.instance.id,
              deviceId: device.id,
              fingerprint,
            },
          },
          select: { id: true },
        });
        if (existing) attemptMetrics.alreadyStoredReports++;
        else attemptMetrics.importedReports++;

        // Import everything the Google provider actually returned. The requested gap is
        // only the reconciliation target used for coverage metrics, never a discard filter.
        await this.persistPosition(device, report);
      }

      for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
        const value = attemptMetrics[key];
        if (typeof value === 'number') totals[key] += value;
      }
      attemptResults.push(attemptMetrics);
      diagnostics.record({
        code: 'findhub.reconciliation',
        component: 'findhub',
        instanceId: this.instance.id,
        reconciliationId,
        phase: 'attempt',
        trigger,
        status: discovered ? 'provider_data' : 'no_usable_position',
        rangeSeconds: Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000)),
        attemptsRequested: attempts,
        attempt: attempt + 1,
        ...attemptMetrics,
      });

      if (!discovered) emptyAttempts++;
      else emptyAttempts = 0;
      if (emptyAttempts >= 2) break;
    }

    const after = await (this.prisma as any).findHubPosition.count({
      where: { instanceId: this.instance.id, deviceId, recordedAt: { gt: from, lte: to } },
    });
    const recovered = Math.max(0, after - before);
    const rows = await (this.prisma as any).findHubPosition.findMany({
      where: { instanceId: this.instance.id, deviceId, recordedAt: { gt: from, lte: to } },
      orderBy: { recordedAt: 'asc' },
      select: { recordedAt: true, source: true },
      take: 1000,
    });

    let status:
      | 'recovered'
      | 'imported_outside_target'
      | 'duplicates_only'
      | 'provider_reports_unusable'
      | 'no_provider_reports'
      | 'retention_filtered'
      | 'no_recoverable_positions';
    if (recovered > 0) status = 'recovered';
    else if (totals.importedReports > 0) status = 'imported_outside_target';
    else if (totals.providerReportsDecoded === 0) status = 'no_provider_reports';
    else if (totals.validReports === 0) status = 'provider_reports_unusable';
    else if (totals.alreadyStoredReports > 0) status = 'duplicates_only';
    else if (totals.reportsSkippedByRetention > 0) status = 'retention_filtered';
    else status = 'no_recoverable_positions';

    const result = {
      reconciliationId,
      deviceId,
      deviceName: device.name,
      status,
      trigger,
      automatic: trigger !== 'manual',
      from: from.toISOString(),
      to: to.toISOString(),
      startedAt,
      completedAt: new Date().toISOString(),
      attemptsRequested: attempts,
      attemptsCompleted,
      positionsBefore: before,
      positionsAfter: after,
      recoveredPositions: recovered,
      providerReportsObserved: totals.providerReportsDecoded,
      providerReportsDecoded: totals.providerReportsDecoded,
      validProviderReports: totals.validReports,
      uniqueValidProviderReports: seen.size,
      alreadyStoredReports: totals.alreadyStoredReports,
      importedReports: totals.importedReports,
      reportsInTargetRange: totals.reportsInTargetRange,
      reportsOutsideTargetRange: totals.reportsOutsideTargetRange,
      reportsSkippedByRetention: totals.reportsSkippedByRetention,
      sourceCounts: { RECENT: totals.recentReports, NETWORK: totals.networkReports },
      decode: {
        fcmPayloadsReceived: totals.fcmPayloadsReceived,
        deviceMismatchPayloads: totals.deviceMismatchPayloads,
        metadataDecodeFailures: totals.metadataDecodeFailures,
        reportsWithEncryptedLocation: totals.reportsWithEncryptedLocation,
        reportsWithoutEncryptedLocation: totals.reportsWithoutEncryptedLocation,
        decryptedReports: totals.decryptedReports,
        decryptRejectedReports: totals.decryptRejectedReports,
        decryptErrors: totals.decryptErrors,
        invalidReports: totals.invalidReports,
        duplicateValidReports: totals.duplicateValidReports,
        duplicateAcrossAttempts: totals.duplicateAcrossAttempts,
      },
      attempts: attemptResults,
      firstPositionInTargetAt: rows[0]?.recordedAt?.toISOString?.() || rows[0]?.recordedAt || null,
      lastPositionInTargetAt:
        rows[rows.length - 1]?.recordedAt?.toISOString?.() || rows[rows.length - 1]?.recordedAt || null,
      firstRecoveredAt: recovered ? rows[0]?.recordedAt?.toISOString?.() || rows[0]?.recordedAt || null : null,
      lastRecoveredAt: recovered
        ? rows[rows.length - 1]?.recordedAt?.toISOString?.() || rows[rows.length - 1]?.recordedAt || null
        : null,
      sources: [...new Set(rows.map((row: any) => row.source).filter(Boolean))],
      completenessGuaranteed: false,
      note: 'Todos os relatórios válidos devolvidos pelo Google foram processados com deduplicação local. O intervalo solicitado mede a recuperação da lacuna; relatórios válidos fora dele também são importados. O Google Find Hub não garante uma timeline histórica completa.',
    };

    diagnostics.record({
      code: 'findhub.reconciliation',
      component: 'findhub',
      instanceId: this.instance.id,
      reconciliationId,
      phase: 'completed',
      trigger,
      status,
      rangeSeconds: Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000)),
      attemptsRequested: attempts,
      attemptsCompleted,
      recoveredPositions: recovered,
      ...totals,
    });
    this.reconciliationStatus.set(deviceId, result);
    await this.emit(FINDHUB_EVENTS.TRACKING_UPDATE, { deviceId, reconciliation: result });
    return result;
  }

  public async positions(deviceId: string, limit = 100, from?: string, to?: string): Promise<any[]> {
    await this.device(deviceId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Limite de histórico inválido.');
    if (
      (from && !Number.isFinite(Date.parse(from))) ||
      (to && !Number.isFinite(Date.parse(to))) ||
      (from && to && Date.parse(from) > Date.parse(to))
    )
      throw new Error('Período de histórico inválido.');
    return await (this.prisma as any).findHubPosition.findMany({
      where: {
        instanceId: this.instance.id,
        deviceId,
        ...(from || to
          ? { recordedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
          : {}),
      },
      orderBy: { recordedAt: 'desc' },
      take: Math.min(Math.max(1, limit), 1000),
    });
  }

  public async traccarBinding(deviceId: string): Promise<any> {
    const device = await this.device(deviceId);
    return await (this.prisma as any).findHubTraccarBinding.findFirst({
      where: { deviceId: device.id, instanceId: this.instance.id },
    });
  }

  public async setTraccar(deviceId: string, config: FindHubTraccarConfig): Promise<any> {
    const device = await this.device(deviceId);
    const internal =
      process.env.TRACCAR_ENABLED === 'true' &&
      process.env.TRACCAR_MODE === 'internal' &&
      config.url === (process.env.TRACCAR_INTERNAL_RECEIVER_URL || 'http://traccar:5055');
    traccarDestination(config.url, internal, true);
    return await (this.prisma as any).findHubTraccarBinding.upsert({
      where: { deviceId: device.id },
      update: {
        enabled: config.enabled,
        url: config.url,
        traccarNumericId: null,
        traccarDeviceId: config.deviceId,
      },
      create: {
        deviceId: device.id,
        instanceId: this.instance.id,
        enabled: config.enabled,
        url: config.url,
        traccarNumericId: null,
        traccarDeviceId: config.deviceId,
      },
    });
  }

  public async removeTraccar(deviceId: string): Promise<void> {
    const device = await this.device(deviceId);
    await (this.prisma as any).findHubTraccarBinding.deleteMany({
      where: { deviceId: device.id, instanceId: this.instance.id },
    });
  }

  public async sendDataWebhook(event: any, data: any): Promise<void> {
    await this.emit(String(event), data);
  }

  private async restoreTracking(): Promise<void> {
    const rows = await (this.prisma as any).findHubDevice.findMany({
      where: {
        instanceId: this.instance.id,
        trackingEnabled: true,
      },
    });

    for (const row of rows) {
      this.installTracking(row.id, row.trackingIntervalSeconds ?? 60);
    }
  }

  private installTracking(deviceId: string, intervalSeconds: number): void {
    const previous = this.tracking.get(deviceId);
    if (previous) clearTimeout(previous);
    const generation = this.generation;
    let failures = 0;
    const schedule = (delay: number) => {
      const timer = setTimeout(async () => {
        if (this.tracking.get(deviceId) !== timer || generation !== this.generation) return;
        try {
          if (!this.protocol) throw new Error('Find Hub account is not connected');
          if (this.dispatching.has(deviceId) || this.reconciliations.has(deviceId)) {
            schedule(Math.min(1000, Math.max(100, trackingDelayMs(intervalSeconds, 0))));
            return;
          }
          this.dispatching.add(deviceId);
          const device = await this.device(deviceId);
          const startedAt = new Date();
          await (this.prisma as any).findHubDevice.updateMany({
            where: { id: deviceId, instanceId: this.instance.id },
            data: {
              lastAttemptAt: startedAt,
              lastErrorCode: null,
              providerRequestCount: { increment: 1 },
              lastProviderRequestAt: startedAt,
            },
          });
          await this.protocol.requestLocation(device);
          failures = 0;
          const query = {
            status: 'requested',
            startedAt: startedAt.toISOString(),
            completedAt: new Date().toISOString(),
            timeoutMs: device.locationTimeoutMs || (await this.settings()).timeoutMs,
          };
          this.locationQueries.set(deviceId, query);
          await this.emit(FINDHUB_EVENTS.TRACKING_UPDATE, { deviceId, query });
        } catch {
          failures = Math.min(failures + 1, 4);
          await (this.prisma as any).findHubDevice.updateMany({
            where: { id: deviceId, instanceId: this.instance.id },
            data: { lastErrorCode: 'LOCATION_REQUEST_FAILED' },
          });
          await this.emit(FINDHUB_EVENTS.ERROR, {
            deviceId,
            operation: 'tracking-request',
            code: 'LOCATION_REQUEST_FAILED',
          });
        } finally {
          this.dispatching.delete(deviceId);
        }
        if (this.tracking.get(deviceId) === timer && generation === this.generation) {
          schedule(trackingDelayMs(intervalSeconds, failures));
        }
      }, delay);
      timer.unref?.();
      this.tracking.set(deviceId, timer);
    };
    // Continuous tracking schedules the next command after the previous command was accepted,
    // not after waiting for the location report. FCM observations arrive independently and update SSE/map.
    schedule(0);
  }

  private async recordProviderReports(device: FindHubDevice, reports: FindHubPosition[]): Promise<void> {
    const valid = reports.filter((position) => validPosition(position));
    if (!valid.length) return;
    const previous = device.latestPosition || null;
    const repeated = valid.filter((position) => !isNewPositionObservation(position, previous)).length;
    const newest = [...valid].sort(comparePositionPreference)[0];
    const newestAt = new Date(newest.timestamp);
    await (this.prisma as any).findHubDevice.updateMany({
      where: { id: device.id, instanceId: this.instance.id },
      data: {
        providerReportCount: { increment: valid.length },
        providerRepeatedReportCount: { increment: repeated },
      },
    });
    await (this.prisma as any).findHubDevice.updateMany({
      where: {
        id: device.id,
        instanceId: this.instance.id,
        OR: [{ lastProviderReportAt: null }, { lastProviderReportAt: { lte: newestAt } }],
      },
      data: { lastProviderReportAt: newestAt },
    });
  }

  private async persistPosition(device: FindHubDevice, position: FindHubPosition): Promise<void> {
    if (!validPosition(position)) return;
    const recordedAt = new Date(position.timestamp);
    const db = this.prisma as any;
    // Monotonic latest position, even when history is disabled or the upstream report is old.
    await db.findHubDevice.updateMany({
      where: {
        id: device.id,
        instanceId: this.instance.id,
        OR: [
          { latestPosition: { equals: Prisma.DbNull } },
          { lastLocationAt: null },
          { lastLocationAt: { lte: recordedAt } },
        ],
      },
      data: { lastLocationAt: recordedAt, latestPosition: position, lastReceivedAt: new Date(), lastErrorCode: null },
    });
    const settings = await this.settings();
    if (!settings.historyEnabled) return;
    if (settings.retentionDays && Date.now() - recordedAt.getTime() > settings.retentionDays * 86400000) return;
    const fingerprint = positionFingerprint(position);
    await db.findHubPosition.upsert({
      where: { instanceId_deviceId_fingerprint: { instanceId: this.instance.id, deviceId: device.id, fingerprint } },
      update: {},
      create: {
        instanceId: this.instance.id,
        deviceId: device.id,
        fingerprint,
        latitude: position.latitude,
        longitude: position.longitude,
        altitude: position.altitude == null ? undefined : Math.round(position.altitude),
        accuracy: position.accuracy,
        source: position.source,
        ownReport: position.ownReport,
        semanticLocation: position.semanticLocation,
        recordedAt,
      },
    });
  }

  public async settings(): Promise<FindHubTrackingSettings> {
    if (!this.options) {
      const account = await (this.prisma as any).findHubAccount.findUnique({ where: { instanceId: this.instance.id } });
      this.options = trackingSettings(account?.trackingSettings || {});
    }
    return { ...this.options };
  }

  public async saveSettings(input: any): Promise<FindHubTrackingSettings> {
    const allowed = [
      'intervalSeconds',
      'timeoutMs',
      'staleAfterSeconds',
      'historyEnabled',
      'retentionDays',
      'reconciliationEnabled',
      'reconciliationOnBoot',
      'reconciliationPeriodicEnabled',
      'reconciliationPeriodSeconds',
      'reconciliationLookbackHours',
      'reconciliationMinGapSeconds',
      'reconciliationAttempts',
    ];
    if (!input || typeof input !== 'object' || Object.keys(input).some((key) => !allowed.includes(key)))
      throw new Error('Configuração inválida.');
    const options = trackingSettings({ ...(await this.settings()), ...input });
    await (this.prisma as any).findHubAccount.update({
      where: { instanceId: this.instance.id },
      data: { trackingSettings: options },
    });
    this.options = options;
    this.installReconciliationSchedule(options);
    await this.emit(FINDHUB_EVENTS.TRACKING_UPDATE, { settings: options });
    return options;
  }

  public async snapshot(): Promise<any> {
    const settings = await this.settings();
    const devices = (await this.devices()).map((device) => ({
      ...this.publicDevice(device),
      latestPosition: device.latestPosition,
      lastReceivedAt: device.lastReceivedAt,
      lastAttemptAt: device.lastAttemptAt,
      lastQuery: this.locationQueries.get(device.id) || null,
      reconciliation: this.reconciliationStatus.get(device.id) || null,
      lastErrorCode: device.lastErrorCode,
      locationTimeoutMs: device.locationTimeoutMs || settings.timeoutMs,
      availability: locationAvailability(
        device.latestPosition,
        settings.staleAfterSeconds,
        device.latestPosition?.source === 'TRACCAR' ? device.providerStatus : undefined,
      ),
    }));
    const account = await (this.prisma as any).findHubAccount.findUnique({ where: { instanceId: this.instance.id } });
    return {
      instanceId: this.instance.id,
      name: this.instance.name,
      email: account?.googleEmail || '',
      connected: this.transportReady,
      settings,
      minimumIntervalSeconds: trackingMinimum(),
      devices,
      counts: {
        devices: devices.length,
        tracking: devices.filter((x) => x.trackingEnabled).length,
        positions: await (this.prisma as any).findHubPosition.count({ where: { instanceId: this.instance.id } }),
      },
      map: { tileUrl: process.env.FINDHUB_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
      catalogue: {
        limitation:
          'Somente dispositivos que o protocolo Google disponibiliza à conta. Compartilhamento Family Link e acessórios podem exigir permissões não expostas por este protocolo.',
        providerCapabilities: {
          canonicalIds: true,
          ownershipAndAccess: true,
          fastPairMetadata: true,
          detailedDeviceTypes: true,
          sound: { supported: true, identifierType: 'SPOT', components: ['UNSPECIFIED', 'RIGHT', 'LEFT', 'CASE'] },
          providerFreshnessTelemetry: true,
          battery: {
            supported: false,
            reason: 'O protocolo de referência fornecido não expõe percentual de bateria.',
          },
          imei: {
            supported: false,
            reason: 'O protocolo de referência fornecido não expõe IMEI.',
          },
          meid: {
            supported: false,
            reason: 'O protocolo de referência fornecido não expõe MEID.',
          },
          serialNumber: {
            supported: false,
            reason: 'O protocolo de referência fornecido não expõe número de série.',
          },
        },
      },
      traccar: await this.traccarConfiguration(),
    };
  }

  public subscribe(listener: (event: any) => void): () => void {
    if (this.subscribers >= 20) throw new Error('Limite de assinaturas realtime desta conta atingido.');
    const key = 'findhub:stream:' + this.instance.id;
    this.subscribers++;
    this._eventEmitter.on(key, listener);
    let closed = false;
    return () => {
      if (!closed) {
        closed = true;
        this.subscribers--;
        this._eventEmitter.off(key, listener);
      }
    };
  }

  public async pruneHistory(): Promise<number> {
    const settings = await this.settings();
    if (!settings.retentionDays || this.pruning) return 0;
    this.pruning = true;
    try {
      const db = this.prisma as any;
      let total = 0;
      // Bounded batches keep retention from monopolizing the database on large accounts.
      for (let batch = 0; batch < 10; batch++) {
        const rows = await db.findHubPosition.findMany({
          where: {
            instanceId: this.instance.id,
            recordedAt: { lt: new Date(Date.now() - settings.retentionDays * 86400000) },
          },
          select: { id: true },
          take: 1000,
        });
        if (!rows.length) break;
        const result = await db.findHubPosition.deleteMany({
          where: { instanceId: this.instance.id, id: { in: rows.map((x) => x.id) } },
        });
        total += result.count;
        if (rows.length < 1000) break;
      }
      return total;
    } finally {
      this.pruning = false;
    }
  }

  private async storedTraccar(): Promise<TraccarConnection> {
    const account = await (this.prisma as any).findHubAccount.findUnique({ where: { instanceId: this.instance.id } });
    if (!account?.encryptedTraccar) {
      if (process.env.TRACCAR_ENABLED === 'true' && process.env.TRACCAR_MODE === 'internal')
        return { mode: 'internal' };
      if (
        process.env.TRACCAR_ENABLED === 'true' &&
        process.env.TRACCAR_MODE === 'external' &&
        process.env.TRACCAR_URL &&
        process.env.TRACCAR_RECEIVER_URL &&
        process.env.TRACCAR_TOKEN
      ) {
        return {
          mode: 'external',
          url: process.env.TRACCAR_URL,
          receiverUrl: process.env.TRACCAR_RECEIVER_URL,
          token: process.env.TRACCAR_TOKEN,
        };
      }
      return { mode: 'disabled' };
    }
    return new FindHubCredentialVault().decrypt<TraccarConnection>(account.encryptedTraccar) || { mode: 'disabled' };
  }
  public async traccarConfiguration(): Promise<any> {
    const config = await this.storedTraccar();
    return {
      mode: config.mode,
      url: config.mode === 'external' ? config.url || '' : '',
      receiverUrl: config.mode === 'external' ? config.receiverUrl || '' : '',
      hasToken: Boolean(config.token),
      timeoutMs: config.timeoutMs || 10000,
      state: this.traccarState,
      available: process.env.TRACCAR_ENABLED === 'true',
      internalAvailable: process.env.TRACCAR_ENABLED === 'true' && process.env.TRACCAR_MODE === 'internal',
    };
  }
  public async saveTraccarConfiguration(input: TraccarConnection): Promise<any> {
    const old = await this.storedTraccar();
    const config = resolveTraccarConnection({
      ...input,
      token:
        input.mode === 'external'
          ? input.token || (old.mode === 'external' && old.url === input.url ? old.token : '')
          : undefined,
    });
    if (config.mode !== 'disabled') {
      const probe = new TraccarClient(config);
      try {
        await probe.session();
      } finally {
        probe.close();
      }
    }
    // Store the endpoint and invalidate bindings atomically; never reuse IDs from another server.
    const saved = { ...config, ...(config.mode === 'internal' ? { token: undefined } : {}) };
    const encryptedTraccar = new FindHubCredentialVault().encrypt(saved);
    await (this.prisma as any).$transaction(async (db: any) => {
      if (config.mode !== old.mode || config.url !== old.url || config.receiverUrl !== old.receiverUrl) {
        await db.findHubTraccarBinding.deleteMany({ where: { instanceId: this.instance.id } });
      }
      await db.findHubAccount.update({ where: { instanceId: this.instance.id }, data: { encryptedTraccar } });
    });
    await this.connectTraccar();
    return this.traccarConfiguration();
  }
  public async provisionTraccar(deviceId: string): Promise<any> {
    const device = await this.device(deviceId);
    const config = resolveTraccarConnection(await this.storedTraccar());
    if (config.mode === 'disabled') throw new Error('Configure o Traccar desta conta antes de vincular.');
    const client = new TraccarClient(config);
    const remote = await client.provision(this.instance.id, deviceId, device.name);
    return (this.prisma as any).findHubTraccarBinding.upsert({
      where: { deviceId },
      create: {
        instanceId: this.instance.id,
        deviceId,
        enabled: true,
        url: config.receiverUrl,
        traccarDeviceId: remote.uniqueId,
        traccarNumericId: remote.id,
      },
      update: { enabled: true, url: config.receiverUrl, traccarDeviceId: remote.uniqueId, traccarNumericId: remote.id },
    });
  }
  private async connectTraccar(): Promise<void> {
    this.traccarClient?.close();
    this.traccarClient = undefined;
    this.traccarState = 'disabled';
    const config = await this.storedTraccar();
    if (config.mode === 'disabled' || process.env.TRACCAR_ENABLED !== 'true') return;
    const client = new TraccarClient(config);
    this.traccarClient = client;
    client.start(
      async (data) => {
        if (this.traccarClient !== client) return;
        const bindings = await (this.prisma as any).findHubTraccarBinding.findMany({
          where: { instanceId: this.instance.id, enabled: true },
        });
        const allowed = new Map<number, any>(
          bindings.filter((x) => x.traccarNumericId).map((x) => [x.traccarNumericId, x]),
        );
        for (const remote of Array.isArray(data.devices) ? data.devices.slice(0, 1000) : []) {
          const binding = allowed.get(remote.id);
          if (!binding) continue;
          const status = ['online', 'offline', 'unknown'].includes(remote.status) ? remote.status : 'unknown';
          await (this.prisma as any).findHubDevice.updateMany({
            where: { id: binding.deviceId, instanceId: this.instance.id },
            data: { providerStatus: status },
          });
          await this.emit(FINDHUB_EVENTS.TRACKING_UPDATE, { deviceId: binding.deviceId, providerStatus: status });
        }
        for (const remote of Array.isArray(data.positions) ? data.positions.slice(0, 1000) : []) {
          const binding = allowed.get(remote.deviceId);
          if (!binding || this.traccarClient !== client) continue;
          const device = await this.device(binding.deviceId);
          const position: FindHubPosition = {
            deviceId: device.id,
            googleDeviceId: device.googleDeviceId,
            latitude: remote.latitude,
            longitude: remote.longitude,
            altitude: remote.altitude,
            accuracy: remote.accuracy,
            timestamp: remote.fixTime,
            source: 'TRACCAR',
            ownReport: true,
          };
          if (!validPosition(position)) continue;
          const latest = device.latestPosition;
          if (
            latest &&
            Date.parse(latest.timestamp) === Date.parse(position.timestamp) &&
            latest.latitude === position.latitude &&
            latest.longitude === position.longitude
          )
            continue;
          await this.persistPosition(device, position);
          await this.emit(FINDHUB_EVENTS.LOCATION_UPDATED, { device: this.publicDevice(device), location: position });
        }
      },
      (state) => {
        if (this.traccarClient === client) {
          this.traccarState = state;
          void this.emit(FINDHUB_EVENTS.TRACKING_UPDATE, { traccarState: state }).catch(() => undefined);
        }
      },
    );
  }

  private async forwardTraccar(device: FindHubDevice, position: FindHubPosition): Promise<void> {
    const binding = await (this.prisma as any).findHubTraccarBinding.findUnique({
      where: { deviceId: device.id },
    });
    if (!binding?.enabled) return;
    if (binding.traccarNumericId) {
      const config = await this.storedTraccar();
      if (config.mode !== 'disabled') await new TraccarClient(config).send(binding.traccarDeviceId, position);
      return;
    }
    await this.traccar.send(
      {
        enabled: true,
        url: binding.url,
        deviceId: binding.traccarDeviceId,
      },
      device,
      position,
    );
  }

  private async setState(state: FindHubRuntimeState): Promise<void> {
    this.stateConnection = { state };
    await this.prisma.instance
      .update({
        where: { id: this.instance.id },
        data: { connectionStatus: state },
      })
      .catch(() => undefined);

    await this.emit('connection.update', {
      instance: this.instance.name,
      state,
      provider: FINDHUB_INTEGRATION,
    });
  }

  private async emit(event: string, data: object): Promise<void> {
    this._eventEmitter.emit('findhub:stream:' + this.instance.id, {
      event,
      instanceId: this.instance.id,
      at: new Date().toISOString(),
      data,
    });
    const serverUrl = this.configService.get<HttpServer>('SERVER').URL;
    await eventManager.emit({
      instanceName: this.instance.name,
      origin: 'FindHubStartupService',
      event,
      data,
      serverUrl,
      dateTime: new Date().toISOString(),
      sender: 'google-find-hub',
      apiKey: undefined,
      local: true,
    });
  }

  private toDevice(row: any): FindHubDevice {
    return {
      id: row.id,
      googleDeviceId: row.googleDeviceId,
      name: row.name,
      identifierType: row.identifierType,
      deviceType: row.deviceType,
      manufacturer: row.manufacturer || undefined,
      model: row.model || undefined,
      fastPairModelId: row.fastPairModelId || undefined,
      pairedAt: row.pairedAt?.toISOString?.() || row.pairedAt || null,
      canonicalIds: Array.isArray(row.canonicalIds) ? row.canonicalIds : [],
      accessInformation: Array.isArray(row.accessInformation) ? row.accessInformation : [],
      ownerKeyVersion: row.ownerKeyVersion ?? undefined,
      identityKeyFingerprint: row.identityKeyFingerprint || undefined,
      accountKeyFingerprint: row.accountKeyFingerprint || undefined,
      publicAddressFingerprint: row.publicAddressFingerprint || undefined,
      secretsCreatedAt: row.secretsCreatedAt?.toISOString?.() || row.secretsCreatedAt || null,
      networkAggregationMinReports: row.networkAggregationMinReports ?? undefined,
      providerRequestCount: Number(row.providerRequestCount || 0),
      providerReportCount: Number(row.providerReportCount || 0),
      providerRepeatedReportCount: Number(row.providerRepeatedReportCount || 0),
      lastProviderRequestAt: row.lastProviderRequestAt?.toISOString?.() || row.lastProviderRequestAt || null,
      lastProviderReportAt: row.lastProviderReportAt?.toISOString?.() || row.lastProviderReportAt || null,
      imageUrl: row.imageUrl || undefined,
      avatarData: row.avatarData || null,
      trackingEnabled: Boolean(row.trackingEnabled),
      trackingIntervalSeconds: row.trackingIntervalSeconds,
      lastLocationAt: row.lastLocationAt?.toISOString?.() || row.lastLocationAt || null,
      latestPosition: row.latestPosition || null,
      lastReceivedAt: row.lastReceivedAt?.toISOString?.() || row.lastReceivedAt || null,
      lastAttemptAt: row.lastAttemptAt?.toISOString?.() || row.lastAttemptAt || null,
      lastErrorCode: row.lastErrorCode || null,
      providerStatus: row.providerStatus || null,
      locationTimeoutMs: row.locationTimeoutMs || null,
    };
  }

  private publicDevice(device: FindHubDevice) {
    return {
      id: device.id,
      googleDeviceId: device.googleDeviceId,
      canonicalIds: device.canonicalIds || [],
      name: device.name,
      identifierType: device.identifierType,
      deviceType: device.deviceType,
      manufacturer: device.manufacturer,
      model: device.model,
      fastPairModelId: device.fastPairModelId,
      pairedAt: device.pairedAt,
      accessInformation: device.accessInformation || [],
      ownerKeyVersion: device.ownerKeyVersion,
      identityKeyFingerprint: device.identityKeyFingerprint,
      accountKeyFingerprint: device.accountKeyFingerprint,
      publicAddressFingerprint: device.publicAddressFingerprint,
      secretsCreatedAt: device.secretsCreatedAt,
      networkAggregationMinReports: device.networkAggregationMinReports,
      providerRequestCount: device.providerRequestCount || 0,
      providerReportCount: device.providerReportCount || 0,
      providerRepeatedReportCount: device.providerRepeatedReportCount || 0,
      lastProviderRequestAt: device.lastProviderRequestAt || null,
      lastProviderReportAt: device.lastProviderReportAt || null,
      imageUrl: device.imageUrl,
      avatarVersion: device.avatarData
        ? createHash('sha256').update(device.avatarData).digest('hex').slice(0, 16)
        : null,
      trackingEnabled: device.trackingEnabled,
      trackingIntervalSeconds: device.trackingIntervalSeconds,
      lastLocationAt: device.lastLocationAt,
    };
  }
}
