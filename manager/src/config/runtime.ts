export type CompatibilityMode = 'current' | 'service'
export type AuthMode = 'access-code' | 'account'

export type RuntimeConfig = {
  serviceBasePath: string
  apiBaseUrl: string
  requestTimeoutMs: number
  compatibility: CompatibilityMode
  authMode: AuthMode
  features: Record<string, boolean>
}

const configured = window.__CONNECT_WEB__ || {}

export const runtime: RuntimeConfig = {
  serviceBasePath: String(configured.serviceBasePath || '/manager-api/v1').replace(/\/+$/, ''),
  apiBaseUrl: String(configured.apiBaseUrl || location.origin).replace(/\/+$/, ''),
  requestTimeoutMs: Number(configured.requestTimeoutMs || 30000),
  compatibility: configured.compatibility === 'service' ? 'service' : 'current',
  authMode: configured.authMode === 'account' ? 'account' : 'access-code',
  features: configured.features || {},
}

export function appBasePath() {
  return location.pathname === '/manager' || location.pathname.startsWith('/manager/')
    ? '/manager/'
    : '/'
}

export function featureEnabled(name: string, fallback = true) {
  const value = runtime.features?.[name]
  return value === undefined ? fallback : value === true
}
