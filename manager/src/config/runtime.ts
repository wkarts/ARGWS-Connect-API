export type CompatibilityMode = 'current' | 'service'
export type AuthMode = 'access-code' | 'account'

export type RuntimeConfig = {
  serviceBasePath: string
  apiBaseUrl: string
  requestTimeoutMs: number
  compatibility: CompatibilityMode
  authMode: AuthMode
  appVersion: string
  features: Record<string, boolean>
}

const configured = window.__CONNECT_WEB__ || {}

function normalizeAppVersion(value: unknown) {
  const version = String(value || '').trim()
  if (version === 'develop') return version
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
    ? version
    : 'develop'
}

export const runtime: RuntimeConfig = {
  serviceBasePath: String(configured.serviceBasePath || '/manager-api/v1').replace(/\/+$/, ''),
  apiBaseUrl: String(configured.apiBaseUrl || location.origin).replace(/\/+$/, ''),
  requestTimeoutMs: Number(configured.requestTimeoutMs || 30000),
  compatibility: configured.compatibility === 'service' ? 'service' : 'current',
  authMode: configured.authMode === 'account' ? 'account' : 'access-code',
  appVersion: normalizeAppVersion(configured.appVersion),
  features: configured.features || {},
}

export function appBasePath() {
  return location.pathname === '/manager' || location.pathname.startsWith('/manager/')
    ? '/manager/'
    : '/'
}

export function applicationVersionLabel() {
  return runtime.appVersion === 'develop' ? 'develop' : `v${runtime.appVersion}`
}

export function featureEnabled(name: string, fallback = true) {
  const value = runtime.features?.[name]
  return value === undefined ? fallback : value === true
}
