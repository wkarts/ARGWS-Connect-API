import { WAMonitoringService } from '@api/services/monitor.service';
import { Auth, configService } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException, NotFoundException } from '@exceptions';
import { randomBytes, timingSafeEqual } from 'crypto';
import { IncomingMessage, Server as HttpServer } from 'http';
import { Server as HttpsServer } from 'https';

// ws does not ship project-local TypeScript declarations in every supported install.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WebSocketServer } = require('ws') as { WebSocketServer: any };

const VOICE_MEDIA_PATH = '/voice/media';
const AUTH_TIMEOUT_MS = 5000;
const MEDIA_TICKET_TTL_MS = 30_000;
const MAX_PENDING_MEDIA_TICKETS = 2048;
const MAX_AUTH_PAYLOAD_BYTES = 4096;
const MAX_PCM_FRAME_BYTES = 256 * 1024;

type MediaTicketRecord = {
  instanceName: string;
  callId: string;
  expiresAt: number;
};

function safeTokenEquals(actual?: string, expected?: string): boolean {
  if (!actual || !expected) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Binary PCM gateway for browser/PBX media.
 * Control events stay in REST/EventManager. PCM never touches RabbitMQ/Webhooks.
 */
export class VoiceMediaService {
  private readonly logger = new Logger('VoiceMediaService');
  private readonly mediaTickets = new Map<string, MediaTicketRecord>();
  private attached = false;

  constructor(private readonly waMonitor: WAMonitoringService) {}

  public async createMediaTicket(instanceName: string, callId: string) {
    const normalizedInstanceName = String(instanceName || '').trim();
    const normalizedCallId = String(callId || '').trim();
    const provider = this.waMonitor.waInstances[normalizedInstanceName];

    if (!provider) throw new NotFoundException(`Instance "${normalizedInstanceName}" not found`);
    if (!normalizedCallId) throw new BadRequestException('callId is required');
    if (
      typeof provider.listCalls !== 'function' ||
      typeof provider.onInboundVoiceAudio !== 'function' ||
      typeof provider.feedLiveAudio !== 'function' ||
      typeof provider.setExternalAudioMode !== 'function'
    ) {
      throw new BadRequestException('Voice media unavailable for this provider');
    }

    const calls = await provider.listCalls();
    if (
      !Array.isArray(calls) ||
      !calls.some((call: any) => String(call?.callId || call?.id) === normalizedCallId)
    ) {
      throw new NotFoundException('Call not found');
    }

    this.pruneExpiredTickets();
    this.enforceTicketCapacity();

    let ticket = randomBytes(32).toString('base64url');
    while (this.mediaTickets.has(ticket)) ticket = randomBytes(32).toString('base64url');

    const expiresAt = Date.now() + MEDIA_TICKET_TTL_MS;
    this.mediaTickets.set(ticket, {
      instanceName: normalizedInstanceName,
      callId: normalizedCallId,
      expiresAt,
    });

    return {
      ticket,
      expiresAt: new Date(expiresAt).toISOString(),
      expiresInSeconds: Math.floor(MEDIA_TICKET_TTL_MS / 1000),
      mediaPath: VOICE_MEDIA_PATH,
    };
  }

  private consumeMediaTicket(ticket: string): MediaTicketRecord | null {
    if (!ticket) return null;
    const record = this.mediaTickets.get(ticket);
    this.mediaTickets.delete(ticket);
    if (!record || record.expiresAt <= Date.now()) return null;
    return record;
  }

  private pruneExpiredTickets() {
    const now = Date.now();
    for (const [ticket, record] of this.mediaTickets.entries()) {
      if (record.expiresAt <= now) this.mediaTickets.delete(ticket);
    }
  }

  private enforceTicketCapacity() {
    while (this.mediaTickets.size >= MAX_PENDING_MEDIA_TICKETS) {
      const oldestTicket = this.mediaTickets.keys().next().value as string | undefined;
      if (!oldestTicket) break;
      this.mediaTickets.delete(oldestTicket);
    }
  }

  public attach(server: HttpServer | HttpsServer) {
    if (this.attached) return;
    this.attached = true;

    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
      const pathname = new URL(request.url || '/', 'http://localhost').pathname;
      if (pathname !== VOICE_MEDIA_PATH) return;

      wss.handleUpgrade(request, socket, head, (ws: any) => {
        this.bindSocket(ws);
      });
    });
    this.logger.info(`Voice media gateway ready at ${VOICE_MEDIA_PATH}`);
  }

  private bindSocket(ws: any) {
    let authenticated = false;
    let unsubscribe: (() => void) | null = null;
    let provider: any = null;
    let callId = '';

    const authTimer = setTimeout(() => {
      if (!authenticated) ws.close(4401, 'Authentication timeout');
    }, AUTH_TIMEOUT_MS);
    authTimer.unref?.();

    const cleanup = () => {
      clearTimeout(authTimer);
      unsubscribe?.();
      unsubscribe = null;
      if (authenticated && provider && callId) {
        try {
          provider.setExternalAudioMode(callId, false);
        } catch {
          // Call may already have ended.
        }
      }
    };

    ws.on('close', cleanup);
    ws.on('error', (error: Error) => this.logger.error(error));

    ws.on('message', async (payload: any, isBinary: boolean) => {
      try {
        if (!authenticated) {
          if (isBinary) {
            ws.close(4401, 'Authenticate before sending media');
            return;
          }

          const authPayload = Buffer.from(payload);
          if (authPayload.byteLength === 0 || authPayload.byteLength > MAX_AUTH_PAYLOAD_BYTES) {
            ws.close(4400, 'Invalid authentication payload');
            return;
          }

          const auth = JSON.parse(authPayload.toString('utf8'));
          const ticketRecord = this.consumeMediaTicket(String(auth?.ticket || ''));
          const instanceName = ticketRecord?.instanceName || String(auth?.instanceName || '');
          callId = ticketRecord?.callId || String(auth?.callId || '');
          const token = String(auth?.token || '');
          provider = this.waMonitor.waInstances[instanceName];

          const globalToken = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
          const authorized = Boolean(
            provider &&
              (ticketRecord || safeTokenEquals(provider.token, token) || safeTokenEquals(globalToken, token)),
          );
          if (!authorized) {
            ws.close(4401, 'Unauthorized');
            return;
          }
          if (
            !callId ||
            typeof provider.onInboundVoiceAudio !== 'function' ||
            typeof provider.feedLiveAudio !== 'function' ||
            typeof provider.setExternalAudioMode !== 'function'
          ) {
            ws.close(4404, 'Voice media unavailable');
            return;
          }

          const calls = typeof provider.listCalls === 'function' ? await provider.listCalls() : [];
          if (!Array.isArray(calls) || !calls.some((call: any) => String(call?.callId || call?.id) === callId)) {
            ws.close(4404, 'Call not found');
            return;
          }

          provider.setExternalAudioMode(callId, true);
          unsubscribe = provider.onInboundVoiceAudio(({ call, pcm }: any) => {
            if (String(call?.callId || call?.id) !== callId || ws.readyState !== 1) return;
            const bytes = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
            ws.send(bytes, { binary: true });
          });

          authenticated = true;
          clearTimeout(authTimer);
          ws.send(JSON.stringify({ type: 'ready', format: 'f32le', sampleRate: 16000, channels: 1 }));
          return;
        }

        if (!isBinary) return;
        const bytes = Buffer.from(payload);
        if (bytes.byteLength > MAX_PCM_FRAME_BYTES) {
          ws.close(1009, 'Media frame too large');
          return;
        }
        if (bytes.byteLength === 0 || bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return;
        const copy = Buffer.from(bytes);
        const pcm = new Float32Array(
          copy.buffer,
          copy.byteOffset,
          copy.byteLength / Float32Array.BYTES_PER_ELEMENT,
        );
        provider.feedLiveAudio(callId, pcm);
      } catch (error) {
        this.logger.error(error);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    });
  }
}
