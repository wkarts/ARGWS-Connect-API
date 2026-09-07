from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]


def read(path):
    return (root / path).read_text(encoding='utf-8')


def write(path, text):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding='utf-8', newline='\n')


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise SystemExit(f'Expected block not found in {path}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


def regex_replace_once(path, pattern, replacement):
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S | re.M)
    if count != 1:
        raise SystemExit(f'Expected regex block not found in {path}: {pattern[:120]!r}')
    write(path, updated)


# -----------------------------------------------------------------------------
# 1. Provider-neutral authentication serialization + normalized QR output
# -----------------------------------------------------------------------------
path = 'src/api/controllers/instance.controller.ts'
text = read(path)
if "import qrcode, { QRCodeToDataURLOptions } from 'qrcode';" not in text:
    text = text.replace(
        "import EventEmitter2 from 'eventemitter2';\nimport { v4 } from 'uuid';",
        "import EventEmitter2 from 'eventemitter2';\nimport qrcode, { QRCodeToDataURLOptions } from 'qrcode';\nimport { v4 } from 'uuid';",
        1,
    )
write(path, text)

controller_block = r"  private readonly logger = new Logger\('InstanceController'\);.*?^  public async createInstance"
controller_replacement = '''  private readonly logger = new Logger('InstanceController');
  private readonly authenticationQueues = new Map<string, Promise<void>>();

  private authenticationKey(instance: any): string {
    return String(instance.instanceId || instance.instanceName || instance.instance?.id || instance.instance?.name);
  }

  /** Serialize QR/pairing operations per instance while keeping different instances fully concurrent. */
  private async withAuthenticationLock<T>(instance: any, operation: () => Promise<T>): Promise<T> {
    const key = this.authenticationKey(instance);
    const previous = this.authenticationQueues.get(key) ?? Promise.resolve();
    let release: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => gate);
    this.authenticationQueues.set(key, queued);

    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.authenticationQueues.get(key) === queued) {
        this.authenticationQueues.delete(key);
      }
    }
  }

  private normalizePairingPhoneNumber(number?: string | null): string | undefined {
    if (!number) return undefined;

    const normalized = String(number).replace(/\\D/g, '');
    if (normalized.length < 8 || normalized.length > 15) {
      throw new BadRequestException('Invalid phone number for pairing code. Use country code + area code + number.');
    }

    return normalized;
  }

  private async normalizeQrCode(qrCode: wa.QrCode): Promise<wa.QrCode> {
    if (!qrCode) return qrCode;
    if (qrCode.base64 || !qrCode.code) return qrCode;

    const opts: QRCodeToDataURLOptions = {
      margin: 3,
      scale: 4,
      errorCorrectionLevel: 'H',
      color: {
        light: '#ffffff',
        dark: this.configService.get<QrCode>('QRCODE').COLOR,
      },
    };
    return { ...qrCode, base64: await qrcode.toDataURL(qrCode.code, opts) };
  }

  private async waitForQrCode(instance: any, pairingCodeRequested: boolean): Promise<wa.QrCode> {
    const timeoutMs = this.configService.get<QrCode>('QRCODE').AUTH_TIMEOUT_MS;
    const startedAt = Date.now();

    do {
      const qrCode = instance.qrCode;
      if (pairingCodeRequested ? qrCode?.pairingCode : qrCode?.code || qrCode?.base64) {
        return pairingCodeRequested ? qrCode : await this.normalizeQrCode(qrCode);
      }
      await delay(250);
    } while (Date.now() - startedAt < timeoutMs);

    const qrCode = instance.qrCode;
    if (pairingCodeRequested && !qrCode?.pairingCode) {
      throw new BadRequestException(
        'Unable to generate pairing code. Confirm the international phone number and try again.',
      );
    }

    if (!pairingCodeRequested && !qrCode?.code && !qrCode?.base64) {
      throw new BadRequestException('Unable to generate QR code. Try again.');
    }

    return pairingCodeRequested ? qrCode : await this.normalizeQrCode(qrCode);
  }

  private async requestExplicitQrCode(instance: any): Promise<wa.QrCode> {
    return await this.withAuthenticationLock(instance, async () => {
      if (!('prepareQrConnection' in instance) || typeof instance.prepareQrConnection !== 'function') {
        throw new BadRequestException('QR connection is not available for the selected WhatsApp provider');
      }

      await instance.prepareQrConnection();
      return await this.waitForQrCode(instance, false);
    });
  }

  private async requestExplicitPairingCode(instance: any, number: string): Promise<wa.QrCode> {
    return await this.withAuthenticationLock(instance, async () => {
      const registered =
        typeof instance.isRegistered === 'function'
          ? instance.isRegistered()
          : Boolean(instance.client?.authState?.creds?.registered);
      if (registered) {
        throw new BadRequestException('This WhatsApp session is already registered.');
      }

      if (typeof instance.preparePairingConnection !== 'function') {
        throw new BadRequestException('Pairing code is not available for the selected WhatsApp provider');
      }

      await instance.preparePairingConnection(number);

      // Baileys exposes its pair-device challenge as the initial QR event.
      // Zapo has its own auth_pairing_required readiness signal and does not need this wait.
      const qrCode =
        instance.integration === Integration.WHATSAPP_BAILEYS
          ? await this.waitForQrCode(instance, false)
          : (instance.qrCode ?? {});

      const pairingCode =
        typeof instance.requestPairingCode === 'function'
          ? await instance.requestPairingCode(number)
          : await instance.client.requestPairingCode(number);

      if (!pairingCode) {
        throw new BadRequestException(
          'Unable to generate pairing code. Confirm the international phone number and try again.',
        );
      }

      if (typeof instance.setPairingCode === 'function') {
        instance.setPairingCode(pairingCode);
      }

      const maskedNumber = `${'*'.repeat(Math.max(0, number.length - 4))}${number.slice(-4)}`;
      this.logger.info(`Explicit pairing code generated for ${maskedNumber}`);
      return { ...qrCode, pairingCode };
    });
  }

  public async createInstance'''
