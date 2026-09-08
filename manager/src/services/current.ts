import { runtime } from '@/config/runtime'
import * as normalize from './normalizers'
import type { AuditItem, ConnectionItem, ContactItem, Conversation, Message, Overview, Session, UserItem } from '@/types/domain'

const ACCESS_STORAGE_KEY = 'connect_access_code'
let accessCode = sessionStorage.getItem(ACCESS_STORAGE_KEY) || ''
let instanceCache = new Map<string, any>()

class CurrentApiError extends Error {
  status: number
  data: unknown
  constructor(message: string, status = 0, data: unknown = null) {
    super(message)
    this.name = 'CurrentApiError'
    this.status = status
    this.data = data
  }
}

function messageFrom(data: any, fallback: string) {
  const value = data?.response?.message ?? data?.message ?? data?.error ?? fallback
  return Array.isArray(value) ? value.join(', ') : String(value || fallback || 'Não foi possível concluir a operação.')
}

function saveAccess(value: string) {
  accessCode = String(value || '').trim()
  if (accessCode) sessionStorage.setItem(ACCESS_STORAGE_KEY, accessCode)
  else sessionStorage.removeItem(ACCESS_STORAGE_KEY)
}

export function clearCurrentAccess() {
  saveAccess('')
  instanceCache.clear()
}

export function hasCurrentAccess() {
  return Boolean(accessCode)
}

async function api<T>(path: string, options: {
  method?: string
  data?: unknown
  params?: Record<string, unknown>
  headers?: Record<string, string>
  token?: string
  timeout?: number
} = {}): Promise<T> {
  const method = options.method || 'GET'
  const url = new URL(`${runtime.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`)
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
        ...(options.token || accessCode ? { apikey: options.token || accessCode } : {}),
        ...options.headers,
      },
      body: options.data !== undefined ? JSON.stringify(options.data) : undefined,
    })
    const text = await response.text()
    let payload: any = null
    try { payload = text ? JSON.parse(text) : null } catch { payload = text }
    if (!response.ok) throw new CurrentApiError(messageFrom(payload, response.statusText), response.status, payload)
    return payload as T
  } finally {
    clearTimeout(timer)
  }
}

function syntheticSession(): Session {
  return {
    account: {
      id: 'local-admin',
      name: 'Administrador',
      email: '',
      roleLabel: 'Administração',
      active: true,
    },
    permissions: ['*'],
    csrf: '',
    security: {
      enabled: false,
      required: false,
      enrollmentRequired: false,
      recoveryRemaining: 0,
      lastVerifiedAt: null,
    },
  }
}

async function root() {
  return api<any>('/', { token: '' })
}

function instanceId(item: any) {
  return String(item?.id || item?.instanceId || item?.name || item?.instanceName || '')
}

function rememberInstances(items: any[]) {
  const next = new Map<string, any>()
  for (const item of items) {
    const id = instanceId(item)
    if (id) next.set(id, item)
    if (item?.name) next.set(String(item.name), item)
    if (item?.instanceName) next.set(String(item.instanceName), item)
  }
  instanceCache = next
  return items
}

async function rawInstances() {
  const data = await api<any>('/instance/fetchInstances')
  const items = Array.isArray(data) ? data : data ? [data] : []
  return rememberInstances(items)
}

async function rawInstance(ref: string) {
  const cached = instanceCache.get(ref)
  if (cached) return cached
  const items = await rawInstances()
  return items.find((item) => instanceId(item) === ref || item?.name === ref || item?.instanceName === ref) || null
}

function publicInstance(item: any) {
  if (!item) return null
  const { token: _token, ...safe } = item
  return safe
}

async function withInstance<T>(ref: string, fn: (item: any, name: string, token: string) => Promise<T>) {
  const item = await rawInstance(ref)
  if (!item) throw new CurrentApiError('Instância não encontrada.', 404)
  const name = String(item.name || item.instanceName || ref)
  const token = String(item.token || '')
  return fn(item, name, token)
}

