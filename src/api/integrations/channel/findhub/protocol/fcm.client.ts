import { createECDH, randomBytes, randomUUID } from 'crypto';
import tls, { TLSSocket } from 'tls';

import { decryptLegacyWebPush, webPushParams } from '../crypto/webpush';
import { GOOGLE_ADM_CONFIG, GOOGLE_ENDPOINTS } from '../findhub.constants';
import { FindHubFcmCredentials } from '../findhub.types';
import {
  bytes,
  concat,
  fieldBytes,
  fieldFixed64,
  fieldMessage,
  fieldString,
  fieldVarint,
  fixed64,
  parseFields,
  readVarint,
  repeatedBytes,
  string,
  varint,
} from './protobuf';

function b64url(value: Buffer): string {
  return value.toString('base64url');
}

function encodeCheckin(androidId?: bigint, securityToken?: bigint): Buffer {
  const chromeBuild = concat(fieldVarint(1, 3), fieldString(2, GOOGLE_ADM_CONFIG.chromeVersion), fieldVarint(3, 1));
  const checkin = concat(fieldVarint(12, 3), fieldMessage(13, chromeBuild));
  const fields = [fieldMessage(4, checkin), fieldVarint(14, 3), fieldVarint(22, 0)];
  if (androidId && securityToken) {
    fields.push(fieldVarint(2, androidId));
    fields.push(fieldFixed64(13, securityToken));
  }
  return concat(...fields);
}

function decodeCheckin(payload: Buffer): { androidId: string; securityToken: string } {
  const androidId = int64Flexible(payload, 7);
  const securityToken = fixed64(payload, 8);
  if (androidId === undefined || securityToken === undefined) throw new Error('Invalid Google check-in response');
  return { androidId: androidId.toString(), securityToken: securityToken.toString() };
}

function int64Flexible(payload: Buffer, fieldNo: number): bigint | undefined {
  const candidate = parseFields(payload).find((field) => field.no === fieldNo);
  if (!candidate) return undefined;
  if (candidate.wire === 0) return candidate.value as bigint;
  if (candidate.wire === 1) return (candidate.value as Buffer).readBigUInt64LE(0);
  return undefined;
}

async function responseJson(response: Response): Promise<any> {
  const text = await response.text();
  if (!response.ok) throw new Error(`Google FCM request failed (${response.status})`);
  return text ? JSON.parse(text) : {};
}

async function checkin(existing?: FindHubFcmCredentials): Promise<{ androidId: string; securityToken: string }> {
  const body = encodeCheckin(
    existing ? BigInt(existing.gcm.androidId) : undefined,
    existing ? BigInt(existing.gcm.securityToken) : undefined,
  );
  const response = await fetch(GOOGLE_ENDPOINTS.checkin, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
    headers: { 'Content-Type': 'application/x-protobuf' },
    body: Uint8Array.from(body),
  });
  if (!response.ok) throw new Error(`Google check-in failed (${response.status})`);
  return decodeCheckin(Buffer.from(await response.arrayBuffer()));
}