regex_replace_once(path, controller_block, controller_replacement)


# -----------------------------------------------------------------------------
# 2. Zapo lifecycle: never reuse a poisoned pairing client; mode-specific identity
# -----------------------------------------------------------------------------
path = 'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts'
replace_once(
    path,
    "  private pairingReady = false;\n  private lidReconciliationDone = false;\n  private readonly outgoingCallPeers = new Map<string, string>();\n  private readonly audioEmitter = new EventEmitter2();",
    "  private pairingReady = false;\n  private authMode: 'qrcode' | 'pairing-code' = 'qrcode';\n  private lidReconciliationDone = false;\n  private readonly outgoingCallPeers = new Map<string, string>();\n  private readonly callMuteStates = new Map<string, boolean>();\n  private readonly audioEmitter = new EventEmitter2();",
)

old = '''  public async prepareQrConnection() {
    this.instance.qrcode = { count: 0 };
    this.phoneNumber = undefined;
    await this.loadRuntimeConfiguration();
    await this.ensureClient();
    this.startConnect();
    return this.client;
  }

  public async preparePairingConnection(number: string) {
    const normalized = String(number || '').replace(/\\D/g, '');
    if (!normalized) throw new BadRequestException('Pairing-code phone number is required');

    this.phoneNumber = normalized;
    this.instance.qrcode = { count: 0 };
    await this.loadRuntimeConfiguration();
    await this.ensureClient();
    if (!this.pairingReady && !this.pairingReadyPromise) this.resetPairingReady();
    this.startConnect();
    await this.waitPairingReady();
    return this.client;
  }

  public async requestPairingCode(number: string) {
    const normalized = String(number || '').replace(/\\D/g, '');
    if (!normalized) throw new BadRequestException('Pairing-code phone number is required');
    await this.ensureClient();
    await this.waitPairingReady();
    const code = await this.client.auth.requestPairingCode(normalized);
    this.setPairingCode(code);
    return code;
  }
'''
new = '''  private async resetLinkingClient() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;

    const current = this.client;
    this.client = null;
    this.connectPromise = null;
    this.pairingReady = false;
    this.pairingReadyPromise = null;
    this.resolvePairingReady = null;
    this.stateConnection = { state: 'close' };

    await current?.disconnect?.().catch(() => undefined);
    this.cleanupPoller?.stop?.();
    this.cleanupPoller = null;
    this.store = null;
  }

  public async prepareQrConnection() {
    if (this.isRegistered()) return this.client;

    // Reuse a still-valid QR from the same mode, otherwise create a clean auth client.
    if (this.client && this.authMode === 'qrcode' && (this.instance.qrcode?.code || this.instance.qrcode?.base64)) {
      return this.client;
    }
    if (this.client) await this.resetLinkingClient();

    this.authMode = 'qrcode';
    this.instance.qrcode = { count: 0 };
    this.phoneNumber = undefined;
    await this.loadRuntimeConfiguration();
    await this.ensureClient();
    this.startConnect();
    return this.client;
  }

  public async preparePairingConnection(number: string) {
    const normalized = String(number || '').replace(/\\D/g, '');
    if (!normalized) throw new BadRequestException('Pairing-code phone number is required');
    if (this.isRegistered()) throw new BadRequestException('This WhatsApp session is already registered.');

    // Pairing is an explicit operation. Never reuse QR/stale/failed companion state.
    if (this.client) await this.resetLinkingClient();
    this.authMode = 'pairing-code';
    this.phoneNumber = normalized;
    this.instance.qrcode = { count: 0 };
    await this.loadRuntimeConfiguration();
    await this.ensureClient();
    this.resetPairingReady();
    this.startConnect();
    await this.waitPairingReady();
    return this.client;
  }

  public async requestPairingCode(number: string) {
    const normalized = String(number || '').replace(/\\D/g, '');
    if (!normalized) throw new BadRequestException('Pairing-code phone number is required');

    try {
      await this.ensureClient();
      await this.waitPairingReady();
      const code = await this.client.auth.requestPairingCode(normalized);
      this.setPairingCode(code);
      return code;
    } catch (error) {
      this.setPairingCode(undefined);
      // A rejected companion_hello cannot be reused safely on the next request.
      await this.resetLinkingClient();
      throw error;
    }
  }
'''
replace_once(path, old, new)

