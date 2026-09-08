import { runtime } from '@/config/runtime'
import * as normalize from './normalizers'
import { integrationDefinitions } from './integration-definitions'
import { VoiceMediaSession, type VoiceMediaCallbacks } from './voice-media'
import type {
  AuditItem,
  ConnectionItem,
  ContactItem,
  Conversation,
  IntegrationKey,
  IntegrationSummary,
  InstanceConfigKey,
  Message,
  Overview,
  ProviderMigrationResult,
  Session,
  UserItem,
  WhatsAppCall,
  WhatsAppProvider,
} from '@/types/domain'

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
    account: { id: 'local-admin', name: 'Administrador', email: '', roleLabel: 'Administração', active: true },
    permissions: ['*'],
    csrf: '',
    security: { enabled: false, required: false, enrollmentRequired: false, recoveryRemaining: 0, lastVerifiedAt: null },
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

async function rawInstance(ref: string, refresh = false) {
  if (!refresh) {
    const cached = instanceCache.get(ref)
    if (cached) return cached
  }
  const items = await rawInstances()
  return items.find((item) => instanceId(item) === ref || item?.name === ref || item?.instanceName === ref) || null
}

function publicInstance(item: any) {
  if (!item) return null
  const { token: _token, ...safe } = item
  const provider = normalize.normalizeProvider(item.integration || item.provider)
  return {
    ...safe,
    provider,
    providerLabel: normalize.providerLabel(provider),
    capabilities: normalize.providerCapabilities(provider),
  }
}

async function withInstance<T>(ref: string, fn: (item: any, name: string, token: string) => Promise<T>, refresh = false) {
  const item = await rawInstance(ref, refresh)
  if (!item) throw new CurrentApiError('Instância não encontrada.', 404)
  const name = String(item.name || item.instanceName || ref)
  const token = String(item.token || '')
  return fn(item, name, token)
}

function integrationId(item: any, key: IntegrationKey) {
  return String(
    item?.id ||
    item?.[`${key}Id`] ||
    item?.openaiBotId ||
    item?.typebotId ||
    item?.difyId ||
    item?.n8nId ||
    item?.connectAIId ||
    item?.connectBotId ||
    item?.flowiseId ||
    '',
  )
}

function listFrom(value: any): any[] {
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.records)) return value.records
  if (Array.isArray(value?.data)) return value.data
  return value ? [value] : []
}

function integrationPayload(key: IntegrationKey, data: any) {
  const payload = { ...(data || {}) }
  // The uploaded backend currently persists `basicAuthPass` while its JSON
  // schema also advertises `basicAuthPassword`. Send both aliases so the
  // frontend remains compatible with either side of that transitional contract.
  if (key === 'n8n' && payload.basicAuthPass !== undefined) {
    payload.basicAuthPassword = payload.basicAuthPass
  }
  return payload
}

