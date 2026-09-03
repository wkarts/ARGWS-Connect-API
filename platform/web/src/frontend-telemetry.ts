import type { AuthSession } from './types'

const controlHost = String(import.meta.env.VITE_CONTROL_PLANE_HOST || 'control.localhost').toLowerCase()
const partnerHost = String(import.meta.env.VITE_PARTNER_PLANE_HOST || 'partner.localhost').toLowerCase()
const redactKey = /(password|passwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|credential)/i
const recentlySent = new Map<string, number>()
let installed = false

function isControlPlane(): boolean {
  const host = window.location.hostname.toLowerCase()
  return host === controlHost || host.startsWith('control.') || host.startsWith('admin.') || new URLSearchParams(location.search).get('control') === '1'
}

function isPartnerPlane(): boolean {
  const host = window.location.hostname.toLowerCase()
  return !isControlPlane() && (host === partnerHost || host.startsWith('partner.') || host.startsWith('partners.') || new URLSearchParams(location.search).get('partner') === '1')
}

function sessionKey(): string { return `multitenant-app-session:${window.location.hostname}` }
function accessToken(): string {
  try {
    const raw = localStorage.getItem(sessionKey())
    if (!raw) return ''
    const session = JSON.parse(raw) as AuthSession
    return session.tokens?.access_token || ''
  } catch {
    return ''
  }
}

export function sanitizeTelemetry(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[MAX_DEPTH]'
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack?.slice(0, 12000) }
  if (Array.isArray(value)) return value.slice(0, 80).map(item => sanitizeTelemetry(item, depth + 1))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) result[key] = redactKey.test(key) ? '[REDACTED]' : sanitizeTelemetry(item, depth + 1)
    return result
  }
  if (typeof value === 'string') return value.replace(/(Bearer\s+)[A-Za-z0-9._~+\-/=]+/gi, '$1[REDACTED]').slice(0, 16000)
  return value
}

export function captureFrontendEvent(
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL',
  event: string,
  message: string,
  details: Record<string, unknown> = {},
): void {
  // O Partner Plane aguarda um endpoint de observabilidade dedicado. Não envia
  // telemetria para o Control Plane nem assume um tenant implicitamente.
  if (isPartnerPlane()) return

  const token = accessToken()
  if (!token) return
  const signature = `${level}|${event}|${message}`.slice(0, 1000)
  const now = Date.now(), previous = recentlySent.get(signature) || 0
  if (now - previous < 5000) return
  recentlySent.set(signature, now)
  if (recentlySent.size > 300) { for (const [key, timestamp] of recentlySent) if (now - timestamp > 60000) recentlySent.delete(key) }

  const endpoint = isControlPlane() ? '/api/control/v1/observability/logs/ingest' : '/api/v1/observability/logs/ingest'
  const body = {
    source: 'frontend',
    service: isControlPlane() ? 'control-web' : 'tenant-web',
    level,
    event: event.slice(0, 160),
    message: message.slice(0, 16000),
    details: sanitizeTelemetry({ ...details, href: window.location.href, userAgent: navigator.userAgent, online: navigator.onLine, viewport: `${window.innerWidth}x${window.innerHeight}` }),
  }
  void fetch(endpoint, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body), keepalive: true }).catch(() => undefined)
}

export function installFrontendTelemetry(): void {
  if (installed) return
  installed = true
  window.addEventListener('error', event => captureFrontendEvent('ERROR', 'browser_error', event.message || 'Erro JavaScript no navegador.', { filename: event.filename, lineno: event.lineno, colno: event.colno, error: sanitizeTelemetry(event.error) }))
  window.addEventListener('unhandledrejection', event => { const reason = event.reason; captureFrontendEvent('ERROR', 'unhandled_rejection', reason instanceof Error ? reason.message : String(reason || 'Promise rejeitada sem tratamento.'), { reason: sanitizeTelemetry(reason) }) })

  const originalError = console.error.bind(console), originalWarn = console.warn.bind(console)
  console.error = (...args: unknown[]) => { originalError(...args); captureFrontendEvent('ERROR', 'console_error', args.map(item => item instanceof Error ? item.message : String(item)).join(' ').slice(0, 16000), { arguments: sanitizeTelemetry(args) }) }
  console.warn = (...args: unknown[]) => { originalWarn(...args); captureFrontendEvent('WARNING', 'console_warning', args.map(item => item instanceof Error ? item.message : String(item)).join(' ').slice(0, 16000), { arguments: sanitizeTelemetry(args) }) }
}
