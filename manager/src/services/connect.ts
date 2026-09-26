import { runtime } from '@/config/runtime'
import { current } from './current'
import { connect as service } from './service'
import type {
  AuditItem,
  ConnectionItem,
  ContactItem,
  Conversation,
  IntegrationKey,
  IntegrationSummary,
  InstanceConfigKey,
  ManagerEmbeddingSettings,
  Message,
  Overview,
  ProviderMigrationResult,
  SecurityState,
  Session,
  UserItem,
  WhatsAppCall,
  WhatsAppProvider,
} from '@/types/domain'
import type { VoiceMediaCallbacks, VoiceMediaSession } from './voice-media'
import type { CallCapabilities, VideoMediaCallbacks, VideoMediaPreparation, VideoMediaSession } from './video-media'

const adapter: Record<string, any> = (runtime.compatibility === 'service' ? service : current) as Record<string, any>

function invoke<T = any>(name: string, ...args: any[]): Promise<T> {
  const fn = adapter[name]
  if (typeof fn !== 'function') return Promise.reject(new Error('Este recurso ainda não está disponível nesta instalação.'))
  return Promise.resolve(fn(...args)) as Promise<T>
}

function sanitizeCallIdentity(call: WhatsAppCall): WhatsAppCall {
  const raw = call.raw || {}
  if (raw.identityResolved === true) return call

  // A LID é um identificador interno do WhatsApp, não um número telefônico.
  // Enquanto o backend não tiver comprovado a relação LID -> PN, nunca exponha
  // esse valor (nem nome/foto não verificados) como identidade do contato.
  return {
    ...call,
    number: '',
    name: undefined,
    avatar: undefined,
  }
}