old = '''    const session = this.configService.get<ConfigSessionPhone>('CONFIG_SESSION_PHONE');
    const deviceBrowser =
      process.env.WHATSAPP_PROTOCOL_BROWSER_NAME || process.env.ZAPO_DEVICE_BROWSER || session.NAME || 'Chrome';
    const deviceDisplayName =
      process.env.WHATSAPP_PROTOCOL_BROWSER_CLIENT || session.CLIENT || process.env.ZAPO_DEVICE_OS || 'Connect|API';
'''
new = '''    const session = this.configService.get<ConfigSessionPhone>('CONFIG_SESSION_PHONE');
    const configuredBrowser =
      process.env.WHATSAPP_PROTOCOL_BROWSER_NAME || process.env.ZAPO_DEVICE_BROWSER || session.NAME || 'Chrome';
    const configuredDisplayName =
      process.env.WHATSAPP_PROTOCOL_BROWSER_CLIENT || session.CLIENT || process.env.ZAPO_DEVICE_OS || 'Connect|API';

    // WhatsApp validates link-code companion_hello much more strictly than QR pairing.
    // Keep the pairing fingerprint canonical until Zapo exposes a separated public label/handshake identity.
    const deviceBrowser =
      this.authMode === 'pairing-code' ? process.env.ZAPO_PAIRING_DEVICE_BROWSER || 'Chrome' : configuredBrowser;
    const deviceDisplayName =
      this.authMode === 'pairing-code' ? process.env.ZAPO_PAIRING_DEVICE_OS || 'Linux' : configuredDisplayName;
'''
replace_once(path, old, new)

# Resolve alternate PN attrs directly from the raw stanza when Zapo did not populate remoteJidAlt.
old = '''    const rawRemoteJid = String(event.key.remoteJid);
    const remoteJidAlt = event.key.remoteJidAlt ? String(event.key.remoteJidAlt) : undefined;
    const canonicalRemoteJid =
      rawRemoteJid.endsWith('@lid') && remoteJidAlt && !remoteJidAlt.endsWith('@lid') ? remoteJidAlt : rawRemoteJid;
    const rawParticipant = event.key.participant ? String(event.key.participant) : undefined;
    const participantAlt = event.key.participantAlt ? String(event.key.participantAlt) : undefined;
'''
new = '''    const rawRemoteJid = this.normalizeDeviceJid(String(event.key.remoteJid));
    const remoteJidAlt = this.resolveAlternatePhoneJid(event, 'remote');
    const canonicalRemoteJid =
      rawRemoteJid.endsWith('@lid') && remoteJidAlt && !remoteJidAlt.endsWith('@lid') ? remoteJidAlt : rawRemoteJid;
    const rawParticipant = event.key.participant
      ? this.normalizeDeviceJid(String(event.key.participant))
      : undefined;
    const participantAlt = this.resolveAlternatePhoneJid(event, 'participant');
'''
replace_once(path, old, new)

