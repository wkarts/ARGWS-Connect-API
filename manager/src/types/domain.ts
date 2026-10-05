export type Account = {
  id: string
  name: string
  email: string
  roleLabel: string
  active: boolean
}

export type SecurityState = {
  enabled: boolean
  required: boolean
  enrollmentRequired: boolean
  recoveryRemaining: number
  lastVerifiedAt?: string | null
}

export type ManagerEmbeddingSettings = {
  version: number
  configured: boolean
  enabled: boolean
  allowedOrigins: string[]
  effectiveFrameAncestors: string
  source: 'database' | 'environment'
  allowAnyOrigin: boolean
  updatedAt?: string | null
}

export type ManagerStorageResource = {
  key: string
  label: string
  objectCount: number
  mediaCount: number
  bytes: number
  cleanable: boolean
  note?: string
}

export type TranscriptionJob = {
  id: string
  instanceId?: string | null
  messageId?: string | null
  mode?: 'dictation' | 'transcription' | string
  sourceType?: string
  originalFilename?: string | null
  sizeBytes?: number | null
  provider: string
  model: string
  language?: string | null
  status: 'queued' | 'processing' | 'completed' | 'failed' | string
  stage?: string | null
  progressPercent?: number
  processedDurationMs?: number | null
  heartbeatAt?: string | null
  text?: string | null
  detectedLanguage?: string | null
  durationMs?: number | null
  segments?: unknown[] | null
  errorCode?: string | null
  errorMessage?: string | null
  attempts: number
  createdAt?: string
  startedAt?: string | null
  completedAt?: string | null
  updatedAt?: string
}

export type DictationAccepted = { id: string; mode: 'dictation'; status: string }

export type ManagerStorageOverview = {
  enabled: boolean
  bucket: string | null
  managedPrefix: string
  generatedAt: string
  truncated: boolean
  objectCount: number
  totalBytes: number
  managedObjectCount: number
  managedBytes: number
  untrackedObjectCount: number
  untrackedBytes: number
  databaseMediaCount: number
  missingObjectCount: number
  resources: ManagerStorageResource[]
  instances: Array<{
    id: string
    name: string
    databaseMediaCount: number
    objectCount: number
    bytes: number
    missingObjectCount: number
  }>
  cleanup: {
    supportedResources: Array<{ key: string; label: string; safe: boolean }>
    policy: string
  }
}

export type Session = {
  account: Account
  permissions: string[]
  csrf: string
  security: SecurityState
}

export type Overview = {
  online: boolean
  version?: string
  connections: { connected: number; total: number; disconnected: number }
  totals: { messages: number; conversations: number; contacts: number }
  uptimeSeconds: number
  services: Array<{ key: string; label: string; status: 'ok' | 'attention' | 'unavailable' }>
  recent: Array<{ id: string; title: string; detail?: string; when?: string; kind?: string }>
  trends?: { messages?: number[]; conversations?: number[] }
}

export type WhatsAppProvider = 'WHATSAPP-BAILEYS' | 'WHATSAPP-ZAPO' | 'WHATSAPP-BUSINESS' | string

export type ProviderCapabilitySet = {
  auth: boolean
  messaging: boolean
  contacts: boolean
  chats: boolean
  groups: boolean
  statusRead: boolean
  statusPublish: boolean
  presence: boolean
  chatState: boolean
  pnLid: boolean
  interactiveMessages: boolean
  media: boolean
  profile: boolean
  privacy: boolean
  labels: boolean
  receipts: boolean
  businessProfile: boolean
  businessCatalog: boolean
  calls: boolean
  voice: boolean
  qrCode: boolean
  pairingCode: boolean
  devices?: boolean
  location?: boolean
  tracking?: boolean
}

export type ConnectionItem = {
  id: string
  name: string
  status: 'connected' | 'connecting' | 'disconnected' | 'unknown'
  channel: string
  provider: WhatsAppProvider
  providerLabel: string
  capabilities: ProviderCapabilitySet
  number?: string
  profileName?: string
  avatar?: string
  counts: { contacts: number; conversations: number; messages: number }
  updatedAt?: string | null
}

export type ProviderMigrationResult = {
  status?: string
  migrated?: boolean
  dryRun?: boolean
  sourceProvider?: WhatsAppProvider
  targetProvider?: WhatsAppProvider
  pairingRequired?: boolean
  connectionState?: string
  losses?: Array<string | { key?: string; message?: string; detail?: string }>
  message?: string
  instanceName?: string
  instanceId?: string
}

export type ContactItem = {
  id: string
  name: string
  number?: string
  avatar?: string
  rawRef?: string
  aliases?: string[]
  isLid?: boolean
  updatedAt?: string | null
}

export type Conversation = {
  isGroup?: boolean
  id: string
  title: string
  subtitle?: string
  avatar?: string
  unread: number
  lastMessage?: string
  updatedAt?: string
  rawRef?: string
  aliases?: string[]
  isLid?: boolean
}

export type Message = {
  mediaKind?: 'image' | 'video' | 'audio'
  participantRef?: string
  participantName?: string
  id: string
  transcriptionMessageId?: string
  isAudio?: boolean
  transcriptionJobId?: string
  transcriptionStatus?: string
  transcriptionStage?: string | null
  transcriptionProgress?: number
  transcriptionText?: string | null
  text: string
  direction: 'in' | 'out' | 'system'
  timestamp?: string
  status?: string
}

export type WhatsAppCall = {
  id: string
  callId: string
  number: string
  name?: string
  avatar?: string
  remoteJid?: string
  direction: 'incoming' | 'outgoing' | 'unknown'
  state: string
  isVideo: boolean
  muted?: boolean
  startedAt?: string | number
  raw?: any
}

export type IntegrationKey = 'n8n' | 'typebot' | 'dify' | 'flowise' | 'openai' | 'connectAI' | 'connectBot'
export type InstanceConfigKey = 'settings' | 'proxy' | 'webhook' | 'websocket' | 'rabbitmq' | 'nats' | 'sqs' | 'kafka' | 'pusher' | 'chatwoot'

export type IntegrationSummary = {
  key: IntegrationKey
  label: string
  configured: boolean
  count: number
  status: 'configured' | 'not_configured' | 'error'
  detail?: string
}

export type UserItem = {
  id: string
  name: string
  email: string
  active: boolean
  roles: string[]
  lastLoginAt?: string | null
}

export type AuditItem = {
  id: string
  action: string
  description: string
  actor?: string
  createdAt?: string
}