async function gcmRegister(checkinData: {
  androidId: string;
  securityToken: string;
}): Promise<{ token: string; appId: string }> {
  const appId = `wp:${GOOGLE_ADM_CONFIG.androidPackage}#${randomUUID()}`;
  const body = new URLSearchParams({
    app: GOOGLE_ADM_CONFIG.chromeId,
    'X-subtype': appId,
    device: checkinData.androidId,
    sender: GOOGLE_ADM_CONFIG.vapidKey,
  });
  const response = await fetch(GOOGLE_ENDPOINTS.gcmRegister, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
    headers: {
      Authorization: `AidLogin ${checkinData.androidId}:${checkinData.securityToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const text = await response.text();
  if (!response.ok || !text.startsWith('token=')) throw new Error('Google GCM registration failed');
  const token = text.slice('token='.length).trim();
  if (!token || /\s/.test(token)) throw new Error('Invalid Google GCM registration token');
  return { token, appId };
}

async function fcmInstall(): Promise<{ fid: string; authToken: string; refreshToken?: string }> {
  const fidBytes = randomBytes(17);
  fidBytes[0] = 0x70 + (fidBytes[0] % 0x10);
  // Firebase installations require exactly 22 URL-safe base64 characters (132 bits).
  const fid = fidBytes.toString('base64url').slice(0, 22);
  const heartbeat = Buffer.from(JSON.stringify({ heartbeats: [], version: 2 })).toString('base64');
  const response = await fetch(GOOGLE_ENDPOINTS.fcmInstall, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'x-firebase-client': heartbeat,
      'x-goog-api-key': GOOGLE_ADM_CONFIG.apiKey,
      'X-Android-Package': GOOGLE_ADM_CONFIG.androidPackage,
      'X-Android-Cert': GOOGLE_ADM_CONFIG.androidCertSha1,
    },
    body: JSON.stringify({
      appId: GOOGLE_ADM_CONFIG.appId,
      authVersion: 'FIS_v2',
      fid,
      sdkVersion: 'w:0.6.6',
    }),
  });
  const data = await responseJson(response);
  const assignedFid = data.fid || fid;
  if (
    typeof assignedFid !== 'string' ||
    !/^[cdef][A-Za-z0-9_-]{21}$/.test(assignedFid) ||
    typeof data.authToken?.token !== 'string' ||
    !data.authToken.token
  ) {
    throw new Error('Invalid Firebase installation response');
  }
  return {
    fid: assignedFid,
    authToken: data.authToken.token,
    refreshToken: data.refreshToken,
  };
}

async function fcmRegister(
  gcmToken: string,
  installation: { fid: string; authToken: string },
  publicKey: Buffer,
  authSecret: Buffer,
): Promise<{ token: string }> {
  const endpoint = `${GOOGLE_ENDPOINTS.fcmRegisterBase}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-firebase-installations-auth': installation.authToken,
      'x-goog-api-key': GOOGLE_ADM_CONFIG.apiKey,
      'X-Android-Package': GOOGLE_ADM_CONFIG.androidPackage,
      'X-Android-Cert': GOOGLE_ADM_CONFIG.androidCertSha1,
    },
    body: JSON.stringify({
      web: {
        applicationPubKey: null,
        auth: b64url(authSecret),
        endpoint: `${GOOGLE_ENDPOINTS.fcmSendBase}${gcmToken}`,
        p256dh: b64url(publicKey),
      },
    }),
  });
  const data = await responseJson(response);
  const token = data.token || data.name?.split('/').pop();
  if (!token) throw new Error('Google FCM registration token missing');
  return { token };
}

function encodeSetting(name: string, value: string): Buffer {
  return concat(fieldString(1, name), fieldString(2, value));
}

function encodeHeartbeatStat(): Buffer {
  return concat(fieldString(1, ''), fieldVarint(2, true), fieldVarint(3, 10_000));
}

function encodeSelectiveAck(persistentId: string, lastStreamId: number): Buffer {
  const selectiveAck = fieldString(1, persistentId);
  const extension = concat(fieldVarint(1, 12), fieldBytes(2, selectiveAck));
  return concat(fieldVarint(2, 1), fieldString(3, ''), fieldMessage(7, extension), fieldVarint(10, lastStreamId));
}

function encodeHeartbeatAck(lastStreamId: number): Buffer {
  return lastStreamId > 0 ? fieldVarint(2, lastStreamId) : Buffer.alloc(0);
}

function encodeLogin(credentials: FindHubFcmCredentials): Buffer {
  const androidId = credentials.gcm.androidId;
  const fields: Buffer[] = [
    fieldString(1, GOOGLE_ADM_CONFIG.chromeVersion),
    fieldString(2, 'mcs.android.com'),
    fieldString(3, androidId),
    fieldString(4, androidId),
    fieldString(5, credentials.gcm.securityToken),
    fieldString(6, `android-${BigInt(androidId).toString(16)}`),
    fieldMessage(8, encodeSetting('new_vc', '1')),
    fieldVarint(12, false),
    fieldMessage(13, encodeHeartbeatStat()),
    fieldVarint(14, true),
    fieldVarint(16, 2),
    fieldVarint(17, 1),
  ];
  for (const id of credentials.persistentIds || []) fields.push(fieldString(10, id));
  return concat(...fields);
}

function encodePacket(tag: number, payload: Buffer, includeVersion: boolean): Buffer {
  return concat(includeVersion ? Buffer.from([41, tag]) : Buffer.from([tag]), varint(payload.length), payload);
}

function decodeAppData(payload: Buffer): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of repeatedBytes(payload, 7)) {
    const key = string(value, 1);
    const data = string(value, 2);
    if (key && data !== undefined) result[key] = data;
  }
  return result;
}

