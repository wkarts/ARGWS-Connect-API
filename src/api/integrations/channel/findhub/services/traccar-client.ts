import { createHash } from 'crypto';
import WebSocket from 'ws';

export interface TraccarConnection {
  mode: 'disabled' | 'internal' | 'external';
  url?: string;
  receiverUrl?: string;
  token?: string;
  timeoutMs?: number;
}

/** Only installation administrators can authorize network destinations. Never follow redirects with credentials. */
export function traccarDestination(value: string, internal = false, receiver = false): URL {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search || !['http:', 'https:'].includes(url.protocol))
    throw new Error('Endereço Traccar inválido.');
  const internalUrl = receiver
    ? process.env.TRACCAR_INTERNAL_RECEIVER_URL || 'http://traccar:5055'
    : process.env.TRACCAR_INTERNAL_URL || 'http://traccar:8082';
  const allowed = internal
    ? [new URL(internalUrl).origin]
    : [
        ...String(process.env.TRACCAR_ALLOWED_ORIGINS || '').split(','),
        process.env.TRACCAR_URL || '',
        process.env.TRACCAR_RECEIVER_URL || '',
      ]
        .map((x) => x.trim())
        .filter(Boolean);
  if (!allowed.includes(url.origin) || (!internal && url.protocol !== 'https:'))
    throw new Error('Destino Traccar não autorizado. Configure TRACCAR_ALLOWED_ORIGINS na instalação.');
  if (url.pathname !== '/') throw new Error('Informe a origem Traccar, sem caminho, parâmetros ou credenciais.');
  return url;
}

export function resolveTraccarConnection(config: TraccarConnection): TraccarConnection {
  if (config.mode === 'disabled') return { mode: 'disabled' };
  if (String(process.env.TRACCAR_ENABLED || 'false').toLowerCase() !== 'true')
    throw new Error('A integração Traccar está desabilitada na instalação.');
  if (!['internal', 'external'].includes(config.mode)) throw new Error('Modo Traccar inválido.');
  const internal = config.mode === 'internal';
  if (internal && process.env.TRACCAR_MODE !== 'internal')
    throw new Error('O Traccar interno não foi habilitado no deploy.');
  const url = traccarDestination(
    internal ? process.env.TRACCAR_INTERNAL_URL || 'http://traccar:8082' : config.url || process.env.TRACCAR_URL || '',
    internal,
  );
  const receiverUrl = traccarDestination(
    internal
      ? process.env.TRACCAR_INTERNAL_RECEIVER_URL || 'http://traccar:5055'
      : config.receiverUrl || process.env.TRACCAR_RECEIVER_URL || '',
    internal,
    true,
  );
  const timeoutMs = Number(config.timeoutMs ?? process.env.FINDHUB_TRACCAR_TIMEOUT_MS ?? 10000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000)
    throw new Error('Timeout Traccar inválido.');
  const token = internal
    ? process.env.TRACCAR_TOKEN || ''
    : config.token || (url.origin === process.env.TRACCAR_URL ? process.env.TRACCAR_TOKEN || '' : '');
  if (!internal && (!token || token.length > 8192 || /[\r\n]/.test(token)))
    throw new Error('Informe um token Traccar válido.');
  return { mode: config.mode, url: url.origin, receiverUrl: receiverUrl.origin, token, timeoutMs };
}

export function traccarUniqueId(instanceId: string, deviceId: string): string {
  return (
    'connect-' +
    createHash('sha256')
      .update(instanceId + ':' + deviceId)
      .digest('hex')
      .slice(0, 40)
  );
}

export type TraccarPositionMetadata = {
  batteryLevel?: number;
  batteryTier?: string;
  batteryTierSource?: string;
  charging?: boolean;
  attributes?: Record<string, string | number | boolean | null | undefined>;
};

type TraccarSendPosition = {
  latitude: number;
  longitude: number;
  timestamp: string;
  accuracy?: number;
  altitude?: number;
} & TraccarPositionMetadata;

function safeTraccarDetail(value: unknown): string | undefined {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (
    !normalized ||
    normalized.startsWith('<') ||
    /(?:password|authorization|cookie|set-cookie|token|secret)/i.test(normalized)
  )
    return undefined;
  return normalized.slice(0, 240);
}

async function readTraccarErrorDetail(response: Response): Promise<string | undefined> {
  try {
    const body = await response.text();
    if (!body.trim()) return undefined;
    try {
      const parsed = JSON.parse(body);
      for (const value of [parsed?.message, parsed?.error, parsed?.detail, parsed?.title, parsed?.exception]) {
        const detail = safeTraccarDetail(value);
        if (detail) return detail;
      }
    } catch {
      // Some Traccar errors are plain text; sanitize that fallback below.
    }
    return safeTraccarDetail(body);
  } catch {
    return undefined;
  }
}

/** REST/session and socket clients are backend-only. No Google or Traccar credentials are returned to the Manager. */
export class TraccarClient {
  private cookie = '';
  private socket?: WebSocket;
  private reconnect?: NodeJS.Timeout;
  private stopped = false;
  private failures = 0;
  private readonly config: TraccarConnection;
  constructor(config: TraccarConnection) {
    this.config = resolveTraccarConnection(config);
  }

