export type ManagerFramePolicy = {
  enabled: boolean;
  frameAncestors: string;
  contentSecurityPolicy: string;
};

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function validFrameAncestor(token: string): boolean {
  if (['*', "'self'", "'none'", 'https:', 'http:'].includes(token)) return true;
  return /^https?:\/\/(?:\*\.)?[a-z0-9.-]+(?::\d{1,5})?$/i.test(token);
}

export function managerFramePolicy(env: NodeJS.ProcessEnv = process.env): ManagerFramePolicy {
  const enabled = envBoolean(env.MANAGER_IFRAME_ENABLED, true);
  if (!enabled) {
    return {
      enabled: false,
      frameAncestors: "'none'",
      contentSecurityPolicy: "frame-ancestors 'none'",
    };
  }

  const requested = String(env.MANAGER_FRAME_ANCESTORS || '*')
    .replace(/[\r\n]/g, ' ')
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter(validFrameAncestor);

  let ancestors = requested.length ? [...new Set(requested)] : ['*'];
  if (ancestors.includes("'none'")) ancestors = ["'none'"];
  else if (ancestors.includes('*')) ancestors = ['*'];

  const frameAncestors = ancestors.join(' ');
  return {
    enabled: frameAncestors !== "'none'",
    frameAncestors,
    contentSecurityPolicy: `frame-ancestors ${frameAncestors}`,
  };
}