export class FindHubFcmClient {
  private socket?: TLSSocket;
  private receiveBuffer = Buffer.alloc(0);
  private firstInbound = true;
  private firstOutbound = true;
  private stopped = false;
  private reconnectTimer?: NodeJS.Timeout;
  private inputStreamId = 0;
  private authenticated = false;
  private heartbeatTimer?: NodeJS.Timeout;
  private heartbeatDeadline?: NodeJS.Timeout;
  private loginResult?: (error?: Error) => void;

  public get ready(): boolean {
    return this.authenticated && !this.stopped;
  }

  constructor(
    private credentials: FindHubFcmCredentials | null,
    private readonly onCredentials: (credentials: FindHubFcmCredentials) => Promise<void>,
    private readonly onPayload: (payload: Buffer) => void,
  ) {}

  public get registrationToken(): string {
    if (!this.credentials?.registration?.token) throw new Error('Find Hub FCM registration is not ready');
    return this.credentials.registration.token;
  }

  public get currentCredentials(): FindHubFcmCredentials | null {
    return this.credentials;
  }

  public async ensureRegistered(): Promise<FindHubFcmCredentials> {
    if (this.credentials?.registration?.token && this.credentials?.keys?.privateKey) return this.credentials;
    const checkinData = await checkin(this.credentials ?? undefined);
    const gcm = await gcmRegister(checkinData);
    const installation = await fcmInstall();
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const publicKey = ecdh.getPublicKey(undefined, 'uncompressed');
    const privateKey = ecdh.getPrivateKey();
    const authSecret = randomBytes(16);
    const registration = await fcmRegister(gcm.token, installation, publicKey, authSecret);
    this.credentials = {
      gcm: { ...checkinData, token: gcm.token, appId: gcm.appId },
      keys: {
        privateKey: privateKey.toString('base64'),
        publicKey: publicKey.toString('base64'),
        authSecret: authSecret.toString('base64'),
      },
      installation,
      registration,
      persistentIds: [],
    };
    await this.onCredentials(this.credentials);
    return this.credentials;
  }

  public async start(): Promise<void> {
    this.stopped = false;
    await this.ensureRegistered();
    if (this.stopped) throw new Error('Find Hub connection cancelled');
    await this.connect();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    this.authenticated = false;
    this.clearHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.destroy();
    this.socket = undefined;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    await new Promise<void>((resolve, reject) => {
      const socket = tls.connect({
        host: GOOGLE_ENDPOINTS.mcsHost,
        port: GOOGLE_ENDPOINTS.mcsPort,
        servername: GOOGLE_ENDPOINTS.mcsHost,
      });
      const timeout = setTimeout(() => {
        reject(new Error('Google MCS connection timed out'));
        socket.destroy();
      }, 30_000);
      socket.once('close', () => {
        if (this.socket !== socket) return;
        this.clearHeartbeat();
        this.authenticated = false;
        this.loginResult = undefined;
        clearTimeout(timeout);
        reject(new Error('Google MCS connection closed'));
      });
      this.authenticated = false;
      this.loginResult = (error) => {
        clearTimeout(timeout);
        this.loginResult = undefined;
        if (error) {
          reject(error);
          socket.destroy();
        } else {
          this.authenticated = true;
          this.monitorHeartbeat();
          resolve();
        }
      };
      this.socket = socket;
      this.receiveBuffer = Buffer.alloc(0);
      this.firstInbound = true;
      this.firstOutbound = true;
      this.inputStreamId = 0;
      socket.once('secureConnect', () => {
        try {
          socket.write(encodePacket(2, encodeLogin(this.credentials!), this.firstOutbound));
          this.firstOutbound = false;
          // LoginResponse, not the TLS handshake, confirms authentication.
        } catch (error) {
          reject(error);
        }
      });
      socket.on('data', (chunk) => {
        if (this.socket !== socket || this.stopped) return;
        try {
          this.consume(chunk);
        } catch {
          socket.destroy(new Error('Invalid Google MCS frame'));
        }
      });
      socket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      socket.on('close', () => {
        if (this.socket === socket) this.scheduleReconnect();
      });
    });
  }

  private clearHeartbeat(): void {
    clearTimeout(this.heartbeatTimer);
    clearTimeout(this.heartbeatDeadline);
    this.heartbeatTimer = undefined;
    this.heartbeatDeadline = undefined;
  }

