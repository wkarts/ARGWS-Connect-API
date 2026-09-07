from pathlib import Path
import re

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(path, old, new):
    text = read(path)
    if old not in text:
        raise RuntimeError(f'Expected block not found in {path}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


def replace_regex(path, pattern, replacement):
    text = read(path)
    new, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'Expected regex block not found exactly once in {path}: {pattern[:120]!r} ({count})')
    write(path, new)


def append_once(path, marker, content):
    text = read(path)
    if marker in text:
        return
    write(path, text.rstrip() + '\n\n' + content.rstrip() + '\n')


# ---------------------------------------------------------------------------
# 1. Authentication orchestration: one operation per instance, never QR+pair
#    concurrently. Different instances remain fully independent.
# ---------------------------------------------------------------------------
instance_path = 'src/api/controllers/instance.controller.ts'
replace_once(
    instance_path,
    "  private readonly logger = new Logger('InstanceController');\n  private readonly qrCodeRequests = new Map<string, Promise<wa.QrCode>>();\n  private readonly pairingCodeRequests = new Map<string, Promise<wa.QrCode>>();",
    "  private readonly logger = new Logger('InstanceController');\n  private readonly authenticationRequests = new Map<\n    string,\n    { mode: 'qr' | 'pairing'; promise: Promise<wa.QrCode> }\n  >();",
)

replace_once(
    instance_path,
    "    return normalized;\n  }\n\n  private async waitForQrCode(instance: any, pairingCodeRequested: boolean): Promise<wa.QrCode> {",
    "    return normalized;\n  }\n\n  private authenticationKey(instance: any): string {\n    return String(instance.instanceId || instance.instanceName || instance.instance?.name);\n  }\n\n  private async runAuthenticationRequest(\n    instance: any,\n    mode: 'qr' | 'pairing',\n    operation: () => Promise<wa.QrCode>,\n  ): Promise<wa.QrCode> {\n    const requestKey = this.authenticationKey(instance);\n    const running = this.authenticationRequests.get(requestKey);\n\n    if (running) {\n      if (running.mode === mode) return running.promise;\n      throw new BadRequestException(\n        'Another WhatsApp authentication request is already in progress for this instance. Try again when it finishes.',\n      );\n    }\n\n    const promise = operation();\n    this.authenticationRequests.set(requestKey, { mode, promise });\n    try {\n      return await promise;\n    } finally {\n      if (this.authenticationRequests.get(requestKey)?.promise === promise) {\n        this.authenticationRequests.delete(requestKey);\n      }\n    }\n  }\n\n  private async waitForQrCode(instance: any, pairingCodeRequested: boolean): Promise<wa.QrCode> {",
)

replace_once(
    instance_path,
    "      if (pairingCodeRequested ? qrCode?.pairingCode : qrCode?.code || qrCode?.base64) {",
    "      if (pairingCodeRequested ? qrCode?.pairingCode : qrCode?.base64) {",
)
replace_once(
    instance_path,
    "    if (!pairingCodeRequested && !qrCode?.code && !qrCode?.base64) {",
    "    if (!pairingCodeRequested && !qrCode?.base64) {",
)

replace_regex(
    instance_path,
    r"  private async requestExplicitQrCode\(instance: any\): Promise<wa\.QrCode> \{.*?\n  private async requestExplicitPairingCode",
    """  private async requestExplicitQrCode(instance: any): Promise<wa.QrCode> {
    return this.runAuthenticationRequest(instance, 'qr', async () => {
      if (!('prepareQrConnection' in instance) || typeof instance.prepareQrConnection !== 'function') {
        throw new BadRequestException('QR connection is not available for the selected WhatsApp provider');
      }

      await instance.prepareQrConnection();
      return await this.waitForQrCode(instance, false);
    });
  }

  private async requestExplicitPairingCode""",
)

replace_regex(
    instance_path,
    r"  private async requestExplicitPairingCode\(instance: any, number: string\): Promise<wa\.QrCode> \{.*?\n  public async createInstance",
    """  private async requestExplicitPairingCode(instance: any, number: string): Promise<wa.QrCode> {
    return this.runAuthenticationRequest(instance, 'pairing', async () => {
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

      // Baileys must receive its pair-device QR challenge before requestPairingCode.
      // Zapo owns a different handshake and waits for auth_pairing_required internally.
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

      if (typeof instance.setPairingCode === 'function') instance.setPairingCode(pairingCode);

      const maskedNumber = `${'*'.repeat(Math.max(0, number.length - 4))}${number.slice(-4)}`;
      this.logger.info(`Explicit pairing code generated for ${maskedNumber}`);
      return { ...qrCode, pairingCode };
    });
  }

  public async createInstance""",
)


