import { OfferCallDto } from '@api/dto/call.dto';
import {
  SendAudioDto,
  SendContactDto,
  SendLocationDto,
  SendMediaDto,
  SendPollDto,
  SendPtvDto,
  SendReactionDto,
  SendStickerDto,
  SendTextDto,
} from '@api/dto/sendMessage.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { chatbotController } from '@api/server.module';
import { CacheService } from '@api/services/cache.service';
import { ChannelStartupService } from '@api/services/channel.service';
import { Events, Integration, wa } from '@api/types/wa.types';
import { Chatwoot, ConfigService, ConfigSessionPhone, Database, QrCode } from '@config/env.config';
import { BadRequestException, InternalServerErrorException } from '@exceptions';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { createPostgresStore } from '@innovatorssoft/store-postgres';
import { createJid } from '@utils/createJid';
import axios from 'axios';
import { isBase64, isURL } from 'class-validator';
import EventEmitter2 from 'eventemitter2';
import ffmpeg from 'fluent-ffmpeg';
import mimeTypes from 'mime-types';
import { Pool } from 'pg';
import qrcode, { QRCodeToDataURLOptions } from 'qrcode';
import sharp from 'sharp';
import { PassThrough } from 'stream';

let sharedZapoPostgresBackend: any = null;
let sharedZapoPostgresUri: string | null = null;

type ZapoLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

function resolveZapoLogLevel(value?: string): ZapoLogLevel {
  switch (value) {
    case 'trace':
    case 'debug':
    case 'info':
    case 'warn':
    case 'error':
      return value;
    default:
      return 'warn';
  }
}

function getSharedZapoPostgresBackend(connectionString: string) {
  if (sharedZapoPostgresBackend && sharedZapoPostgresUri === connectionString) {
    return sharedZapoPostgresBackend;
  }

  const pool = new Pool({ connectionString });
  sharedZapoPostgresBackend = createPostgresStore({
    pool,
    tablePrefix: process.env.ZAPO_STORE_TABLE_PREFIX || 'zapo_',
    cleanup: {
      intervalMs: Math.max(60_000, Number.parseInt(process.env.ZAPO_STORE_CLEANUP_INTERVAL_MS || '300000')),
    },
  });
  sharedZapoPostgresUri = connectionString;
  return sharedZapoPostgresBackend;
}

/**
 * Native Zapo provider for Connect|API.
 *
 * Zapo owns the WhatsApp Web protocol session. The optional Zapo VOIP plugin
 * owns WhatsApp call signaling/media. No external call bridge is used here.
 */
export class ZapoStartupService extends ChannelStartupService {
  constructor(
    public readonly configService: ConfigService,
    public readonly eventEmitter: EventEmitter2,
    public readonly prismaRepository: PrismaRepository,
    public readonly cache: CacheService,
    public readonly chatwootCache: CacheService,
  ) {
    super(configService, eventEmitter, prismaRepository, chatwootCache);
    this.instance.qrcode = { count: 0 };
  }

  public client: any = null;
  public stateConnection: wa.StateConnection = { state: 'close' };
  public phoneNumber?: string;

  public readonly capabilities = Object.freeze({
    messaging: true,
    text: true,
    location: true,
    contacts: true,
    media: true,
    audio: true,
    ptv: true,
    sticker: true,
    reactions: true,
    polls: true,
    qrCode: true,
    pairingCode: true,
    voice: true,
    video: false,
  });

  private storeBackend: any = null;
  private cleanupPoller: any = null;
  private store: any = null;
  private connectPromise: Promise<void> | null = null;
  private pairingReadyPromise: Promise<void> | null = null;
  private resolvePairingReady: (() => void) | null = null;
  private pairingReady = false;
  private lidReconciliationDone = false;
  private readonly outgoingCallPeers = new Map<string, string>();
  private readonly audioEmitter = new EventEmitter2();
  private reconnectTimer?: NodeJS.Timeout;
  private intentionalDisconnect = false;