  private async request(
    path: string,
    method = 'GET',
    payload?: unknown,
    form?: URLSearchParams,
    allowNotFound = false,
  ): Promise<any> {
    if (this.config.mode === 'disabled') throw new Error('Traccar desabilitado.');
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.cookie) headers.Cookie = this.cookie;
    else if (this.config.token) headers.Authorization = 'Bearer ' + this.config.token;
    else if (this.config.mode === 'internal') {
      const email = process.env.TRACCAR_ADMIN_EMAIL,
        password = process.env.TRACCAR_ADMIN_PASSWORD;
      if (!email || !password) throw new Error('Credenciais do Traccar interno ausentes.');
      headers.Authorization = 'Basic ' + Buffer.from(email + ':' + password).toString('base64');
    }
    if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    else if (payload !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(this.config.url + path, {
        method,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.timeoutMs!),
        body: form ? form.toString() : payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch {
      throw new Error('Traccar indisponível ou timeout de conexão.');
    }
    if (!response.ok) {
      if (allowNotFound && response.status === 404) {
        await response.body?.cancel();
        return null;
      }
      const detail = await readTraccarErrorDetail(response);
      const operation = `${method} ${path.split('?')[0]}`;
      throw new Error(
        `Traccar recusou ${operation} (HTTP ${response.status})${detail ? `: ${detail}` : ''}.`,
      );
    }
    const cookies = response.headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
    const sessionCookie = cookies.map((x) => x.split(';')[0]).find((x) => /^JSESSIONID=/.test(x));
    if (sessionCookie) this.cookie = sessionCookie;
    if (response.status === 204) return null;
    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (size <= 4 * 1024 * 1024) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 4 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('Resposta Traccar excedeu o limite.');
        }
        chunks.push(next.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error('Resposta Traccar inválida.');
    } finally {
      reader.releaseLock();
    }
  }

  public async session(): Promise<void> {
    this.cookie = '';
    if (this.config.token) {
      // Token query is required by the official session endpoint; it never reaches browser/log output.
      await this.request('/api/session?token=' + encodeURIComponent(this.config.token));
    } else {
      await this.request(
        '/api/session',
        'POST',
        undefined,
        new URLSearchParams({
          email: process.env.TRACCAR_ADMIN_EMAIL || '',
          password: process.env.TRACCAR_ADMIN_PASSWORD || '',
        }),
      );
    }
    if (!this.cookie) throw new Error('O Traccar não forneceu uma sessão para o realtime.');
  }

  public async provision(
    instanceId: string,
    deviceId: string,
    name: string,
    attributes: Record<string, string | number | boolean | null | undefined> = {},
  ): Promise<{ id: number; uniqueId: string }> {
    // Traccar's REST catalog requires an authenticated session; Basic Auth alone is not
    // sufficient for /api/devices on the internal server.
    if (!this.cookie) await this.session();
    const uniqueId = traccarUniqueId(instanceId, deviceId);
    const remoteAttributes = {
      connectInstanceId: instanceId,
      connectDeviceId: deviceId,
      ...Object.fromEntries(
        Object.entries(attributes).filter(([, value]) => value !== undefined && value !== null && value !== ''),
      ),
    };
    const existing = await this.request('/api/devices?uniqueId=' + encodeURIComponent(uniqueId));
    if (!Array.isArray(existing)) throw new Error('Catálogo Traccar inválido.');
    let remote = existing.find((x) => x.uniqueId === uniqueId);
    let creationError: Error | undefined;
    if (!remote) {
      try {
        remote = await this.request('/api/devices', 'POST', {
          name,
          uniqueId,
          attributes: remoteAttributes,
        });
      } catch (error) {
        creationError = error instanceof Error ? error : new Error('Falha ao criar o dispositivo no Traccar.');
        try {
          const retry = await this.request('/api/devices?uniqueId=' + encodeURIComponent(uniqueId));
          remote = Array.isArray(retry) ? retry.find((x) => x.uniqueId === uniqueId) : null;
        } catch {
          // Preserve the original create response; the retry is only an idempotency check.
          remote = null;
        }
      }
    }
    if (!remote && creationError) throw creationError;
    if (
      !Number.isSafeInteger(remote?.id) ||
      remote.id < 1 ||
      remote.uniqueId !== uniqueId ||
      remote.attributes?.connectInstanceId !== instanceId ||
      remote.attributes?.connectDeviceId !== deviceId
    )
      throw new Error('O dispositivo Traccar não pertence a esta vinculação.');
    const currentAttributes = remote.attributes && typeof remote.attributes === 'object' ? remote.attributes : {};
    const mergedAttributes = { ...currentAttributes, ...remoteAttributes };
    const changed = Object.entries(remoteAttributes).some(([key, value]) => currentAttributes[key] !== value);
    if (changed) {
      await this.request('/api/devices/' + remote.id, 'PUT', {
        id: remote.id,
        name: remote.name || name,
        uniqueId,
        attributes: mergedAttributes,
      });
    }
    return { id: remote.id, uniqueId };
  }