# ---------------------------------------------------------------------------
# 2. Zapo provider parity: stable pairing readiness, profile identity, LID/PN
#    canonicalization, status separation and human call peers.
# ---------------------------------------------------------------------------
zapo_path = 'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts'
replace_once(
    zapo_path,
    "  private pairingReady = false;\n  private lidReconciliationDone = false;\n  private readonly outgoingCallPeers = new Map<string, string>();",
    "  private pairingReady = false;\n  private lidReconciliationDone = false;\n  private profileRefreshPromise: Promise<void> | null = null;\n  private readonly lidToPhoneJid = new Map<string, string>();\n  private readonly outgoingCallPeers = new Map<string, string>();",
)

replace_once(
    zapo_path,
    "  public async profilePicture(number: string) {\n    const jid = createJid(number);\n    const result = await this.client.profile.getProfilePicture(jid, 'image').catch(() => ({}));\n    return { wuid: jid, profilePictureUrl: result?.url ?? null };\n  }",
    """  public async profilePicture(number: string) {
    const jid = this.normalizeProfileJid(number);
    if (!jid || this.stateConnection.state !== 'open') {
      return { wuid: jid, profilePictureUrl: null };
    }

    const result = await this.client.profile.getProfilePicture(jid, 'image').catch(() => ({}));
    return { wuid: jid, profilePictureUrl: result?.url ?? null };
  }""",
)

replace_once(
    zapo_path,
    "    this.client.on('auth_qr', ({ qr }: any) => {\n      void this.handleQr(qr);\n      this.markPairingReady();\n    });",
    "    this.client.on('auth_qr', ({ qr }: any) => {\n      void this.handleQr(qr);\n    });",
)

replace_once(
    zapo_path,
    "      this.instance.profileName = credentials.meDisplayName ?? this.instance.profileName;\n      if (state === 'open') {\n        await this.refreshOwnProfilePicture(credentials);\n      }\n    }\n\n    await this.persistConnectionState(state);",
    "      this.instance.profileName = credentials.meDisplayName ?? this.instance.profileName;\n    }\n\n    // Connection state must never wait for optional profile-picture IQs.\n    await this.persistConnectionState(state);",
)

replace_once(
    zapo_path,
    "    if (state === 'open') {\n      this.instance.qrcode = { count: 0 };\n      void this.reconcileStoredLidAliases().catch((error: Error) => this.logger.error(error));\n      return;\n    }",
    """    if (state === 'open') {
      this.instance.qrcode = { count: 0 };
      void this.refreshOwnProfilePicture(credentials)
        .then(() => this.persistConnectionState('open'))
        .catch((error: Error) => this.logger.error(error));
      void this.reconcileStoredLidAliases().catch((error: Error) => this.logger.error(error));
      return;
    }""",
)

# Insert canonical JID helpers before the inbound message handler.
replace_once(
    zapo_path,
    "  private async handleIncomingMessage(event: any) {",
    """  private bareJid(value?: string | null): string {
    return String(value || '').trim().replace(/:\\d+(?=@)/, '');
  }

  private isPhoneJid(value?: string | null): boolean {
    const jid = this.bareJid(value);
    return /^\\d+@s\\.whatsapp\\.net$/.test(jid);
  }

  private rememberLidAlias(primary?: string | null, alternate?: string | null) {
    const first = this.bareJid(primary);
    const second = this.bareJid(alternate);
    if (first.endsWith('@lid') && this.isPhoneJid(second)) this.lidToPhoneJid.set(first, second);
    if (second.endsWith('@lid') && this.isPhoneJid(first)) this.lidToPhoneJid.set(second, first);
  }

  private canonicalUserJid(primary?: string | null, alternate?: string | null): string {
    const first = this.bareJid(primary);
    const second = this.bareJid(alternate);
    if (!first) return first;
    if (!first.endsWith('@lid')) return first;
    if (this.isPhoneJid(second)) return second;
    return this.lidToPhoneJid.get(first) || first;
  }

  private async handleIncomingMessage(event: any) {""",
)

replace_once(
    zapo_path,
    """    const rawRemoteJid = String(event.key.remoteJid);
    const remoteJidAlt = event.key.remoteJidAlt ? String(event.key.remoteJidAlt) : undefined;
    const canonicalRemoteJid =
      rawRemoteJid.endsWith('@lid') && remoteJidAlt && !remoteJidAlt.endsWith('@lid') ? remoteJidAlt : rawRemoteJid;
    const rawParticipant = event.key.participant ? String(event.key.participant) : undefined;
    const participantAlt = event.key.participantAlt ? String(event.key.participantAlt) : undefined;
    const canonicalParticipant =
      rawParticipant?.endsWith('@lid') && participantAlt && !participantAlt.endsWith('@lid')
        ? participantAlt
        : rawParticipant;
""",
    """    const rawRemoteJid = this.bareJid(event.key.remoteJid);
    const eventRemoteJidAlt = event.key.remoteJidAlt ? this.bareJid(event.key.remoteJidAlt) : undefined;
    this.rememberLidAlias(rawRemoteJid, eventRemoteJidAlt);
    const canonicalRemoteJid = this.canonicalUserJid(rawRemoteJid, eventRemoteJidAlt);
    const remoteJidAlt = rawRemoteJid !== canonicalRemoteJid ? rawRemoteJid : eventRemoteJidAlt;

    const rawParticipant = event.key.participant ? this.bareJid(event.key.participant) : undefined;
    const eventParticipantAlt = event.key.participantAlt ? this.bareJid(event.key.participantAlt) : undefined;
    this.rememberLidAlias(rawParticipant, eventParticipantAlt);
    const canonicalParticipant = rawParticipant
      ? this.canonicalUserJid(rawParticipant, eventParticipantAlt)
      : undefined;
    const participantAlt =
      rawParticipant && canonicalParticipant && rawParticipant !== canonicalParticipant
        ? rawParticipant
        : eventParticipantAlt;
""",
)