  public get connectionStatus() {
    return this.stateConnection;
  }

  public get qrCode(): wa.QrCode {
    return {
      pairingCode: this.instance.qrcode?.pairingCode,
      code: this.instance.qrcode?.code,
      base64: this.instance.qrcode?.base64,
      count: this.instance.qrcode?.count,
    };
  }

  public get profilePictureUrl() {
    return this.instance.profilePictureUrl;
  }

  public setPairingCode(pairingCode?: string) {
    this.instance.qrcode.pairingCode = pairingCode ?? null;
  }

  public isRegistered(): boolean {
    return Boolean(this.client?.getCredentials?.()?.meJid);
  }

  public async closeClient() {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;

    try {
      await this.client?.disconnect?.();
    } finally {
      this.cleanupPoller?.stop?.();
      this.cleanupPoller = null;
      this.stateConnection = { state: 'close' };
    }
  }

  public async logoutInstance() {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    try {
      if (this.isRegistered()) {
        await this.client?.logout?.();
      }
    } finally {
      await this.client?.disconnect?.().catch(() => undefined);
      this.cleanupPoller?.stop?.();
      this.cleanupPoller = null;
      this.stateConnection = { state: 'close' };
    }
  }

  /** Permanently remove Zapo protocol/session state when the Connect|API instance is deleted. */
  public async purgeProviderState() {
    this.intentionalDisconnect = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;

    await this.ensureClient();
    await this.client?.disconnect?.().catch(() => undefined);
    this.cleanupPoller?.stop?.();
    this.cleanupPoller = null;

    const session = this.store?.session?.(this.instanceId);
    if (session) {
      const domains = [
        'auth',
        'signal',
        'preKey',
        'session',
        'identity',
        'senderKey',
        'appState',
        'retry',
        'groupMetadata',
        'deviceList',
        'messages',
        'messageSecret',
        'threads',
        'contacts',
        'privacyToken',
      ];
      for (const domain of domains) {
        const store = session[domain];
        if (typeof store?.clear === 'function') {
          await store.clear();
        }
      }
      await session.destroy?.();
    }

    this.client = null;
    this.store = null;
    this.stateConnection = { state: 'close' };
  }

  public async getProfileName() {
    const credentials = this.client?.getCredentials?.();
    return credentials?.meDisplayName ?? this.instance.profileName ?? null;
  }

  public async getProfileStatus() {
    const jid = this.instance.wuid || this.client?.getCredentials?.()?.meJid;
    if (!jid) return null;
    return (await this.client.profile.getStatus(jid))?.status ?? null;
  }

  public async profilePicture(number: string) {
    const jid = createJid(number);
    const result = await this.client.profile.getProfilePicture(jid, 'image').catch(() => ({}));
    return { wuid: jid, profilePictureUrl: result?.url ?? null };
  }

  public async prepareQrConnection() {
    this.instance.qrcode = { count: 0 };
    this.phoneNumber = undefined;
    await this.loadRuntimeConfiguration();
    await this.ensureClient();
    this.startConnect();
    return this.client;
  }

  public async preparePairingConnection(number: string) {
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
  }

  public async requestPairingCode(number: string) {
    const normalized = String(number || '').replace(/\D/g, '');
    if (!normalized) throw new BadRequestException('Pairing-code phone number is required');
    await this.ensureClient();
    await this.waitPairingReady();
    const code = await this.client.auth.requestPairingCode(normalized);
    this.setPairingCode(code);
    return code;
  }

  public async connectToWhatsapp(): Promise<any> {
    try {
      await this.loadRuntimeConfiguration();
      await this.ensureClient();
      this.startConnect();
      return this.client;
    } catch (error) {
      this.logger.error(error);
      throw new InternalServerErrorException(error?.toString());
    }
  }

  public async restart() {
    return this.reloadConnection();
  }

  public async reloadConnection() {
    await this.closeClient();
    this.intentionalDisconnect = false;
    this.client = null;
    return this.connectToWhatsapp();
  }

