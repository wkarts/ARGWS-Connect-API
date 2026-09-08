import type { Account, AuditItem, ConnectionItem, ContactItem, Conversation, Message, Overview, SecurityState, Session, UserItem } from '@/types/domain'

const num = (v: any) => Number(v ?? 0) || 0
const str = (v: any, fallback = '') => String(v ?? fallback)
const array = (v: any): any[] => Array.isArray(v) ? v : Array.isArray(v?.data) ? v.data : Array.isArray(v?.items) ? v.items : Array.isArray(v?.records) ? v.records : Array.isArray(v?.messages?.records) ? v.messages.records : Array.isArray(v?.chats?.records) ? v.chats.records : Array.isArray(v?.contacts?.records) ? v.contacts.records : []

function roleLabel(roles: string[] = []) {
  if (roles.includes('administrator')) return 'Administrador'
  if (roles.includes('supervisor')) return 'Supervisor'
  if (roles.includes('operator')) return 'Operador'
  if (roles.includes('viewer')) return 'Consulta'
  return roles[0] ? roles[0].replaceAll('_', ' ') : 'Usuário'
}

export function security(raw: any): SecurityState {
  const s = raw?.security ?? raw ?? {}
  return {
    enabled: Boolean(s.twoFactorEnabled ?? s.enabled),
    required: Boolean(s.twoFactorRequired ?? s.required),
    enrollmentRequired: Boolean(s.enrollmentRequired ?? s.setupRequired),
    recoveryRemaining: num(s.recoveryCodesRemaining ?? s.recoveryRemaining),
    lastVerifiedAt: s.lastMfaAt ?? s.lastVerifiedAt ?? null,
  }
}

export function session(raw: any): Session {
  const user = raw?.user ?? raw?.account ?? {}
  const roles = Array.isArray(user.roles) ? user.roles : []
  return {
    account: {
      id: str(user.id || user.email),
      name: str(user.name || user.email || 'Usuário'),
      email: str(user.email),
      roleLabel: roleLabel(roles),
      active: user.active !== false,
    },
    permissions: Array.isArray(raw?.permissions) ? raw.permissions : [],
    csrf: str(raw?.csrf),
    security: security(raw?.security),
  }
}

export function overview(raw: any): Overview {
  const engine = raw?.engine ?? raw?.operation ?? raw?.core ?? {}
  const instances = raw?.instances ?? raw?.connections ?? {}
  const totals = raw?.totals ?? raw?.summary ?? {}
  const services: Overview['services'] = [
    { key: 'operation', label: 'Operação', status: engine?.status === 'ok' || engine?.online === true ? 'ok' : 'attention' },
    { key: 'connections', label: 'Conexões', status: num(instances?.connected) > 0 || num(instances?.total) === 0 ? 'ok' : 'attention' },
    { key: 'security', label: 'Segurança', status: 'ok' },
    { key: 'updates', label: 'Atualizações', status: raw?.services?.updates?.status === 'unavailable' ? 'attention' : 'ok' },
    { key: 'availability', label: 'Disponibilidade', status: 'ok' },
    { key: 'performance', label: 'Desempenho', status: 'ok' },
  ]
  return {
    online: engine?.status === 'ok' || engine?.online === true,
    version: engine?.version ?? raw?.version,
    connections: {
      connected: num(instances?.connected),
      total: num(instances?.total),
      disconnected: num(instances?.disconnected),
    },
    totals: {
      messages: num(totals?.messages),
      conversations: num(totals?.chats ?? totals?.conversations),
      contacts: num(totals?.contacts),
    },
    uptimeSeconds: num(engine?.uptime ?? raw?.uptime),
    services,
    recent: array(raw?.recent ?? raw?.activity).map((item, index) => ({
      id: str(item.id || index),
      title: str(item.title || item.action || 'Atividade registrada'),
      detail: str(item.detail || item.description || ''),
      when: item.when || item.createdAt || item.timestamp,
      kind: item.kind || 'activity',
    })),
    trends: raw?.trends,
  }
}