replace_once(
    zapo_path,
    "    const isStatusMessage = canonicalRemoteJid === 'status@broadcast' || event.key.isBroadcast === true;",
    "    const isStatusMessage = canonicalRemoteJid === 'status@broadcast' || rawRemoteJid === 'status@broadcast';",
)

replace_once(
    zapo_path,
    "      if (remoteJid.endsWith('@lid') && remoteJidAlt && !remoteJidAlt.endsWith('@lid')) {\n        aliases.set(remoteJid, remoteJidAlt);\n      } else if (remoteJidAlt.endsWith('@lid') && remoteJid && !remoteJid.endsWith('@lid')) {\n        aliases.set(remoteJidAlt, remoteJid);\n      }",
    """      if (remoteJid.endsWith('@lid') && this.isPhoneJid(remoteJidAlt)) {
        aliases.set(remoteJid, this.bareJid(remoteJidAlt));
        this.rememberLidAlias(remoteJid, remoteJidAlt);
      } else if (remoteJidAlt.endsWith('@lid') && this.isPhoneJid(remoteJid)) {
        aliases.set(remoteJidAlt, this.bareJid(remoteJid));
        this.rememberLidAlias(remoteJid, remoteJidAlt);
      }""",
)

replace_regex(
    zapo_path,
    r"  private async refreshOwnProfilePicture\(credentials: any\) \{.*?\n  private async reconcileStoredLidAliases",
    """  private normalizeProfileJid(value?: string | null): string | null {
    const raw = this.bareJid(value);
    if (!raw || raw === '@s.whatsapp.net' || raw === '@lid') return null;

    if (raw.includes('@')) {
      const [user, server] = raw.split('@');
      if (!user || !server) return null;
      if (server === 's.whatsapp.net' && !/^\\d+$/.test(user)) return null;
      if (server === 'lid' && !/^\\d+$/.test(user)) return null;
      return `${user}@${server}`;
    }

    const digits = raw.replace(/\\D/g, '');
    return digits ? createJid(digits) : null;
  }

  private async refreshOwnProfilePicture(credentials: any) {
    if (this.profileRefreshPromise) return this.profileRefreshPromise;

    const operation = (async () => {
      const candidates = [credentials?.meJid, this.instance.ownerJid, credentials?.meLid]
        .map((value) => this.normalizeProfileJid(value))
        .filter((value): value is string => Boolean(value));

      for (const jid of [...new Set(candidates)]) {
        const picture = await this.client.profile.getProfilePicture(jid, 'image').catch(() => null);
        if (picture?.url) {
          this.instance.profilePictureUrl = picture.url;
          return;
        }
      }
    })();

    this.profileRefreshPromise = operation;
    try {
      await operation;
    } finally {
      if (this.profileRefreshPromise === operation) this.profileRefreshPromise = null;
    }
  }

  private async reconcileStoredLidAliases""",
)

replace_regex(
    zapo_path,
    r"  private normalizeCall\(call: any\) \{.*?\n  private ensureVoip",
    """  private normalizeCall(call: any) {
    if (!call) return null;
    const rawPeerJid = this.bareJid(call.peerJid);
    const callerPhoneJid = this.normalizeProfileJid(call.callerPn);
    const mappedPhoneJid = rawPeerJid.endsWith('@lid') ? this.lidToPhoneJid.get(rawPeerJid) : undefined;
    const requestedPeerJid = this.outgoingCallPeers.get(call.callId);
    const displayPeerJid = callerPhoneJid || requestedPeerJid || mappedPhoneJid || rawPeerJid;

    return this.toJson({
      callId: call.callId,
      peerJid: displayPeerJid,
      peerJidAlt: rawPeerJid !== displayPeerJid ? rawPeerJid : undefined,
      peerJidRaw: rawPeerJid,
      callerPn: call.callerPn,
      isVideo: call.isVideo,
      direction: call.direction,
      state: call.stateData?.state ?? call.state,
      stateData: call.stateData,
      muted: Boolean(call.stateData?.audioMuted),
      canAccept: call.canAccept,
      canReject: call.canReject,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
    });
  }

  private ensureVoip""",
)

replace_once(
    zapo_path,
    "    this.client.on('voip_call_ended', (call: any) => {\n      this.emitCall('ended', call);\n    });",
    "    this.client.on('voip_call_ended', (call: any) => {\n      this.emitCall('ended', call);\n      if (call?.callId) this.outgoingCallPeers.delete(call.callId);\n    });",
)


