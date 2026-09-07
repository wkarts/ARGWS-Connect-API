from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def path(name: str) -> Path:
    return ROOT / name


def read(name: str) -> str:
    return path(name).read_text(encoding='utf-8')


def write(name: str, content: str) -> None:
    p = path(name)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8', newline='\n')


def replace_once(name: str, old: str, new: str) -> None:
    text = read(name)
    if old not in text:
        raise RuntimeError(f'Expected block not found in {name}: {old[:120]!r}')
    write(name, text.replace(old, new, 1))


def regex_once(name: str, pattern: str, replacement: str) -> None:
    text = read(name)
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'Expected regex block not found exactly once in {name}: {pattern[:120]!r}; count={count}')
    write(name, new_text)


# -----------------------------------------------------------------------------
# Shared configuration: QR/auth timeout and device identity are provider-neutral.
# -----------------------------------------------------------------------------
replace_once(
    'src/config/env.config.ts',
    "export type QrCode = { LIMIT: number; COLOR: string };",
    "export type QrCode = { LIMIT: number; COLOR: string; AUTH_TIMEOUT_MS: number };",
)
replace_once(
    'src/config/env.config.ts',
    "      QRCODE: {\n        LIMIT: Number.parseInt(process.env.QRCODE_LIMIT) || 30,\n        COLOR: process.env.QRCODE_COLOR || '#198754',\n      },",
    "      QRCODE: {\n        LIMIT: Number.parseInt(process.env.QRCODE_LIMIT) || 30,\n        COLOR: process.env.QRCODE_COLOR || '#198754',\n        AUTH_TIMEOUT_MS: Math.max(15000, Number.parseInt(process.env.WHATSAPP_AUTH_REQUEST_TIMEOUT_MS || '60000')),\n      },",
)

# -----------------------------------------------------------------------------
# InstanceController: one in-flight QR/pairing operation per instance.
# Provider internals remain provider-owned; the HTTP contract is stable/shared.
# -----------------------------------------------------------------------------
replace_once(
    'src/api/controllers/instance.controller.ts',
    "import { Auth, Chatwoot, ConfigService, HttpServer, WaBusiness } from '@config/env.config';",
    "import { Auth, Chatwoot, ConfigService, HttpServer, QrCode, WaBusiness } from '@config/env.config';",
)
replace_once(
    'src/api/controllers/instance.controller.ts',
    "  private readonly logger = new Logger('InstanceController');\n",
    "  private readonly logger = new Logger('InstanceController');\n  private readonly qrCodeRequests = new Map<string, Promise<wa.QrCode>>();\n  private readonly pairingCodeRequests = new Map<string, Promise<wa.QrCode>>();\n",
)
regex_once(
    'src/api/controllers/instance.controller.ts',
    r"  private async waitForQrCode\(instance: any, pairingCodeRequested: boolean\): Promise<wa\.QrCode> \{.*?\n  \}\n\n  private async requestExplicitPairingCode",
    """  private async waitForQrCode(instance: any, pairingCodeRequested: boolean): Promise<wa.QrCode> {
    const timeoutMs = this.configService.get<QrCode>('QRCODE').AUTH_TIMEOUT_MS;
    const startedAt = Date.now();

    do {
      const qrCode = instance.qrCode;
      if (pairingCodeRequested ? qrCode?.pairingCode : qrCode?.code || qrCode?.base64) {
        return qrCode;
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

    return qrCode;
  }

  private async requestExplicitQrCode(instance: any): Promise<wa.QrCode> {
    const requestKey = String(instance.instanceId || instance.instanceName || instance.instance?.name);
    const running = this.qrCodeRequests.get(requestKey);
    if (running) return running;

    const operation = (async () => {
      if (!('prepareQrConnection' in instance) || typeof instance.prepareQrConnection !== 'function') {
        throw new BadRequestException('QR connection is not available for the selected WhatsApp provider');
      }
      await instance.prepareQrConnection();
      return await this.waitForQrCode(instance, false);
    })();

    this.qrCodeRequests.set(requestKey, operation);
    try {
      return await operation;
    } finally {
      this.qrCodeRequests.delete(requestKey);
    }
  }

  private async requestExplicitPairingCode""",
)
regex_once(
    'src/api/controllers/instance.controller.ts',
    r"  private async requestExplicitPairingCode\(instance: any, number: string\): Promise<wa\.QrCode> \{.*?\n  \}\n\n  public async createInstance",
    """  private async requestExplicitPairingCode(instance: any, number: string): Promise<wa.QrCode> {
    const requestKey = `${String(instance.instanceId || instance.instanceName || instance.instance?.name)}:${number}`;
    const running = this.pairingCodeRequests.get(requestKey);
    if (running) return running;

    const operation = (async () => {
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

      // Baileys needs the pair-device challenge before requestPairingCode.
      // Zapo exposes an explicit auth_pairing_required readiness signal internally.
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
    })();

    this.pairingCodeRequests.set(requestKey, operation);
    try {
      return await operation;
    } finally {
      this.pairingCodeRequests.delete(requestKey);
    }
  }

  public async createInstance""",
)

controller = read('src/api/controllers/instance.controller.ts')
controller = controller.replace(
    """          } else {
            if (!('prepareQrConnection' in instance) || typeof instance.prepareQrConnection !== 'function') {
              throw new BadRequestException('QR connection is not available for the selected WhatsApp provider');
            }
            await instance.prepareQrConnection();
            getQrcode = await this.waitForQrCode(instance, false);
          }""",
    """          } else {
            getQrcode = await this.requestExplicitQrCode(instance);
          }""",
    1,
)
old_qr_connect = """        if (!('prepareQrConnection' in instance) || typeof instance.prepareQrConnection !== 'function') {
          throw new BadRequestException('QR connection is not available for the selected WhatsApp provider');
        }
        await instance.prepareQrConnection();
        return await this.waitForQrCode(instance, false);"""
if controller.count(old_qr_connect) != 2:
    raise RuntimeError(f'Expected two connect QR blocks; found {controller.count(old_qr_connect)}')
controller = controller.replace(old_qr_connect, "        return await this.requestExplicitQrCode(instance);", 2)
write('src/api/controllers/instance.controller.ts', controller)

# -----------------------------------------------------------------------------
# Baileys: keep its proven pairing fingerprint; improve own-profile photo fallback.
# Do not refactor the stable pairing implementation.
# -----------------------------------------------------------------------------
replace_once(
    'src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts',
    """  public async profilePicture(number: string) {
    const jid = createJid(number);

    try {
      const profilePictureUrl = await this.client.profilePictureUrl(jid, 'image');

      return { wuid: jid, profilePictureUrl };
    } catch {
      return { wuid: jid, profilePictureUrl: null };
    }
  }""",
    """  public async profilePicture(number: string) {
    const jid = createJid(number);

    try {
      const profilePictureUrl = await this.client.profilePictureUrl(jid, 'image');
      return { wuid: jid, profilePictureUrl };
    } catch {
      try {
        const profilePictureUrl = await this.client.profilePictureUrl(jid, 'preview');
        return { wuid: jid, profilePictureUrl };
      } catch {
        return { wuid: jid, profilePictureUrl: null };
      }
    }
  }""",
)

