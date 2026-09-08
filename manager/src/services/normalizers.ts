import type {
  Account,
  AuditItem,
  ConnectionItem,
  ContactItem,
  Conversation,
  Message,
  Overview,
  ProviderCapabilitySet,
  SecurityState,
  Session,
  UserItem,
  WhatsAppCall,
  WhatsAppProvider,
} from '@/types/domain'

const num = (v: any) => Number(v ?? 0) || 0
const str = (v: any, fallback = '') => String(v ?? fallback)
export const asArray = (v: any): any[] => Array.isArray(v)
  ? v
  : Array.isArray(v?.data)
    ? v.data
    : Array.isArray(v?.items)
      ? v.items
      : Array.isArray(v?.records)
        ? v.records
        : Array.isArray(v?.messages?.records)
          ? v.messages.records
          : Array.isArray(v?.chats?.records)
            ? v.chats.records
            : Array.isArray(v?.contacts?.records)
              ? v.contacts.records
              : []

function roleLabel(roles: string[] = []) {
  if (roles.includes('administrator')) return 'Administrador'
  if (roles.includes('supervisor')) return 'Supervisor'
  if (roles.includes('operator')) return 'Operador'
  if (roles.includes('viewer')) return 'Consulta'
  return roles[0] ? roles[0].replaceAll('_', ' ') : 'Usuário'
}

function jidLocal(value: any): string {
  return str(value).split('@')[0].replace(/:\d+$/, '')
}

function identityKey(value: any): string {
  return str(value).trim().toLowerCase()
}

function nameKey(value: any): string {
  return str(value).trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')
}

function looksLikeIdentifier(value: string): boolean {
  const text = value.trim()
  return !text || /^\+?\d+$/.test(text) || text.includes('@lid') || text.includes('@s.whatsapp.net')
}

function chooseDisplayName(primary: string, secondary: string): string {
  if (!looksLikeIdentifier(primary)) return primary
  if (!looksLikeIdentifier(secondary)) return secondary
  return primary || secondary || 'Contato'
}

function mergeAliases(...values: Array<string[] | string | undefined>): string[] {
  const aliases = values
    .flatMap((value) => Array.isArray(value) ? value : value ? [value] : [])
    .map((value) => identityKey(value))
    .filter(Boolean)
  return [...new Set(aliases)]
}

function messagePreview(value: any): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.length ? '[Conteúdo]' : ''
  if (typeof value !== 'object') return ''

  if (value.text && typeof value.text === 'string') return value.text
  if (value.body && typeof value.body === 'string') return value.body
  if (value.content && typeof value.content === 'string') return value.content
  if (value.conversation && typeof value.conversation === 'string') return value.conversation
  if (value.extendedTextMessage?.text) return str(value.extendedTextMessage.text)
  if (value.imageMessage) return str(value.imageMessage.caption || 'Imagem')
  if (value.videoMessage) return str(value.videoMessage.caption || 'Vídeo')
  if (value.audioMessage) return 'Áudio'
  if (value.stickerMessage) return 'Figurinha'
  if (value.documentMessage) return str(value.documentMessage.caption || value.documentMessage.fileName || 'Documento')
  if (value.documentWithCaptionMessage) return messagePreview(value.documentWithCaptionMessage.message)
  if (value.contactMessage) return str(value.contactMessage.displayName || 'Contato')
  if (value.contactsArrayMessage) return 'Contatos'
  if (value.locationMessage || value.liveLocationMessage) return 'Localização'
  if (value.pollCreationMessage || value.pollCreationMessageV3) return 'Enquete'
  if (value.message) return messagePreview(value.message)

  return '[Conteúdo]'
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
  const core = raw?.operation ?? raw?.core ?? raw?.engine ?? {}
  const instances = raw?.instances ?? raw?.connections ?? {}
  const totals = raw?.totals ?? raw?.summary ?? {}
  const services: Overview['services'] = [
    { key: 'operation', label: 'Operação', status: core?.status === 'ok' || core?.online === true ? 'ok' : 'attention' },
    { key: 'connections', label: 'Conexões', status: num(instances?.connected) > 0 || num(instances?.total) === 0 ? 'ok' : 'attention' },
    { key: 'security', label: 'Segurança', status: 'ok' },
    { key: 'updates', label: 'Atualizações', status: raw?.services?.updates?.status === 'unavailable' ? 'attention' : 'ok' },
    { key: 'availability', label: 'Disponibilidade', status: 'ok' },
    { key: 'performance', label: 'Desempenho', status: 'ok' },
  ]
  return {
    online: core?.status === 'ok' || core?.online === true,
    version: core?.version ?? raw?.version,
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
    uptimeSeconds: num(core?.uptime ?? raw?.uptime),
    services,
    recent: asArray(raw?.recent ?? raw?.activity).map((item, index) => ({
      id: str(item.id || index),
      title: str(item.title || item.action || 'Atividade registrada'),
      detail: str(item.detail || item.description || ''),
      when: item.when || item.createdAt || item.timestamp,
      kind: item.kind || 'activity',
    })),
    trends: raw?.trends,
  }
}

