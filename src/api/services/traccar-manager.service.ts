import { Logger } from '@config/logger.config';

type TraccarConfiguration = {
  internalUrl: URL;
  email: string;
  password: string;
};

export type TraccarManagerOverview = {
  server: unknown;
  devices: unknown[];
  positions: unknown[];
  refreshedAt: string;
  map: { tileUrl: string };
};

const REQUEST_TIMEOUT_MS = 15_000;
const SESSION_TTL_MS = 15 * 60_000;

function enabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    String(value || '')
      .trim()
      .toLowerCase(),
  );
}

function parseInternalUrl(value: string | undefined): URL {
  const raw = String(value || 'http://traccar:8082').trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('TRACCAR_INTERNAL_URL inválida.');
  }
  if (
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== '/' && url.pathname !== '') ||
    !['http:', 'https:'].includes(url.protocol)
  ) {
    throw new Error('TRACCAR_INTERNAL_URL deve conter somente uma origem HTTP(S) interna.');
  }
  return url;
}

function sessionCookieFromHeader(value: string | undefined): string | null {
  if (!value || value.length > 2048 || /[\r\n]/.test(value)) return null;
  const candidate = value
    .split(';')
    .map((part) => part.trim())
    .find((part) => /^JSESSIONID=[^;]+$/i.test(part));
  return candidate || null;
}

function loginCookie(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() || [response.headers.get('set-cookie') || ''];
  for (const value of values) {
    const cookie = sessionCookieFromHeader(value);
    if (cookie) return cookie;
  }
  return null;
}

/** The Manager only renders the Traccar screen when the internal handoff is complete. */
export function traccarManagerPortalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    if (!enabled(env.TRACCAR_ENABLED) || env.TRACCAR_MODE !== 'internal') return false;
    parseInternalUrl(env.TRACCAR_INTERNAL_URL);
    const email = String(env.TRACCAR_ADMIN_EMAIL || '').trim();
    const password = String(env.TRACCAR_ADMIN_PASSWORD || '');
    return Boolean(email && password && !/[\r\n]/.test(email) && !/[\r\n]/.test(password));
  } catch {
    return false;
  }
}

export class TraccarManagerError extends Error {
  constructor(
    message: string,
    public readonly status = 503,
  ) {
    super(message);
    this.name = 'TraccarManagerError';
  }
}

/**
 * Read-only Manager facade for the internal Traccar API. The Traccar session
 * stays in the API process; neither its administrative password nor its cookie
 * is ever sent to a browser.
 */
export class TraccarManagerService {
  private readonly logger = new Logger('TRACCAR MANAGER');
  private sessionCookie: string | null = null;
  private sessionExpiresAt = 0;
  private pendingLogin: Promise<string> | null = null;

  public available(): boolean {
    return this.configuration(false) !== null;
  }

  public async overview(): Promise<TraccarManagerOverview> {
    const configuration = this.requiredConfiguration();
    const [server, devices, positions] = await Promise.all([
      this.readJson(configuration, '/api/server'),
      this.readJson(configuration, '/api/devices'),
      this.readJson(configuration, '/api/positions'),
    ]);
    return {
      server,
      devices: Array.isArray(devices) ? devices : [],
      positions: Array.isArray(positions) ? positions : [],
      refreshedAt: new Date().toISOString(),
      map: { tileUrl: process.env.FINDHUB_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
    };
  }

  private configuration(throwOnError: boolean): TraccarConfiguration | null {
    try {
      if (!enabled(process.env.TRACCAR_ENABLED) || process.env.TRACCAR_MODE !== 'internal') return null;
      const internalUrl = parseInternalUrl(process.env.TRACCAR_INTERNAL_URL);
      const email = String(process.env.TRACCAR_ADMIN_EMAIL || '').trim();
      const password = String(process.env.TRACCAR_ADMIN_PASSWORD || '');
      if (!email || !password || /[\r\n]/.test(email) || /[\r\n]/.test(password)) {
        throw new Error('Credenciais administrativas do Traccar não estão disponíveis.');
      }
      return { internalUrl, email, password };
    } catch (error) {
      if (throwOnError) {
        throw new TraccarManagerError(error instanceof Error ? error.message : 'Traccar interno indisponível.');
      }
      return null;
    }
  }

  private requiredConfiguration(): TraccarConfiguration {
    const configuration = this.configuration(true);
    if (!configuration) throw new TraccarManagerError('Traccar interno não habilitado.');
    return configuration;
  }

  private async readJson(configuration: TraccarConfiguration, path: string, retry = true): Promise<unknown> {
    const cookie = await this.session(configuration);
    const response = await this.request(new URL(path, configuration.internalUrl), {
      headers: { accept: 'application/json', cookie },
    });
    if (response.status === 401 && retry) {
      await response.body?.cancel();
      this.clearSession();
      return this.readJson(configuration, path, false);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new TraccarManagerError(`Traccar interno recusou a consulta (${response.status}).`, 502);
    }
    try {
      return await response.json();
    } catch {
      throw new TraccarManagerError('Traccar interno retornou uma resposta inválida.', 502);
    }
  }

  private async session(configuration: TraccarConfiguration): Promise<string> {
    if (this.sessionCookie && this.sessionExpiresAt > Date.now()) return this.sessionCookie;
    if (!this.pendingLogin) {
      this.pendingLogin = this.login(configuration).finally(() => {
        this.pendingLogin = null;
      });
    }
    return this.pendingLogin;
  }

  private async login(configuration: TraccarConfiguration): Promise<string> {
    try {
      const response = await this.request(new URL('/api/session', configuration.internalUrl), {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ email: configuration.email, password: configuration.password }).toString(),
      });
      const cookie = loginCookie(response);
      await response.body?.cancel();
      if (!response.ok || !cookie) {
        throw new TraccarManagerError('Não foi possível autenticar a sessão interna do Traccar.', 502);
      }
      this.sessionCookie = cookie;
      this.sessionExpiresAt = Date.now() + SESSION_TTL_MS;
      return cookie;
    } catch (error) {
      this.clearSession();
      if (error instanceof TraccarManagerError) throw error;
      this.logger.warn('Falha ao abrir sessão interna do Traccar.');
      throw new TraccarManagerError('Traccar interno temporariamente indisponível.', 502);
    }
  }

  private async request(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, redirect: 'error', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private clearSession(): void {
    this.sessionCookie = null;
    this.sessionExpiresAt = 0;
  }
}
