import { PrismaRepository } from '@api/repository/repository.service';
import { eventManager } from '@api/server.module';
import { ConfigService, HttpServer } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { randomUUID } from 'crypto';
import EventEmitter2 from 'eventemitter2';

import { FindHubAuthBrokerService } from '../auth/findhub-auth-broker.service';
import { FINDHUB_EVENTS, FINDHUB_INTEGRATION } from '../findhub.constants';
import { FindHubDevice, FindHubPosition, FindHubRuntimeState, FindHubTraccarConfig } from '../findhub.types';
import {
  boundedInteger,
  FindHubMonitoringSettings,
  minimumTrackingInterval,
  monitoringSettings,
  positionKey,
  validateMonitoringSettings,
  validPosition,
} from './findhub-monitoring';
import { FindHubProtocolClient } from './findhub-protocol.client';
import { FindHubTraccarService } from './findhub-traccar.service';

type TrackingJob = {
  timer?: NodeJS.Timeout;
  failures: number;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  lastError?: string;
};
type StreamEvent = { event: string; data: object; receivedAt: string };

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
  private generation = 0;
  private readonly locating = new Map<string, Promise<FindHubPosition | null>>();
  private readonly tracking = new Map<string, TrackingJob>();
  private readonly listeners = new Set<(event: StreamEvent) => void>();
  private maintenance?: NodeJS.Timeout;
  private pruning = false;
  private syncing?: Promise<FindHubDevice[]>;
  private policy?: FindHubMonitoringSettings;
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
    return this.connect();
  }

  public async settings(): Promise<FindHubMonitoringSettings> {
    if (!this.policy) {
      const row = await (this.prisma as any).findHubAccount.findUnique({ where: { instanceId: this.instance.id } });
      this.policy = monitoringSettings(row?.settings);
    }
    return { ...this.policy };
  }
  public async saveSettings(input: FindHubMonitoringSettings) {
    const settings = validateMonitoringSettings(input);
    await (this.prisma as any).findHubAccount.upsert({
      where: { instanceId: this.instance.id },
      update: { settings },
      create: { instanceId: this.instance.id, settings },
    });
    this.policy = settings;
    // Retention is an explicit, account-scoped policy, never a global WhatsApp cleanup.
    await this.pruneHistory();
    this.startMaintenance();
    return this.settings();
  }
  public async catalogStatus() {
    const row = await (this.prisma as any).findHubAccount.findUnique({ where: { instanceId: this.instance.id } });
    return row?.catalogStatus || null;
  }
  public subscribe(listener: (event: StreamEvent) => void): () => void {
    if (this.listeners.size >= 16) throw new Error('Limite de conexões de eventos desta instância atingido.');
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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
    await this.protocol?.close().catch(() => undefined);
    let clientUuid = loaded.account.clientUuid;
    if (!clientUuid) {
      clientUuid = randomUUID();
      await (this.prisma as any).findHubAccount.update({ where: { id: loaded.account.id }, data: { clientUuid } });
    }
    this.protocol = new FindHubProtocolClient(loaded.credentials, loaded.sharedKey, clientUuid, (credentials) =>
      this.authBroker.persistCredentials(this.instance.id, credentials),
    );
    try {
      await this.setState('connecting');
      await this.protocol.connect();
      await this.refreshDevices();
      await this.authBroker.setAuthState(this.instance.id, 'READY');
      await this.setState('open');
      await this.restoreTracking();
      this.startMaintenance();
    } catch {
      await this.closeClient();
      await this.authBroker.setAuthState(this.instance.id, 'AUTH_REQUIRED');
      throw new Error('Não foi possível validar a conexão Google Find Hub. A conta não foi marcada como conectada.');
    }
    return { instance: { instanceName: this.instance.name, status: 'open' }, auth: { state: 'READY' } };
  }
  public async restart(): Promise<void> {
    await this.closeClient();
    await this.connect();
  }
  public async closeClient(): Promise<void> {
    this.generation++;
    for (const job of this.tracking.values()) clearTimeout(job.timer);
    this.tracking.clear();
    clearInterval(this.maintenance);
    this.maintenance = undefined;
    await this.protocol?.close().catch(() => undefined);
    this.protocol = undefined;
    await this.setState('close');
  }
  public async logoutInstance(): Promise<void> {
    await this.closeClient();
    await this.authBroker.clear(this.instance.id);
    await (this.prisma as any).findHubDevice.deleteMany({ where: { instanceId: this.instance.id } });
    this.policy = undefined;
  }
  public async purgeProviderState(): Promise<void> {
    await this.logoutInstance();
  }
  public auth(): FindHubAuthBrokerService {
    return this.authBroker;
  }

  public async refreshDevices(): Promise<FindHubDevice[]> {
    if (this.syncing) return this.syncing;
    this.syncing = this.syncDevices().finally(() => {
      this.syncing = undefined;
    });
    return this.syncing;
  }
  private async syncDevices(): Promise<FindHubDevice[]> {
    const protocol = this.protocol;
    if (!protocol) throw new Error('Find Hub account is not connected');
    const generation = this.generation;
    const discovered = await protocol.listDevices();
    if (generation !== this.generation || protocol !== this.protocol) throw new Error('A conexão foi encerrada.');
    const account = await (this.prisma as any).findHubAccount.findUnique({ where: { instanceId: this.instance.id } });
    if (!account) throw new Error('Find Hub account not found');
    const settings = await this.settings();
    const updatedAt = new Date().toISOString();
    for (const device of discovered) {
      // A Google device can occur in several catalogs/with several canonical aliases. Reuse its local id.
      const previous = await (this.prisma as any).findHubDevice.findFirst({
        where: {
          instanceId: this.instance.id,
          googleDeviceId: { in: device.aliases || [device.googleDeviceId] },
        },
      });
      const data = {
        name: device.name.slice(0, 255),
        identifierType: device.identifierType,
        deviceType: device.deviceType,
        manufacturer: device.manufacturer?.slice(0, 255),
        model: device.model?.slice(0, 255),
        imageUrl: device.imageUrl?.slice(0, 1000),
        catalogMetadata: {
          aliases: device.aliases || [device.googleDeviceId],
          catalogTypes: device.catalogTypes || [],
          locationSupported: device.locationSupported ?? null,
          lastSeenAt: updatedAt,
        },
      };
      await (this.prisma as any).findHubDevice.upsert({
        where: {
          instanceId_googleDeviceId: {
            instanceId: this.instance.id,
            googleDeviceId: previous?.googleDeviceId || device.googleDeviceId,
          },
        },
        update: data,
        create: {
          ...data,
          instanceId: this.instance.id,
          accountId: account.id,
          googleDeviceId: device.googleDeviceId,
          trackingIntervalSeconds: settings.defaultIntervalSeconds,
        },
      });
    }
    await (this.prisma as any).findHubAccount.update({
      where: { id: account.id },
      data: {
        catalogStatus: protocol.catalogStatus || { updatedAt, complete: false, sources: [] },
      },
    });
    // Partial discovery never deletes devices, their tracking configuration, links or history.
    const result = await this.devices();
    await this.emit(FINDHUB_EVENTS.DEVICES_UPDATED, {
      devices: result.map((device) => this.publicDevice(device)),
      catalog: protocol.catalogStatus,
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
  public async configureDevice(deviceId: string, input: { intervalSeconds: number; timeoutMs: number | null }) {
    const device = await this.device(deviceId);
    const interval = boundedInteger(input.intervalSeconds, minimumTrackingInterval(), 86400, 'Intervalo');
    const timeout = input.timeoutMs === null ? null : boundedInteger(input.timeoutMs, 5000, 180000, 'Timeout');
    await (this.prisma as any).findHubDevice.update({
      where: { id: device.id },
      data: { trackingIntervalSeconds: interval, locationTimeoutMs: timeout },
    });
    if (device.trackingEnabled && this.transportReady) this.installTracking(device.id, interval, false);
    return this.device(device.id);
  }
  public async latestPosition(deviceId: string) {
    return (await this.device(deviceId)).position || null;
  }

  public async locate(deviceId: string, timeoutMs?: number): Promise<FindHubPosition | null> {
    // Reuse the active request rather than issuing duplicate Google requests for the same device.
    const running = this.locating.get(deviceId);
    if (running) return running;
    const promise = this.locateOnce(deviceId, timeoutMs).finally(() => {
      if (this.locating.get(deviceId) === promise) this.locating.delete(deviceId);
    });
    this.locating.set(deviceId, promise);
    return promise;
  }
  private async locateOnce(deviceId: string, timeoutMs?: number): Promise<FindHubPosition | null> {
    const protocol = this.protocol;
    if (!protocol || !this.transportReady) throw new Error('Find Hub account is not connected');
    const device = await this.device(deviceId);
    const settings = await this.settings();
    const timeout = boundedInteger(
      timeoutMs ?? device.locationTimeoutMs ?? settings.locationTimeoutMs,
      5000,
      180000,
      'Timeout',
    );
    const generation = this.generation;
    const positions = await protocol.locate(device, timeout);
    if (generation !== this.generation || protocol !== this.protocol)
      throw new Error('A conexão de localização foi encerrada.');
    const valid = positions.filter(validPosition).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const unique = new Map(valid.map((position) => [positionKey(device.id, position), position]));
    for (const position of unique.values()) {
      if (generation !== this.generation || protocol !== this.protocol) break;
      const fresh = await this.persistPosition(device, position, settings);
      if (fresh) {
        await this.emit(FINDHUB_EVENTS.LOCATION_UPDATED, { device: this.publicDevice(device), location: position });
        // Destination failure is not a failed Google location. Persist and publish before forwarding.
        await this.forwardTraccar(device, position).catch(async () =>
          this.emit(FINDHUB_EVENTS.ERROR, {
            operation: 'traccar',
            deviceId: device.id,
            message: 'Não foi possível encaminhar a posição ao Traccar.',
          }),
        );
      }
    }
    return valid[valid.length - 1] || null;
  }

  public async startTracking(deviceId: string, intervalSeconds?: number): Promise<any> {
    if (!this.transportReady) throw new Error('Conecte a conta antes de iniciar o rastreamento.');
    const device = await this.device(deviceId);
    const interval = boundedInteger(
      intervalSeconds ?? device.trackingIntervalSeconds ?? (await this.settings()).defaultIntervalSeconds,
      minimumTrackingInterval(),
      86400,
      'Intervalo',
    );
    await (this.prisma as any).findHubDevice.update({
      where: { id: device.id },
      data: { trackingEnabled: true, trackingIntervalSeconds: interval },
    });
    this.installTracking(device.id, interval, true);
    await this.emit(FINDHUB_EVENTS.TRACKING_UPDATE, { deviceId: device.id, enabled: true, intervalSeconds: interval });
    return { deviceId: device.id, enabled: true, intervalSeconds: interval };
  }
  public async stopTracking(deviceId: string): Promise<any> {
    const device = await this.device(deviceId);
    clearTimeout(this.tracking.get(device.id)?.timer);
    this.tracking.delete(device.id);
    await (this.prisma as any).findHubDevice.update({ where: { id: device.id }, data: { trackingEnabled: false } });
    await this.emit(FINDHUB_EVENTS.TRACKING_UPDATE, { deviceId: device.id, enabled: false });
    return { deviceId: device.id, enabled: false };
  }
  private async restoreTracking(): Promise<void> {
    const rows = await (this.prisma as any).findHubDevice.findMany({
      where: { instanceId: this.instance.id, trackingEnabled: true },
    });
    for (const row of rows)
      this.installTracking(row.id, Math.max(minimumTrackingInterval(), row.trackingIntervalSeconds || 60), false);
  }
  private installTracking(deviceId: string, intervalSeconds: number, immediate = false): void {
    clearTimeout(this.tracking.get(deviceId)?.timer);
    const job: TrackingJob = { failures: 0 };
    this.tracking.set(deviceId, job);
    const schedule = (delay: number) => {
      if (this.tracking.get(deviceId) !== job) return;
      job.nextAttemptAt = new Date(Date.now() + delay).toISOString();
      job.timer = setTimeout(() => {
        void run();
      }, delay);
      job.timer.unref?.();
    };
    const run = async () => {
      if (this.tracking.get(deviceId) !== job) return;
      job.lastAttemptAt = new Date().toISOString();
      job.nextAttemptAt = undefined;
      try {
        const position = await this.locate(deviceId);
        if (!position) throw new Error('No position');
        job.failures = 0;
        job.lastError = undefined;
      } catch {
        job.failures++;
        job.lastError = 'Nenhum relatório utilizável recebido nesta consulta.';
      }
      if (this.tracking.get(deviceId) !== job) return;
      // A completed request schedules the next: no overlapping retries or bursts after a timeout.
      const seconds = Math.max(intervalSeconds, Math.min(3600, intervalSeconds * 2 ** Math.min(job.failures, 6)));
      schedule(seconds * 1000);
      await this.emit(FINDHUB_EVENTS.TRACKING_UPDATE, {
        deviceId,
        enabled: true,
        intervalSeconds,
        lastAttemptAt: job.lastAttemptAt,
        nextAttemptAt: job.nextAttemptAt,
        failures: job.failures,
        lastError: job.lastError,
      });
    };
    schedule(immediate ? 0 : intervalSeconds * 1000);
  }

  public async positions(deviceId: string, limit = 100): Promise<any[]> {
    return (await this.history(deviceId, { limit })).items;
  }
  public async history(deviceId: string, options: { limit?: number; cursor?: string; from?: string; to?: string }) {
    await this.device(deviceId);
    const limit = boundedInteger(options.limit ?? 100, 1, 1000, 'Limite');
    const where: any = { instanceId: this.instance.id, deviceId };
    const dates: any = {};
    for (const [key, value] of [
      ['gte', options.from],
      ['lte', options.to],
    ] as const) {
      if (value) {
        const time = new Date(value);
        if (!Number.isFinite(time.getTime())) throw new Error('Período de histórico inválido.');
        dates[key] = time;
      }
    }
    if (dates.gte && dates.lte && dates.gte > dates.lte) throw new Error('Período de histórico invertido.');
    if (Object.keys(dates).length) where.recordedAt = dates;
    if (options.cursor) {
      const previous = await (this.prisma as any).findHubPosition.findFirst({
        where: { ...where, id: options.cursor },
      });
      if (!previous) throw new Error('Cursor de histórico inválido para este dispositivo.');
      where.AND = [
        {
          OR: [
            { recordedAt: { lt: previous.recordedAt } },
            { recordedAt: previous.recordedAt, id: { lt: previous.id } },
          ],
        },
      ];
    }
    const rows = await (this.prisma as any).findHubPosition.findMany({
      where,
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    return { items, hasMore, nextCursor: hasMore ? items[items.length - 1].id : null };
  }
  private startMaintenance() {
    if (this.maintenance) return;
    this.maintenance = setInterval(() => {
      void this.pruneHistory().catch(() => this.logger.warn('Find Hub history cleanup failed'));
    }, 600000);
    this.maintenance.unref?.();
  }
  public async pruneHistory(): Promise<void> {
    if (this.pruning) return;
    this.pruning = true;
    try {
      const settings = await this.settings();
      if (!settings.historyRetentionDays) return;
      const cutoff = new Date(Date.now() - settings.historyRetentionDays * 86400000);
      // Bounded batches prevent a large history from monopolizing the shared database.
      for (let batch = 0; batch < 5; batch++) {
        const rows = await (this.prisma as any).findHubPosition.findMany({
          where: { instanceId: this.instance.id, recordedAt: { lt: cutoff } },
          select: { id: true },
          take: 1000,
        });
        if (!rows.length) break;
        await (this.prisma as any).findHubPosition.deleteMany({
          where: { instanceId: this.instance.id, id: { in: rows.map((row: any) => row.id) } },
        });
        if (rows.length < 1000) break;
      }
    } finally {
      this.pruning = false;
    }
  }
  private async persistPosition(
    device: FindHubDevice,
    position: FindHubPosition,
    settings: FindHubMonitoringSettings,
  ): Promise<boolean> {
    const deduplicationKey = positionKey(device.id, position);
    const previousKey = device.position ? positionKey(device.id, device.position) : null;
    const newer = !device.lastLocationAt || Date.parse(position.timestamp) >= Date.parse(device.lastLocationAt);
    if (newer) {
      await (this.prisma as any).findHubDevice.updateMany({
        where: {
          id: device.id,
          instanceId: this.instance.id,
          OR: [{ lastLocationAt: null }, { lastLocationAt: { lte: new Date(position.timestamp) } }],
        },
        data: { lastLocationAt: new Date(position.timestamp), lastPosition: position, lastReceivedAt: new Date() },
      });
      device.position = position;
      device.lastLocationAt = position.timestamp;
    }
    if (
      settings.historyEnabled &&
      (!settings.historyRetentionDays ||
        Date.parse(position.timestamp) >= Date.now() - settings.historyRetentionDays * 86400000)
    ) {
      await (this.prisma as any).findHubPosition.upsert({
        where: { deduplicationKey },
        update: {},
        create: {
          deduplicationKey,
          instanceId: this.instance.id,
          deviceId: device.id,
          latitude: position.latitude,
          longitude: position.longitude,
          altitude: position.altitude,
          accuracy: position.accuracy,
          source: position.source,
          ownReport: position.ownReport,
          semanticLocation: position.semanticLocation?.slice(0, 500),
          recordedAt: new Date(position.timestamp),
        },
      });
    }
    return newer && deduplicationKey !== previousKey;
  }
  public async traccarBinding(deviceId: string): Promise<any> {
    const device = await this.device(deviceId);
    return (this.prisma as any).findHubTraccarBinding.findFirst({
      where: { deviceId: device.id, instanceId: this.instance.id },
    });
  }
  public async setTraccar(deviceId: string, config: FindHubTraccarConfig): Promise<any> {
    const device = await this.device(deviceId);
    const data = { enabled: config.enabled, url: config.url, traccarDeviceId: config.deviceId };
    return (this.prisma as any).findHubTraccarBinding.upsert({
      where: { deviceId: device.id },
      update: data,
      create: { ...data, deviceId: device.id, instanceId: this.instance.id },
    });
  }
  public async removeTraccar(deviceId: string): Promise<void> {
    const device = await this.device(deviceId);
    await (this.prisma as any).findHubTraccarBinding.deleteMany({
      where: { deviceId: device.id, instanceId: this.instance.id },
    });
  }
  private async forwardTraccar(device: FindHubDevice, position: FindHubPosition): Promise<void> {
    const binding = await this.traccarBinding(device.id);
    if (binding?.enabled)
      await this.traccar.send({ enabled: true, url: binding.url, deviceId: binding.traccarDeviceId }, device, position);
  }
  public async sendDataWebhook(event: any, data: any): Promise<void> {
    await this.emit(String(event), data, true);
  }
  private async setState(state: FindHubRuntimeState): Promise<void> {
    this.stateConnection = { state };
    await this.prisma.instance
      .update({ where: { id: this.instance.id }, data: { connectionStatus: state } })
      .catch(() => undefined);
    await this.emit('connection.update', { instance: this.instance.name, state, provider: FINDHUB_INTEGRATION });
  }
  private async emit(event: string, data: object, strict = false): Promise<void> {
    const dateTime = new Date().toISOString();
    for (const listener of this.listeners) {
      try {
        listener({ event, data, receivedAt: dateTime });
      } catch {
        this.listeners.delete(listener);
      }
    }
    await eventManager
      .emit({
        instanceName: this.instance.name,
        origin: 'FindHubStartupService',
        event,
        data,
        serverUrl: this.configService.get<HttpServer>('SERVER').URL,
        dateTime,
        sender: 'google-find-hub',
        apiKey: undefined,
        local: true,
      })
      .catch((error) => {
        if (strict) throw error;
        this.logger.warn('Find Hub event delivery failed');
      });
  }
  private toDevice(row: any): FindHubDevice {
    const job = this.tracking.get(row.id);
    return {
      id: row.id,
      googleDeviceId: row.googleDeviceId,
      name: row.name,
      identifierType: row.identifierType,
      deviceType: row.deviceType,
      manufacturer: row.manufacturer || undefined,
      model: row.model || undefined,
      imageUrl: row.imageUrl || undefined,
      catalogTypes: row.catalogMetadata?.catalogTypes || [],
      locationSupported: row.catalogMetadata?.locationSupported ?? undefined,
      trackingEnabled: Boolean(row.trackingEnabled),
      trackingIntervalSeconds: row.trackingIntervalSeconds,
      locationTimeoutMs: row.locationTimeoutMs ?? null,
      lastLocationAt: row.lastLocationAt?.toISOString?.() || row.lastLocationAt || null,
      lastReceivedAt: row.lastReceivedAt?.toISOString?.() || row.lastReceivedAt || null,
      position: row.lastPosition || null,
      trackingStatus: {
        inProgress: this.locating.has(row.id),
        lastAttemptAt: job?.lastAttemptAt,
        nextAttemptAt: job?.nextAttemptAt,
        failures: job?.failures || 0,
        lastError: job?.lastError,
      },
    };
  }
  private publicDevice(device: FindHubDevice) {
    return {
      id: device.id,
      name: device.name,
      identifierType: device.identifierType,
      deviceType: device.deviceType,
      manufacturer: device.manufacturer,
      model: device.model,
      imageUrl: device.imageUrl,
      catalogTypes: device.catalogTypes,
      locationSupported: device.locationSupported,
      trackingEnabled: device.trackingEnabled,
      trackingIntervalSeconds: device.trackingIntervalSeconds,
      locationTimeoutMs: device.locationTimeoutMs,
      trackingStatus: device.trackingStatus,
      lastLocationAt: device.lastLocationAt,
      lastReceivedAt: device.lastReceivedAt,
      position: device.position,
    };
  }
}