# Add helpers immediately before handleIncomingMessage.
marker = '''  private async handleIncomingMessage(event: any) {
'''
helpers = '''  private normalizeDeviceJid(value?: string): string {
    if (!value) return '';
    return String(value).replace(/:\\d+(?=@)/, '');
  }

  private resolveAlternatePhoneJid(event: any, kind: 'remote' | 'participant'): string | undefined {
    const attrs = event?.rawNode?.attrs || {};
    const candidates =
      kind === 'participant'
        ? [event?.key?.participantAlt, attrs.participant_pn, attrs.sender_pn]
        : [
            event?.key?.remoteJidAlt,
            event?.key?.recipientAlt,
            attrs.sender_pn,
            attrs.peer_recipient_pn,
            attrs.recipient_pn,
          ];

    for (const candidate of candidates) {
      if (!candidate) continue;
      const normalized = this.normalizeDeviceJid(String(candidate));
      if (normalized.includes('@') && !normalized.endsWith('@lid')) return normalized;
    }
    return undefined;
  }

  private async handleIncomingMessage(event: any) {
'''
replace_once(path, marker, helpers)

# Own picture: retry after open and strip :device before IQ queries.
replace_once(
    path,
    '''      if (state === 'open') {
        await this.refreshOwnProfilePicture(credentials);
      }
''',
    '''      if (state === 'open') {
        void this.refreshOwnProfilePicture(credentials).catch((error: Error) => this.logger.error(error));
      }
''',
)

profile_pattern = r"  private async refreshOwnProfilePicture\(credentials: any\) \{.*?^  private async reconcileStoredLidAliases"
profile_replacement = '''  private async refreshOwnProfilePicture(credentials: any) {
    const candidates = [credentials?.meJid, credentials?.meLid, this.instance.ownerJid]
      .filter(Boolean)
      .map((jid) => this.normalizeDeviceJid(String(jid)));

    const delays = [0, 1000, 3000];
    for (const delayMs of delays) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (this.stateConnection.state !== 'open') return;

      for (const jid of [...new Set(candidates)]) {
        for (const type of ['image', 'preview'] as const) {
          const picture = await this.client?.profile?.getProfilePicture?.(jid, type).catch(() => null);
          if (picture?.url) {
            this.instance.profilePictureUrl = picture.url;
            await this.prismaRepository.instance
              .update({ where: { id: this.instanceId }, data: { profilePicUrl: picture.url } })
              .catch((error: Error) => this.logger.error(error));
            return;
          }
        }
      }
    }
  }

  private async reconcileStoredLidAliases'''
regex_replace_once(path, profile_pattern, profile_replacement)

# Call display + deterministic mute state.
replace_once(
    path,
    '''    const callId = await this.client.voip.startCall({ peerJid: jid, isVideo: Boolean(isVideo) });
    this.outgoingCallPeers.set(callId, jid);
''',
    '''    const callId = await this.client.voip.startCall({ peerJid: jid, isVideo: Boolean(isVideo) });
    this.outgoingCallPeers.set(callId, jid);
    this.callMuteStates.set(callId, false);
''',
)
replace_once(
    path,
    '''  public async rejectCall(callId: string) {
    await this.ensureConnected();
    this.ensureVoip();
    await this.client.voip.rejectCall(callId);
    return this.normalizeCall(this.client.voip.getCall(callId));
  }

  public async endCall(callId: string) {
    await this.ensureConnected();
    this.ensureVoip();
    await this.client.voip.endCall(callId);
    return this.normalizeCall(this.client.voip.getCall(callId));
  }

  public async muteCall(callId: string, muted: boolean) {
    await this.ensureConnected();
    this.ensureVoip();
    this.client.voip.setMute(callId, muted);
    return this.normalizeCall(this.client.voip.getCall(callId)) ?? { callId, muted };
  }
''',
    '''  public async rejectCall(callId: string) {
    await this.ensureConnected();
    this.ensureVoip();
    const snapshot = this.normalizeCall(this.client.voip.getCall(callId));
    await this.client.voip.rejectCall(callId);
    this.callMuteStates.delete(callId);
    this.outgoingCallPeers.delete(callId);
    return snapshot;
  }

  public async endCall(callId: string) {
    await this.ensureConnected();
    this.ensureVoip();
    const snapshot = this.normalizeCall(this.client.voip.getCall(callId));
    await this.client.voip.endCall(callId);
    this.callMuteStates.delete(callId);
    this.outgoingCallPeers.delete(callId);
    return snapshot;
  }

  public async muteCall(callId: string, muted: boolean) {
    await this.ensureConnected();
    this.ensureVoip();
    this.client.voip.setMute(callId, muted);
    this.callMuteStates.set(callId, muted);
    return this.normalizeCall(this.client.voip.getCall(callId)) ?? { callId, muted };
  }
''',
)
replace_once(
    path,
    '''    this.client.on('voip_call_ended', (call: any) => {
      this.emitCall('ended', call);
    });
''',
    '''    this.client.on('voip_call_ended', (call: any) => {
      this.emitCall('ended', call);
      if (call?.callId) {
        this.callMuteStates.delete(call.callId);
        this.outgoingCallPeers.delete(call.callId);
      }
    });
''',
)
replace_once(
    path,
    '''    const displayPeerJid =
      (call.callerPn ? createJid(String(call.callerPn)) : undefined) ||
      this.outgoingCallPeers.get(call.callId) ||
      rawPeerJid;
    return this.toJson({
      callId: call.callId,
      peerJid: displayPeerJid,
      peerJidRaw: rawPeerJid,
      callerPn: call.callerPn,
''',
    '''    const displayPeerJid =
      (call.callerPn ? createJid(String(call.callerPn)) : undefined) ||
      (call.peerJidAlt && !String(call.peerJidAlt).endsWith('@lid') ? String(call.peerJidAlt) : undefined) ||
      this.outgoingCallPeers.get(call.callId) ||
      rawPeerJid;
    return this.toJson({
      callId: call.callId,
      peerJid: displayPeerJid,
      displayPeerJid,
      peerJidRaw: rawPeerJid,
      callerPn: call.callerPn,
''',
)
replace_once(
    path,
    '''      muted: Boolean(call.stateData?.audioMuted),
''',
    '''      muted: this.callMuteStates.get(call.callId) ?? Boolean(call.stateData?.audioMuted),
''',
)