export function normalizeProvider(value: any): WhatsAppProvider {
  const raw = str(value || 'WHATSAPP-BAILEYS').toUpperCase()
  if (raw.includes('ZAPO')) return 'WHATSAPP-ZAPO'
  if (raw.includes('BUSINESS') || raw.includes('META')) return 'WHATSAPP-BUSINESS'
  if (raw.includes('BAILEYS') || raw.includes('WHATSAPP')) return 'WHATSAPP-BAILEYS'
  return raw
}

export function providerLabel(value: any) {
  const provider = normalizeProvider(value)
  if (provider === 'WHATSAPP-ZAPO') return 'ZAPO'
  if (provider === 'WHATSAPP-BUSINESS') return 'WhatsApp Business / Cloud API'
  if (provider === 'WHATSAPP-BAILEYS') return 'Baileys'
  return String(provider)
}

const baseCapabilities: ProviderCapabilitySet = {
  auth: true,
  messaging: true,
  contacts: true,
  chats: true,
  groups: true,
  statusRead: true,
  statusPublish: true,
  presence: true,
  chatState: true,
  pnLid: true,
  interactiveMessages: true,
  media: true,
  profile: true,
  privacy: true,
  labels: true,
  receipts: true,
  businessProfile: true,
  businessCatalog: false,
  calls: false,
  voice: false,
  qrCode: true,
  pairingCode: true,
}

export function providerCapabilities(value: any): ProviderCapabilitySet {
  const provider = normalizeProvider(value)
  if (provider === 'WHATSAPP-ZAPO') {
    return { ...baseCapabilities, calls: true, voice: true, businessCatalog: false }
  }
  if (provider === 'WHATSAPP-BAILEYS') {
    return { ...baseCapabilities, calls: false, voice: false, businessCatalog: true }
  }
  if (provider === 'WHATSAPP-BUSINESS') {
    return {
      ...baseCapabilities,
      qrCode: false,
      pairingCode: false,
      labels: false,
      pnLid: false,
      calls: false,
      voice: false,
      businessCatalog: true,
    }
  }
  return { ...baseCapabilities }
}