# -----------------------------------------------------------------------------
# Zapo: shared QR/device identity, latched pairing readiness, visible outgoing
# messages, Status/protocol separation, LID reconciliation and call peer aliases.
# -----------------------------------------------------------------------------
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    "import { Chatwoot, ConfigService, Database } from '@config/env.config';",
    "import { Chatwoot, ConfigService, ConfigSessionPhone, Database, QrCode } from '@config/env.config';",
)
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """  private connectPromise: Promise<void> | null = null;
  private pairingReadyPromise: Promise<void> | null = null;
  private resolvePairingReady: (() => void) | null = null;
  private readonly audioEmitter = new EventEmitter2();""",
    """  private connectPromise: Promise<void> | null = null;
  private pairingReadyPromise: Promise<void> | null = null;
  private resolvePairingReady: (() => void) | null = null;
  private pairingReady = false;
  private lidReconciliationDone = false;
  private readonly outgoingCallPeers = new Map<string, string>();
  private readonly audioEmitter = new EventEmitter2();""",
)
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """  public async preparePairingConnection(number: string) {
    const normalized = String(number || '').replace(/\D/g, '');
    if (!normalized) throw new BadRequestException('Pairing-code phone number is required');

    this.phoneNumber = normalized;
    this.instance.qrcode = { count: 0 };
    await this.loadRuntimeConfiguration();
    await this.ensureClient();
    this.resetPairingReady();
    this.startConnect();
    await this.waitPairingReady();
    return this.client;
  }""",
    """  public async preparePairingConnection(number: string) {
    const normalized = String(number || '').replace(/\D/g, '');
    if (!normalized) throw new BadRequestException('Pairing-code phone number is required');

    this.phoneNumber = normalized;
    this.instance.qrcode = { count: 0 };
    await this.loadRuntimeConfiguration();
    await this.ensureClient();
    if (!this.pairingReady && !this.pairingReadyPromise) this.resetPairingReady();
    this.startConnect();
    await this.waitPairingReady();
    return this.client;
  }""",
)
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """  public async textMessage(data: SendTextDto) {
    await this.ensureConnected();
    const jid = createJid(data.number);
    await this.applyDelay(data.delay);

    const contextInfo = this.buildContextInfo(data, jid);
    const result = await this.client.message.send(jid, {
      type: 'text',
      text: data.text,
      linkPreview: data.linkPreview,
      ...(contextInfo ? { contextInfo } : {}),
    });

    return { key: { id: result?.id, remoteJid: jid, fromMe: true }, message: { conversation: data.text } };
  }""",
    """  public async textMessage(data: SendTextDto) {
    await this.ensureConnected();
    const jid = createJid(data.number);
    await this.applyDelay(data.delay);

    const contextInfo = this.buildContextInfo(data, jid);
    const result = await this.client.message.send(jid, {
      type: 'text',
      text: data.text,
      linkPreview: data.linkPreview,
      ...(contextInfo ? { contextInfo } : {}),
    });

    return await this.persistOutgoingMessage(result?.id, jid, 'conversation', { conversation: data.text });
  }""",
)
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """    const result = await this.client.message.send(jid, content);
    return this.outgoingMessageResult(result?.id, jid, `${data.mediatype}Message`);
  }""",
    """    const result = await this.client.message.send(jid, content);
    const messageType = `${data.mediatype}Message`;
    return await this.persistOutgoingMessage(result?.id, jid, messageType, {
      [messageType]: {
        caption: data.caption,
        mimetype,
        fileName: data.fileName,
      },
    });
  }""",
)
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """    const jid = createJid(number);
    const callId = await this.client.voip.startCall({ peerJid: jid, isVideo: Boolean(isVideo) });

    if (callDuration && callDuration > 0) {""",
    """    const jid = createJid(number);
    const callId = await this.client.voip.startCall({ peerJid: jid, isVideo: Boolean(isVideo) });
    this.outgoingCallPeers.set(callId, jid);

    if (callDuration && callDuration > 0) {""",
)
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """  public async muteCall(callId: string, muted: boolean) {
    await this.ensureConnected();
    this.ensureVoip();
    this.client.voip.setMute(callId, muted);
    return { callId, muted };
  }""",
    """  public async muteCall(callId: string, muted: boolean) {
    await this.ensureConnected();
    this.ensureVoip();
    this.client.voip.setMute(callId, muted);
    return this.normalizeCall(this.client.voip.getCall(callId)) ?? { callId, muted };
  }""",
)

# Shared Zapo device identity: browser stays a valid browser; displayed OS/client
# name comes from the same Connect|API variables used by Baileys QR mode.
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """    const maxConcurrentCalls = Math.max(1, Number.parseInt(process.env.ZAPO_VOIP_MAX_CONCURRENT_CALLS || '4'));
    const plugins =
      process.env.ZAPO_VOIP_ENABLED === 'false' ? [] : [voipPlugin({ maxConcurrentCalls, logLevel: 'warn' })];

    this.client = new WaClient(
      {
        store: this.store,
        sessionId: this.instanceId,""",
    """    const maxConcurrentCalls = Math.max(1, Number.parseInt(process.env.ZAPO_VOIP_MAX_CONCURRENT_CALLS || '4'));
    const plugins =
      process.env.ZAPO_VOIP_ENABLED === 'false' ? [] : [voipPlugin({ maxConcurrentCalls, logLevel: 'warn' })];
    const session = this.configService.get<ConfigSessionPhone>('CONFIG_SESSION_PHONE');
    const deviceBrowser =
      process.env.WHATSAPP_PROTOCOL_BROWSER_NAME || process.env.ZAPO_DEVICE_BROWSER || session.NAME || 'Chrome';
    const deviceDisplayName =
      process.env.WHATSAPP_PROTOCOL_BROWSER_CLIENT || session.CLIENT || process.env.ZAPO_DEVICE_OS || 'Connect|API';

    this.pairingReady = false;
    this.pairingReadyPromise = null;
    this.resolvePairingReady = null;

    this.client = new WaClient(
      {
        store: this.store,
        sessionId: this.instanceId,""",
)
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """        deviceBrowser: process.env.ZAPO_DEVICE_BROWSER || 'Chrome',
        deviceOsDisplayName: process.env.ZAPO_DEVICE_OS || 'Linux',
        plugins,""",
    """        deviceBrowser,
        deviceOsDisplayName: deviceDisplayName,
        plugins,""",
)

# QR color parity with Baileys/env.
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """    const opts: QRCodeToDataURLOptions = {
      margin: 3,
      scale: 4,
      errorCorrectionLevel: 'H',
      color: { light: '#ffffff', dark: '#111111' },
    };""",
    """    const opts: QRCodeToDataURLOptions = {
      margin: 3,
      scale: 4,
      errorCorrectionLevel: 'H',
      color: { light: '#ffffff', dark: this.configService.get<QrCode>('QRCODE').COLOR },
    };""",
)

# Replace connection/profile section with robust own-picture refresh and LID cleanup trigger.
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """      this.instance.profileName = credentials.meDisplayName ?? this.instance.profileName;
      if (state === 'open') {
        const picture = await this.client.profile.getProfilePicture(credentials.meJid, 'image').catch(() => null);
        this.instance.profilePictureUrl = picture?.url ?? this.instance.profilePictureUrl;
      }
    }

    await this.persistConnectionState(state);""",
    """      this.instance.profileName = credentials.meDisplayName ?? this.instance.profileName;
      if (state === 'open') {
        await this.refreshOwnProfilePicture(credentials);
      }
    }

    await this.persistConnectionState(state);""",
)
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """    if (state === 'open') {
      this.instance.qrcode = { count: 0 };
      return;
    }""",
    """    if (state === 'open') {
      this.instance.qrcode = { count: 0 };
      void this.reconcileStoredLidAliases().catch((error: Error) => this.logger.error(error));
      return;
    }""",
)

