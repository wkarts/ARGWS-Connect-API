/** Keep migration credentials/URL direct; override only the runtime Prisma client. */
export function runtimeDatabaseUrl(env: Record<string, string | undefined>): string | undefined {
  if (!['true', '1', 'yes'].includes((env.DATABASE_POOL_ENABLED || '').toLowerCase())) return undefined;
  const direct = env.DATABASE_CONNECTION_URI;
  if (!direct) throw new Error('DATABASE_CONNECTION_URI is required with DATABASE_POOL_ENABLED');
  const url = new URL(direct);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_POOL_ENABLED requires PostgreSQL');
  }
  const host = env.DATABASE_POOL_HOST || 'connect-engine-pgbouncer';
  if (!/^[a-zA-Z0-9._-]+$/.test(host)) throw new Error('Invalid DATABASE_POOL_HOST');
  function bounded(name: string, fallback: number, maximum: number): number {
    const value = Number(env[name] || fallback);
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}`);
    return value;
  }
  url.hostname = host;
  url.port = String(bounded('DATABASE_POOL_PORT', 6432, 65535));
  url.searchParams.set('connection_limit', String(bounded('DATABASE_POOL_CONNECTION_LIMIT', 5, 100)));
  url.searchParams.set('pool_timeout', String(bounded('DATABASE_POOL_TIMEOUT', 10, 60)));
  url.searchParams.set('connect_timeout', '5');
  url.searchParams.set('pgbouncer', 'true');
  return url.toString();
}

export function isDatabaseUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return ['P1001', 'P1002', 'P1017', 'P2024', 'P2037'].includes(String(error.code));
}