# -----------------------------------------------------------------------------
# 3. Dedicated binary Voice Media gateway (never EventManager/RabbitMQ)
# -----------------------------------------------------------------------------
voice_service = r'''import { WAMonitoringService } from '@api/services/monitor.service';
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
'''
write('src/api/services/voice-media.service.ts', voice_service)

# Wire media gateway directly to the HTTP server, outside EventManager.
replace_once(
    'src/api/server.module.ts',
    "import { TemplateService } from './services/template.service';",
    "import { TemplateService } from './services/template.service';\nimport { VoiceMediaService } from './services/voice-media.service';",
)
replace_once(
    'src/api/server.module.ts',
    '''export const waMonitor = new WAMonitoringService(
  eventEmitter,
  configService,
  prismaRepository,
  providerFiles,
  cache,
  chatwootCache,
  baileysCache,
);
''',
    '''export const waMonitor = new WAMonitoringService(
  eventEmitter,
  configService,
  prismaRepository,
  providerFiles,
  cache,
  chatwootCache,
  baileysCache,
);
export const voiceMediaService = new VoiceMediaService(waMonitor);
''',
)
replace_once(
    'src/main.ts',
    "import { eventManager, waMonitor } from '@api/server.module';",
    "import { eventManager, voiceMediaService, waMonitor } from '@api/server.module';",
)
replace_once(
    'src/main.ts',
    '''  eventManager.init(server);

  server.listen(httpServer.PORT, () => logger.log(httpServer.TYPE.toUpperCase() + ' - ON: ' + httpServer.PORT));
''',
    '''  eventManager.init(server);
  voiceMediaService.attach(server);

  server.listen(httpServer.PORT, () => logger.log(httpServer.TYPE.toUpperCase() + ' - ON: ' + httpServer.PORT));
''',
)