# ---------------------------------------------------------------------------
# 3. Manager authentication rendering: QR modal only receives a finished image.
# ---------------------------------------------------------------------------
dashboard_path = 'manager/src/pages/dashboard.js'
replace_once(
    dashboard_path,
    "    const code = data?.base64 || data?.qrcode?.base64 || data?.code || data?.qrcode?.code;",
    "    const code = data?.base64 || data?.qrcode?.base64;",
)
replace_once(
    dashboard_path,
    "    const code = data?.base64 || data?.qrcode?.base64 || data?.code || data?.qrcode?.code || '';",
    "    const code = data?.base64 || data?.qrcode?.base64 || '';",
)


# ---------------------------------------------------------------------------
# 4. Generic badges keep technical values internal and CSS-safe.
# ---------------------------------------------------------------------------
dom_path = 'manager/src/core/dom.js'
replace_once(
    dom_path,
    "  const key = String(status || 'unknown').toLowerCase();\n  const connection = {",
    "  const rawKey = String(status || 'unknown').toLowerCase();\n  const key = rawKey.replace(/[^a-z0-9_-]+/g, '-');\n  const connection = {",
)
replace_once(
    dom_path,
    "  }[key];",
    "  }[rawKey];",
)


# ---------------------------------------------------------------------------
# 5. Real-time Voice Media Gateway. Audio is a dedicated media plane and never
#    goes through EventManager/RabbitMQ/Webhook/NATS/SQS.
# ---------------------------------------------------------------------------
voice_gateway = r'''import type { WAMonitoringService } from '@api/services/monitor.service';
import { Logger } from '@config/logger.config';
import { BadRequestException, NotFoundException } from '@exceptions';
import { randomBytes } from 'crypto';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import { URL } from 'url';
import { WebSocket, WebSocketServer } from 'ws';

type VoiceMediaGrant = {
  instanceName: string;
  callId: string;
  expiresAt: number;
};

type MediaCapableInstance = {
  listCalls?: () => Promise<any[]>;
  onInboundVoiceAudio?: (handler: (event: { call: any; pcm: Float32Array }) => void) => () => void;
  setExternalAudioMode?: (callId: string, enabled: boolean) => void;
  feedLiveAudio?: (callId: string, pcm: Float32Array) => unknown;
};

export class VoiceMediaGatewayService {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  private readonly logger = new Logger('VoiceMediaGateway');
  private readonly tickets = new Map<string, VoiceMediaGrant>();
  private wss: WebSocketServer | null = null;

  private get ticketTtlMs() {
    return Math.max(15_000, Number.parseInt(process.env.VOICE_MEDIA_TICKET_TTL_SECONDS || '60') * 1000);
  }

  private get maxBufferedBytes() {
    return Math.max(65_536, Number.parseInt(process.env.VOICE_MEDIA_MAX_BUFFERED_BYTES || '1048576'));
  }

  public async issueTicket(instanceName: string, callId: string) {
    const instance = this.mediaInstance(instanceName);
    if (!callId) throw new BadRequestException('callId is required');

    if (typeof instance.listCalls === 'function') {
      const calls = await instance.listCalls();
      if (!calls.some((call) => String(call?.callId || call?.id) === callId)) {
        throw new NotFoundException(`Call "${callId}" not found`);
      }
    }

    const ticket = randomBytes(32).toString('base64url');
    this.tickets.set(ticket, { instanceName, callId, expiresAt: Date.now() + this.ticketTtlMs });
    return {
      ticket,
      callId,
      path: '/voice/media',
      expiresIn: Math.floor(this.ticketTtlMs / 1000),
      sampleRate: 16000,
      channels: 1,
      format: 'float32le',
    };
  }

  public init(server: HttpServer | HttpsServer) {
    if (this.wss) return;
    this.wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

    server.on('upgrade', (request, socket, head) => {
      let url: URL;
      try {
        url = new URL(request.url || '/', 'http://localhost');
      } catch {
        return;
      }
      if (url.pathname !== '/voice/media') return;

      const grant = this.consumeTicket(url.searchParams.get('ticket'));
      if (!grant) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      this.wss?.handleUpgrade(request, socket, head, (ws) => this.bindSocket(ws, grant));
    });

    this.logger.info('Dedicated voice media WebSocket enabled at /voice/media');
  }

  private consumeTicket(ticket: string | null): VoiceMediaGrant | null {
    if (!ticket) return null;
    const grant = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!grant || grant.expiresAt < Date.now()) return null;
    return grant;
  }

  private mediaInstance(instanceName: string): MediaCapableInstance {
    const instance = this.waMonitor.waInstances[instanceName] as MediaCapableInstance | undefined;
    if (!instance) throw new NotFoundException(`Instance "${instanceName}" not found`);
    if (
      typeof instance.onInboundVoiceAudio !== 'function' ||
      typeof instance.setExternalAudioMode !== 'function' ||
      typeof instance.feedLiveAudio !== 'function'
    ) {
      throw new BadRequestException('The selected provider does not expose a live audio media channel');
    }
    return instance;
  }

  private bindSocket(ws: WebSocket, grant: VoiceMediaGrant) {
    let instance: MediaCapableInstance;
    try {
      instance = this.mediaInstance(grant.instanceName);
      instance.setExternalAudioMode?.(grant.callId, true);
    } catch (error) {
      ws.close(1008, error instanceof Error ? error.message : 'Voice media unavailable');
      return;
    }

    let closed = false;
    const unsubscribe = instance.onInboundVoiceAudio?.(({ call, pcm }) => {
      if (String(call?.callId || call?.id) !== grant.callId) return;
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > this.maxBufferedBytes) return;
      const bytes = Buffer.from(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
      ws.send(bytes, { binary: true });
    });

    const cleanup = () => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      try {
        instance.setExternalAudioMode?.(grant.callId, false);
      } catch (error) {
        this.logger.warn(`Unable to disable external audio mode for ${grant.callId}: ${String(error)}`);
      }
    };

    ws.on('message', (data, isBinary) => {
      if (!isBinary) return;
      const payload = Buffer.isBuffer(data)
        ? data
        : Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.from(data as ArrayBuffer);
      if (!payload.length || payload.length % 4 !== 0 || payload.length > 256_000) return;

      const copy = Uint8Array.from(payload);
      const pcm = new Float32Array(copy.buffer);
      instance.feedLiveAudio?.(grant.callId, pcm);
    });
    ws.on('close', cleanup);
    ws.on('error', cleanup);
  }
}
'''
write('src/api/services/voice-media-gateway.service.ts', voice_gateway)

