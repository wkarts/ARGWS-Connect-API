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

export type ConnectionItem = {
  id: string
  name: string
  status: 'connected' | 'connecting' | 'disconnected' | 'unknown'
  channel: string
  number?: string
  profileName?: string
  avatar?: string
  counts: { contacts: number; conversations: number; messages: number }
  updatedAt?: string | null
}


export type ContactItem = {
  id: string
  name: string
  number?: string
  avatar?: string
  updatedAt?: string | null
}

export type Conversation = {
  id: string
  title: string
  subtitle?: string
  avatar?: string
  unread: number
  lastMessage?: string
  updatedAt?: string
  rawRef?: string
}

export type Message = {
  id: string
  text: string
  direction: 'in' | 'out' | 'system'
  timestamp?: string
  status?: string
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
