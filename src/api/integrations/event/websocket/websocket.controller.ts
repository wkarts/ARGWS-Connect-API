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

  /**
   * A lista de IPs é deliberadamente separada da lista de hosts.
   *
   * Em produção o Engine.IO normalmente enxerga o IP do reverse proxy Docker
   * (172.x/10.x/192.168.x), e não o hostname público. Por isso os intervalos
   * privados padrão nunca podem ser substituídos por WEBSOCKET_ALLOWED_HOSTS.
   */
  private isAllowedNetworkAddress(address?: string): boolean {
    const websocketConfig = configService.get<Websocket>('WEBSOCKET');
    const defaults = '127.0.0.1,::1,::ffff:127.0.0.1,172.*,10.*,192.168.*';
    const allowedAddresses = [defaults, websocketConfig.ALLOWED_IPS]
      .filter(Boolean)
      .join(',');

    return allowedAddresses
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .some((pattern) => this.matchesAllowedAddress(address || '', pattern));
  }

  private normalizeHost(value?: string): string {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';

    try {
      if (/^https?:\/\//i.test(raw) || /^wss?:\/\//i.test(raw)) {
        return new URL(raw).hostname.toLowerCase();
      }
    } catch {
      return '';
    }

    // Host header may include a port. Preserve IPv6 literals.
    if (raw.startsWith('[')) {
      const end = raw.indexOf(']');
      return end >= 0 ? raw.slice(1, end) : raw;
    }

    return raw.split(':')[0];
  }

  private matchesAllowedHost(host: string, pattern: string): boolean {
    const normalizedHost = this.normalizeHost(host);
    const normalizedPattern = this.normalizeHost(pattern);

    if (!normalizedPattern) return false;
    if (normalizedPattern === '*') return true;
    if (normalizedPattern.startsWith('*.')) {
      const suffix = normalizedPattern.slice(1);
      return normalizedHost.endsWith(suffix) || normalizedHost === normalizedPattern.slice(2);
    }
    if (normalizedPattern.endsWith('*')) {
      return normalizedHost.startsWith(normalizedPattern.slice(0, -1));
    }

    return normalizedHost === normalizedPattern;
  }

  private isAllowedRequestHost(req: any): boolean {
    const websocketConfig = configService.get<Websocket>('WEBSOCKET');
    const configuredHosts = websocketConfig.ALLOWED_HOSTS || '';
    const allowedHosts = ['localhost', '127.0.0.1', configuredHosts]
      .join(',')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const candidates: string[] = [];
    const origin = String(req?.headers?.origin || '').trim();
    const forwardedHost = String(req?.headers?.['x-forwarded-host'] || '').trim();
    const host = String(req?.headers?.host || '').trim();

    if (origin) candidates.push(origin);
    if (forwardedHost) candidates.push(forwardedHost.split(',')[0]);
    if (host) candidates.push(host);

    return candidates.some((candidate) => allowedHosts.some((pattern) => this.matchesAllowedHost(candidate, pattern)));
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
          const trustedNetwork = this.isAllowedNetworkAddress(remoteAddress);
          const trustedHost = this.isAllowedRequestHost(req);

          // Engine.IO runs before Socket.IO auth is available. Behind a reverse
          // proxy we therefore accept either the trusted internal proxy network
          // or a configured public Origin/Host, and perform API-key validation
          // in the Socket.IO middleware immediately afterwards.
          if (!trustedNetwork && !trustedHost) {
            this.logger.error(
              `Connection rejected: Socket.IO origin/network not allowed (${remoteAddress || 'unknown'})`,
            );
            return callback('Socket.IO origin/network not allowed', false);
          }

          return callback(null, true);
        } catch (error) {
          this.logger.error('Socket.IO request validation error:');
          this.logger.error(error);
          return callback('Socket.IO request validation error', false);
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

          // Backward compatibility is restricted to the trusted internal
          // network only. Public Manager clients must authenticate with apikey.
          if (this.isAllowedNetworkAddress(remoteAddress)) {
            this.logger.info(`Trusted internal Socket.IO connection accepted without API key: ${socket.id}`);
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

    this.logger.info('Socket.io initialized with reverse-proxy aware allowlist and API-key authentication');
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