export function connections(raw: any): ConnectionItem[] {
  return asArray(raw).map((item) => {
    const provider = normalizeProvider(item.integration || item.provider || item.channel)
    return {
      id: str(item.id || item.instanceId || item.instanceName || item.name),
      name: str(item.name || item.instanceName || item.profileName || 'Conexão'),
      status: normalizeStatus(item.connectionStatus || item.status || item.state),
      channel: normalizeChannel(provider),
      provider,
      providerLabel: providerLabel(provider),
      capabilities: providerCapabilities(provider),
      number: item.number || item.ownerJid?.split('@')?.[0] || undefined,
      profileName: item.profileName || undefined,
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
  if (s.includes('whatsapp') || s.includes('baileys') || s.includes('zapo') || s.includes('business')) return 'WhatsApp'
  if (s.includes('instagram')) return 'Instagram'
  if (s.includes('telegram')) return 'Telegram'
  return value ? str(value) : 'Canal'
}

function mergeContact(existing: ContactItem, incoming: ContactItem): ContactItem {
  const canonical = existing.isLid && !incoming.isLid ? incoming : existing
  const secondary = canonical === existing ? incoming : existing
  return {
    ...canonical,
    name: chooseDisplayName(canonical.name, secondary.name),
    number: canonical.number || secondary.number,
    avatar: canonical.avatar || secondary.avatar,
    rawRef: canonical.rawRef || secondary.rawRef,
    aliases: mergeAliases(canonical.aliases, secondary.aliases, canonical.rawRef, secondary.rawRef),
    isLid: canonical.isLid && secondary.isLid,
    updatedAt: canonical.updatedAt || secondary.updatedAt,
  }
}

export function contacts(raw: any): ContactItem[] {
  const normalized = asArray(raw)
    .filter((item) => item?.remoteJid !== 'status@broadcast' && !str(item?.remoteJid).endsWith('@broadcast'))
    .map((item, index): ContactItem => {
      const rawRef = str(item.remoteJid || item.jid || item.number || '')
      const number = item.number || jidLocal(rawRef) || undefined
      const name = str(
        item.pushName || item.name || item.verifiedName || item.notify || number || rawRef || 'Contato',
      )
      return {
        id: str(item.id || rawRef || index),
        name,
        number,
        avatar: item.profilePicUrl || item.avatar || undefined,
        rawRef: rawRef || undefined,
        aliases: mergeAliases(rawRef, item.lid, item.phoneNumber, item.remoteJidAlt),
        isLid: rawRef.endsWith('@lid'),
        updatedAt: item.updatedAt || null,
      }
    })

  const result: ContactItem[] = []
  for (const item of normalized) {
    let index = result.findIndex((current) => current.id === item.id || current.rawRef === item.rawRef)
    if (index < 0 && nameKey(item.name)) {
      index = result.findIndex(
        (current) => nameKey(current.name) === nameKey(item.name) && (current.isLid === true || item.isLid === true),
      )
    }
    if (index < 0) result.push(item)
    else result[index] = mergeContact(result[index], item)
  }

  return result.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }))
}

function mergeConversation(existing: Conversation, incoming: Conversation): Conversation {
  const canonical = existing.isLid && !incoming.isLid ? incoming : existing
  const secondary = canonical === existing ? incoming : existing
  return {
    ...canonical,
    title: chooseDisplayName(canonical.title, secondary.title),
    subtitle: canonical.subtitle || secondary.subtitle,
    avatar: canonical.avatar || secondary.avatar,
    unread: Math.max(canonical.unread, secondary.unread),
    lastMessage: canonical.lastMessage || secondary.lastMessage,
    updatedAt: canonical.updatedAt || secondary.updatedAt,
    rawRef: canonical.rawRef || secondary.rawRef,
    aliases: mergeAliases(canonical.aliases, secondary.aliases, canonical.rawRef, secondary.rawRef),
    isLid: canonical.isLid && secondary.isLid,
  }
}