  /** Delete only a device provably provisioned by this Connect|API instance. */
  public async removeProvisioned(
    instanceId: string,
    deviceId: string,
    numericId: number | null | undefined,
    uniqueId: string,
  ): Promise<void> {
    if (!uniqueId || !/^connect-[a-f0-9]{40}$/.test(uniqueId))
      throw new Error('Identificador Traccar da vinculação inválido.');
    if (numericId !== null && numericId !== undefined && (!Number.isSafeInteger(numericId) || numericId < 1))
      throw new Error('Dispositivo Traccar inválido.');
    let remote = numericId ? await this.request('/api/devices/' + numericId, 'GET', undefined, undefined, true) : null;
    if (!remote) {
      const rows = await this.request('/api/devices?uniqueId=' + encodeURIComponent(uniqueId));
      if (!Array.isArray(rows)) throw new Error('Catálogo Traccar inválido.');
      remote = rows.find((candidate) => candidate?.uniqueId === uniqueId) || null;
    }
    if (!remote) return; // Idempotent: the remote device is already gone.
    if (
      !Number.isSafeInteger(remote.id) ||
      remote.id < 1 ||
      remote.uniqueId !== uniqueId ||
      remote.attributes?.connectInstanceId !== instanceId ||
      remote.attributes?.connectDeviceId !== deviceId
    )
      throw new Error('O dispositivo Traccar não pertence a esta vinculação; remoção bloqueada.');
    await this.request('/api/devices/' + remote.id, 'DELETE', undefined, undefined, true);
  }

  public async latestPositions(deviceId: number): Promise<any[]> {
    if (!Number.isSafeInteger(deviceId) || deviceId < 1) throw new Error('Dispositivo Traccar inválido.');
    const rows = await this.request('/api/positions?deviceId=' + deviceId);
    if (!Array.isArray(rows)) throw new Error('Posições Traccar inválidas.');
    return rows.filter((row) => row.deviceId === deviceId);
  }

  public async send(uniqueId: string, position: TraccarSendPosition): Promise<void> {
    const body = new URLSearchParams({
      id: uniqueId,
      valid: '1',
      lat: String(position.latitude),
      lon: String(position.longitude),
      timestamp: String(Date.parse(position.timestamp) / 1000),
    });
    if (position.accuracy !== undefined) body.set('accuracy', String(position.accuracy));
    if (position.altitude !== undefined) body.set('altitude', String(position.altitude));
    if (Number.isFinite(position.batteryLevel) && position.batteryLevel! >= 0 && position.batteryLevel! <= 100)
      body.set('batt', String(position.batteryLevel));
    if (position.charging !== undefined) body.set('charge', String(position.charging));
    if (position.batteryTier) body.set('findhubBatteryTier', position.batteryTier);
    if (position.batteryTierSource) body.set('findhubBatteryTierSource', position.batteryTierSource);
    for (const [key, value] of Object.entries(position.attributes || {})) {
      if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key) || value === undefined || value === null || value === '') continue;
      body.set(key, String(value));
    }
    try {
      const response = await fetch(this.config.receiverUrl!, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(this.config.timeoutMs!),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error('rejected');
    } catch {
      throw new Error('Não foi possível encaminhar a posição ao receptor Traccar.');
    }
  }

  public start(onData: (data: any) => Promise<void>, onState: (state: string) => void): void {
    this.stopped = false;
    const open = async () => {
      if (this.stopped) return;
      try {
        await this.session();
        if (this.stopped) return;
        const url = new URL('/api/socket', this.config.url);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        const socket = new WebSocket(url, {
          headers: { Cookie: this.cookie },
          handshakeTimeout: this.config.timeoutMs,
          maxPayload: 4 * 1024 * 1024,
        });
        this.socket = socket;
        let pending = 0;
        socket.on('open', () => {
          this.failures = 0;
          onState('connected');
        });
        socket.on('message', (raw) => {
          // Prevent an upstream burst from building an unbounded database write queue.
          if (this.stopped || this.socket !== socket) return;
          if (pending >= 8) {
            socket.close(1008, 'backpressure');
            return;
          }
          let data: any;
          try {
            data = JSON.parse(raw.toString());
          } catch {
            return;
          }
          pending++;
          void onData(data)
            .catch(() => onState('degraded'))
            .finally(() => {
              pending--;
            });
        });
        socket.on('error', () => {
          onState('degraded');
          socket.close();
        });
        socket.on('close', schedule);
      } catch {
        schedule();
      }
    };
    const schedule = () => {
      if (this.stopped || this.reconnect) return;
      onState('disconnected');
      this.reconnect = setTimeout(
        () => {
          this.reconnect = undefined;
          void open();
        },
        Math.min(60000, 1000 * 2 ** Math.min(++this.failures, 6)),
      );
      this.reconnect.unref?.();
    };
    void open();
  }
  public close(): void {
    this.stopped = true;
    clearTimeout(this.reconnect);
    this.reconnect = undefined;
    this.socket?.removeAllListeners();
    this.socket?.on('error', () => undefined);
    this.socket?.terminate();
    this.socket = undefined;
    this.cookie = '';
  }
}