# Replace incoming message handler so protocol/status messages never become chats.
regex_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    r"  private async handleIncomingMessage\(event: any\) \{.*?\n  \}\n\n  private async upsertContact",
    """  private async handleIncomingMessage(event: any) {
    if (!event?.message || !event?.key?.remoteJid) return;

    const rawRemoteJid = String(event.key.remoteJid);
    const remoteJidAlt = event.key.remoteJidAlt ? String(event.key.remoteJidAlt) : undefined;
    const canonicalRemoteJid =
      rawRemoteJid.endsWith('@lid') && remoteJidAlt && !remoteJidAlt.endsWith('@lid') ? remoteJidAlt : rawRemoteJid;
    const rawParticipant = event.key.participant ? String(event.key.participant) : undefined;
    const participantAlt = event.key.participantAlt ? String(event.key.participantAlt) : undefined;
    const canonicalParticipant =
      rawParticipant?.endsWith('@lid') && participantAlt && !participantAlt.endsWith('@lid')
        ? participantAlt
        : rawParticipant;

    const message = this.toJson(event.message);
    const messageType = this.detectMessageType(message);
    const isProtocolMessage = messageType === 'protocolMessage' || messageType === 'senderKeyDistributionMessage';
    const isStatusMessage = canonicalRemoteJid === 'status@broadcast' || event.key.isBroadcast === true;
    const messageRaw: any = {
      key: {
        id: event.key.id,
        remoteJid: canonicalRemoteJid,
        remoteJidAlt,
        fromMe: Boolean(event.key.fromMe),
        participant: canonicalParticipant,
        participantAlt,
      },
      pushName: event.pushName,
      participant: canonicalParticipant,
      messageType,
      message,
      messageTimestamp: Math.round(event.timestampSeconds || Date.now() / 1000),
      source: 'web',
      instanceId: this.instanceId,
    };

    const db = this.configService.get<Database>('DATABASE');
    if (db.SAVE_DATA.NEW_MESSAGE) {
      await this.prismaRepository.message
        .create({ data: messageRaw })
        .catch((error: Error) => this.logger.error(error));
    }

    // Protocol messages are useful for protocol state/debugging but are not user conversations.
    if (isProtocolMessage) return;

    this.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw);

    // Status is retained in Message for the dedicated Status view, never as a regular chat/contact.
    if (isStatusMessage) return;

    await chatbotController.emit({
      instance: { instanceName: this.instance.name, instanceId: this.instanceId },
      remoteJid: messageRaw.key.remoteJid,
      msg: messageRaw,
      pushName: messageRaw.pushName,
    });

    if (this.configService.get<Chatwoot>('CHATWOOT').ENABLED && this.localChatwoot?.enabled) {
      await this.chatwootService.eventWhatsapp(
        Events.MESSAGES_UPSERT,
        { instanceName: this.instance.name, instanceId: this.instanceId },
        messageRaw,
      );
    }

    if (db.SAVE_DATA.CONTACTS) {
      await this.upsertContact(messageRaw.key.remoteJid, messageRaw.pushName);
    }

    if (db.SAVE_DATA.CHATS) {
      await this.upsertChat(messageRaw.key.remoteJid, messageRaw.pushName);
    }

    if (rawRemoteJid !== canonicalRemoteJid) {
      await Promise.all([
        this.prismaRepository.chat.deleteMany({ where: { instanceId: this.instanceId, remoteJid: rawRemoteJid } }),
        this.prismaRepository.contact.deleteMany({ where: { instanceId: this.instanceId, remoteJid: rawRemoteJid } }),
      ]);
    }
  }

  private async upsertContact""",
)

# Insert outgoing persistence + profile + bounded LID reconciliation before call handling.
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """  private async upsertChat(remoteJid: string, name?: string) {
    await this.prismaRepository.chat.upsert({
      where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid } },
      update: { name },
      create: { remoteJid, name, instanceId: this.instanceId },
    });
    this.sendDataWebhook(Events.CHATS_UPSERT, { remoteJid, name, instanceId: this.instanceId });
  }

  private async handleIncomingCall(call: any) {""",
    """  private async upsertChat(remoteJid: string, name?: string) {
    await this.prismaRepository.chat.upsert({
      where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid } },
      update: { name },
      create: { remoteJid, name, instanceId: this.instanceId },
    });
    this.sendDataWebhook(Events.CHATS_UPSERT, { remoteJid, name, instanceId: this.instanceId });
  }

  private async persistOutgoingMessage(id: string | undefined, jid: string, messageType: string, message: any) {
    const messageRaw: any = {
      key: { id: id || `local-${Date.now()}`, remoteJid: jid, fromMe: true },
      pushName: this.instance.profileName,
      messageType,
      message,
      messageTimestamp: Math.round(Date.now() / 1000),
      source: 'web',
      instanceId: this.instanceId,
    };

    this.sendDataWebhook(Events.MESSAGES_UPSERT, messageRaw);
    const db = this.configService.get<Database>('DATABASE');
    if (db.SAVE_DATA.NEW_MESSAGE) {
      await this.prismaRepository.message
        .create({ data: messageRaw })
        .catch((error: Error) => this.logger.error(error));
    }
    if (db.SAVE_DATA.CHATS) await this.upsertChat(jid);
    return messageRaw;
  }

  private async refreshOwnProfilePicture(credentials: any) {
    const candidates = [credentials?.meJid, credentials?.meLid, this.instance.ownerJid].filter(Boolean);
    for (const jid of [...new Set(candidates.map(String))]) {
      for (const type of ['image', 'preview'] as const) {
        const picture = await this.client.profile.getProfilePicture(jid, type).catch(() => null);
        if (picture?.url) {
          this.instance.profilePictureUrl = picture.url;
          return;
        }
      }
    }
  }

  private async reconcileStoredLidAliases() {
    if (this.lidReconciliationDone) return;
    this.lidReconciliationDone = true;

    const rows = await this.prismaRepository.message.findMany({
      where: { instanceId: this.instanceId },
      orderBy: { messageTimestamp: 'desc' },
      take: 5000,
      select: { id: true, key: true },
    });
    const aliases = new Map<string, string>();

    for (const row of rows) {
      const key = row.key as any;
      const remoteJid = String(key?.remoteJid || '');
      const remoteJidAlt = String(key?.remoteJidAlt || '');
      if (remoteJid.endsWith('@lid') && remoteJidAlt && !remoteJidAlt.endsWith('@lid')) {
        aliases.set(remoteJid, remoteJidAlt);
      } else if (remoteJidAlt.endsWith('@lid') && remoteJid && !remoteJid.endsWith('@lid')) {
        aliases.set(remoteJidAlt, remoteJid);
      }
    }

    for (const [lidJid, phoneJid] of aliases) {
      const [lidContact, phoneContact, lidChat, phoneChat] = await Promise.all([
        this.prismaRepository.contact.findUnique({
          where: { remoteJid_instanceId: { remoteJid: lidJid, instanceId: this.instanceId } },
        }),
        this.prismaRepository.contact.findUnique({
          where: { remoteJid_instanceId: { remoteJid: phoneJid, instanceId: this.instanceId } },
        }),
        this.prismaRepository.chat.findUnique({
          where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: lidJid } },
        }),
        this.prismaRepository.chat.findUnique({
          where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: phoneJid } },
        }),
      ]);

      if (lidContact && !phoneContact) {
        await this.prismaRepository.contact.create({
          data: {
            remoteJid: phoneJid,
            pushName: lidContact.pushName,
            profilePicUrl: lidContact.profilePicUrl,
            instanceId: this.instanceId,
          },
        });
      }
      if (lidChat && !phoneChat) {
        await this.prismaRepository.chat.create({
          data: {
            remoteJid: phoneJid,
            name: lidChat.name,
            unreadMessages: lidChat.unreadMessages,
            instanceId: this.instanceId,
          },
        });
      }

      await Promise.all([
        this.prismaRepository.contact.deleteMany({ where: { instanceId: this.instanceId, remoteJid: lidJid } }),
        this.prismaRepository.chat.deleteMany({ where: { instanceId: this.instanceId, remoteJid: lidJid } }),
      ]);

      for (const row of rows) {
        const key = row.key as any;
        if (String(key?.remoteJid || '') !== lidJid) continue;
        await this.prismaRepository.message.update({
          where: { id: row.id },
          data: { key: { ...key, remoteJid: phoneJid, remoteJidAlt: lidJid } },
        });
      }
    }
  }

  private async handleIncomingCall(call: any) {""",
)