export const current = {
  async status() {
    const info = await root().catch(() => null)
    return { setupRequired: false, version: info?.version || '' }
  },

  async loginAccess(code: string) {
    const value = String(code || '').trim()
    if (!value) throw new CurrentApiError('Informe o código de acesso.', 400)
    await api('/verify-creds', { method: 'POST', token: value })
    saveAccess(value)
    return syntheticSession()
  },

  async me(): Promise<Session> {
    if (!accessCode) throw new CurrentApiError('Acesso não iniciado.', 401)
    await api('/verify-creds', { method: 'POST' })
    return syntheticSession()
  },

  async logout() {
    clearCurrentAccess()
    return { ok: true }
  },

  async overview(): Promise<Overview> {
    const [info, items] = await Promise.all([root(), rawInstances()])
    const connected = items.filter((item) => String(item.connectionStatus || item.status || '').toLowerCase() === 'open').length
    const totals = items.reduce((acc, item) => {
      acc.contacts += Number(item?._count?.Contact || 0)
      acc.conversations += Number(item?._count?.Chat || 0)
      acc.messages += Number(item?._count?.Message || 0)
      return acc
    }, { contacts: 0, conversations: 0, messages: 0 })
    return {
      online: true,
      version: info?.version || '',
      connections: { connected, total: items.length, disconnected: Math.max(0, items.length - connected) },
      totals,
      uptimeSeconds: 0,
      services: [
        { key: 'operation', label: 'Operação', status: 'ok' },
        { key: 'connections', label: 'Conexões', status: items.length === 0 || connected > 0 ? 'ok' : 'attention' },
        { key: 'security', label: 'Segurança', status: 'ok' },
        { key: 'updates', label: 'Atualizações', status: 'ok' },
        { key: 'availability', label: 'Disponibilidade', status: 'ok' },
        { key: 'performance', label: 'Desempenho', status: 'ok' },
      ],
      recent: [],
    }
  },

  async connections(): Promise<ConnectionItem[]> {
    return normalize.connections(await rawInstances())
  },

  async connection(id: string) {
    return publicInstance(await rawInstance(id))
  },

  async createConnection(data: any) {
    const payload: any = {
      instanceName: String(data?.instanceName || data?.name || '').trim(),
      integration: data?.integration || 'WHATSAPP-BAILEYS',
      token: data?.token,
    }
    if (data?.number) payload.number = String(data.number).replace(/\D/g, '')
    if (data?.businessId) payload.businessId = String(data.businessId).trim()
    const result = await api('/instance/create', { method: 'POST', data: payload })
    await rawInstances()
    return result
  },

  async connectConnection(id: string, data: any = {}) {
    return withInstance(id, async (item, name, token) => api(`/instance/connect/${encodeURIComponent(name)}`, {
      token,
      params: data?.pairing && (data?.number || item?.number) ? { number: String(data?.number || item.number).replace(/\D/g, '') } : undefined,
    }))
  },

  async restartConnection(id: string) {
    return withInstance(id, async (_item, name, token) => api(`/instance/restart/${encodeURIComponent(name)}`, { method: 'POST', token }))
  },

  async disconnectConnection(id: string) {
    return withInstance(id, async (_item, name, token) => api(`/instance/logout/${encodeURIComponent(name)}`, { method: 'DELETE', token }))
  },

  async removeConnection(id: string) {
    const result = await withInstance(id, async (_item, name, token) => api(`/instance/delete/${encodeURIComponent(name)}`, { method: 'DELETE', token }))
    await rawInstances()
    return result
  },

  async conversations(id: string): Promise<Conversation[]> {
    return withInstance(id, async (_item, name, token) => normalize.conversations(await api(`/chat/findChats/${encodeURIComponent(name)}`, {
      method: 'POST', token, data: { where: {}, sort: 'desc', page: 1, offset: 200 },
    })))
  },

  async messages(id: string, ref = ''): Promise<Message[]> {
    return withInstance(id, async (_item, name, token) => {
      const where = ref ? { key: { remoteJid: ref } } : {}
      return normalize.messages(await api(`/chat/findMessages/${encodeURIComponent(name)}`, {
        method: 'POST', token, data: { where, sort: 'desc', page: 1, offset: ref ? 250 : 150 },
      }))
    })
  },

  async sendText(id: string, number: string, text: string) {
    return withInstance(id, async (_item, name, token) => api(`/message/sendText/${encodeURIComponent(name)}`, {
      method: 'POST', token, data: { number: String(number).replace(/@.+$/, '').replace(/\D/g, ''), text },
    }))
  },

  async contacts(id: string): Promise<ContactItem[]> {
    return withInstance(id, async (_item, name, token) => normalize.contacts(await api(`/chat/findContacts/${encodeURIComponent(name)}`, {
      method: 'POST', token, data: { where: {}, sort: 'asc', page: 1, offset: 500 },
    })))
  },

  async calls(id: string) {
    return withInstance(id, async (_item, name, token) => api<any>(`/call/list/${encodeURIComponent(name)}`, { token }))
  },

  async callAction(id: string, action: string, data: any = {}) {
    return withInstance(id, async (_item, name, token) => api(`/call/${encodeURIComponent(action)}/${encodeURIComponent(name)}`, {
      method: 'POST', token, data,
    }))
  },

  async health() {
    return api<any>('/health', { token: '' })
  },

  async updates() {
    const info = await root()
    return { currentVersion: info?.version || '', version: info?.version || '', available: false, message: 'Sua instalação está pronta para receber atualizações quando disponíveis.' }
  },

  async users(): Promise<UserItem[]> { return [] },
  async roles() { return [] },
  async audit(): Promise<AuditItem[]> { return [] },
  async security() { return normalize.security({}) },
  async setup() { throw new CurrentApiError('Este recurso ainda não está habilitado nesta instalação.', 409) },
  async verify() { throw new CurrentApiError('Este recurso ainda não está habilitado nesta instalação.', 409) },
  async beginTwoStep() { throw new CurrentApiError('Este recurso ainda não está habilitado nesta instalação.', 409) },
  async confirmTwoStep() { throw new CurrentApiError('Este recurso ainda não está habilitado nesta instalação.', 409) },
  async regenerateRecovery() { throw new CurrentApiError('Este recurso ainda não está habilitado nesta instalação.', 409) },
  async changePassword() { throw new CurrentApiError('Este recurso ainda não está habilitado nesta instalação.', 409) },
  async createUser() { throw new CurrentApiError('Este recurso ainda não está habilitado nesta instalação.', 409) },
  async updateUser() { throw new CurrentApiError('Este recurso ainda não está habilitado nesta instalação.', 409) },
  async removeUser() { throw new CurrentApiError('Este recurso ainda não está habilitado nesta instalação.', 409) },
}