export function connections(raw: any): ConnectionItem[] {
  return array(raw).map((item) => {
    const integration = str(item.integration || item.provider || item.channel)
    return {
      id: str(item.id || item.instanceId || item.instanceName || item.name),
      name: str(item.name || item.instanceName || item.profileName || 'Conexão'),
      status: normalizeStatus(item.connectionStatus || item.status || item.state),
      channel: normalizeChannel(integration),
      provider: normalizeProvider(integration),
      integration,
      number: item.number || item.ownerJid?.split('@')?.[0] || undefined,
      profileName: item.profileName || item.clientName || undefined,
      avatar: item.profilePicUrl || item.avatar || undefined,
      counts: {
        contacts: num(item._count?.Contact ?? item.counts?.contacts),
        conversations: num(item._count?.Chat ?? item.counts?.conversations),
        messages: num(item._count?.Message ?? item.counts?.messages),
      },
      updatedAt: item.updatedAt || null,
    }
  })
}

function normalizeStatus(value: any): ConnectionItem['status'] {
  const s = str(value).toLowerCase()
  if (['open', 'connected', 'online', 'ready'].includes(s)) return 'connected'
  if (['connecting', 'qr', 'pending'].includes(s)) return 'connecting'
  if (['close', 'closed', 'disconnected', 'offline'].includes(s)) return 'disconnected'
  return 'unknown'
}
function normalizeChannel(value: any) {
  const s = str(value).toLowerCase()
  if (s.includes('whatsapp') || s.includes('baileys') || s.includes('zapo') || s.includes('evolution')) return 'WhatsApp'
  if (s.includes('instagram')) return 'Instagram'
  if (s.includes('telegram')) return 'Telegram'
  return value ? str(value) : 'Canal'
}
function normalizeProvider(value: any) {
  const s = str(value).toUpperCase()
  if (s.includes('BAILEYS')) return 'Baileys'
  if (s.includes('ZAPO')) return 'ZAPO'
  if (s.includes('BUSINESS') || s.includes('CLOUD')) return 'WhatsApp Business / Cloud API'
  if (s.includes('WHATSAPP')) return 'WhatsApp'
  return value ? str(value) : 'Não identificado'
}

export function contacts(raw: any): ContactItem[] {
  return array(raw).map((item, index) => ({
    id: str(item.id || item.remoteJid || item.jid || item.number || index),
    name: str(item.pushName || item.name || item.verifiedName || item.notify || item.remoteJid || item.number || 'Contato'),
    number: item.number || item.remoteJid?.split('@')?.[0] || item.jid?.split('@')?.[0] || undefined,
    avatar: item.profilePicUrl || item.avatar || undefined,
    updatedAt: item.updatedAt || null,
  }))
}

export function conversations(raw: any): Conversation[] {
  return array(raw).map((item, index) => ({
    id: str(item.id || item.remoteJid || item.jid || index),
    title: str(item.pushName || item.name || item.contactName || item.remoteJid || 'Conversa'),
    subtitle: item.number || item.remoteJid || item.subtitle,
    avatar: item.profilePicUrl || item.avatar,
    unread: num(item.unreadMessages ?? item.unread ?? item.unreadCount),
    lastMessage: str(item.lastMessage?.message || item.lastMessage?.text || item.lastMessage || ''),
    updatedAt: item.updatedAt || item.lastMessage?.messageTimestamp || item.timestamp,
    rawRef: item.remoteJid || item.jid || item.id,
  }))
}

export function messages(raw: any): Message[] {
  return array(raw).map((item, index) => {
    const text = item.message?.conversation || item.message?.extendedTextMessage?.text || item.text || item.body || item.content || ''
    const fromMe = Boolean(item.key?.fromMe ?? item.fromMe)
    return {
      id: str(item.key?.id || item.id || index),
      text: str(text || '[Conteúdo]'),
      direction: fromMe ? 'out' : 'in',
      timestamp: item.messageTimestamp || item.createdAt || item.timestamp,
      status: item.status,
    }
  })
}

export function users(raw: any): UserItem[] {
  return array(raw).map((item) => ({
    id: str(item.id || item.email),
    name: str(item.name || item.email || 'Usuário'),
    email: str(item.email),
    active: item.active !== false,
    roles: Array.isArray(item.roles) ? item.roles : [],
    lastLoginAt: item.lastLoginAt || null,
  }))
}

export function audit(raw: any): AuditItem[] {
  return array(raw).map((item, index) => ({
    id: str(item.id || index),
    action: str(item.action || 'activity'),
    description: str(item.description || item.action || 'Atividade registrada'),
    actor: item.actor?.name || item.user?.name || item.userName || item.email,
    createdAt: item.createdAt || item.timestamp,
  }))
}
