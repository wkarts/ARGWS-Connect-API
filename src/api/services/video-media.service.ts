import { getConnectVideoConfig } from '@api/integrations/channel/whatsapp/voip/connect-voip.config';
import { WAMonitoringService } from '@api/services/monitor.service';
import { BadRequestException, NotFoundException } from '@exceptions';
import { randomBytes, randomUUID } from 'crypto';
import { IncomingMessage, Server as HttpServer } from 'http';
import { Server as HttpsServer } from 'https';

import { diagnostics } from '../../diagnostics/diagnostics.service';
import { decodeVideoFrame, encodeVideoFrame, VIDEO_FRAME_HEADER_BYTES } from './video-media.codec';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { WebSocketServer } = require('ws') as { WebSocketServer: any };

const MEDIA_PATH = '/video/media';
const TICKET_TTL_MS = 30_000;
const MAX_TICKETS = 2048;
const MAX_PENDING_SOCKETS = 128;
const MAX_SOCKETS = 2048;
const AUTH_TIMEOUT_MS = 5000;
const MAX_CONTROL_BYTES = 4096;
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
const KEYFRAME_INTERVAL_MS = 500;
const TERMINAL = new Set([
  'ended',
  'end',
  'terminated',
  'rejected',
  'closed',
  'failed',
  'missed',
  'unanswered',
  'accepted_elsewhere',
  'answered_elsewhere',
]);

type Ticket = { instanceName: string; callId: string; provider: any; expiresAt: number };

export function videoMediaConfiguration() {
  const { maxFrameBytes, maxFps, width, height, bitrate } = getConnectVideoConfig();
  return {
    codec: 'h264' as const,
    format: 'annexb' as const,
    mediaPath: MEDIA_PATH,
    maxFrameBytes,
    maxFps,
    width,
    height,
    bitrate,
  };
}

/** Ephemeral H.264 gateway. No camera frames are persisted or sent to the event plane. */
export class VideoMediaService {
  private readonly tickets = new Map<string, Ticket>();
  private readonly sockets = new Set<any>();
  private readonly activeCalls = new Map<string, any>();
  private pendingSockets = 0;
  private attached = false;

  constructor(private readonly waMonitor: WAMonitoringService) {}

  public async capabilities(instanceName: string) {
    const provider = this.provider(instanceName);
    const capabilities =
      typeof provider.getCallCapabilities === 'function' ? await provider.getCallCapabilities() : null;
    const video = Boolean(getConnectVideoConfig().enabled && capabilities?.video && this.hasVideo(provider));
    return {
      audio: capabilities?.audio === true,
      video,
      engine: typeof capabilities?.engine === 'string' ? capabilities.engine : 'unavailable',
      ...(video ? { videoCodec: 'h264', videoMedia: videoMediaConfiguration() } : {}),
    };
  }

  public async createMediaTicket(instanceName: string, callId: string) {
    instanceName = String(instanceName || '').trim();
    callId = String(callId || '').trim();
    if (!callId) throw new BadRequestException('callId is required');
    const provider = this.provider(instanceName);
    if (!(await this.capabilities(instanceName)).video) throw new BadRequestException('Video media unavailable');
    await this.requireCall(provider, callId);
    if (this.provider(instanceName) !== provider) throw new BadRequestException('Instance runtime changed');
    const now = Date.now();
    for (const [key, ticket] of this.tickets) if (ticket.expiresAt <= now) this.tickets.delete(key);
    if (this.tickets.size >= MAX_TICKETS) throw new BadRequestException('Too many pending video media tickets');
    let ticket = randomBytes(32).toString('base64url');
    while (this.tickets.has(ticket)) ticket = randomBytes(32).toString('base64url');
    const expiresAt = now + TICKET_TTL_MS;
    this.tickets.set(ticket, { instanceName, callId, provider, expiresAt });
    return { ticket, expiresAt: new Date(expiresAt).toISOString(), expiresInSeconds: 30, ...videoMediaConfiguration() };
  }

  private provider(instanceName: string): any {
    const provider = this.waMonitor.waInstances[instanceName];
    if (!provider) throw new NotFoundException('Instance not found');
    return provider;
  }

  private hasVideo(provider: any): boolean {
    return [
      'listCalls',
      'feedLiveVideo',
      'onInboundVideo',
      'onVideoKeyFrameRequest',
      'onCallEnded',
      'requestVideoKeyFrame',
    ].every((method) => typeof provider?.[method] === 'function');
  }

  private async requireCall(provider: any, callId: string) {
    const calls = await provider.listCalls();
    const call = Array.isArray(calls) && calls.find((item) => String(item?.callId || item?.id) === callId);
    const state = String(call?.stateData?.state ?? call?.state ?? '').toLowerCase();
    if (!call || !call.isVideo || TERMINAL.has(state)) throw new NotFoundException('Active video call not found');
  }

  private consume(ticket: unknown): Ticket | null {
    if (typeof ticket !== 'string') return null;
    const record = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return record && record.expiresAt > Date.now() ? record : null;
  }