# Call controller gains one-time media tickets.
call_controller = 'src/api/controllers/call.controller.ts'
replace_once(
    call_controller,
    "import { WAMonitoringService } from '@api/services/monitor.service';",
    "import { WAMonitoringService } from '@api/services/monitor.service';\nimport type { VoiceMediaGatewayService } from '@api/services/voice-media-gateway.service';",
)
replace_once(
    call_controller,
    "export class CallController {\n  constructor(private readonly waMonitor: WAMonitoringService) {}",
    "export class CallController {\n  constructor(\n    private readonly waMonitor: WAMonitoringService,\n    private readonly voiceMediaGateway: VoiceMediaGatewayService,\n  ) {}",
)
replace_once(
    call_controller,
    "  public async listCalls({ instanceName }: InstanceDto) {",
    "  public async mediaTicket({ instanceName }: InstanceDto, data: CallIdDto) {\n    return await this.voiceMediaGateway.issueTicket(instanceName, data.callId);\n  }\n\n  public async listCalls({ instanceName }: InstanceDto) {",
)

call_router = 'src/api/routes/call.router.ts'
replace_once(
    call_router,
    "    this.router.get(this.routerPath('list'), ...guards, async (req, res) => {",
    """    this.router.post(this.routerPath('media-ticket'), ...guards, async (req, res) => {
      const response = await this.dataValidate<CallIdDto>({
        request: req,
        schema: callIdSchema,
        ClassRef: CallIdDto,
        execute: (instance, data) => callController.mediaTicket(instance, data),
      });
      return res.status(HttpStatus.CREATED).json(response);
    });

    this.router.get(this.routerPath('list'), ...guards, async (req, res) => {""",
)

server_module = 'src/api/server.module.ts'
replace_once(
    server_module,
    "import { TemplateService } from './services/template.service';",
    "import { TemplateService } from './services/template.service';\nimport { VoiceMediaGatewayService } from './services/voice-media-gateway.service';",
)
replace_once(
    server_module,
    "export const sendMessageController = new SendMessageController(waMonitor);\nexport const callController = new CallController(waMonitor);",
    "export const voiceMediaGateway = new VoiceMediaGatewayService(waMonitor);\nexport const sendMessageController = new SendMessageController(waMonitor);\nexport const callController = new CallController(waMonitor, voiceMediaGateway);",
)

main_path = 'src/main.ts'
replace_once(
    main_path,
    "import { eventManager, waMonitor } from '@api/server.module';",
    "import { eventManager, voiceMediaGateway, waMonitor } from '@api/server.module';",
)
replace_once(
    main_path,
    "  eventManager.init(server);\n\n  server.listen",
    "  eventManager.init(server);\n  voiceMediaGateway.init(server);\n\n  server.listen",
)

# Manager API gets one-time ticket support.
manager_calls = 'manager/src/api/calls.js'
append_once(
    manager_calls,
    'createMediaTicket',
    """export const createMediaTicket = (session, instance, callId) =>
  request(
    session,
    `/call/media-ticket/${encodeURIComponent(nameOf(instance))}`,
    { method: 'POST', data: { callId } },
    instance.token,
  );""",
)