  public async textMessage(data: SendTextDto) {
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
  }

  public async locationMessage(data: SendLocationDto) {
    await this.ensureConnected();
    const jid = createJid(data.number);
    const result = await this.client.message.send(jid, {
      locationMessage: {
        degreesLatitude: data.latitude,
        degreesLongitude: data.longitude,
        name: data.name,
        address: data.address,
      },
    });
    return { key: { id: result?.id, remoteJid: jid, fromMe: true } };
  }

  public async contactMessage(data: SendContactDto) {
    await this.ensureConnected();
    const jid = createJid(data.number);
    const contact = data.contact?.[0];
    if (!contact) throw new BadRequestException('At least one contact is required');

    const escapedName = String(contact.fullName || '').replace(/[\n\r]/g, ' ');
    const phone = String(contact.phoneNumber || contact.wuid || '').replace(/\D/g, '');
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${escapedName}`,
      phone ? `TEL;type=CELL;waid=${phone}:+${phone}` : null,
      contact.organization ? `ORG:${String(contact.organization).replace(/[\n\r]/g, ' ')}` : null,
      contact.email ? `EMAIL:${String(contact.email).replace(/[\n\r]/g, '')}` : null,
      contact.url ? `URL:${String(contact.url).replace(/[\n\r]/g, '')}` : null,
      'END:VCARD',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.client.message.send(jid, {
      contactMessage: { displayName: escapedName, vcard },
    });
    return { key: { id: result?.id, remoteJid: jid, fromMe: true } };
  }

  public async mediaMessage(data: SendMediaDto, file?: any) {
    await this.ensureConnected();
    const jid = createJid(data.number);
    await this.applyDelay(data.delay);

    const { buffer, mimetype } = await this.resolveMediaInput(
      data.media,
      file,
      data.mimetype,
      this.defaultMediaMime(data.mediatype),
    );
    const contextInfo = this.buildContextInfo(data, jid);
    const content: any = {
      type: data.mediatype,
      media: buffer,
      mimetype,
      ...(data.caption ? { caption: data.caption } : {}),
      ...(data.fileName ? { fileName: data.fileName } : {}),
      ...(contextInfo ? { contextInfo } : {}),
    };

    const result = await this.client.message.send(jid, content);
    const messageType = `${data.mediatype}Message`;
    return await this.persistOutgoingMessage(result?.id, jid, messageType, {
      [messageType]: {
        caption: data.caption,
        mimetype,
        fileName: data.fileName,
      },
    });
  }

  public async ptvMessage(data: SendPtvDto, file?: any) {
    await this.ensureConnected();
    const jid = createJid(data.number);
    await this.applyDelay(data.delay);

    const { buffer } = await this.resolveMediaInput(data.video, file, 'video/mp4', 'video/mp4');
    const contextInfo = this.buildContextInfo(data, jid);
    const result = await this.client.message.send(jid, {
      type: 'ptv',
      media: buffer,
      mimetype: 'video/mp4',
      ...(contextInfo ? { contextInfo } : {}),
    });
    return this.outgoingMessageResult(result?.id, jid, 'ptvMessage');
  }

  public async audioWhatsapp(data: SendAudioDto, file?: any) {
    await this.ensureConnected();
    const jid = createJid(data.number);
    await this.applyDelay(data.delay);

    let audio: Buffer;
    if (data.encoding !== false) {
      audio = await this.convertVoiceNote(data.audio, file);
    } else {
      audio = (await this.resolveMediaInput(data.audio, file, 'audio/ogg; codecs=opus', 'audio/ogg; codecs=opus'))
        .buffer;
    }

    const contextInfo = this.buildContextInfo(data, jid);
    const result = await this.client.message.send(jid, {
      type: 'audio',
      media: audio,
      mimetype: 'audio/ogg; codecs=opus',
      ptt: true,
      ...(contextInfo ? { contextInfo } : {}),
    });
    return this.outgoingMessageResult(result?.id, jid, 'audioMessage');
  }

  public async mediaSticker(data: SendStickerDto, file?: any) {
    await this.ensureConnected();
    const jid = createJid(data.number);
    await this.applyDelay(data.delay);

    const source = await this.resolveMediaInput(data.sticker, file, file?.mimetype, 'image/webp');
    const sticker = data.notConvertSticker
      ? source.buffer
      : await sharp(source.buffer, { animated: true }).webp().toBuffer();
    const contextInfo = this.buildContextInfo(data, jid);
    const result = await this.client.message.send(jid, {
      type: 'sticker',
      media: sticker,
      mimetype: 'image/webp',
      ...(contextInfo ? { contextInfo } : {}),
    });
    return this.outgoingMessageResult(result?.id, jid, 'stickerMessage');
  }

  public async reactionMessage(data: SendReactionDto) {
    await this.ensureConnected();
    const target = data.key;
    if (!target?.remoteJid || !target?.id || typeof target.fromMe !== 'boolean') {
      throw new BadRequestException('Reaction target key must include remoteJid, id and fromMe');
    }

    const result = await this.client.message.send(target.remoteJid, {
      type: 'reaction',
      emoji: data.reaction || '',
      target: {
        remoteJid: target.remoteJid,
        id: target.id,
        fromMe: target.fromMe,
        ...(target.participant ? { participant: target.participant } : {}),
      },
    });
    return this.outgoingMessageResult(result?.id, target.remoteJid, 'reactionMessage');
  }

  public async pollMessage(data: SendPollDto) {
    await this.ensureConnected();
    const jid = createJid(data.number);
    await this.applyDelay(data.delay);
    const contextInfo = this.buildContextInfo(data, jid);
    const result = await this.client.message.send(jid, {
      type: 'poll',
      name: data.name,
      options: data.values,
      selectableCount: data.selectableCount || 1,
      ...(contextInfo ? { contextInfo } : {}),
    });
    return this.outgoingMessageResult(result?.id, jid, 'pollCreationMessage');
  }

  public async sendPresence(data: any) {
    await this.ensureConnected();
    const jid = data?.number ? createJid(data.number) : undefined;
    const presence = data?.presence || data;

    if (presence === 'available' || presence === 'unavailable') {
      await this.client.presence.send(presence);
      return { presence };
    }

    if (jid && ['composing', 'recording', 'paused'].includes(presence)) {
      const chatstate =
        presence === 'recording'
          ? { state: 'composing', media: 'audio' }
          : { state: presence === 'paused' ? 'paused' : 'composing' };
      await this.client.presence.sendChatstate(jid, chatstate);
      return { presence, jid };
    }

    throw new BadRequestException(`Unsupported presence for Zapo provider: ${presence}`);
  }

  public async setPresence(data: any) {
    return this.sendPresence(data);
  }

  /** Place a WhatsApp call directly through Zapo VOIP. */
  public async offerCall({ number, isVideo, callDuration }: OfferCallDto) {
    await this.ensureConnected();
    this.ensureVoip();

    if (isVideo) {
      throw new BadRequestException('The native Zapo provider currently supports audio calls only');
    }

    const jid = createJid(number);
    const callId = await this.client.voip.startCall({ peerJid: jid, isVideo: Boolean(isVideo) });
    this.outgoingCallPeers.set(callId, jid);

    if (callDuration && callDuration > 0) {
      const timer = setTimeout(() => {
        void this.client.voip.endCall(callId).catch((error: Error) => this.logger.error(error));
      }, callDuration * 1000);
      timer.unref?.();
    }

    return { id: callId, callId, jid, isVideo: Boolean(isVideo), provider: Integration.WHATSAPP_ZAPO };
  }

  public async acceptCall(callId: string) {
    await this.ensureConnected();
    this.ensureVoip();
    await this.client.voip.acceptCall(callId);
    return this.normalizeCall(this.client.voip.getCall(callId));
  }

  public async rejectCall(callId: string) {
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

  public async listCalls() {
    await this.ensureClient();
    this.ensureVoip();
    return this.client.voip.getCalls().map((call: any) => this.normalizeCall(call));
  }

  /** Internal media hook for the future PBX bridge. Audio never goes through EventManager. */
  public onInboundVoiceAudio(handler: (event: { call: any; pcm: Float32Array }) => void) {
    this.audioEmitter.on('audio', handler);
    return () => this.audioEmitter.off('audio', handler);
  }

  public setExternalAudioMode(callId: string, enabled: boolean) {
    this.ensureVoip();
    this.client.voip.setExternalAudioMode(callId, enabled);
  }

  public feedLiveAudio(callId: string, pcm: Float32Array) {
    this.ensureVoip();
    return this.client.voip.feedLiveAudio(callId, pcm);
  }

  private async loadRuntimeConfiguration() {
    await Promise.all([this.loadChatwoot(), this.loadSettings(), this.loadWebhook(), this.loadProxy()]);
  }

  private async ensureClient() {
    if (this.client) return this.client;

    const database = this.configService.get<Database>('DATABASE');
    if (database.PROVIDER !== 'postgresql') {
      throw new BadRequestException(
        'The native Zapo provider currently requires DATABASE_PROVIDER=postgresql for persistent protocol state',
      );
    }
    if (!database.CONNECTION.URI) {
      throw new BadRequestException('The Zapo provider requires DATABASE_CONNECTION_URI');
    }

    // Provider modules are loaded lazily so Baileys/Meta startup remains independent from Zapo/VoIP.
    const [{ ConsoleLogger, createStore, WaClient }, { voipPlugin }] = await Promise.all([
      import('@innovatorssoft/zapo-js'),
      import('@innovatorssoft/voip'),
    ]);

    this.storeBackend = getSharedZapoPostgresBackend(database.CONNECTION.URI);

    this.store = createStore({
      backends: { pg: this.storeBackend },
      providers: {
        auth: 'pg',
        signal: 'pg',
        preKey: 'pg',
        session: 'pg',
        identity: 'pg',
        senderKey: 'pg',
        appState: 'pg',
        privacyToken: 'pg',
        messages: 'pg',
        threads: 'pg',
        contacts: 'pg',
      },
      cacheProviders: {
        retry: 'pg',
        groupMetadata: 'pg',
        deviceList: 'pg',
        messageSecret: 'pg',
      },
    });
    this.cleanupPoller = this.storeBackend.startCleanup(this.instanceId);

    const maxConcurrentCalls = Math.max(1, Number.parseInt(process.env.ZAPO_VOIP_MAX_CONCURRENT_CALLS || '4'));
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
        sessionId: this.instanceId,
        connectTimeoutMs: 30_000,
        nodeQueryTimeoutMs: 30_000,
        keepAliveIntervalMs: 30_000,
        markOnlineOnConnect: this.localSettings.alwaysOnline === true,
        recoverFromClientTooOld: true,
        history: {
          enabled: this.localSettings.syncFullHistory === true,
          requireFullSync: this.localSettings.syncFullHistory === true,
        },
        deviceBrowser,
        deviceOsDisplayName: deviceDisplayName,
        plugins,
      },
      new ConsoleLogger(resolveZapoLogLevel(process.env.ZAPO_LOG_LEVEL)),
    );

    this.bindClientEvents();
    return this.client;
  }

  private bindClientEvents() {
    this.client.on('auth_qr', ({ qr }: any) => {
      void this.handleQr(qr);
      this.markPairingReady();
    });

    this.client.on('auth_pairing_required', () => this.markPairingReady());

    this.client.on('auth_pairing_code', ({ code }: any) => {
      this.setPairingCode(code);
      this.sendDataWebhook(Events.QRCODE_UPDATED, {
        qrcode: { instance: this.instance.name, pairingCode: code },
        provider: Integration.WHATSAPP_ZAPO,
      });
    });

    this.client.on('auth_paired', ({ credentials }: any) => {
      this.instance.wuid = credentials?.meJid;
      this.instance.ownerJid = credentials?.meJid;
      this.instance.profileName = credentials?.meDisplayName;
      this.stateConnection = { state: 'open' };
    });

    this.client.on('connection', (event: any) => {
      void this.handleConnectionEvent(event);
    });

    this.client.on('message', (event: any) => {
      void this.handleIncomingMessage(event);
    });

    this.client.on('voip_call_incoming', (call: any) => {
      void this.handleIncomingCall(call);
    });

    this.client.on('voip_call_state', (call: any) => {
      this.emitCall('state', call);
    });

    this.client.on('voip_call_ended', (call: any) => {
      this.emitCall('ended', call);
    });

    this.client.on('voip_call_error', (error: Error) => {
      this.sendDataWebhook(Events.CALL, {
        action: 'error',
        provider: Integration.WHATSAPP_ZAPO,
        error: error?.message || String(error),
      });
    });

    this.client.on('voip_call_inbound_audio', ({ call, pcm }: any) => {
      // PCM stays inside the media plane and is exposed only to internal consumers (PBX/bridge).
      this.audioEmitter.emit('audio', { call: this.normalizeCall(call), pcm });
    });
  }

  private startConnect() {
    if (this.connectPromise) return this.connectPromise;

    this.intentionalDisconnect = false;
    this.stateConnection = { state: 'connecting' };
    void this.persistConnectionState('connecting');

    this.connectPromise = this.client
      .connect()
      .catch((error: Error) => {
        this.logger.error(error);
        this.stateConnection = { state: 'close' };
        void this.persistConnectionState('close');
      })
      .finally(() => {
        this.connectPromise = null;
      });

    return this.connectPromise;
  }

  private async handleConnectionEvent(event: any) {
    const state = event?.status === 'open' ? 'open' : event?.status === 'connecting' ? 'connecting' : 'close';
    this.stateConnection = { state };

    const credentials = this.client?.getCredentials?.();
    if (credentials?.meJid) {
      this.instance.wuid = credentials.meJid;
      this.instance.ownerJid = credentials.meJid;
      this.instance.profileName = credentials.meDisplayName ?? this.instance.profileName;
      if (state === 'open') {
        await this.refreshOwnProfilePicture(credentials);
      }
    }

    await this.persistConnectionState(state);

    this.sendDataWebhook(Events.CONNECTION_UPDATE, {
      instance: this.instance.name,
      state,
      reason: event?.reason,
      code: event?.code,
      isLogout: event?.isLogout === true,
      wuid: this.instance.wuid,
      profileName: this.instance.profileName,
      provider: Integration.WHATSAPP_ZAPO,
    });

    if (state === 'open') {
      this.instance.qrcode = { count: 0 };
      void this.reconcileStoredLidAliases().catch((error: Error) => this.logger.error(error));
      return;
    }

    if (event?.isLogout === true || this.intentionalDisconnect) return;
    if (!this.isRegistered()) return;
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.intentionalDisconnect) this.startConnect();
    }, 3000);
    this.reconnectTimer.unref?.();
  }

  private async persistConnectionState(state: 'open' | 'close' | 'connecting') {
    if (!this.instanceId) return;
    try {
      await this.prismaRepository.instance.update({
        where: { id: this.instanceId },
        data: {
          connectionStatus: state,
          ownerJid: this.instance.ownerJid,
          profileName: this.instance.profileName,
          profilePicUrl: this.instance.profilePictureUrl,
        },
      });
    } catch (error) {
      this.logger.error(error);
    }
  }

  private async handleQr(qr: string) {
    if (!qr) return;

    const opts: QRCodeToDataURLOptions = {
      margin: 3,
      scale: 4,
      errorCorrectionLevel: 'H',
      color: { light: '#ffffff', dark: this.configService.get<QrCode>('QRCODE').COLOR },
    };
    const base64 = await qrcode.toDataURL(qr, opts);

    // Publish QR state atomically. `InstanceController.waitForQrCode()` polls
    // this object, so exposing `code` before `base64` creates a race where the
    // raw WhatsApp payload is returned to the Manager as if it were an image.
    this.instance.qrcode = {
      ...this.instance.qrcode,
      count: (this.instance.qrcode.count || 0) + 1,
      code: qr,
      base64,
    };

    this.sendDataWebhook(Events.QRCODE_UPDATED, {
      qrcode: {
        instance: this.instance.name,
        pairingCode: this.instance.qrcode.pairingCode,
        code: qr,
        base64: this.instance.qrcode.base64,
      },
      provider: Integration.WHATSAPP_ZAPO,
    });
  }

  private async handleIncomingMessage(event: any) {
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

  private async upsertContact(remoteJid: string, pushName?: string) {
    await this.prismaRepository.contact.upsert({
      where: { remoteJid_instanceId: { remoteJid, instanceId: this.instanceId } },
      update: { pushName },
      create: { remoteJid, pushName, instanceId: this.instanceId },
    });
    this.sendDataWebhook(Events.CONTACTS_UPSERT, { remoteJid, pushName, instanceId: this.instanceId });
  }

  private async upsertChat(remoteJid: string, name?: string) {
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

  private async handleIncomingCall(call: any) {
    this.emitCall('incoming', call);

    try {
      if (this.localSettings.rejectCall && call?.callId && call?.canReject !== false) {
        await this.client.voip.rejectCall(call.callId);
      }

      const automaticMessage = this.localSettings.msgCall?.trim();
      if (automaticMessage && call?.peerJid) {
        await this.client.message.send(call.peerJid, automaticMessage);
      }
    } catch (error) {
      this.logger.error(error);
    }
  }

  private emitCall(action: 'incoming' | 'state' | 'ended', call: any) {
    this.sendDataWebhook(Events.CALL, {
      action,
      provider: Integration.WHATSAPP_ZAPO,
      call: this.normalizeCall(call),
    });
  }

  private normalizeCall(call: any) {
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

  private ensureVoip() {
    if (!this.client?.voip) {
      throw new BadRequestException('Zapo VOIP is disabled or unavailable for this instance');
    }
  }

  private async ensureConnected() {
    await this.ensureClient();
    if (this.stateConnection.state !== 'open') {
      if (this.isRegistered()) {
        await this.startConnect();
      }
    }
    if (this.stateConnection.state !== 'open') {
      throw new BadRequestException('Zapo WhatsApp instance is not connected');
    }
  }

  private resetPairingReady() {
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
  }

  private async applyDelay(delay?: number) {
    if (delay && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  private buildContextInfo(data: any, targetJid: string) {
    const quoted = data?.quoted;
    const mentions = Array.isArray(data?.mentioned)
      ? data.mentioned.map((item: string) => (String(item).includes('@') ? String(item) : createJid(String(item))))
      : [];

    const contextInfo: any = {};
    if (quoted?.key?.id) {
      contextInfo.quotedMessageId = quoted.key.id;
      if (quoted.key.participant) contextInfo.quotedParticipant = quoted.key.participant;
      if (quoted.key.remoteJid && quoted.key.remoteJid !== targetJid) {
        contextInfo.quotedRemoteJid = quoted.key.remoteJid;
      }
      if (quoted.message) contextInfo.quotedMessage = quoted.message;
    }
    if (mentions.length > 0) contextInfo.mentionedJids = mentions;

    return Object.keys(contextInfo).length > 0 ? contextInfo : null;
  }

  private async resolveMediaInput(
    value: string,
    file?: any,
    explicitMimetype?: string,
    fallbackMimetype = 'application/octet-stream',
  ): Promise<{ buffer: Buffer; mimetype: string }> {
    if (file?.buffer) {
      return {
        buffer: Buffer.from(file.buffer),
        mimetype: explicitMimetype || file.mimetype || this.mimeFromName(file.originalname) || fallbackMimetype,
      };
    }

    if (!value) throw new BadRequestException('Media, URL or base64 content is required');

    if (isURL(value)) {
      const response = await axios.get(value, { responseType: 'arraybuffer', timeout: 60_000 });
      const responseType = String(response.headers?.['content-type'] || '').split(';')[0];
      return {
        buffer: Buffer.from(response.data),
        mimetype: explicitMimetype || responseType || this.mimeFromName(value) || fallbackMimetype,
      };
    }

    const dataUri = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/s.exec(value);
    const base64Payload = dataUri?.[2] ?? value;
    if (!dataUri && !isBase64(base64Payload)) {
      throw new BadRequestException('Media must be a valid URL or base64 payload');
    }

    const buffer = Buffer.from(base64Payload, 'base64');
    if (!buffer.length) throw new BadRequestException('Media payload is empty');
    return {
      buffer,
      mimetype: explicitMimetype || dataUri?.[1] || fallbackMimetype,
    };
  }

  private mimeFromName(value?: string): string | null {
    if (!value) return null;
    try {
      const pathname = isURL(value) ? new URL(value).pathname : value;
      const detected = mimeTypes.lookup(pathname);
      return detected ? String(detected) : null;
    } catch {
      return null;
    }
  }

  private defaultMediaMime(type: string): string {
    const defaults: Record<string, string> = {
      image: 'image/jpeg',
      video: 'video/mp4',
      ptv: 'video/mp4',
      audio: 'audio/ogg; codecs=opus',
      document: 'application/octet-stream',
    };
    return defaults[type] || 'application/octet-stream';
  }

  private async convertVoiceNote(value: string, file?: any): Promise<Buffer> {
    const source = await this.resolveMediaInput(value, file, file?.mimetype, 'application/octet-stream');
    const input = new PassThrough();
    input.end(source.buffer);

    ffmpeg.setFfmpegPath(ffmpegPath.path);
    return await new Promise<Buffer>((resolve, reject) => {
      const output = new PassThrough();
      const chunks: Buffer[] = [];
      output.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      output.on('end', () => resolve(Buffer.concat(chunks)));
      output.on('error', reject);

      ffmpeg(input)
        .noVideo()
        .audioCodec('libopus')
        .audioChannels(1)
        .audioFrequency(48000)
        .audioBitrate('128k')
        .outputFormat('ogg')
        .addOutputOptions([
          '-avoid_negative_ts make_zero',
          '-compression_level 10',
          '-application voip',
          '-fflags +bitexact',
          '-flags +bitexact',
          '-map_metadata -1',
          '-map_chapters -1',
        ])
        .on('error', reject)
        .pipe(output, { end: true });
    });
  }

  private outgoingMessageResult(id: string | undefined, jid: string, messageType: string) {
    return {
      key: { id, remoteJid: jid, fromMe: true },
      messageType,
      provider: Integration.WHATSAPP_ZAPO,
    };
  }

  private detectMessageType(message: any): string {
    if (!message || typeof message !== 'object') return 'unknown';
    if (typeof message.conversation === 'string') return 'conversation';
    return Object.keys(message).find((key) => message[key] !== null && message[key] !== undefined) || 'unknown';
  }

  private toJson<T = any>(value: T): any {
    return JSON.parse(
      JSON.stringify(value, (_key, current) => {
        if (typeof current === 'bigint') return current.toString();
        if (current instanceof Uint8Array) return Buffer.from(current).toString('base64');
        if (Buffer.isBuffer(current)) return current.toString('base64');
        if (current && typeof current === 'object' && typeof current.toJSON === 'function') return current.toJSON();
        return current;
      }),
    );
  }

  private unsupported(feature: string): never {
    throw new BadRequestException(`The Zapo provider adapter does not expose ${feature} yet`);
  }

  // Explicit stubs avoid opaque "method is not a function" errors while the adapter grows.
  public buttonMessage() {
    return this.unsupported('buttonMessage');
  }
  public listMessage() {
    return this.unsupported('listMessage');
  }
  public statusMessage() {
    return this.unsupported('statusMessage');
  }
  public templateMessage() {
    return this.unsupported('templateMessage');
  }
}