# Pairing readiness is latched; a QR event received before the user clicks pairing
# remains valid instead of creating a dead promise that times out.
replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """  private resetPairingReady() {
    this.pairingReadyPromise = new Promise<void>((resolve) => {
      this.resolvePairingReady = resolve;
    });
  }

  private markPairingReady() {
    this.resolvePairingReady?.();
    this.resolvePairingReady = null;
  }

  private async waitPairingReady() {
    if (!this.pairingReadyPromise) this.resetPairingReady();
    await Promise.race([
      this.pairingReadyPromise,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Zapo pairing readiness timeout')), 15_000)),
    ]);
  }""",
    """  private resetPairingReady() {
    this.pairingReady = false;
    this.pairingReadyPromise = new Promise<void>((resolve) => {
      this.resolvePairingReady = resolve;
    });
  }

  private markPairingReady() {
    this.pairingReady = true;
    this.resolvePairingReady?.();
    this.resolvePairingReady = null;
  }

  private async waitPairingReady() {
    if (this.pairingReady) return;
    if (!this.pairingReadyPromise) this.resetPairingReady();
    const timeoutMs = Math.max(15000, Number.parseInt(process.env.WHATSAPP_AUTH_REQUEST_TIMEOUT_MS || '60000'));
    await Promise.race([
      this.pairingReadyPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('Zapo pairing readiness timeout')), timeoutMs),
      ),
    ]);
  }""",
)

# Call normalization exposes the human/phone peer while retaining raw LID.
regex_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    r"  private normalizeCall\(call: any\) \{.*?\n  \}\n\n  private ensureVoip",
    """  private normalizeCall(call: any) {
    if (!call) return null;
    const rawPeerJid = call.peerJid;
    const displayPeerJid =
      (call.callerPn ? createJid(String(call.callerPn)) : undefined) ||
      this.outgoingCallPeers.get(call.callId) ||
      rawPeerJid;
    return this.toJson({
      callId: call.callId,
      peerJid: displayPeerJid,
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

# -----------------------------------------------------------------------------
# Manager: business-friendly connection state with LED.
# -----------------------------------------------------------------------------
replace_once(
    'manager/src/core/dom.js',
    "export const badge = (status) => el('span', { class: `status status-${String(status || 'unknown').toLowerCase()}`, text: status || 'desconhecido' });",
    """export const badge = (status) => {
  const key = String(status || 'unknown').toLowerCase();
  const connection = {
    open: ['Conectado', 'open'],
    connected: ['Conectado', 'open'],
    close: ['Desconectado', 'close'],
    closed: ['Desconectado', 'close'],
    disconnected: ['Desconectado', 'close'],
    connecting: ['Conectando', 'connecting'],
  }[key];
  if (!connection) return el('span', { class: `status status-${key}`, text: status || 'desconhecido' });
  return el(
    'span',
    { class: `status connection-status status-${connection[1]}` },
    el('span', { class: 'status-led' }),
    connection[0],
  );
};""",
)

# Shared Chat status preference.
write(
    'manager/src/core/chat-preferences.js',
    """const statusKey = (instance) => `connect-api:chat:show-status:${instance.id || instance.instanceId || instance.name}`;

export function getShowStatusInChat(instance) {
  return localStorage.getItem(statusKey(instance)) === '1';
}