# -----------------------------------------------------------------------------
# 4. Real browser softphone media bridge
# -----------------------------------------------------------------------------
voip_page = r'''import { alertBox, badge, button, card, el, field, input, spinner } from '../core/dom.js';
import { acceptCall, endCall, listCalls, muteCall, offerCall, rejectCall } from '../api/calls.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

const MEDIA_SAMPLE_RATE = 16000;

function peer(call) {
  const value = call?.displayPeerJid || call?.peerJidAlt || call?.callerPn || call?.peerJid || call?.peer || '';
  return String(value).replace(/@.+$/, '') || 'Desconhecido';
}

function downsample(input, inputRate) {
  if (inputRate === MEDIA_SAMPLE_RATE) return new Float32Array(input);
  const ratio = inputRate / MEDIA_SAMPLE_RATE;
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let total = 0;
    for (let cursor = start; cursor < end; cursor += 1) total += input[cursor];
    output[index] = total / Math.max(1, end - start);
  }
  return output;
}

function mediaUrl(apiUrl) {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/voice/media';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function renderVoip(instance) {
  const session = loadSession();
  const page = el('div', { class: 'page softphone-page' });
  const feedback = el('div');
  const callsNode = el('div', { class: 'softphone-calls' }, spinner());
  const number = input('', { type: 'tel', inputmode: 'numeric', placeholder: '5575999999999' });
  let loading = false;
  let polling;
  let media = null;

  function closeMedia() {
    if (!media) return;
    media.processor?.disconnect();
    media.source?.disconnect();
    media.stream?.getTracks?.().forEach((track) => track.stop());
    if (media.ws?.readyState === WebSocket.OPEN || media.ws?.readyState === WebSocket.CONNECTING) media.ws.close();
    void media.context?.close?.();
    media = null;
  }

  function playPcm(context, state, payload) {
    const samples = new Float32Array(payload);
    if (!samples.length) return;
    const buffer = context.createBuffer(1, samples.length, MEDIA_SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    state.nextPlaybackTime = Math.max(state.nextPlaybackTime, context.currentTime + 0.03);
    source.start(state.nextPlaybackTime);
    state.nextPlaybackTime += buffer.duration;
  }

  async function openMedia(callId) {
    if (media?.callId === callId) return;
    closeMedia();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    const AudioContextRef = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextRef();
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(2048, 1, 1);
    const ws = new WebSocket(mediaUrl(session.apiUrl));
    ws.binaryType = 'arraybuffer';
    const state = { nextPlaybackTime: context.currentTime };

    media = { callId, stream, context, source, processor, ws, state };

    processor.onaudioprocess = (event) => {
      event.outputBuffer.getChannelData(0).fill(0);
      if (ws.readyState !== WebSocket.OPEN) return;
      const samples = downsample(event.inputBuffer.getChannelData(0), context.sampleRate);
      ws.send(samples.buffer);
    };
    source.connect(processor);
    processor.connect(context.destination);

    ws.onopen = () => {
      ws.send(JSON.stringify({ instanceName: instance.name, callId, token: instance.token }));
    };
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data);
        if (message.type === 'ready') {
          feedback.replaceChildren(alertBox('Áudio conectado ao navegador.', 'success'));
        } else if (message.type === 'error') {
          feedback.replaceChildren(alertBox(message.message || 'Erro no canal de áudio.'));
        }
        return;
      }
      playPcm(context, state, event.data);
    };
    ws.onclose = (event) => {
      if (media?.callId === callId && event.code !== 1000) {
        feedback.replaceChildren(alertBox(`Canal de áudio fechado (${event.code}).`));
      }
    };
    ws.onerror = () => feedback.replaceChildren(alertBox('Falha ao conectar o canal de áudio do Softphone.'));
  }

  async function act(action, call, value) {
    const callId = call.callId || call.id;
    try {
      feedback.replaceChildren();
      if (action === 'accept') {
        await acceptCall(session, instance, callId);
        await openMedia(callId);
      }
      if (action === 'reject') await rejectCall(session, instance, callId);
      if (action === 'end') {
        await endCall(session, instance, callId);
        if (media?.callId === callId) closeMedia();
      }
      if (action === 'mute') {
        await muteCall(session, instance, callId, value);
        if (media?.callId === callId) media.stream.getAudioTracks().forEach((track) => (track.enabled = !value));
      }
      if (action === 'media') await openMedia(callId);
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  function draw(calls) {
    callsNode.replaceChildren();
    if (!calls.length) {
      callsNode.append(
        el('div', { class: 'softphone-idle' }, el('strong', { text: 'Softphone disponível' }), el('span', { text: 'Faça uma chamada ou aguarde uma chamada recebida.' })),
      );
      return;
    }

    calls.forEach((call) => {
      const callId = call.callId || call.id;
      const muted = Boolean(call.muted ?? call.stateData?.audioMuted);
      const state = String(call.state || call.stateData?.state || 'unknown');
      const actions = [];
      if (call.canAccept) actions.push(button('Atender + áudio', { class: 'primary', onclick: () => act('accept', call) }));
      if (call.canReject) actions.push(button('Recusar', { class: 'danger', onclick: () => act('reject', call) }));
      if (!call.canAccept && !media) actions.push(button('Conectar áudio', { class: 'primary', onclick: () => act('media', call) }));
      actions.push(button(muted ? 'Ativar microfone' : 'Silenciar', { onclick: () => act('mute', call, !muted) }));
      actions.push(button('Encerrar', { class: 'danger', onclick: () => act('end', call) }));

      callsNode.append(
        card(
          el('div', { class: 'softphone-call-head' },
            el('div', { class: 'softphone-peer' }, el('span', { class: 'softphone-peer-icon', text: '☎' }), el('div', {}, el('strong', { text: peer(call) }), el('small', { text: call.direction === 'incoming' ? 'Chamada recebida' : 'Chamada efetuada' }))),
            badge(state),
          ),
          el('div', { class: 'softphone-call-actions' }, ...actions),
        ),
      );
    });
  }

  async function reload({ silent = false } = {}) {
    if (loading) return;
    loading = true;
    if (!silent) callsNode.replaceChildren(spinner());
    try {
      const data = await listCalls(session, instance);
      const calls = Array.isArray(data) ? data : data?.calls || [];
      draw(calls);
      if (media && !calls.some((call) => String(call.callId || call.id) === media.callId)) closeMedia();
    } catch (error) {
      if (!silent) callsNode.replaceChildren(alertBox(error.message || String(error)));
    } finally {
      loading = false;
    }
  }

  const dialer = el(
    'form',
    { class: 'softphone-dialer' },
    field('Número', number, 'DDI + DDD + número'),
    button('Ligar', { class: 'primary', type: 'submit' }),
  );
  dialer.onsubmit = async (event) => {
    event.preventDefault();
    const target = number.value.replace(/\\D/g, '');
    if (!target) return;
    try {
      feedback.replaceChildren();
      const result = await offerCall(session, instance, target);
      number.value = '';
      const callId = result?.callId || result?.id;
      if (callId) await openMedia(callId);
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  };

  page.append(
    pageHeader('VoIP', 'Softphone web/PWA da instância. Áudio PCM trafega por canal dedicado.', [
      button('Atualizar', { onclick: reload }),
    ]),
    feedback,
    el('section', { class: 'softphone-console' },
      el('div', { class: 'softphone-display' }, el('span', { text: 'Connect|API Softphone' }), el('strong', { text: 'WhatsApp Voice' })),
      dialer,
    ),
    callsNode,
    card(
      el('strong', { text: 'Vídeo' }),
      el('p', { class: 'muted', text: 'Ainda não habilitado: o provider Zapo atual expõe sinalização de vídeo, mas não um pipeline de mídia de vídeo utilizável pela Connect|API.' }),
    ),
  );

  void reload();
  polling = setInterval(() => {
    if (!document.body.contains(page)) {
      clearInterval(polling);
      closeMedia();
      return;
    }
    void reload({ silent: true });
  }, 2000);
  return instanceShell(instance, 'voip', page);
}
'''
write('manager/src/pages/voip.js', voip_page)