  public attach(server: HttpServer | HttpsServer) {
    if (this.attached) return;
    this.attached = true;
    const config = videoMediaConfiguration();
    const wss = new WebSocketServer({
      noServer: true,
      perMessageDeflate: false,
      maxPayload: config.maxFrameBytes + VIDEO_FRAME_HEADER_BYTES,
    });
    server.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
      let pathname: string;
      try {
        pathname = new URL(request.url || '/', 'http://localhost').pathname;
      } catch {
        return;
      }
      if (pathname !== MEDIA_PATH) return;
      if (this.pendingSockets >= MAX_PENDING_SOCKETS || this.sockets.size >= MAX_SOCKETS) {
        socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws: any) => this.bindSocket(ws));
    });
    server.on('close', () => {
      this.tickets.clear();
      for (const ws of this.sockets) ws.close(1001, 'Server stopping');
      wss.close();
    });
  }

  private bindSocket(ws: any) {
    const config = videoMediaConfiguration();
    const traceId = randomUUID();
    const recorded = new Set<string>();
    let state: 'pending' | 'authenticating' | 'ready' | 'closed' = 'pending';
    let grant: Ticket | null = null;
    let activeKey = '';
    let pending = true;
    let unsubscriptions: Array<() => void> = [];
    let lifecycleTimer: ReturnType<typeof setInterval> | undefined;
    let checkingCall = false;
    let waitingInboundKeyframe = true;
    let waitingOutboundKeyframe = true;
    let lastInboundTimestamp = -1;
    let lastOutboundTimestamp = -1;
    let lastRemoteKeyframeRequest = -Infinity;
    let lastLocalKeyframeRequest = -Infinity;
    let windowStartedAt = Date.now();
    let frameCount = 0;
    let byteCount = 0;
    this.sockets.add(ws);
    this.pendingSockets++;

    const record = (phase: string, reason?: string, closeCode?: number) => {
      if (recorded.has(phase)) return;
      recorded.add(phase);
      try {
        diagnostics.record({
          code: 'call.media',
          component: 'video-media',
          phase,
          reason,
          closeCode,
          traceId,
          ...(state === 'ready' && grant ? { instanceId: grant.instanceName, callId: grant.callId } : {}),
        });
      } catch {
        /* Diagnostic persistence never participates in the video path. */
      }
    };
    const releasePending = () => {
      if (pending) {
        pending = false;
        this.pendingSockets--;
      }
    };
    const cleanup = () => {
      if (state === 'closed') return;
      record('closed');
      state = 'closed';
      releasePending();
      clearTimeout(authTimer);
      clearInterval(lifecycleTimer);
      for (const unsubscribe of unsubscriptions) {
        try {
          unsubscribe();
        } catch {
          /* Already disposed. */
        }
      }
      unsubscriptions = [];
      if (activeKey && this.activeCalls.get(activeKey) === ws) this.activeCalls.delete(activeKey);
      this.sockets.delete(ws);
    };
    const close = (code: number, reason: string, diagnosticReason = 'provider_error') => {
      if (state === 'closed') return;
      if (code !== 1000 && code !== 1001) record('failed', diagnosticReason, code);
      cleanup();
      ws.close(code, reason);
    };
    const authTimer = setTimeout(() => close(4401, 'Authentication timeout', 'auth_timeout'), AUTH_TIMEOUT_MS);
    authTimer.unref?.();
    const requestLocalKeyframe = () => {
      if (state !== 'ready' || Date.now() - lastLocalKeyframeRequest < KEYFRAME_INTERVAL_MS) return;
      lastLocalKeyframeRequest = Date.now();
      if (ws.bufferedAmount < MAX_CONTROL_BYTES) ws.send(JSON.stringify({ type: 'request_keyframe' }));
    };
    const requestRemoteKeyframe = () => {
      if (state !== 'ready' || Date.now() - lastRemoteKeyframeRequest < KEYFRAME_INTERVAL_MS) return;
      lastRemoteKeyframeRequest = Date.now();
      grant.provider.requestVideoKeyFrame(grant.callId);
    };
    const alive = () => state !== 'closed' && ws.readyState === 1;
    const subscribe = (register: () => () => void) => {
      const unsubscribe = register();
      if (alive()) unsubscriptions.push(unsubscribe);
      else unsubscribe();
    };
    record('connected');
    ws.on('close', cleanup);
    ws.on('error', () => close(1011, 'Video transport failed', 'socket_error'));

    ws.on('message', async (payload: any, isBinary: boolean) => {
      if (!alive()) return;
      try {
        const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        if (state !== 'ready') {
          if (state !== 'pending' || isBinary) {
            close(4401, 'Authenticate before sending video', 'auth_failed');
            return;
          }
          state = 'authenticating';
          if (!bytes.length || bytes.length > MAX_CONTROL_BYTES) {
            close(4400, 'Invalid authentication payload', 'invalid_payload');
            return;
          }
          const auth = JSON.parse(bytes.toString('utf8'));
          grant = this.consume(auth?.ticket);
          if (!grant || this.waMonitor.waInstances[grant.instanceName] !== grant.provider) {
            close(4401, 'Unauthorized', 'auth_failed');
            return;
          }
          if (!(await this.capabilities(grant.instanceName)).video) {
            close(4404, 'Video media unavailable', 'provider_unavailable');
            return;
          }
          if (!alive()) return;
          // Subscribe before awaiting the snapshot so termination cannot be missed in the gap.
          subscribe(() =>
            grant.provider.onCallEnded((callId: string) => {
              if (callId === grant.callId) close(1000, 'Call ended');
            }),
          );
          if (!alive()) return;
          await this.requireCall(grant.provider, grant.callId);
          if (!alive()) return;
          if (this.waMonitor.waInstances[grant.instanceName] !== grant.provider) {
            close(4404, 'Instance runtime changed', 'provider_unavailable');
            return;
          }
          activeKey = JSON.stringify([grant.instanceName, grant.callId]);
          if (this.activeCalls.has(activeKey)) {
            close(4409, 'Video media is already attached');
            return;
          }
          this.activeCalls.set(activeKey, ws);
          subscribe(() =>
            grant.provider.onInboundVideo(({ call, frame }: any) => {
              if (state !== 'ready' || ws.readyState !== 1 || String(call?.callId || call?.id) !== grant.callId) return;
              try {
                if (frame?.codec !== 'h264') return;
                if (
                  ws.bufferedAmount + VIDEO_FRAME_HEADER_BYTES + frame.data.byteLength > MAX_BUFFERED_BYTES ||
                  frame.timestampUs <= lastInboundTimestamp
                ) {
                  waitingInboundKeyframe = true;
                  requestRemoteKeyframe();
                  return;
                }
                if (waitingInboundKeyframe && !frame.keyFrame) {
                  requestRemoteKeyframe();
                  return;
                }
                const packet = encodeVideoFrame(frame, config.maxFrameBytes);
                waitingInboundKeyframe = false;
                lastInboundTimestamp = frame.timestampUs;
                ws.send(packet, { binary: true });
              } catch {
                close(1011, 'Invalid provider video frame');
              }
            }),
          );
          subscribe(() =>
            grant.provider.onVideoKeyFrameRequest(({ callId }: { callId: string }) => {
              if (callId === grant.callId) requestLocalKeyframe();
            }),
          );
          if (!alive()) return;
          state = 'ready';
          releasePending();
          clearTimeout(authTimer);
          record('authenticated');
          ws.send(JSON.stringify({ type: 'ready', ...config }));
          requestRemoteKeyframe();
          requestLocalKeyframe();
          lifecycleTimer = setInterval(async () => {
            if (!alive() || checkingCall) return;
            checkingCall = true;
            try {
              if (this.waMonitor.waInstances[grant.instanceName] !== grant.provider) throw new Error('Runtime changed');
              await this.requireCall(grant.provider, grant.callId);
            } catch {
              close(1000, 'Call unavailable');
            } finally {
              checkingCall = false;
            }
          }, 2000);
          lifecycleTimer.unref?.();
          return;
        }
        if (!isBinary) {
          if (bytes.length > MAX_CONTROL_BYTES) {
            close(1009, 'Control frame too large', 'invalid_payload');
            return;
          }
          const control = JSON.parse(bytes.toString('utf8'));
          if (control?.type !== 'request_keyframe') {
            close(4400, 'Unsupported video control', 'invalid_payload');
            return;
          }
          waitingInboundKeyframe = true;
          requestRemoteKeyframe();
          return;
        }
        if (Date.now() - windowStartedAt >= 1000) {
          windowStartedAt = Date.now();
          frameCount = 0;
          byteCount = 0;
        }
        frameCount++;
        byteCount += bytes.byteLength;
        if (
          frameCount > config.maxFps + 2 ||
          byteCount > Math.max(config.maxFrameBytes + VIDEO_FRAME_HEADER_BYTES, config.bitrate / 2)
        ) {
          waitingOutboundKeyframe = true;
          requestLocalKeyframe();
          return;
        }
        const frame = decodeVideoFrame(bytes, config.maxFrameBytes);
        if (frame.timestampUs <= lastOutboundTimestamp) {
          waitingOutboundKeyframe = true;
          requestLocalKeyframe();
          return;
        }
        if (waitingOutboundKeyframe && !frame.keyFrame) {
          requestLocalKeyframe();
          return;
        }
        const sent = grant.provider.feedLiveVideo(grant.callId, frame.data, frame.timestampUs);
        if (sent <= 0) {
          waitingOutboundKeyframe = true;
          requestLocalKeyframe();
          return;
        }
        waitingOutboundKeyframe = false;
        lastOutboundTimestamp = frame.timestampUs;
      } catch {
        close(state === 'ready' ? 4400 : 4401, 'Invalid video request', 'invalid_payload');
      }
    });
  }
}
