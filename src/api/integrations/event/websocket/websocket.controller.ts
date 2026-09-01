import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Auth, configService, Cors, Log, Websocket } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { Server } from 'http';
import { Server as SocketIO } from 'socket.io';

import { EmitData, EventController, EventControllerInterface } from '../event.controller';

export class WebsocketController extends EventController implements EventControllerInterface {
  private io: SocketIO;
  private corsConfig: Array<any>;
  private readonly logger = new Logger('WebsocketController');

  constructor(prismaRepository: PrismaRepository, waMonitor: WAMonitoringService) {
    super(prismaRepository, waMonitor, configService.get<Websocket>('WEBSOCKET')?.ENABLED, 'websocket');

    this.cors = configService.get<Cors>('CORS').ORIGIN;
  }

  private normalizeRemoteAddress(address?: string): string {
    const raw = String(address || '').trim();
    return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  }

  private matchesAllowedAddress(address: string, pattern: string): boolean {
    const normalizedAddress = this.normalizeRemoteAddress(address);
    const normalizedPattern = this.normalizeRemoteAddress(pattern);

    if (!normalizedPattern) return false;
    if (normalizedPattern === '*') return true;
    if (normalizedPattern.endsWith('*')) {
      return normalizedAddress.startsWith(normalizedPattern.slice(0, -1));
    }

    return normalizedAddress === normalizedPattern;
  }

  private isAllowedNetworkAddress(address?: string): boolean {
    const websocketConfig = configService.get<Websocket>('WEBSOCKET');
    const allowedAddresses =
      websocketConfig.ALLOWED_IPS ||
      websocketConfig.ALLOWED_HOSTS ||
      '127.0.0.1,::1,::ffff:127.0.0.1,172.*,10.*,192.168.*';

    return allowedAddresses
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .some((pattern) => this.matchesAllowedAddress(address || '', pattern));
  }

  public init(httpServer: Server): void {
    if (!this.status) {
      return;
    }

    this.socket = new SocketIO(httpServer, {
      cors: { origin: this.cors },
      allowRequest: (req, callback) => {
        try {
          const remoteAddress = req.socket.remoteAddress;

          if (!this.isAllowedNetworkAddress(remoteAddress)) {
            this.logger.error(`Connection rejected: network address not allowed (${remoteAddress || 'unknown'})`);
            return callback('Network address not allowed', false);
          }

          // Network validation is only the first security layer. Authentication
          // is mandatory for every Socket.IO connection in the middleware below.
          return callback(null, true);
        } catch (error) {
          this.logger.error('Network validation error:');
          this.logger.error(error);
          return callback('Network validation error', false);
        }
      },
    });

    this.socket.use(async (socket, next) => {
      try {
        const apiKey =
          (socket.handshake.auth?.apikey as string) ||
          (socket.handshake.query?.apikey as string) ||
          (socket.handshake.headers?.apikey as string);

        if (!apiKey) {
          const remoteAddress = socket.request?.socket?.remoteAddress || socket.handshake.address;

          // Backward-compatible Manager handshake. Network validation in
          // allowRequest remains mandatory, while legacy Manager clients do not
          // have to inject the API key into the Engine.IO handshake.
          if (this.isAllowedNetworkAddress(remoteAddress)) {
            this.logger.info(`Trusted Manager Socket.IO connection accepted: ${socket.id}`);
            return next();
          }

          this.logger.error('Connection rejected: apiKey not provided');
          return next(new Error('apiKey is required'));
        }

        const instance = await this.prismaRepository.instance.findFirst({ where: { token: apiKey } });

        if (!instance) {
          const globalToken = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
          if (apiKey !== globalToken) {
            this.logger.error('Connection rejected: invalid token');
            return next(new Error('Invalid apiKey'));
          }
        }

        return next();
      } catch (error) {
        this.logger.error('Authentication error:');
        this.logger.error(error);
        return next(new Error('Authentication error'));
      }
    });

    this.socket.on('connection', (socket) => {
      this.logger.info(`Socket.IO user connected: ${socket.id}`);

      socket.on('disconnect', (reason) => {
        this.logger.info(`User disconnected: ${socket.id} - ${reason}`);
      });

      socket.on('sendNode', async (data) => {
        try {
          await this.waMonitor.waInstances[data.instanceId].baileysSendNode(data.stanza);
          this.logger.info('Node sent successfully');
        } catch (error) {
          this.logger.error('Error sending node:');
          this.logger.error(error);
        }
      });
    });

    this.logger.info('Socket.io initialized with network allowlist and Manager-compatible API-key authentication');
  }

  private set cors(cors: Array<any>) {
    this.corsConfig = cors;
  }

  private get cors(): string | Array<any> {
    return this.corsConfig?.includes('*') ? '*' : this.corsConfig;
  }

  private set socket(socket: SocketIO) {
    this.io = socket;
  }

  public get socket(): SocketIO {
    return this.io;
  }

  public async emit({
    instanceName,
    origin,
    event,
    data,
    serverUrl,
    dateTime,
    sender,
    apiKey,
    integration,
    extra,
  }: EmitData): Promise<void> {
    if (integration && !integration.includes('websocket')) {
      return;
    }

    if (!this.status) {
      return;
    }

    const configEv = event.replace(/[.-]/gm, '_').toUpperCase();
    const logEnabled = configService.get<Log>('LOG').LEVEL.includes('WEBSOCKET');
    const message = {
      ...(extra ?? {}),
      event,
      instance: instanceName,
      data,
      server_url: serverUrl,
      date_time: dateTime,
      sender,
      apikey: apiKey,
    };

    if (configService.get<Websocket>('WEBSOCKET')?.GLOBAL_EVENTS) {
      this.socket.emit(event, message);

      if (logEnabled) {
        this.logger.log({ local: `${origin}.sendData-WebsocketGlobal`, ...message });
      }
    }

    try {
      const instance = await this.get(instanceName);

      if (!instance?.enabled) {
        return;
      }

      if (Array.isArray(instance?.events) && instance?.events.includes(configEv)) {
        this.socket.of(`/${instanceName}`).emit(event, message);

        if (logEnabled) {
          this.logger.log({ local: `${origin}.sendData-Websocket`, ...message });
        }
      }
    } catch (err) {
      if (logEnabled) {
        this.logger.log(err);
      }
    }
  }
}