# Avoid hammering profile IQs while an instance is disconnected.
replace_once(
    'manager/src/pages/chat.js',
    "    if (!jid || jid.endsWith('@g.us') || jid.endsWith('@lid') || isStatusJid(jid)) return node;",
    "    if (!jid || jid.endsWith('@g.us') || jid.endsWith('@lid') || isStatusJid(jid)) return node;\n    if (instance.connectionStatus !== 'open') return node;",
)

# Chat must scroll inside its panes, never move the full application/sidebar.
css_path = 'manager/src/styles/app.css'
css = read(css_path)
extra_css = r'''

/* Stable application/chat viewport */
body:has(.chat-layout){overflow:hidden}.instance-layout:has(.chat-layout){height:calc(100vh - 64px);min-height:0}.instance-main:has(.chat-layout){height:100%;overflow:hidden}.instance-main:has(.chat-layout) .chat-layout{height:100%;min-height:0;grid-template-columns:360px minmax(0,1fr)}.instance-main:has(.chat-layout) .chat-list,.instance-main:has(.chat-layout) .conversation,.instance-main:has(.chat-layout) .messages{min-height:0}.chat-list{overscroll-behavior:contain}.messages{overscroll-behavior:contain}.connection-status{display:inline-flex;align-items:center;gap:6px}.status-led{width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 14%,transparent)}

/* Connect|API browser softphone */
.softphone-console{border:1px solid var(--border);border-radius:16px;background:linear-gradient(145deg,var(--surface),var(--surface2));padding:20px;margin-bottom:16px;box-shadow:var(--shadow)}.softphone-display{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.softphone-display span{color:var(--muted)}.softphone-display strong{font-size:20px}.softphone-dialer{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:12px}.softphone-calls{display:flex;flex-direction:column;gap:12px;margin-bottom:16px}.softphone-calls>.card{display:flex;flex-direction:column;gap:14px}.softphone-call-head{display:flex;align-items:center;justify-content:space-between;gap:14px}.softphone-peer{display:flex;align-items:center;gap:12px}.softphone-peer>div{display:flex;flex-direction:column;gap:3px}.softphone-peer small{color:var(--muted)}.softphone-peer-icon{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;background:var(--primary);color:#fff;font-size:20px}.softphone-call-actions{display:flex;gap:8px;flex-wrap:wrap}.softphone-idle{min-height:160px;border:1px dashed var(--border);border-radius:14px;display:grid;place-items:center;align-content:center;gap:6px;color:var(--muted)}.softphone-idle strong{color:var(--text);font-size:18px}
@media(max-width:900px){body:has(.chat-layout){overflow:auto}.instance-layout:has(.chat-layout),.instance-main:has(.chat-layout){height:auto;overflow:visible}.instance-main:has(.chat-layout) .chat-layout{grid-template-columns:1fr;height:auto}.softphone-dialer{grid-template-columns:1fr}.softphone-call-head{align-items:flex-start}.softphone-call-actions{display:grid;grid-template-columns:1fr 1fr}}
'''
if '/* Stable application/chat viewport */' not in css:
    write(css_path, css.rstrip() + extra_css)