export const connect = {
  status: (): Promise<any> => invoke('status'),
  setup: (data: any, setupToken?: string): Promise<any> => invoke('setup', data, setupToken),
  login: (email: string, password: string): Promise<any> => invoke('login', email, password),
  loginAccess: (code: string): Promise<Session> => runtime.compatibility === 'current'
    ? current.loginAccess(code)
    : Promise.reject(new Error('Modo de acesso indisponível.')),
  verify: (code = '', recovery = ''): Promise<Session> => invoke('verify', code, recovery),
  me: (): Promise<Session> => invoke('me'),
  logout: (): Promise<any> => invoke('logout'),
  embeddingSettings: (): Promise<ManagerEmbeddingSettings> => invoke('embeddingSettings'),
  saveEmbeddingSettings: (data: { version: number; enabled: boolean; allowedOrigins: string[] }): Promise<ManagerEmbeddingSettings> => invoke('saveEmbeddingSettings', data),
  security: (): Promise<SecurityState> => invoke('security'),
  beginTwoStep: (password: string): Promise<any> => invoke('beginTwoStep', password),
  confirmTwoStep: (code: string): Promise<{ session: Session; recoveryCodes: string[] }> => invoke('confirmTwoStep', code),
  regenerateRecovery: (password: string): Promise<any> => invoke('regenerateRecovery', password),
  changePassword: (currentPassword: string, newPassword: string): Promise<any> => invoke('changePassword', currentPassword, newPassword),
  overview: (): Promise<Overview> => invoke('overview'),
  connections: (): Promise<ConnectionItem[]> => invoke('connections'),
  connection: (id: string): Promise<any> => invoke('connection', id),
  createConnection: (data: any): Promise<any> => invoke('createConnection', data),
  connectConnection: (id: string, data: any = {}): Promise<any> => invoke('connectConnection', id, data),
  restartConnection: (id: string): Promise<any> => invoke('restartConnection', id),
  disconnectConnection: (id: string): Promise<any> => invoke('disconnectConnection', id),
  removeConnection: (id: string): Promise<any> => invoke('removeConnection', id),
  migrateProvider: (id: string, target: WhatsAppProvider, dryRun = false): Promise<ProviderMigrationResult> => invoke('migrateProvider', id, target, dryRun),
  conversations: (id: string): Promise<Conversation[]> => invoke('conversations', id),
  messages: (id: string, ref = ''): Promise<Message[]> => invoke('messages', id, ref),
  groupInfo: (id: string, groupJid: string): Promise<any> => invoke('groupInfo', id, groupJid),
  sendText: (id: string, number: string, text: string): Promise<any> => invoke('sendText', id, number, text),
  testMessageContacts: (id: string, page = 1): Promise<{ items: ContactItem[]; hasMore: boolean }> => invoke('testMessageContacts', id, page),
  contacts: (id: string): Promise<ContactItem[]> => typeof adapter.contacts === 'function' ? invoke('contacts', id) : Promise.resolve([]),
  calls: async (id: string): Promise<WhatsAppCall[]> => {
    const result = await invoke<WhatsAppCall[]>('calls', id)
    return result.map(sanitizeCallIdentity)
  },
  callCapabilities: (id: string): Promise<CallCapabilities> => invoke('callCapabilities', id),
  offerCall: (id: string, number: string, duration?: number, isVideo = false): Promise<any> => invoke('offerCall', id, number, duration, isVideo),
  callAction: (id: string, action: 'accept' | 'reject' | 'end' | 'mute', data: any = {}): Promise<any> => invoke('callAction', id, action, data),
  voiceMedia: (id: string, callId: string, callbacks: VoiceMediaCallbacks = {}): Promise<VoiceMediaSession> => invoke('voiceMedia', id, callId, callbacks),
  videoMedia: (id: string, callId: string, preparation: VideoMediaPreparation, canvas: HTMLCanvasElement, callbacks: VideoMediaCallbacks = {}): Promise<VideoMediaSession> => invoke('videoMedia', id, callId, preparation, canvas, callbacks),
  integrationSummaries: (id: string): Promise<IntegrationSummary[]> => invoke('integrationSummaries', id),
  findIntegrations: (id: string, key: IntegrationKey): Promise<any[]> => invoke('findIntegrations', id, key),
  createIntegration: (id: string, key: IntegrationKey, data: any): Promise<any> => invoke('createIntegration', id, key, data),
  updateIntegration: (id: string, key: IntegrationKey, ref: string, data: any): Promise<any> => invoke('updateIntegration', id, key, ref, data),
  deleteIntegration: (id: string, key: IntegrationKey, ref: string): Promise<any> => invoke('deleteIntegration', id, key, ref),
  integrationSettings: (id: string, key: IntegrationKey): Promise<any> => invoke('integrationSettings', id, key),
  saveIntegrationSettings: (id: string, key: IntegrationKey, data: any): Promise<any> => invoke('saveIntegrationSettings', id, key, data),
  integrationSessions: (id: string, key: IntegrationKey, ref: string): Promise<any[]> => invoke('integrationSessions', id, key, ref),
  integrationSessionStatus: (id: string, key: IntegrationKey, remoteJid: string, status: string): Promise<any> => invoke('integrationSessionStatus', id, key, remoteJid, status),
  integrationIgnoreJid: (id: string, key: IntegrationKey, remoteJid: string, action: 'add' | 'remove'): Promise<any> => invoke('integrationIgnoreJid', id, key, remoteJid, action),
  openAiCredentials: (id: string): Promise<any[]> => invoke('openAiCredentials', id),
  createOpenAiCredential: (id: string, data: { name: string; apiKey: string }): Promise<any> => invoke('createOpenAiCredential', id, data),
  deleteOpenAiCredential: (id: string, credentialId: string): Promise<any> => invoke('deleteOpenAiCredential', id, credentialId),
  openAiModels: (id: string, credentialId: string): Promise<any[]> => invoke('openAiModels', id, credentialId),
  integrationId: (item: any, key: IntegrationKey): string => typeof adapter.integrationId === 'function' ? adapter.integrationId(item, key) : String(item?.id || ''),
  loadInstanceConfig: (id: string, key: InstanceConfigKey): Promise<any> => invoke('loadInstanceConfig', id, key),
  saveInstanceConfig: (id: string, key: InstanceConfigKey, data: any): Promise<any> => invoke('saveInstanceConfig', id, key, data),
  users: (): Promise<UserItem[]> => invoke('users'),
  roles: (): Promise<any[]> => invoke('roles'),
  createUser: (data: any): Promise<any> => invoke('createUser', data),
  updateUser: (id: string, data: any): Promise<any> => invoke('updateUser', id, data),
  removeUser: (id: string): Promise<any> => invoke('removeUser', id),
  audit: (): Promise<AuditItem[]> => invoke('audit'),
  findHubAvatar: (id: string, deviceId: string, avatar?: string | null): Promise<any> => invoke('findHubAvatar', id, deviceId, avatar),
  findHubSnapshot: (id: string): Promise<any> => invoke('findHubSnapshot', id),
  findHubSettings: (id: string, data?: any): Promise<any> => invoke('findHubSettings', id, data),
  findHubTraccarConnection: (id: string, data?: any): Promise<any> => invoke('findHubTraccarConnection', id, data),
  findHubTraccarProvision: (id: string, deviceId: string): Promise<any> => invoke('findHubTraccarProvision', id, deviceId),
  findHubStream: (id: string, signal: AbortSignal, onEvent: (event: any) => void): Promise<void> => invoke('findHubStream', id, signal, onEvent),
  findHubBrowserAuth: (id: string, operation: 'start' | 'exchange' | 'complete' | 'cancel', data: any): Promise<any> => invoke('findHubBrowserAuth', id, operation, data),
  findHubDownloadHelper: (id: string): Promise<void> => invoke('findHubDownloadHelper', id),
  findHubDisconnect: (id: string): Promise<any> => invoke('findHubDisconnect', id),
  findHubTraccar: (id: string, deviceId: string, method: 'GET' | 'PUT' | 'DELETE' = 'GET', data?: any): Promise<any> => invoke('findHubTraccar', id, deviceId, method, data),
  findHubAuthStart: (id: string, email: string): Promise<any> => invoke('findHubAuthStart', id, email),
  findHubAuthStatus: (id: string): Promise<any> => invoke('findHubAuthStatus', id),
  findHubImportCredentials: (id: string, data: any): Promise<any> => invoke('findHubImportCredentials', id, data),
  findHubDevices: (id: string): Promise<any[]> => invoke('findHubDevices', id),
  findHubRefreshDevices: (id: string): Promise<any[]> => invoke('findHubRefreshDevices', id),
  findHubCaptureCatalog: (id: string, catalog: 'spot' | 'android' | 'auto' | 'fastpair' | 'supervised'): Promise<void> => invoke('findHubCaptureCatalog', id, catalog),
  findHubCaptureDeviceUpdate: (id: string, deviceId: string, timeoutMs?: number): Promise<void> => invoke('findHubCaptureDeviceUpdate', id, deviceId, timeoutMs),
  findHubLocate: (id: string, deviceId: string, timeoutMs?: number): Promise<any> => invoke('findHubLocate', id, deviceId, timeoutMs),
  findHubSound: (id: string, deviceId: string, operation: 'start' | 'stop', component = 'UNSPECIFIED'): Promise<any> => invoke('findHubSound', id, deviceId, operation, component),
  findHubStartTracking: (id: string, deviceId: string, intervalSeconds = 60, timeoutMs?: number): Promise<any> => invoke('findHubStartTracking', id, deviceId, intervalSeconds, timeoutMs),
  findHubStopTracking: (id: string, deviceId: string): Promise<any> => invoke('findHubStopTracking', id, deviceId),
  findHubPositions: (id: string, deviceId: string, limit = 100, from?: string, to?: string): Promise<any[]> => invoke('findHubPositions', id, deviceId, limit, from, to),
  findHubReconcile: (id: string, deviceId: string, data?: any): Promise<any> => invoke('findHubReconcile', id, deviceId, data || {}),
  health: (): Promise<any> => invoke('health'),
  updates: (): Promise<any> => invoke('updates'),
}