export function setShowStatusInChat(instance, value) {
  localStorage.setItem(statusKey(instance), value ? '1' : '0');
}
""",
)

# Add Status to navigation.
replace_once(
    'manager/src/components/shell.js',
    """  const principal = [
    ['Visão geral', 'dashboard', '◫'],
    ['Chat', 'chat', '◉'],
  ];
  if (instance.integration === 'WHATSAPP-ZAPO') {""",
    """  const principal = [
    ['Visão geral', 'dashboard', '◫'],
    ['Chat', 'chat', '◉'],
  ];
  if (instance.integration === 'WHATSAPP-BAILEYS' || instance.integration === 'WHATSAPP-ZAPO') {
    principal.push(['Status', 'status', '◌']);
  }
  if (instance.integration === 'WHATSAPP-ZAPO') {""",
)

# Manager chat API helper.
replace_once(
    'manager/src/api/chat.js',
    """export async function fetchProfilePicture(session, instance, remoteJid) {""",
    """export const findStatusMessages = (session, instance) => findMessages(session, instance, 'status@broadcast');

export async function fetchProfilePicture(session, instance, remoteJid) {""",
)

# Rebuild Chat as a fixed WhatsApp-like workspace, filtering protocol messages.
write(
    'manager/src/pages/chat.js',
    """import { alertBox, button, el, input, spinner } from '../core/dom.js';
import { fetchProfilePicture, findChats, findMessages, findStatusMessages, sendMedia, sendText } from '../api/chat.js';
import { getShowStatusInChat } from '../core/chat-preferences.js';
import { loadSession } from '../core/session.js';
import { instanceShell } from '../components/shell.js';

function rawChatJid(chat) {
  return chat?.remoteJid || chat?.id || chat?.key?.remoteJid || '';
}
function chatAltJid(chat) {
  return chat?.remoteJidAlt || chat?.lastMessage?.key?.remoteJidAlt || chat?.key?.remoteJidAlt || '';
}
function canonicalJid(chat) {
  const raw = rawChatJid(chat);
  const alt = chatAltJid(chat);
  return raw.endsWith('@lid') && alt && !alt.endsWith('@lid') ? alt : raw;
}
function isStatusJid(jid) {
  return String(jid || '') === 'status@broadcast';
}
function isProtocolMessage(message) {
  const payload = message?.message || {};
  const type = String(message?.messageType || '');
  return type === 'protocolMessage' || type === 'senderKeyDistributionMessage' || Boolean(payload.protocolMessage);
}
function chatName(chat) {
  const jid = canonicalJid(chat);
  if (isStatusJid(jid)) return 'Status do WhatsApp';
  return chat?.pushName || chat?.name || jid.split('@')[0] || 'Conversa';
}
function messageText(message) {
  if (!message || isProtocolMessage(message)) return '';
  const payload = message?.message || {};
  return (
    payload.conversation ||
    payload.extendedTextMessage?.text ||
    payload.imageMessage?.caption ||
    (payload.imageMessage ? '📷 Imagem' : '') ||
    payload.videoMessage?.caption ||
    (payload.videoMessage ? '🎥 Vídeo' : '') ||
    payload.documentMessage?.fileName ||
    (payload.documentMessage ? '📄 Documento' : '') ||
    (payload.audioMessage ? '🎤 Áudio' : '') ||
    (payload.stickerMessage ? 'Sticker' : '') ||
    payload.contactMessage?.displayName ||
    (payload.locationMessage ? '📍 Localização' : '') ||
    (payload.pollCreationMessage ? '📊 Enquete' : '') ||
    ''
  );
}
function messageTimestamp(message) {
  const value = Number(message?.messageTimestamp || message?.timestamp || 0);
  if (!value) return '';
  const date = new Date(value > 10_000_000_000 ? value : value * 1000);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function renderChat(instance, initialJid = '', { embedded = false } = {}) {
  const session = loadSession();
  const layout = el('div', { class: 'chat-layout whatsapp-like' });
  const list = el('aside', { class: 'chat-list' });
  const conversation = el('section', { class: 'conversation' });
  const aliases = new Map();
  const avatarCache = new Map();
  let chats = [];
  let selected = initialJid;
  let polling;
  let loadingChats = false;
  let loadingMessages = false;

  function registerAliases(chat) {
    const canonical = canonicalJid(chat);
    if (!canonical) return;
    const set = aliases.get(canonical) || new Set();
    [rawChatJid(chat), chatAltJid(chat), canonical].filter(Boolean).forEach((jid) => set.add(jid));
    aliases.set(canonical, set);
  }

  function dedupeChats(rows) {
    const map = new Map();
    rows.forEach((chat) => {
      registerAliases(chat);
      const jid = canonicalJid(chat);
      if (!jid || jid.endsWith('@broadcast')) return;
      const current = map.get(jid);
      if (!current || new Date(chat.updatedAt || 0) > new Date(current.updatedAt || 0)) map.set(jid, chat);
    });
    if (getShowStatusInChat(instance)) {
      map.set('status@broadcast', { remoteJid: 'status@broadcast', name: 'Status do WhatsApp', syntheticStatus: true });
      aliases.set('status@broadcast', new Set(['status@broadcast']));
    }
    return [...map.values()];
  }

  function avatar(chat, size = '') {
    const jid = canonicalJid(chat);
    const name = chatName(chat);
    const node = el('div', { class: `avatar ${size}`.trim(), text: name[0]?.toUpperCase() || '?' });
    if (!jid || jid.endsWith('@g.us') || jid.endsWith('@lid') || isStatusJid(jid)) return node;
    const cached = avatarCache.get(jid);
    if (cached) {
      node.replaceChildren(el('img', { src: cached, alt: '' }));
      return node;
    }
    void fetchProfilePicture(session, instance, jid)
      .then((data) => {
        const url = data?.profilePictureUrl || data?.url || data?.profilePicture?.url;
        if (url && document.body.contains(node)) {
          avatarCache.set(jid, url);
          node.replaceChildren(el('img', { src: url, alt: '' }));
        }
      })
      .catch(() => undefined);
    return node;
  }

  async function loadChats({ silent = false } = {}) {
    if (loadingChats) return;
    loadingChats = true;
    if (!silent) {
      list.replaceChildren(
        el('div', { class: 'chat-list-head' }, el('strong', { text: 'Conversas' })),
        el('div', { class: 'center' }, spinner()),
      );
    }
    try {
      chats = dedupeChats(await findChats(session, instance));
      drawChats();
    } catch (error) {
      if (!silent) list.append(alertBox(error.message || String(error)));
    } finally {
      loadingChats = false;
    }
  }

  function drawChats() {
    const search = input('', { placeholder: 'Pesquisar ou iniciar nova conversa' });
    const rows = el('div', { class: 'chat-rows' });
    const header = el(
      'div',
      { class: 'chat-list-toolbar' },
      el('strong', { text: 'Conversas' }),
      button('↻', { class: 'icon-btn', onclick: () => loadChats() }),
    );
    const drawRows = () => {
      const term = search.value.trim().toLowerCase();
      rows.replaceChildren();
      const visible = chats.filter((chat) => `${chatName(chat)} ${canonicalJid(chat)}`.toLowerCase().includes(term));
      if (!visible.length) {
        rows.append(el('div', { class: 'empty small' }, el('span', { text: 'Nenhuma conversa.' })));
        return;
      }
      visible.forEach((chat) => {
        const jid = canonicalJid(chat);
        const preview = messageText(chat.lastMessage || {});
        const row = el(
          'button',
          {
            class: `chat-row ${selected === jid ? 'active' : ''}`,
            onclick: () => {
              selected = jid;
              history.replaceState(
                {},
                '',
                embedded
                  ? `/manager/embed-chat/${encodeURIComponent(jid)}`
                  : `/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/chat/${encodeURIComponent(jid)}`,
              );
              drawChats();
              void loadMessages();
            },
          },
          avatar(chat),
          el(
            'div',
            { class: 'chat-row-body' },
            el(
              'div',
              { class: 'chat-row-top' },
              el('strong', { text: chatName(chat) }),
              el('small', { text: messageTimestamp(chat.lastMessage) }),
            ),
            el(
              'div',
              { class: 'chat-row-bottom' },
              el('span', { text: preview || (isStatusJid(jid) ? 'Atualizações de Status' : jid.split('@')[0]) }),
              Number(chat.unreadCount || 0) > 0
                ? el('b', { class: 'unread-badge', text: String(chat.unreadCount) })
                : null,
            ),
          ),
        );
        rows.append(row);
      });
    };
    search.addEventListener('input', drawRows);
    list.replaceChildren(header, el('div', { class: 'chat-search' }, search), rows);
    drawRows();
  }

  async function loadMessages({ silent = false } = {}) {
    if (loadingMessages || !selected) {
      if (!selected && !silent) {
        conversation.replaceChildren(
          el(
            'div',
            { class: 'empty conversation-empty' },
            el('strong', { text: 'Connect|API Chat' }),
            el('span', { text: 'Selecione uma conversa para começar.' }),
          ),
        );
      }
      return;
    }

    loadingMessages = true;
    const chat = chats.find((item) => canonicalJid(item) === selected) || { remoteJid: selected };
    const header = el(
      'div',
      { class: 'conversation-head' },
      el(
        'div',
        { class: 'conversation-person' },
        avatar(chat, 'large'),
        el(
          'div',
          {},
          el('strong', { text: chatName(chat) }),
          el('small', { text: isStatusJid(selected) ? 'Status do WhatsApp' : selected.replace(/@.+$/, '') }),
        ),
      ),
      el(
        'div',
        { class: 'actions' },
        instance.integration === 'WHATSAPP-ZAPO' && !isStatusJid(selected)
          ? button('☎', {
              class: 'icon-btn',
              onclick: () =>
                (location.href = `/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/calls`),
            })
          : null,
        button('↻', { class: 'icon-btn', onclick: () => loadMessages() }),
      ),
    );
    const messages = el('div', { class: 'messages' }, silent ? null : spinner());

    let composer = null;
    if (!isStatusJid(selected)) {
      const text = input('', { placeholder: 'Digite uma mensagem', autocomplete: 'off' });
      const file = el('input', { type: 'file', class: 'file-input' });
      const attach = button('＋', { class: 'icon-btn', onclick: () => file.click() });
      const formFeedback = el('div', { class: 'composer-feedback' });
      const form = el(
        'form',
        { class: 'composer' },
        attach,
        file,
        text,
        button('➤', { class: 'primary send-btn', type: 'submit' }),
      );
      composer = el('div', { class: 'composer-wrap' }, formFeedback, form);
      form.onsubmit = async (event) => {
        event.preventDefault();
        const body = text.value.trim();
        const attachment = file.files?.[0];
        if (!body && !attachment) return;
        formFeedback.replaceChildren();
        try {
          if (attachment) await sendMedia(session, instance, selected, attachment, body);
          else await sendText(session, instance, selected, body);
          text.value = '';
          file.value = '';
          await loadMessages();
        } catch (error) {
          formFeedback.replaceChildren(alertBox(error.message || String(error)));
        }
      };
    }

    if (!silent) conversation.replaceChildren(header, messages, composer);
    try {
      const batches = isStatusJid(selected)
        ? [await findStatusMessages(session, instance).catch(() => [])]
        : await Promise.all(
            [...(aliases.get(selected) || new Set([selected]))].map((jid) =>
              findMessages(session, instance, jid).catch(() => []),
            ),
          );
      const unique = new Map();
      batches.flat().forEach((message) => {
        if (isProtocolMessage(message)) return;
        unique.set(message.id || message.key?.id || JSON.stringify(message.key), message);
      });
      const rows = [...unique.values()].sort(
        (a, b) => Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0),
      );
      const target = silent ? conversation.querySelector('.messages') : messages;
      if (target) renderMessageRows(target, rows);
    } catch (error) {
      if (!silent) messages.replaceChildren(alertBox(error.message || String(error)));
    } finally {
      loadingMessages = false;
    }
  }

  function renderMessageRows(target, rows) {
    target.replaceChildren();
    const visible = rows.filter((message) => messageText(message));
    if (!visible.length) {
      target.append(el('div', { class: 'conversation-no-messages', text: 'Nenhuma mensagem visível nesta conversa.' }));
      return;
    }
    visible.forEach((message) =>
      target.append(
        el(
          'div',
          { class: `bubble ${message.key?.fromMe ? 'mine' : ''}` },
          el('span', { text: messageText(message) }),
          el('small', { text: messageTimestamp(message) }),
        ),
      ),
    );
    target.scrollTop = target.scrollHeight;
  }

  layout.append(list, conversation);
  void loadChats().then(() => loadMessages());
  polling = setInterval(() => {
    if (!document.body.contains(layout)) {
      clearInterval(polling);
      return;
    }
    void loadChats({ silent: true });
    if (selected) void loadMessages({ silent: true });
  }, 4000);
  return embedded ? el('main', { class: 'embedded-chat' }, layout) : instanceShell(instance, 'chat', layout);
}
""",
)

# Dedicated Status page.
write(
    'manager/src/pages/status.js',
    """import { alertBox, button, card, el, spinner, toggle } from '../core/dom.js';
import { fetchProfilePicture, findStatusMessages } from '../api/chat.js';
import { getShowStatusInChat, setShowStatusInChat } from '../core/chat-preferences.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

function textOf(message) {
  const payload = message?.message || {};
  return (
    payload.conversation ||
    payload.extendedTextMessage?.text ||
    payload.imageMessage?.caption ||
    (payload.imageMessage ? '📷 Foto' : '') ||
    payload.videoMessage?.caption ||
    (payload.videoMessage ? '🎥 Vídeo' : '') ||
    (payload.audioMessage ? '🎤 Áudio' : '') ||
    ''
  );
}
function participantOf(message) {
  return message?.key?.participantAlt || message?.key?.participant || message?.participant || '';
}
function timeOf(message) {
  const value = Number(message?.messageTimestamp || 0);
  if (!value) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value * 1000));
}

export function renderStatus(instance) {
  const session = loadSession();
  const page = el('div', { class: 'page status-page' });
  const content = el('div', { class: 'status-feed' }, spinner());

  async function reload() {
    content.replaceChildren(spinner());
    try {
      const messages = (await findStatusMessages(session, instance)).filter(
        (message) => message.messageType !== 'protocolMessage' && textOf(message),
      );
      content.replaceChildren();
      if (!messages.length) {
        content.append(
          el(
            'div',
            { class: 'empty' },
            el('strong', { text: 'Nenhum Status disponível' }),
            el('span', { text: 'As atualizações recebidas pelo WhatsApp aparecerão aqui.' }),
          ),
        );
        return;
      }
      for (const message of messages.sort((a, b) => Number(b.messageTimestamp || 0) - Number(a.messageTimestamp || 0))) {
        const participant = participantOf(message);
        const avatar = el('div', { class: 'avatar', text: (message.pushName || participant || 'S')[0].toUpperCase() });
        if (participant && !participant.endsWith('@lid')) {
          void fetchProfilePicture(session, instance, participant)
            .then((data) => {
              const url = data?.profilePictureUrl || data?.url;
              if (url && document.body.contains(avatar)) avatar.replaceChildren(el('img', { src: url, alt: '' }));
            })
            .catch(() => undefined);
        }
        content.append(
          card(
            el(
              'div',
              { class: 'status-feed-row' },
              avatar,
              el(
                'div',
                { class: 'status-feed-body' },
                el('strong', { text: message.pushName || participant.replace(/@.+$/, '') || 'Status' }),
                el('span', { text: textOf(message) }),
                el('small', { text: timeOf(message) }),
              ),
            ),
          ),
        );
      }
    } catch (error) {
      content.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  page.append(
    pageHeader('Status', 'Atualizações do WhatsApp separadas das conversas.', [button('Atualizar', { onclick: reload })]),
    card(
      toggle('Mostrar Status também na lista do Chat', getShowStatusInChat(instance), (value) => {
        setShowStatusInChat(instance, value);
      }),
    ),
    content,
  );
  void reload();
  return instanceShell(instance, 'status', page);
}
""",
)

# Main route for Status.
replace_once(
    'manager/src/main.js',
    "import { renderVoip } from './pages/voip.js';",
    "import { renderVoip } from './pages/voip.js';\nimport { renderStatus } from './pages/status.js';",
)
replace_once(
    'manager/src/main.js',
    """    } else if (section === 'chat') {
      root.append(renderChat(instance, tail ? decodeURIComponent(tail) : ''));
    } else if (section === 'calls' && instance.integration === 'WHATSAPP-ZAPO') {""",
    """    } else if (section === 'chat') {
      root.append(renderChat(instance, tail ? decodeURIComponent(tail) : ''));
    } else if (
      section === 'status' &&
      (instance.integration === 'WHATSAPP-BAILEYS' || instance.integration === 'WHATSAPP-ZAPO')
    ) {
      root.append(renderStatus(instance));
    } else if (section === 'calls' && instance.integration === 'WHATSAPP-ZAPO') {""",
)

# Calls page: phone number alias + real mute toggle + clearer signaling/media boundary.
write(
    'manager/src/pages/calls.js',
    """import { alertBox, badge, button, card, el, field, input, spinner } from '../core/dom.js';
import { acceptCall, endCall, listCalls, muteCall, offerCall, rejectCall } from '../api/calls.js';
import { navigate } from '../core/router.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

function peer(call) {
  const value = call?.displayPeerJid || call?.peerJidAlt || call?.callerPn || call?.peerJid || call?.peer || '';
  return String(value).replace(/@.+$/, '') || 'Desconhecido';
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
  }[String(state || '').toLowerCase()] || state || 'Desconhecido';
}

export function renderCalls(instance) {
  const session = loadSession();
  const page = el('div', { class: 'page calls-page' });
  const feedback = el('div');
  const list = el('div', { class: 'call-list' });
  const number = input('', { type: 'tel', inputmode: 'numeric', placeholder: '5575999999999' });
  let loading = false;
  let polling;

  async function act(action, callId, value) {
    try {
      if (action === 'accept') await acceptCall(session, instance, callId);
      if (action === 'reject') await rejectCall(session, instance, callId);
      if (action === 'end') await endCall(session, instance, callId);
      if (action === 'mute') await muteCall(session, instance, callId, value);
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  function draw(calls) {
    list.replaceChildren();
    if (!calls.length) {
      list.append(
        el(
          'div',
          { class: 'empty small' },
          el('strong', { text: 'Nenhuma chamada ativa' }),
          el('span', { text: 'As chamadas WhatsApp da instância aparecerão aqui.' }),
        ),
      );
      return;
    }
    calls.forEach((call) => {
      const callId = call.callId || call.id;
      const state = call.state || call.stateData?.state || 'unknown';
      const muted = Boolean(call.muted ?? call.stateData?.audioMuted);
      const actions = [];
      if (call.canAccept) actions.push(button('Atender', { class: 'primary', onclick: () => act('accept', callId) }));
      if (call.canReject) actions.push(button('Recusar', { class: 'danger', onclick: () => act('reject', callId) }));
      actions.push(button(muted ? 'Ativar áudio' : 'Silenciar', { onclick: () => act('mute', callId, !muted) }));
      actions.push(button('Encerrar', { class: 'danger', onclick: () => act('end', callId) }));
      list.append(
        card(
          el(
            'div',
            { class: 'call-row' },
            el(
              'div',
              { class: 'call-peer' },
              el('span', { class: 'call-icon', text: call.direction === 'incoming' ? '↙' : '↗' }),
              el(
                'div',
                {},
                el('strong', { text: peer(call) }),
                el('small', { text: call.direction === 'incoming' ? 'Recebida' : 'Efetuada' }),
              ),
            ),
            badge(stateLabel(state)),
            el('div', { class: 'actions' }, ...actions),
          ),
        ),
      );
    });
  }

  async function reload({ silent = false } = {}) {
    if (loading) return;
    loading = true;
    if (!silent) list.replaceChildren(el('div', { class: 'center' }, spinner()));
    try {
      const data = await listCalls(session, instance);
      draw(Array.isArray(data) ? data : data?.calls || []);
    } catch (error) {
      if (!silent) list.replaceChildren(alertBox(error.message || String(error)));
    } finally {
      loading = false;
    }
  }

  const callForm = el(
    'form',
    { class: 'call-dialer' },
    field('Número para chamada', number),
    button('Ligar', { class: 'primary', type: 'submit' }),
  );
  callForm.onsubmit = async (event) => {
    event.preventDefault();
    const target = number.value.replace(/\D/g, '');
    if (!target) return;
    feedback.replaceChildren();
    try {
      await offerCall(session, instance, target);
      number.value = '';
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  };

  page.append(
    pageHeader('Chamadas WhatsApp', 'Chamadas de voz da instância.', [
      button('Softphone', {
        onclick: () => navigate(`/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/voip`),
      }),
      button('Atualizar', { onclick: reload }),
    ]),
    feedback,
    card(callForm),
    list,
  );
  void reload();
  polling = setInterval(() => {
    if (!document.body.contains(page)) return clearInterval(polling);
    void reload({ silent: true });
  }, 2500);
  return instanceShell(instance, 'calls', page);
}
""",
)

# VoIP page becomes an honest Softphone PWA preparation surface (signaling is
# ready; browser audio media bridge is the next explicit layer).
write(
    'manager/src/pages/voip.js',
    """import { alertBox, badge, button, card, el, spinner } from '../core/dom.js';
import { listCalls } from '../api/calls.js';
import { navigate } from '../core/router.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

export function renderVoip(instance) {
  const session = loadSession();
  const page = el('div', { class: 'page softphone-page' });
  const status = el('div', { class: 'voip-status' }, spinner());
  const micState = el('span', { class: 'muted', text: 'Microfone não verificado' });

  async function testMicrophone() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      micState.textContent = 'Microfone disponível';
      micState.className = 'success-text';
    } catch (error) {
      micState.textContent = 'Microfone indisponível ou sem permissão';
    }
  }

  async function reload() {
    try {
      const calls = await listCalls(session, instance);
      const active = Array.isArray(calls) ? calls.length : calls?.calls?.length || 0;
      status.replaceChildren(
        card(el('span', { class: 'muted', text: 'Canal de voz' }), el('strong', { text: 'WhatsApp / Zapo' })),
        card(el('span', { class: 'muted', text: 'Conexão' }), badge(instance.connectionStatus)),
        card(el('span', { class: 'muted', text: 'Chamadas ativas' }), el('strong', { text: String(active) })),
        card(el('span', { class: 'muted', text: 'Vídeo' }), el('strong', { text: 'Não habilitado' })),
      );
    } catch (error) {
      status.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  page.append(
    pageHeader('VoIP', 'Softphone PWA e acesso às chamadas da instância.', [button('Atualizar', { onclick: reload })]),
    el(
      'div',
      { class: 'voip-hero softphone-hero' },
      el(
        'div',
        {},
        el('h2', { text: 'Connect|API Softphone' }),
        el('p', {
          class: 'muted',
          text: 'A sinalização de chamadas já está ativa. O áudio no navegador será ligado pelo canal de mídia dedicado do Softphone PWA.',
        }),
        micState,
      ),
      el(
        'div',
        { class: 'actions' },
        button('Testar microfone', { onclick: testMicrophone }),
        button('Abrir chamadas', {
          class: 'primary',
          onclick: () => navigate(`/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/calls`),
        }),
      ),
    ),
    status,
  );
  void reload();
  return instanceShell(instance, 'voip', page);
}
""",
)

# CSS overrides for LED state, fixed chat viewport, hidden native file control,
# WhatsApp-like workspace and Status feed.
css = read('manager/src/styles/app.css')
marker = '/* provider-parity-ui-v2 */'
if marker not in css:
    css += """

/* provider-parity-ui-v2 */
.status.connection-status{align-items:center;gap:7px;padding:5px 9px;background:transparent}.status-led{width:9px;height:9px;border-radius:50%;display:inline-block;box-shadow:0 0 0 3px color-mix(in srgb,currentColor 14%,transparent)}.status-open .status-led{background:#16a34a}.status-close .status-led{background:#dc2626}.status-connecting .status-led{background:#d97706}.status-open.connection-status{color:#15803d}.status-close.connection-status{color:#b91c1c}.status-connecting.connection-status{color:#b45309}.file-input{display:none}.composer-wrap{background:var(--surface)}.conversation-no-messages{margin:auto;color:var(--muted);font-size:14px}.status-feed{display:flex;flex-direction:column;gap:12px;margin-top:16px}.status-feed-row{display:flex;align-items:center;gap:12px}.status-feed-body{display:flex;flex-direction:column;gap:4px;min-width:0}.status-feed-body span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.status-feed-body small{color:var(--muted)}.success-text{color:#15803d}.softphone-hero .actions{justify-content:flex-end}
@media(min-width:901px){body:has(.chat-layout){overflow:hidden}.instance-layout:has(.chat-layout){height:calc(100vh - 64px);min-height:0;overflow:hidden}.instance-main:has(.chat-layout){height:100%;min-height:0;overflow:hidden}.instance-main:has(.chat-layout)>.chat-layout{height:100%;min-height:0}.chat-layout{min-height:0}.chat-list{min-height:0;overflow-y:auto}.conversation{min-height:0;overflow:hidden}.messages{min-height:0;overflow-y:auto;overscroll-behavior:contain}.sidebar{overscroll-behavior:contain}}
.whatsapp-like{background:#efeae2}.messages{background-color:#efeae2;background-image:linear-gradient(45deg,rgba(255,255,255,.18) 25%,transparent 25%),linear-gradient(-45deg,rgba(255,255,255,.18) 25%,transparent 25%),linear-gradient(45deg,transparent 75%,rgba(255,255,255,.18) 75%),linear-gradient(-45deg,transparent 75%,rgba(255,255,255,.18) 75%);background-size:32px 32px;background-position:0 0,0 16px,16px -16px,-16px 0}.chat-row.active{background:color-mix(in srgb,var(--primary) 8%,var(--surface2))}:root[data-theme=dark] .messages{background-color:#0b141a;background-image:none}
"""
    write('manager/src/styles/app.css', css)

# -----------------------------------------------------------------------------
# Deployment example: one shared identity/color/auth timeout. Zapo-specific OS is
# no longer defaulted to Linux; existing deployments inherit shared Connect|API.
# -----------------------------------------------------------------------------
env = read('deploy/develop/env.example')
env = env.replace(
    "WHATSAPP_PROTOCOL_BROWSER_VERSION=20.0.04\nQRCODE_LIMIT=30",
    "WHATSAPP_PROTOCOL_BROWSER_VERSION=20.0.04\nWHATSAPP_AUTH_REQUEST_TIMEOUT_MS=60000\nQRCODE_LIMIT=30",
    1,
)
env = env.replace("ZAPO_DEVICE_BROWSER=Chrome\nZAPO_DEVICE_OS=Linux", "ZAPO_DEVICE_BROWSER=\nZAPO_DEVICE_OS=", 1)
write('deploy/develop/env.example', env)

# -----------------------------------------------------------------------------
# Voice architecture checkpoint: no PCM through EventManager; PWA media bridge
# comes before PBX/FreeSWITCH and keeps the public UI provider-neutral.
# -----------------------------------------------------------------------------
write(
    'docs/architecture/voice-softphone-pwa.md',
    """# Connect|API Voice — Softphone PWA e PBX

## Objetivo

O Softphone é uma interface do Connect|API. O provider de WhatsApp (Zapo hoje) fornece sinalização e mídia; o usuário não precisa conhecer a implementação interna.

## Camadas

1. **WhatsApp Voice Provider** — Zapo: sinalização, estados da chamada e PCM de áudio.
2. **Voice Core** — contrato neutro: Call, CallLeg, MediaSession, Participant e State.
3. **Voice Media Gateway** — canal dedicado de mídia, fora do EventManager, para áudio em tempo real.
4. **Connect|API Softphone PWA** — Web Audio/AudioWorklet, microfone, alto-falante, mute, hold e controles de chamada.
5. **PBX Core** — ramais, agentes, filas, URA, grupos, transferência, conferência, gravação e CDR.
6. **FreeSWITCH** — serviço separado de execução SIP/RTP/SRTP/WebRTC quando o PBX for habilitado.

## Softphone PWA — primeira entrega de mídia

- O navegador solicita um ticket curto de mídia por HTTPS.
- O Softphone abre um WebSocket dedicado de mídia usando esse ticket.
- Entrada: PCM mono 16 kHz vindo do Zapo é entregue ao AudioWorklet e reproduzido pelo navegador.
- Saída: microfone do navegador é reamostrado para PCM mono 16 kHz e alimenta `feedLiveAudio`.
- `setExternalAudioMode` é habilitado somente enquanto o Softphone possui a sessão de mídia.
- Áudio/PCM nunca passa por RabbitMQ, Webhook, NATS, SQS ou EventManager.
- Eventos de estado da chamada continuam usando o plano normal de eventos.

## PBX

O PBX será construído sobre o Voice Core, não diretamente sobre o Zapo. Assim o mesmo Softphone poderá trabalhar com WhatsApp, SIP/WebRTC e trunks sem uma segunda interface.

## Vídeo

O contrato pode reservar `isVideo`, mas vídeo só deve ser exposto como disponível quando o provider e o plano de mídia tiverem encoder/decoder e transporte validados. A integração Zapo atual é áudio; a UI não deve prometer vídeo antes disso.
""",
)

# Extend invariants so future refactors cannot silently break the shared auth contract.
test = read('test/zapo-provider.integration.test.mjs')
if "Shared WhatsApp auth timeout" not in test:
    test = test.replace(
        "const callRouter = read('src/api/routes/call.router.ts');\n",
        "const callRouter = read('src/api/routes/call.router.ts');\nconst instanceController = read('src/api/controllers/instance.controller.ts');\nconst baileys = read('src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts');\n",
        1,
    )
    test = test.replace(
        "assert(zapo.includes(\"rawRemoteJid.endsWith('@lid')\"), 'Zapo LID-to-PN canonicalization is missing');\n",
        "assert(zapo.includes(\"rawRemoteJid.endsWith('@lid')\"), 'Zapo LID-to-PN canonicalization is missing');\nassert(zapo.includes(\"this.configService.get<QrCode>('QRCODE').COLOR\"), 'Zapo must use the shared QR color');\nassert(zapo.includes('WHATSAPP_PROTOCOL_BROWSER_CLIENT'), 'Zapo must inherit the shared Connect|API device label');\nassert(instanceController.includes('qrCodeRequests'), 'Shared QR request de-duplication is missing');\nassert(instanceController.includes('pairingCodeRequests'), 'Shared pairing request de-duplication is missing');\nassert(instanceController.includes(\"get<QrCode>('QRCODE').AUTH_TIMEOUT_MS\"), 'Shared WhatsApp auth timeout is missing');\nassert(baileys.includes(\"const pairingCodeBrowser: WABrowserDescription = ['Ubuntu', 'Chrome', '20.0.04']\"), 'Stable Baileys pairing fingerprint changed unexpectedly');\n",
        1,
    )
    write('test/zapo-provider.integration.test.mjs', test)

print('Provider parity repair applied.')
