/** Accept both HTTP Retry-After forms without overflowing a browser timer. */
export function parseRetryAfterSeconds(value: string | null, now = Date.now()): number {
  if (!value?.trim()) return 0
  const trimmed = value.trim()
  const seconds = /^\d+$/.test(trimmed) ? Number(trimmed) : Math.ceil((Date.parse(trimmed) - now) / 1000)
  return Number.isFinite(seconds) ? Math.min(2147483, Math.max(0, seconds)) : 0
}

export function errorRetryAfterSeconds(error: unknown): number {
  const seconds = Number((error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds)
  return Number.isFinite(seconds) ? Math.min(2147483, Math.max(0, seconds)) : 0
}