# -----------------------------------------------------------------------------
# 5. Environment/documentation/invariants
# -----------------------------------------------------------------------------
replace_once(
    'deploy/develop/env.example',
    '''ZAPO_DEVICE_BROWSER=
ZAPO_DEVICE_OS=
ZAPO_LOG_LEVEL=warn
''',
    '''ZAPO_DEVICE_BROWSER=
ZAPO_DEVICE_OS=
# Pairing-code companion hello is intentionally canonical for protocol stability.
ZAPO_PAIRING_DEVICE_BROWSER=Chrome
ZAPO_PAIRING_DEVICE_OS=Linux
ZAPO_LOG_LEVEL=warn
''',
)

parity_path = 'docs/architecture/whatsapp-provider-parity.md'
parity = read(parity_path)
parity = parity.replace(
    '- Zapo mantém um browser/platform válido e usa o nome configurado da Connect|API como identificação humana do dispositivo.',
    '- Zapo usa a identidade configurada da Connect|API no QR. No código de pareamento usa fingerprint canônico `Chrome / Linux` enquanto o companion hello rejeitar identidade customizada; o modo não pode compartilhar cliente/estado com o QR.',
)
if '## Voice Media Gateway / Softphone' not in parity:
    parity += '''

## Voice Media Gateway / Softphone

- Controle de chamadas continua nas rotas REST `/call/*`.
- Áudio em tempo real usa WebSocket dedicado `/voice/media`, autenticado na primeira mensagem com instância, chamada e token.
- O formato atual é PCM `Float32`, mono, 16 kHz; frames são binários.
- PCM não passa por RabbitMQ, Webhooks, NATS, SQS ou EventManager.
- O Manager usa o mesmo contrato do futuro Voice Core/FreeSWITCH, evitando refazer o softphone quando o PBX for incorporado.
- Vídeo permanece desabilitado até o provider expor pipeline de mídia de vídeo utilizável, não apenas sinalização.
'''
write(parity_path, parity)

# Strengthen invariant test so the regression cannot silently return.
test_path = 'test/zapo-provider.integration.test.mjs'
test_text = read(test_path)
if "const voiceMedia = read('src/api/services/voice-media.service.ts');" not in test_text:
    test_text = test_text.replace(
        "const callRouter = read('src/api/routes/call.router.ts');",
        "const callRouter = read('src/api/routes/call.router.ts');\nconst instanceController = read('src/api/controllers/instance.controller.ts');\nconst voiceMedia = read('src/api/services/voice-media.service.ts');",
        1,
    )
    anchor = "assert(zapo.includes(\"rawRemoteJid.endsWith('@lid')\"), 'Zapo LID-to-PN canonicalization is missing');"
    additions = '''assert(zapo.includes("authMode: 'qrcode' | 'pairing-code'"), 'Zapo auth mode isolation is missing');
assert(zapo.includes('resetLinkingClient'), 'Zapo failed/stale linking client reset is missing');
assert(zapo.includes('ZAPO_PAIRING_DEVICE_OS'), 'Zapo canonical pairing identity is missing');
assert(instanceController.includes('authenticationQueues'), 'Per-instance authentication serialization is missing');
assert(instanceController.includes('normalizeQrCode'), 'Provider-neutral QR normalization is missing');
assert(voiceMedia.includes("VOICE_MEDIA_PATH = '/voice/media'"), 'Dedicated voice media gateway is missing');
assert(voiceMedia.includes('feedLiveAudio'), 'Voice media browser-to-provider bridge is missing');'''
    test_text = test_text.replace(anchor, anchor + '\n' + additions, 1)
write(test_path, test_text)

print('WhatsApp authentication, Zapo lifecycle, chat viewport and softphone media repair applied')
