export type ManagerFramePolicy = {
  enabled: boolean;
  frameAncestors: string;
  contentSecurityPolicy: string;
};

export type ManagerEmbeddingOverride = {
  configured: boolean;
  enabled: boolean;
  allowedOrigins: string[];
};

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function localDevelopmentHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase());
}

export function normalizeManagerFrameOrigins(
  values: string[],
  production = process.env.NODE_ENV === 'PROD' || process.env.NODE_ENV === 'production',
): string[] {
  const normalized: string[] = [];
  for (const rawValue of values) {
    const raw = String(rawValue || '').trim();
    if (!raw || raw.length > 300 || /[\u0000-\u0020\u007f]/.test(raw)) {
      throw new Error('Origem de iframe inválida.');
    }

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('Informe uma origem válida, por exemplo https://hub.example.com.');
    }

    const localHttp = !production && url.protocol === 'http:' && localDevelopmentHost(url.hostname);
    if (url.protocol !== 'https:' && !localHttp) {
      throw new Error('Origens de iframe devem usar HTTPS.');
    }
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
      throw new Error('Cadastre somente a origem, sem caminho, credenciais, query ou fragmento.');
    }
    if (!url.hostname || raw.includes('*')) {
      throw new Error('Curingas não são permitidos no cadastro de origens.');
    }

    const origin = url.origin;
    if (!normalized.includes(origin)) normalized.push(origin);
  }

  if (normalized.length > 12) throw new Error('Cadastre no máximo 12 origens de iframe.');
  return normalized;
}

function envFrameAncestors(env: NodeJS.ProcessEnv): string[] {
  const requested = String(env.MANAGER_FRAME_ANCESTORS || '*')
    .replace(/[\r\n]/g, ' ')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((token) =>
      ['*', "'self'", "'none'", 'https:', 'http:'].includes(token) ||
      /^https?:\/\/(?:\*\.)?[a-z0-9.-]+(?::\d{1,5})?$/i.test(token),
    );

  if (!requested.length) return ['*'];
  if (requested.includes("'none'")) return ["'none'"];
  if (requested.includes('*')) return ['*'];
  return [...new Set(requested)];
}

export function managerFramePolicy(
  env: NodeJS.ProcessEnv = process.env,
  persisted?: ManagerEmbeddingOverride | null,
): ManagerFramePolicy {
  if (persisted?.configured) {
    if (!persisted.enabled) {
      return { enabled: false, frameAncestors: "'none'", contentSecurityPolicy: "frame-ancestors 'none'" };
    }

    let allowed: string[];
    try {
      allowed = normalizeManagerFrameOrigins(persisted.allowedOrigins || []);
    } catch {
      return { enabled: false, frameAncestors: "'none'", contentSecurityPolicy: "frame-ancestors 'none'" };
    }
    if (!allowed.length) {
      return { enabled: false, frameAncestors: "'none'", contentSecurityPolicy: "frame-ancestors 'none'" };
    }

    const frameAncestors = ["'self'", ...allowed].join(' ');
    return { enabled: true, frameAncestors, contentSecurityPolicy: `frame-ancestors ${frameAncestors}` };
  }

  const enabled = envBoolean(env.MANAGER_IFRAME_ENABLED, true);
  if (!enabled) {
    return { enabled: false, frameAncestors: "'none'", contentSecurityPolicy: "frame-ancestors 'none'" };
  }

  const ancestors = envFrameAncestors(env);
  const frameAncestors = ancestors.join(' ');
  return {
    enabled: frameAncestors !== "'none'",
    frameAncestors,
    contentSecurityPolicy: `frame-ancestors ${frameAncestors}`,
  };
}
