import type { App } from 'vue'
import type { Router } from 'vue-router'
import { runtime } from '@/config/runtime'
import { getCurrentAccessCode } from './current'

export type DiagnosticLevel = 'info' | 'warn' | 'error'
export type DiagnosticCategory = 'http' | 'error' | 'connection' | 'call' | 'runtime' | 'frontend' | 'system'
export type DiagnosticEvent = {
  id: string; timestamp: string; level: DiagnosticLevel; category: DiagnosticCategory
  code: string; summary: string; traceId?: string; callId?: string; instanceId?: string
  component?: string; details?: Record<string, unknown>
}
export type DiagnosticStatus = {
  ready: boolean; persistent: boolean; storageError: boolean; diskBytes: number; maxDiskBytes: number
  retentionDays: number; storedEvents: number; dropped: number; counts: Record<DiagnosticLevel, number>
  categories: Record<string, number>; version?: string; startedAt?: string; schemaVersion?: number
}
export type DiagnosticFilters = {
  from?: string; to?: string; level?: DiagnosticLevel | ''; category?: DiagnosticCategory | ''
  code?: string; traceId?: string; callId?: string; instanceId?: string
}
export type DiagnosticPage = { events: DiagnosticEvent[]; nextCursor: string | null }
export type ClientErrorKind = 'window_error' | 'unhandled_rejection' | 'vue_error'
export type DiagnosticScreen = 'calls' | 'diagnostics' | 'instances' | 'login' | 'settings' | 'unknown'

const filterNames = ['from', 'to', 'level', 'category', 'code', 'traceId', 'callId', 'instanceId'] as const
function queryFilters(filters: DiagnosticFilters): Record<string, string> {
  const result: Record<string, string> = {}
  for (const name of filterNames) if (filters[name]) result[name] = String(filters[name])
  return result
}

async function request<T>(path: string, options: {
  params?: Record<string, string>; method?: string; data?: unknown; signal?: AbortSignal; blob?: boolean
} = {}): Promise<T> {
  const key = getCurrentAccessCode()
  if (!key) throw new Error('Entre com o acesso administrativo para consultar o diagnóstico.')
  const url = new URL(`${runtime.apiBaseUrl}/diagnostics/${path}`)
  for (const [name, value] of Object.entries(options.params || {})) if (value) url.searchParams.set(name, value)
  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (options.signal?.aborted) controller.abort()
  options.signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(cancel, options.blob ? 120000 : 20000)
  const ensureSession = () => {
    if (getCurrentAccessCode() !== key) throw new Error('O acesso mudou durante a consulta. Atualize o diagnóstico.')
  }
  try {
    const response = await fetch(url, {
      method: options.method || 'GET', credentials: 'same-origin', signal: controller.signal,
      headers: { apikey: key, ...(options.data !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: options.data !== undefined ? JSON.stringify(options.data) : undefined,
    })
    ensureSession()
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('O diagnóstico exige o acesso global do administrador da instalação.')
      if (response.status === 429) throw new Error('O diagnóstico recebeu muitas solicitações. Aguarde alguns segundos e tente novamente.')
      if (response.status === 400) throw new Error('Revise o período, os identificadores e os limites informados.')
      if (response.status === 404) throw new Error('O serviço de diagnóstico ainda não está disponível nesta versão da API.')
      throw new Error('Não foi possível consultar o diagnóstico. Verifique a disponibilidade da API e tente novamente.')
    }
    const result = options.blob ? await response.blob() : response.status === 204 ? undefined : await response.json()
    ensureSession()
    if (controller.signal.aborted) throw new DOMException('Consulta cancelada.', 'AbortError')
    return result as T
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
  }
}

export const diagnostics = {
  status: (signal?: AbortSignal): Promise<DiagnosticStatus> => request('status', { signal }),
  events: (filters: DiagnosticFilters, cursor = '', signal?: AbortSignal): Promise<DiagnosticPage> =>
    request('events', { params: { ...queryFilters(filters), cursor, limit: '100' }, signal }),
  settings: (retentionDays: number, maxDiskMB: number, signal?: AbortSignal): Promise<DiagnosticStatus> =>
    request('settings', { method: 'PUT', data: { retentionDays, maxDiskMB }, signal }),
  async download(filters: DiagnosticFilters, format: 'gzip' | 'jsonl' = 'gzip', signal?: AbortSignal): Promise<void> {
    const key = getCurrentAccessCode()
    // Export the complete filtered range, never the current UI cursor/page.
    const blob = await request<Blob>('export', { params: { ...queryFilters(filters), format }, signal, blob: true })
    if (!key || getCurrentAccessCode() !== key || signal?.aborted) throw new Error('O acesso mudou. Solicite o download novamente.')
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    try {
      link.href = url
      link.download = `connect-diagnostico-${new Date().toISOString().slice(0, 10)}.jsonl${format === 'gzip' ? '.gz' : ''}`
      document.body.appendChild(link)
      link.click()
    } finally {
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  },
}

export function diagnosticScreen(template: string): DiagnosticScreen {
  if (template === '/chamadas') return 'calls'
  if (template === '/diagnostico') return 'diagnostics'
  if (template === '/instancias' || template.startsWith('/instancias/:id')) return 'instances'
  if (template === '/login') return 'login'
  if (template === '/configuracoes') return 'settings'
  return 'unknown'
}

// No Error object, message, stack, URL, route parameters or request payload is accepted here.
export function installDiagnosticsErrors(app: App, router: Router): () => void {
  let reporting = false
  let windowStartedAt = 0
  let reports = 0
  const previousHandler = app.config.errorHandler
  const report = (kind: ClientErrorKind) => {
    if (!getCurrentAccessCode() || reporting) return
    const now = Date.now()
    if (now - windowStartedAt >= 60000) { windowStartedAt = now; reports = 0 }
    if (reports >= 6) return
    reports += 1
    reporting = true
    const template = router.currentRoute.value.matched.at(-1)?.path || ''
    const page = diagnosticScreen(template)
    void request('client-events', { method: 'POST', data: { kind, page } })
      .catch(() => { /* Reporting must never create another unhandled error. */ })
      .finally(() => { reporting = false })
  }
  const onError = () => report('window_error')
  const onRejection = () => report('unhandled_rejection')
  const handler: NonNullable<App['config']['errorHandler']> = (error, instance, info) => {
    report('vue_error')
    if (previousHandler) previousHandler(error, instance, info)
    else console.error(error) // Retain visibility in the browser; never send its content.
  }
  app.config.errorHandler = handler
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    if (app.config.errorHandler === handler) app.config.errorHandler = previousHandler
  }
}
