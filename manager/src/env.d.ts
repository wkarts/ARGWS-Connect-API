/// <reference types="vite/client" />

declare interface Window {
  __CONNECT_API_BASE_URL__?: string
  __CONNECT_WEB__?: {
    serviceBasePath?: string
    apiBaseUrl?: string
    requestTimeoutMs?: number
    compatibility?: 'current' | 'service'
    authMode?: 'access-code' | 'account'
    appVersion?: string
    features?: Record<string, boolean>
  }
}