# Browser AudioWorklet: batches microphone audio before forwarding to the media WS.
worklet = r'''class ConnectApiCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.frames = 0;
    this.targetFrames = Math.max(512, Math.round(sampleRate * 0.06));
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input?.length) return true;
    this.chunks.push(input.slice());
    this.frames += input.length;
    if (this.frames < this.targetFrames) return true;

    const merged = new Float32Array(this.frames);
    let offset = 0;
    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.port.postMessage(merged, [merged.buffer]);
    this.chunks = [];
    this.frames = 0;
    return true;
  }
}

registerProcessor('connectapi-capture', ConnectApiCaptureProcessor);
'''
write('manager/public/softphone-capture.worklet.js', worklet)

# Fully functional audio Softphone page.
voip_page = r'''import { alertBox, badge, button, card, el, field, input, spinner } from '../core/dom.js';
import {
  acceptCall,
  createMediaTicket,
  endCall,
  listCalls,
  muteCall,
  offerCall,
  rejectCall,
} from '../api/calls.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

function peer(call) {
  const value = call?.displayPeerJid || call?.peerJidAlt || call?.callerPn || call?.peerJid || call?.peer || '';
  return String(value).replace(/@.+$/, '') || 'Desconhecido';
}

function callState(call) {
  return String(call?.state || call?.stateData?.state || 'unknown').toLowerCase();
}

function stateLabel(state) {
  return {
    initiating: 'Iniciando',
    ringing: 'Chamando',
    incoming_ringing: 'Recebendo chamada',
    connecting: 'Conectando mídia',
    active: 'Em chamada',
    on_hold: 'Em espera',
    ended: 'Encerrada',
  }[state] || state || 'Desconhecido';
}

function mediaSocketUrl(session, ticket) {
  const url = new URL('/voice/media', session.apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket);
  return url.toString();
}

function downsampleTo16k(input, sourceRate) {
  if (!(input instanceof Float32Array) || !input.length) return new Float32Array();
  if (sourceRate === 16000) return input;
  const ratio = sourceRate / 16000;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor];
    output[i] = sum / Math.max(1, end - start);
  }
  return output;
}

export function renderVoip(instance) {
  const session = loadSession();
  const page = el('div', { class: 'page softphone-page' });
  const feedback = el('div');
  const status = el('div', { class: 'voip-status' }, spinner());
  const callsPanel = el('div', { class: 'softphone-call-list' });
  const number = input('', { type: 'tel', inputmode: 'numeric', placeholder: '5575999999999' });
  const mediaState = el('strong', { text: 'Áudio desconectado' });
  let polling;
  let loading = false;
  let media = null;
  let calls = [];

  function cleanupMedia({ closeSocket = true } = {}) {
    const current = media;
    media = null;
    if (!current) return;
    current.captureNode?.disconnect?.();
    current.sourceNode?.disconnect?.();
    current.silentGain?.disconnect?.();
    current.stream?.getTracks?.().forEach((track) => track.stop());
    if (closeSocket && current.ws?.readyState <= WebSocket.OPEN) current.ws.close();
    current.context?.close?.().catch(() => undefined);
    mediaState.textContent = 'Áudio desconectado';
  }

  function playInbound(context, current, pcm) {
    if (!pcm.length) return;
    const buffer = context.createBuffer(1, pcm.length, 16000);
    buffer.copyToChannel(pcm, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const startAt = Math.max(context.currentTime + 0.03, current.nextPlaybackAt || 0);
    source.start(startAt);
    current.nextPlaybackAt = startAt + buffer.duration;
  }

  async function connectAudio(callId) {
    cleanupMedia();
    feedback.replaceChildren();
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) {
      throw new Error('Este navegador não oferece os recursos de áudio necessários para o Softphone.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const context = new AudioContext({ latencyHint: 'interactive' });
    await context.resume();
    await context.audioWorklet.addModule('/manager/softphone-capture.worklet.js');

    const ticketData = await createMediaTicket(session, instance, callId);
    const ws = new WebSocket(mediaSocketUrl(session, ticketData.ticket));
    ws.binaryType = 'arraybuffer';
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Tempo esgotado ao abrir o canal de áudio.')), 15000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Não foi possível abrir o canal de áudio do Softphone.'));
      };
    });

    const sourceNode = context.createMediaStreamSource(stream);
    const captureNode = new AudioWorkletNode(context, 'connectapi-capture');
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    sourceNode.connect(captureNode);
    captureNode.connect(silentGain);
    silentGain.connect(context.destination);

    const current = {
      callId,
      ws,
      context,
      stream,
      sourceNode,
      captureNode,
      silentGain,
      muted: false,
      nextPlaybackAt: context.currentTime,
    };
    media = current;
    mediaState.textContent = 'Áudio conectado';

    captureNode.port.onmessage = (event) => {
      if (media !== current || current.muted || ws.readyState !== WebSocket.OPEN) return;
      const pcm = downsampleTo16k(event.data, context.sampleRate);
      if (pcm.length) ws.send(pcm.buffer);
    };
    ws.onmessage = (event) => {
      if (media !== current || !(event.data instanceof ArrayBuffer)) return;
      playInbound(context, current, new Float32Array(event.data));
    };
    ws.onclose = () => {
      if (media === current) cleanupMedia({ closeSocket: false });
    };
  }

  async function act(action, call, value) {
    const callId = String(call?.callId || call?.id || '');
    if (!callId) return;
    feedback.replaceChildren();
    try {
      if (action === 'accept') {
        await acceptCall(session, instance, callId);
        await connectAudio(callId);
      }
      if (action === 'reject') await rejectCall(session, instance, callId);
      if (action === 'end') {
        if (media?.callId === callId) cleanupMedia();
        await endCall(session, instance, callId);
      }
      if (action === 'audio') await connectAudio(callId);
      if (action === 'mute') {
        const muted = Boolean(value);
        await muteCall(session, instance, callId, muted);
        if (media?.callId === callId) {
          media.muted = muted;
          media.stream.getAudioTracks().forEach((track) => (track.enabled = !muted));
        }
      }
      await reload({ silent: true });
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  function drawCalls() {
    callsPanel.replaceChildren();
    const visible = calls.filter((call) => callState(call) !== 'ended');
    if (!visible.length) {
      callsPanel.append(
        el(
          'div',
          { class: 'empty small' },
          el('strong', { text: 'Nenhuma chamada ativa' }),
          el('span', { text: 'Faça ou receba uma chamada para usar o Softphone.' }),
        ),
      );
      return;
    }

    for (const call of visible) {
      const callId = call.callId || call.id;
      const state = callState(call);
      const muted = media?.callId === callId ? media.muted : Boolean(call.muted ?? call.stateData?.audioMuted);
      const actions = [];
      if (call.canAccept) actions.push(button('Atender e conectar áudio', { class: 'primary', onclick: () => act('accept', call) }));
      if (call.canReject) actions.push(button('Recusar', { class: 'danger', onclick: () => act('reject', call) }));
      if (!call.canAccept && media?.callId !== callId) {
        actions.push(button('Conectar áudio', { class: 'primary', onclick: () => act('audio', call) }));
      }
      if (media?.callId === callId) {
        actions.push(button(muted ? 'Ativar microfone' : 'Silenciar', { onclick: () => act('mute', call, !muted) }));
      }
      actions.push(button('Encerrar', { class: 'danger', onclick: () => act('end', call) }));

      callsPanel.append(
        card(
          el(
            'div',
            { class: 'softphone-call-row' },
            el(
              'div',
              { class: 'softphone-peer' },
              el('span', { class: 'call-icon', text: call.direction === 'incoming' ? '↙' : '↗' }),
              el('div', {}, el('strong', { text: peer(call) }), el('small', { text: stateLabel(state) })),
            ),
            el('div', { class: 'actions' }, ...actions),
          ),
        ),
      );
    }
  }

  async function reload({ silent = false } = {}) {
    if (loading) return;
    loading = true;
    try {
      const result = await listCalls(session, instance);
      calls = Array.isArray(result) ? result : result?.calls || [];
      const active = calls.filter((call) => callState(call) !== 'ended').length;
      status.replaceChildren(
        card(el('span', { class: 'muted', text: 'Canal de voz' }), el('strong', { text: 'WhatsApp / Zapo' })),
        card(el('span', { class: 'muted', text: 'Instância' }), badge(instance.connectionStatus)),
        card(el('span', { class: 'muted', text: 'Chamadas ativas' }), el('strong', { text: String(active) })),
        card(el('span', { class: 'muted', text: 'Mídia do navegador' }), mediaState),
      );
      drawCalls();
    } catch (error) {
      if (!silent) callsPanel.replaceChildren(alertBox(error.message || String(error)));
    } finally {
      loading = false;
    }
  }

  const dialer = el(
    'form',
    { class: 'call-dialer softphone-dialer' },
    field('Número', number),
    button('Ligar', { class: 'primary', type: 'submit' }),
  );
  dialer.onsubmit = async (event) => {
    event.preventDefault();
    const target = number.value.replace(/\\D/g, '');
    if (!target) return;
    feedback.replaceChildren();
    try {
      const call = await offerCall(session, instance, target);
      number.value = '';
      await reload({ silent: true });
      const callId = call?.callId || call?.id;
      if (callId) await connectAudio(callId);
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  };

  page.append(
    pageHeader('VoIP', 'Softphone web/PWA para as chamadas da instância.', [button('Atualizar', { onclick: reload })]),
    feedback,
    el(
      'section',
      { class: 'softphone-console' },
      el(
        'div',
        { class: 'softphone-console-head' },
        el('div', {}, el('h2', { text: 'Connect|API Softphone' }), el('p', { class: 'muted', text: 'Áudio bidirecional em tempo real pelo canal de mídia dedicado.' })),
        el('span', { class: 'softphone-video-note', text: 'Vídeo indisponível neste provider' }),
      ),
      dialer,
      callsPanel,
    ),
    status,
  );

  void reload();
  polling = setInterval(() => {
    if (!document.body.contains(page)) {
      clearInterval(polling);
      cleanupMedia();
      return;
    }
    void reload({ silent: true });
  }, 2000);
  return instanceShell(instance, 'voip', page);
}
'''
write('manager/src/pages/voip.js', voip_page)

