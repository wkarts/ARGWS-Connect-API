import { PrismaRepository } from '@api/repository/repository.service';
import { eventManager } from '@api/server.module';
import { ConfigService, HttpServer } from '@config/env.config';
import { Logger } from '@config/logger.config';
import EventEmitter2 from 'eventemitter2';

import { FindHubAuthBrokerService } from '../auth/findhub-auth-broker.service';
import { FINDHUB_EVENTS, FINDHUB_INTEGRATION } from '../findhub.constants';
import { FindHubDevice, FindHubPosition, FindHubRuntimeState, FindHubTraccarConfig } from '../findhub.types';
import { FindHubProtocolClient } from './findhub-protocol.client';
import { FindHubTraccarService } from './findhub-traccar.service';

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
    privacy: true,
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

  public get instanceName() { return this.instance.name; }
  public get instanceId() { return this.instance.id; }
  public get token() { return this.instance.token; }
  public get connectionStatus() { return this.stateConnection; }

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

    await this.protocol?.close().catch(() => undefined);
    this.protocol = new FindHubProtocolClient(
      loaded.credentials,
      loaded.sharedKey,
      (credentials) => this.authBroker.persistCredentials(this.instance.id, credentials),
    );
    await this.protocol.connect();
    await this.refreshDevices();
    await this.setState('open');
    return { instance: { instanceName: this.instance.name, status: 'open' }, auth: { state: 'READY' } };
  }

  public async restart(): Promise<void> {
    await this.closeClient();
    await this.connect();
  }

  public async closeClient(): Promise<void> {
    for (const timer of this.tracking.values()) clearInterval(timer);
    this.tracking.clear();
    await this.protocol?.close().catch(() => undefined);
    this.protocol = undefined;
    await this.setState('close');
  }

  public async logoutInstance(): Promise<void> {
    await this.closeClient();
    await this.authBroker.clear(this.instance.id);
    await (this.prisma as any).findHubDevice.deleteMany({ where: { instanceId: this.instance.id } });
  }

  public async purgeProviderState(): Promise<void> {
    await this.logoutInstance();
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
          imageUrl: device.imageUrl,
          trackingIntervalSeconds: Number(process.env.FINDHUB_DEFAULT_TRACKING_INTERVAL_SECONDS || 60),
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

  public async locate(deviceId: string): Promise<FindHubPosition | null> {
    if (!this.protocol) throw new Error('Find Hub account is not connected');
    const device = await this.device(deviceId);
    const positions = await this.protocol.locate(device);
    if (!positions.length) return null;
    const position = positions[0];
    await this.persistPosition(device, position);
    await this.emit(FINDHUB_EVENTS.LOCATION_UPDATED, {
      device: this.publicDevice(device),
      location: position,
    });
    await this.forwardTraccar(device, position);
    return position;
  }

  public async startTracking(deviceId: string, intervalSeconds?: number): Promise<any> {
    const device = await this.device(deviceId);
    const minimum = Math.max(15, Number(process.env.FINDHUB_MIN_TRACKING_INTERVAL_SECONDS || 30));
    const interval = Math.max(minimum, Number(intervalSeconds || device.trackingIntervalSeconds || 60));

    await (this.prisma as any).findHubDevice.update({
      where: { id: device.id },
      data: { trackingEnabled: true, trackingIntervalSeconds: interval },
    });

    this.installTracking(device.id, interval);
    await this.emit(FINDHUB_EVENTS.TRACKING_UPDATE, {
      deviceId: device.id,
      enabled: true,
      intervalSeconds: interval,
    });

    return { deviceId: device.id, enabled: true, intervalSeconds: interval };
  }

  public async stopTracking(deviceId: string): Promise<any> {
    const device = await this.device(deviceId);
    const timer = this.tracking.get(device.id);
    if (timer) clearInterval(timer);
    this.tracking.delete(device.id);

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

  public async positions(deviceId: string, limit = 100): Promise<any[]> {
    await this.device(deviceId);
    return await (this.prisma as any).findHubPosition.findMany({
      where: { instanceId: this.instance.id, deviceId },
      orderBy: { recordedAt: 'desc' },
      take: Math.min(Math.max(1, limit), 1000),
    });
  }

  public async setTraccar(deviceId: string, config: FindHubTraccarConfig): Promise<any> {
    const device = await this.device(deviceId);
    return await (this.prisma as any).findHubTraccarBinding.upsert({
      where: { deviceId: device.id },
      update: {
        enabled: config.enabled,
        url: config.url,
        traccarDeviceId: config.deviceId,
      },
      create: {
        deviceId: device.id,
        instanceId: this.instance.id,
        enabled: config.enabled,
        url: config.url,
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

  private installTracking(deviceId: string, intervalSeconds: number): void {
    const previous = this.tracking.get(deviceId);
    if (previous) clearInterval(previous);

    const timer = setInterval(() => {
      void this.locate(deviceId).catch(async () => {
        await this.emit(FINDHUB_EVENTS.ERROR, {
          operation: 'tracking',
          deviceId,
          message: 'Location refresh failed',
        });
      });
    }, intervalSeconds * 1000);

    timer.unref?.();
    this.tracking.set(deviceId, timer);
  }

  private async persistPosition(device: FindHubDevice, position: FindHubPosition): Promise<void> {
    await (this.prisma as any).findHubDevice.update({
      where: { id: device.id },
      data: { lastLocationAt: new Date(position.timestamp) },
    });

    if (String(process.env.FINDHUB_STORE_POSITION_HISTORY || 'false').toLowerCase() !== 'true') return;

    await (this.prisma as any).findHubPosition.create({
      data: {
        instanceId: this.instance.id,
        deviceId: device.id,
        latitude: position.latitude,
        longitude: position.longitude,
        altitude: position.altitude,
        accuracy: position.accuracy,
        source: position.source,
        ownReport: position.ownReport,
        semanticLocation: position.semanticLocation,
        recordedAt: new Date(position.timestamp),
      },
    });
  }

  private async forwardTraccar(device: FindHubDevice, position: FindHubPosition): Promise<void> {
    const binding = await (this.prisma as any).findHubTraccarBinding.findUnique({
      where: { deviceId: device.id },
    });
    if (!binding?.enabled) return;

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
    await this.prisma.instance.update({
      where: { id: this.instance.id },
      data: { connectionStatus: state },
    }).catch(() => undefined);

    await this.emit('connection.update', {
      instance: this.instance.name,
      state,
      provider: FINDHUB_INTEGRATION,
    });
  }

  private async emit(event: string, data: object): Promise<void> {
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
      imageUrl: row.imageUrl || undefined,
      trackingEnabled: Boolean(row.trackingEnabled),
      trackingIntervalSeconds: row.trackingIntervalSeconds,
      lastLocationAt: row.lastLocationAt?.toISOString?.() || row.lastLocationAt || null,
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
      trackingEnabled: device.trackingEnabled,
      trackingIntervalSeconds: device.trackingIntervalSeconds,
      lastLocationAt: device.lastLocationAt,
    };
  }
}