export function conversations(raw: any): Conversation[] {
  const normalized = asArray(raw)
    .filter((item) => {
      const ref = str(item.remoteJid || item.jid || item.id)
      return ref !== 'status@broadcast' && !ref.endsWith('@broadcast')
    })
    .map((item, index): Conversation => {
      const rawRef = str(item.remoteJid || item.jid || item.id || '')
      const title = str(item.pushName || item.name || item.contactName || jidLocal(rawRef) || 'Conversa')
      return {
        id: str(item.id || rawRef || index),
        title,
        subtitle: item.number || rawRef || item.subtitle,
        avatar: item.profilePicUrl || item.avatar,
        unread: num(item.unreadMessages ?? item.unread ?? item.unreadCount),
        lastMessage: messagePreview(item.lastMessage),
        updatedAt: item.updatedAt || item.lastMessage?.messageTimestamp || item.timestamp,
        rawRef: rawRef || undefined,
        aliases: mergeAliases(rawRef, item.lid, item.phoneNumber, item.remoteJidAlt),
        isLid: rawRef.endsWith('@lid'),
      }
    })

  const result: Conversation[] = []
  for (const item of normalized) {
    let index = result.findIndex((current) => current.id === item.id || current.rawRef === item.rawRef)
    if (index < 0 && nameKey(item.title)) {
      index = result.findIndex(
        (current) => nameKey(current.title) === nameKey(item.title) && (current.isLid === true || item.isLid === true),
      )
    }
    if (index < 0) result.push(item)
    else result[index] = mergeConversation(result[index], item)
  }

  return result.sort((a, b) => {
    const aTime = Number(new Date(a.updatedAt || 0)) || 0
    const bTime = Number(new Date(b.updatedAt || 0)) || 0
    return bTime - aTime
  })
}

export function messages(raw: any): Message[] {
  return asArray(raw).map((item, index) => {
    const text = messagePreview(item.message || item.text || item.body || item.content)
    const fromMe = Boolean(item.key?.fromMe ?? item.fromMe)
    return {
      id: str(item.key?.id || item.id || index),
      text: text || '[Conteúdo]',
      direction: fromMe ? 'out' : 'in',
      timestamp: item.messageTimestamp || item.createdAt || item.timestamp,
      status: item.status,
    }
  })
}

export function calls(raw: any): WhatsAppCall[] {
  return asArray(raw).map((item, index) => {
    const callId = str(item.callId || item.id || item.call?.id || index)
    const remote = str(
      item.displayPeerJid ||
      item.remoteJid ||
      item.peerJid ||
      item.callerPn ||
      item.peerJidAlt ||
      item.peerJidRaw ||
      item.from ||
      item.to ||
      item.number ||
      '',
    )
    const number = str(item.number || jidLocal(remote) || '')
    const rawDirection = str(item.direction || item.type || '').toLowerCase()
    const direction: WhatsAppCall['direction'] = rawDirection.includes('in') || item.isIncoming === true
      ? 'incoming'
      : rawDirection.includes('out') || item.isIncoming === false
        ? 'outgoing'
        : 'unknown'
    return {
      id: callId,
      callId,
      number,
      name: item.name || item.pushName || item.contactName || undefined,
      avatar: item.profilePicUrl || item.avatar || undefined,
      remoteJid: remote || undefined,
      direction,
      state: str(item.state || item.status || item.callState || 'Em andamento'),
      isVideo: Boolean(item.isVideo || item.video),
      muted: item.muted === undefined ? undefined : Boolean(item.muted),
      startedAt: item.startedAt || item.timestamp || item.createdAt,
      raw: item,
    }
  })
}

export function users(raw: any): UserItem[] {
  return asArray(raw).map((item) => ({
    id: str(item.id || item.email),
    name: str(item.name || item.email || 'Usuário'),
    email: str(item.email),
    active: item.active !== false,
    roles: Array.isArray(item.roles) ? item.roles : [],
    lastLoginAt: item.lastLoginAt || null,
  }))
}

export function audit(raw: any): AuditItem[] {
  return asArray(raw).map((item, index) => ({
    id: str(item.id || index),
    action: str(item.action || 'activity'),
    description: str(item.description || item.action || 'Atividade registrada'),
    actor: item.actor?.name || item.user?.name || item.userName || item.email,
    createdAt: item.createdAt || item.timestamp,
  }))
}