# Softphone visual system + better isolated scrolling.
append_once(
    'manager/src/styles/app.css',
    'softphone-media-v1',
    r'''/* softphone-media-v1 */
.softphone-console{display:flex;flex-direction:column;gap:16px;padding:20px;border:1px solid var(--border);border-radius:16px;background:var(--surface);box-shadow:var(--shadow);margin-bottom:16px}.softphone-console-head{display:flex;align-items:center;justify-content:space-between;gap:16px}.softphone-console-head h2{margin-bottom:4px}.softphone-console-head p{margin:0}.softphone-video-note{font-size:12px;color:var(--muted);padding:6px 10px;border:1px solid var(--border);border-radius:999px}.softphone-call-list{display:flex;flex-direction:column;gap:10px}.softphone-call-row{display:flex;align-items:center;justify-content:space-between;gap:16px}.softphone-peer{display:flex;align-items:center;gap:12px}.softphone-peer>div{display:flex;flex-direction:column;gap:3px}.softphone-peer small{color:var(--muted)}.softphone-dialer{margin:0}.softphone-page .voip-status{margin-top:16px}
@media(max-width:900px){.softphone-console-head,.softphone-call-row{align-items:stretch;flex-direction:column}.softphone-call-row>.actions{width:100%}.softphone-call-row>.actions .btn{flex:1}}
''',
)

