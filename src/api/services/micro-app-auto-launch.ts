export type MicroAppAutoLaunchPolicy = {
  enabled?: boolean;
  appKey?: string;
  ttlSeconds?: number;
  messageText?: string;
  linkPreview?: boolean;
};

export type MicroAppLaunchContext = {
  appKey: string;
  url: string;
  expiresAt?: string;
  contact: {
    name: string;
    whatsapp: string;
    remoteJid?: string;
  };
  system: {
    date: string;
    time: string;
    dateTime: string;
    timezone: string;
  };
};

export function resolveMicroAppAutoLaunch(policy: unknown): MicroAppAutoLaunchPolicy | null {
  if (!policy || typeof policy !== 'object') return null;
  const microApps = (policy as any).microApps;
  const autoLaunch = microApps && typeof microApps === 'object' ? microApps.autoLaunch : null;
  if (!autoLaunch || autoLaunch.enabled !== true) return null;
  const appKey = String(autoLaunch.appKey || '').trim();
  if (!appKey) return null;
  return {
    enabled: true,
    appKey,
    ttlSeconds: normalizeTtl(autoLaunch.ttlSeconds),
    messageText: String(autoLaunch.messageText || '').trim() || 'Abrir Mini App',
    linkPreview: autoLaunch.linkPreview !== false,
  };
}

export function normalizeWhatsappNumber(value: unknown) {
  return String(value || '')
    .replace(/@.+$/, '')
    .replace(/\D/g, '');
}

export function candidateRemoteJids(value: unknown) {
  const number = normalizeWhatsappNumber(value);
  if (!number) return [];
  return [`${number}@s.whatsapp.net`, `${number}@c.us`, number];
}

export function buildMicroAppRuntimeContext(input: {
  appKey: string;
  url: string;
  expiresAt?: string;
  number: string;
  contactName?: string | null;
  remoteJid?: string | null;
  now?: Date;
  timezone?: string;
}): MicroAppLaunchContext {
  const now = input.now || new Date();
  const timezone = String(input.timezone || process.env.TZ || 'America/Bahia');
  const number = normalizeWhatsappNumber(input.number);
  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);
  const time = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);
  const dateTime = `${date} ${time}`;
  return {
    appKey: input.appKey,
    url: input.url,
    expiresAt: input.expiresAt,
    contact: {
      name: String(input.contactName || '').trim() || number || 'Contato WhatsApp',
      whatsapp: number,
      remoteJid: input.remoteJid || undefined,
    },
    system: { date, time, dateTime, timezone },
  };
}

export function mergeRuntimeVariables(
  variables: Record<string, unknown> | null | undefined,
  context: MicroAppLaunchContext,
) {
  const source = variables && typeof variables === 'object' ? variables : {};
  return {
    ...source,
    contact: { ...((source as any).contact || {}), ...context.contact },
    system: { ...((source as any).system || {}), ...context.system },
    microApp: {
      ...((source as any).microApp || {}),
      appKey: context.appKey,
      url: context.url,
      expiresAt: context.expiresAt,
    },
  };
}

export function interpolateRuntimeString(value: unknown, variables: Record<string, unknown>) {
  return String(value ?? '').replace(/{{\s*([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\s*}}/g, (_match, path) => {
    const resolved = String(path)
      .split('.')
      .reduce<any>((current, key) => (current == null ? undefined : current[key]), variables);
    return resolved === undefined || resolved === null ? '' : String(resolved);
  });
}

function normalizeTtl(value: unknown) {
  const ttl = Number(value || 900);
  if (!Number.isFinite(ttl)) return 900;
  return Math.min(Math.max(Math.round(ttl), 60), 24 * 60 * 60);
}
