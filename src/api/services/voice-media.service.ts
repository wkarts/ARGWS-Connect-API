import { WAMonitoringService } from '@api/services/monitor.service';
import { Logger } from '@config/logger.config';
import { timingSafeEqual } from 'crypto';
import { IncomingMessage, Server as HttpServer } from 'http';
import { Server as HttpsServer } from 'https';

// ws does not ship project-local TypeScript declarations in every supported install.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WebSocketServer } = require('ws') as { WebSocketServer: any };

const VOICE_MEDIA_PATH = '/voice/media';
const AUTH_TIMEOUT_MS = 5000;

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
  private attached = false;

  constructor(private readonly waMonitor: WAMonitoringService) {}

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
          if (isBinary) throw new Error('Authenticate before sending media');
          const auth = JSON.parse(Buffer.from(payload).toString('utf8'));
          const instanceName = String(auth?.instanceName || '');
          callId = String(auth?.callId || '');
          const token = String(auth?.token || '');
          provider = this.waMonitor.waInstances[instanceName];

          if (!provider || !safeTokenEquals(provider.token, token)) {
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
        if (bytes.byteLength === 0 || bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return;
        const copy = Buffer.from(bytes);
        const pcm = new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / Float32Array.BYTES_PER_ELEMENT);
        provider.feedLiveAudio(callId, pcm);
      } catch (error) {
        this.logger.error(error);
        if (ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'error', message: error?.message || String(error) }));
        }
      }
    });
  }
}
