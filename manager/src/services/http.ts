import { runtime } from '@/config/runtime'

export class ServiceError extends Error {
  status: number
  data: unknown
  constructor(message: string, status = 0, data: unknown = null) {
    super(message)
    this.name = 'ServiceError'
    this.status = status
    this.data = data
  }
}

let csrf = ''
export function setCsrf(value?: string | null) { csrf = value || '' }
export function clearCsrf() { csrf = '' }

function extractMessage(data: any, fallback: string) {
  const value = data?.message ?? data?.response?.message ?? data?.error ?? fallback
  return Array.isArray(value) ? value.join(', ') : String(value || fallback)
}

export async function request<T>(path: string, options: {
  method?: string
  data?: unknown
  params?: Record<string, unknown>
  headers?: Record<string, string>
  timeout?: number
} = {}): Promise<T> {
  const method = options.method || 'GET'
  const base = runtime.serviceBasePath.replace(/\/+$/, '')
  const endpoint = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${base}${endpoint}`, location.origin)
  Object.entries(options.params || {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, String(value))
  })
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), options.timeout || runtime.requestTimeoutMs)
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        ...(options.data !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method) ? { 'x-csrf-token': csrf } : {}),
        ...options.headers,
      },
      body: options.data !== undefined ? JSON.stringify(options.data) : undefined,
    })
    const raw = await response.text()
    let payload: any = null
    try { payload = raw ? JSON.parse(raw) : null } catch { payload = raw }
    if (!response.ok) throw new ServiceError(extractMessage(payload, response.statusText), response.status, payload)
    return payload as T
  } finally {
    clearTimeout(timer)
  }
}