# ---------------------------------------------------------------------------
# 6. Static invariants and documentation: make regressions fail CI.
# ---------------------------------------------------------------------------
test_path = 'test/zapo-provider.integration.test.mjs'
append_once(
    test_path,
    'Voice media gateway invariants: OK',
    """
const instanceController = read('src/api/controllers/instance.controller.ts');
const voiceGateway = read('src/api/services/voice-media-gateway.service.ts');
const managerDashboard = read('manager/src/pages/dashboard.js');
const managerVoip = read('manager/src/pages/voip.js');

assert(instanceController.includes("authenticationRequests"), 'Per-instance authentication serialization is missing');
assert(instanceController.includes("qrCode?.base64"), 'QR requests must wait for rendered Base64 data');
assert(!zapo.includes("void this.handleQr(qr);\\n      this.markPairingReady();"), 'Zapo QR must not satisfy pairing readiness');
assert(zapo.includes("auth_pairing_required"), 'Zapo pairing must wait for auth_pairing_required');
assert(zapo.includes("lidToPhoneJid"), 'Zapo persistent LID/PN runtime alias map is missing');
assert(zapo.includes("normalizeProfileJid"), 'Zapo profile JID guard is missing');
assert(voiceGateway.includes("'/voice/media'"), 'Dedicated voice media WebSocket is missing');
assert(voiceGateway.includes('setExternalAudioMode'), 'Voice media gateway must enable external audio mode');
assert(voiceGateway.includes('feedLiveAudio'), 'Voice media gateway must feed browser microphone PCM into Zapo');
assert(managerDashboard.includes("data?.base64 || data?.qrcode?.base64"), 'Manager QR screen must require rendered Base64');
assert(managerVoip.includes('createMediaTicket'), 'Softphone must request a one-time media ticket');
assert(managerVoip.includes('AudioWorkletNode'), 'Softphone microphone pipeline must use AudioWorklet');
console.log('Voice media gateway invariants: OK');
""",
)

append_once(
    'docs/architecture/voice-softphone-pwa.md',
    '## Implementação atual',
    """
## Implementação atual

A primeira mídia web está implementada no próprio Connect|API:

- `POST /call/media-ticket/:instanceName` emite um ticket curto e de uso único, autenticado pelo token da instância.
- `WS /voice/media?ticket=...` é um canal binário dedicado de PCM Float32 mono 16 kHz.
- O navegador captura microfone via AudioWorklet, reamostra para 16 kHz e envia PCM ao Zapo por `feedLiveAudio`.
- O PCM recebido em `voip_call_inbound_audio` é enviado ao navegador e reproduzido por Web Audio.
- `setExternalAudioMode` só fica ativo durante uma sessão de mídia do Softphone.
- O canal não usa EventManager, RabbitMQ, Webhook, NATS ou SQS.
- O ticket é removido no primeiro uso e expira rapidamente.

O Softphone continua sendo a interface do Connect|API. Quando PBX Core/FreeSWITCH entrarem, o contrato visual não precisa ser substituído; muda-se o backend do Voice Core/Media Gateway.
""",
)

for env_path in ['.env.example', 'deploy/develop/env.example']:
    if (Path(env_path).exists():
        append_once(
            env_path,
            'VOICE_MEDIA_TICKET_TTL_SECONDS=',
            """# Dedicated browser softphone media (PCM never uses EventManager)
VOICE_MEDIA_TICKET_TTL_SECONDS=60
VOICE_MEDIA_MAX_BUFFERED_BYTES=1048576""",
        )

print('Pending WhatsApp/provider/softphone repairs applied.')