const eventConfigKeys = new Set<InstanceConfigKey>(['webhook', 'websocket', 'rabbitmq', 'nats', 'sqs', 'kafka', 'pusher'])

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
    return publicInstance(await rawInstance(id, true))
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

  async migrateProvider(id: string, targetProvider: WhatsAppProvider, dryRun = false): Promise<ProviderMigrationResult> {
    const result = await withInstance(id, async (_item, name, token) => api<ProviderMigrationResult>(`/instance/migrateProvider/${encodeURIComponent(name)}`, {
      method: 'POST',
      token,
      timeout: dryRun ? 60000 : 150000,
      data: { targetProvider, dryRun },
    }), true)
    if (!dryRun) await rawInstances()
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

  async calls(id: string): Promise<WhatsAppCall[]> {
    return withInstance(id, async (item, name, token) => {
      const provider = normalize.normalizeProvider(item.integration)
      if (!normalize.providerCapabilities(provider).calls) return []
      return normalize.calls(await api<any>(`/call/list/${encodeURIComponent(name)}`, { token }))
    }, true)
  },

  async offerCall(id: string, number: string, callDuration?: number) {
    return withInstance(id, async (item, name, token) => {
      const provider = normalize.normalizeProvider(item.integration)
      if (!normalize.providerCapabilities(provider).calls) throw new CurrentApiError('Este provider não oferece chamadas nesta versão.', 409)
      const duration = Number(callDuration || 0)
      return api(`/call/offer/${encodeURIComponent(name)}`, {
        method: 'POST', token, data: { number: String(number).replace(/\D/g, ''), ...(duration > 0 ? { callDuration: duration } : {}) },
      })
    }, true)
  },

  async callAction(id: string, action: 'accept' | 'reject' | 'end' | 'mute', data: any = {}) {
    return withInstance(id, async (item, name, token) => {
      const provider = normalize.normalizeProvider(item.integration)
      if (!normalize.providerCapabilities(provider).calls) throw new CurrentApiError('Este provider não oferece chamadas nesta versão.', 409)
      return api(`/call/${action}/${encodeURIComponent(name)}`, { method: 'POST', token, data })
    }, true)
  },

  async voiceMedia(id: string, callId: string, callbacks: VoiceMediaCallbacks = {}) {
    return withInstance(id, async (item, name, token) => {
      const provider = normalize.normalizeProvider(item.integration)
      if (!normalize.providerCapabilities(provider).voice) throw new CurrentApiError('Áudio de chamada não está disponível neste provider.', 409)
      const mediaToken = token || accessCode
      if (!mediaToken) throw new CurrentApiError('A sessão atual não possui autorização para o áudio da chamada.', 409)
      const session = new VoiceMediaSession({ apiBaseUrl: runtime.apiBaseUrl, instanceName: name, callId, token: mediaToken }, callbacks)
      await session.start()
      return session
    }, true)
  },

  async integrationSummaries(id: string): Promise<IntegrationSummary[]> {
    return withInstance(id, async (_item, name, token) => {
      const keys = Object.keys(integrationDefinitions) as IntegrationKey[]
      return Promise.all(keys.map(async (key) => {
        try {
          const rows = listFrom(await api<any>(`/${key}/find/${encodeURIComponent(name)}`, { token }))
          return {
            key,
            label: integrationDefinitions[key].label,
            configured: rows.length > 0,
            count: rows.length,
            status: rows.length > 0 ? 'configured' : 'not_configured',
            detail: rows.length > 0 ? `${rows.length} configuração${rows.length === 1 ? '' : 'ões'}` : 'Pronto para configurar',
          } as IntegrationSummary
        } catch (error: any) {
          return {
            key,
            label: integrationDefinitions[key].label,
            configured: false,
            count: 0,
            status: 'error',
            detail: error?.status === 404 ? 'Não configurado' : 'Verifique a disponibilidade',
          } as IntegrationSummary
        }
      }))
    })
  },

  async findIntegrations(id: string, key: IntegrationKey) {
    return withInstance(id, async (_item, name, token) => listFrom(await api(`/${key}/find/${encodeURIComponent(name)}`, { token })))
  },

  async createIntegration(id: string, key: IntegrationKey, data: any) {
    return withInstance(id, async (_item, name, token) => api(`/${key}/create/${encodeURIComponent(name)}`, { method: 'POST', token, data: integrationPayload(key, data) }))
  },

  async updateIntegration(id: string, key: IntegrationKey, integrationRef: string, data: any) {
    return withInstance(id, async (_item, name, token) => api(`/${key}/update/${encodeURIComponent(integrationRef)}/${encodeURIComponent(name)}`, { method: 'PUT', token, data: integrationPayload(key, data) }))
  },

  async deleteIntegration(id: string, key: IntegrationKey, integrationRef: string) {
    return withInstance(id, async (_item, name, token) => api(`/${key}/delete/${encodeURIComponent(integrationRef)}/${encodeURIComponent(name)}`, { method: 'DELETE', token }))
  },

  async integrationSettings(id: string, key: IntegrationKey) {
    return withInstance(id, async (_item, name, token) => api(`/${key}/fetchSettings/${encodeURIComponent(name)}`, { token }))
  },

  async saveIntegrationSettings(id: string, key: IntegrationKey, data: any) {
    return withInstance(id, async (_item, name, token) => api(`/${key}/settings/${encodeURIComponent(name)}`, { method: 'POST', token, data }))
  },

  async integrationSessions(id: string, key: IntegrationKey, integrationRef: string) {
    return withInstance(id, async (_item, name, token) => listFrom(await api(`/${key}/fetchSessions/${encodeURIComponent(integrationRef)}/${encodeURIComponent(name)}`, { token })))
  },

  async integrationSessionStatus(id: string, key: IntegrationKey, remoteJid: string, status: string) {
    return withInstance(id, async (_item, name, token) => api(`/${key}/changeStatus/${encodeURIComponent(name)}`, { method: 'POST', token, data: { remoteJid, status } }))
  },

  async integrationIgnoreJid(id: string, key: IntegrationKey, remoteJid: string, action: 'add' | 'remove') {
    return withInstance(id, async (_item, name, token) => api(`/${key}/ignoreJid/${encodeURIComponent(name)}`, { method: 'POST', token, data: { remoteJid, action } }))
  },

  async openAiCredentials(id: string) {
    return withInstance(id, async (_item, name, token) => listFrom(await api(`/openai/creds/${encodeURIComponent(name)}`, { token })))
  },

  async createOpenAiCredential(id: string, data: { name: string; apiKey: string }) {
    return withInstance(id, async (_item, name, token) => api(`/openai/creds/${encodeURIComponent(name)}`, { method: 'POST', token, data }))
  },

  async deleteOpenAiCredential(id: string, credentialId: string) {
    return withInstance(id, async (_item, name, token) => api(`/openai/creds/${encodeURIComponent(credentialId)}/${encodeURIComponent(name)}`, { method: 'DELETE', token }))
  },

  async openAiModels(id: string, credentialId: string) {
    return withInstance(id, async (_item, name, token) => listFrom(await api(`/openai/getModels/${encodeURIComponent(name)}`, {
      token,
      params: credentialId ? { openaiCredsId: credentialId } : undefined,
    })))
  },

  integrationId(item: any, key: IntegrationKey) {
    return integrationId(item, key)
  },

  async loadInstanceConfig(id: string, key: InstanceConfigKey) {
    return withInstance(id, async (_item, name, token) => api<any>(`/${key}/find/${encodeURIComponent(name)}`, { token }))
  },

  async saveInstanceConfig(id: string, key: InstanceConfigKey, data: any) {
    return withInstance(id, async (_item, name, token) => {
      const payload = eventConfigKeys.has(key) ? { [key]: data } : data
      return api(`/${key}/set/${encodeURIComponent(name)}`, { method: 'POST', token, data: payload })
    })
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