  private monitorHeartbeat(): void {
    this.clearHeartbeat();
    if (this.stopped || !this.authenticated || !this.socket) return;
    const socket = this.socket;
    // Match the reference receiver: probe after 20 s of silence; reconnect after 5 s without traffic.
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = undefined;
      if (this.socket !== socket || this.stopped || !this.authenticated) return;
      this.heartbeatDeadline = setTimeout(() => {
        this.heartbeatDeadline = undefined;
        if (this.socket !== socket || this.stopped) return;
        this.authenticated = false;
        socket.destroy(); // Existing close/reconnect path reuses the registered credentials.
      }, 5000);
      this.heartbeatDeadline.unref?.();
      try {
        socket.write(encodePacket(0, encodeHeartbeatAck(this.inputStreamId), this.firstOutbound));
        this.firstOutbound = false;
      } catch {
        this.clearHeartbeat();
        this.authenticated = false;
        socket.destroy();
      }
    }, 20_000);
    this.heartbeatTimer.unref?.();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch(() => this.scheduleReconnect());
    }, 5000);
  }

  private consume(chunk: Buffer): void {
    if (this.receiveBuffer.length + chunk.length > 1048576) throw new Error('Google MCS receive buffer too large');
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]);
    while (this.receiveBuffer.length > 0) {
      let offset = 0;
      if (this.firstInbound) {
        if (this.receiveBuffer.length < 2) return;
        const version = this.receiveBuffer[0];
        if (version < 38) throw new Error(`Unsupported Google MCS version ${version}`);
        offset = 1;
      }
      if (this.receiveBuffer.length <= offset) return;
      const tag = this.receiveBuffer[offset++];
      let lengthInfo: ReturnType<typeof readVarint>;
      try {
        lengthInfo = readVarint(this.receiveBuffer, offset);
      } catch {
        return;
      }
      const size = Number(lengthInfo.value);
      if (!Number.isSafeInteger(size) || size < 0 || size > 1048576) throw new Error('Google MCS frame too large');
      const start = lengthInfo.offset;
      if (this.receiveBuffer.length < start + size) return;
      this.firstInbound = false;
      const payload = this.receiveBuffer.subarray(start, start + size);
      this.receiveBuffer = this.receiveBuffer.subarray(start + size);
      this.handleFrame(tag, payload);
    }
  }

  private handleFrame(tag: number, payload: Buffer): void {
    this.inputStreamId += 1;
    if (this.authenticated) this.monitorHeartbeat();
    if (tag === 3) {
      const error = bytes(payload, 3);
      this.loginResult?.(error || !string(payload, 1) ? new Error('Google MCS login rejected') : undefined);
      return;
    }
    if (tag === 4) {
      this.socket?.destroy();
      return;
    }
    if (tag === 0) {
      this.socket?.write(encodePacket(1, encodeHeartbeatAck(this.inputStreamId), this.firstOutbound));
      this.firstOutbound = false;
      return;
    }
    if (tag !== 8 || !this.credentials) return;
    const appData = decodeAppData(payload);
    const persistentId = string(payload, 9);
    const rawData = bytes(payload, 21);
    if (persistentId) {
      if (!this.credentials.persistentIds.includes(persistentId)) {
        this.credentials.persistentIds.push(persistentId);
        this.credentials.persistentIds = this.credentials.persistentIds.slice(-512);
        void this.onCredentials(this.credentials).catch(() => {
          this.socket?.destroy();
        });
      }
      this.socket?.write(encodePacket(7, encodeSelectiveAck(persistentId, this.inputStreamId), this.firstOutbound));
      this.firstOutbound = false;
    }
    if (!rawData) return;
    try {
      const params = webPushParams(appData);
      const plain = decryptLegacyWebPush({
        privateKey: Buffer.from(this.credentials.keys.privateKey, 'base64'),
        publicKey: Buffer.from(this.credentials.keys.publicKey, 'base64'),
        authSecret: Buffer.from(this.credentials.keys.authSecret, 'base64'),
        senderPublicKey: params.senderPublicKey,
        salt: params.salt,
        payload: rawData,
      });
      const notification = JSON.parse(plain.toString('utf8'));
      const encoded = notification?.data?.['com.google.android.apps.adm.FCM_PAYLOAD'];
      if (encoded) this.onPayload(Buffer.from(encoded, 'base64'));
    } catch {
      // Privacy boundary: never log raw notification payloads or credentials.
    }
  }
}
