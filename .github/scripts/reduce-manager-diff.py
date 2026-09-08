from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 exact match, got {count}')
    p.write_text(text.replace(old, new, 1))

# Restore the two Manager files exactly from develop, then apply only the
# functional hunks. This intentionally avoids repository-wide reformatting.

path = 'manager/src/services/current.ts'
replace_once(
    path,
    """let accessCode = sessionStorage.getItem(ACCESS_STORAGE_KEY) || ''
let instanceCache = new Map<string, any>()""",
    """let accessCode = sessionStorage.getItem(ACCESS_STORAGE_KEY) || ''
let instanceCache = new Map<string, any>()
let instanceCacheItems: any[] = []
let instanceCacheFetchedAt = 0
let instanceCachePromise: Promise<any[]> | null = null
const INSTANCE_CACHE_TTL_MS = 5_000""",
)
replace_once(
    path,
    """export function clearCurrentAccess() {
  saveAccess('')
  instanceCache.clear()
}""",
    """export function clearCurrentAccess() {
  saveAccess('')
  instanceCache.clear()
  instanceCacheItems = []
  instanceCacheFetchedAt = 0
  instanceCachePromise = null
}""",
)
replace_once(
    path,
    """  instanceCache = next
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
  const items = await rawInstances()""",
    """  instanceCache = next
  instanceCacheItems = items
  instanceCacheFetchedAt = Date.now()
  return items
}

async function rawInstances(force = false) {
  if (!force && instanceCacheFetchedAt && Date.now() - instanceCacheFetchedAt < INSTANCE_CACHE_TTL_MS) {
    return instanceCacheItems
  }
  if (!force && instanceCachePromise) return instanceCachePromise

  const pending = api<any>('/instance/fetchInstances').then((data) => {
    const items = Array.isArray(data) ? data : data ? [data] : []
    return rememberInstances(items)
  })
  instanceCachePromise = pending
  try {
    return await pending
  } finally {
    if (instanceCachePromise === pending) instanceCachePromise = null
  }
}

async function rawInstance(ref: string, refresh = false) {
  if (!refresh) {
    const cached = instanceCache.get(ref)
    if (cached) return cached
  }
  const items = await rawInstances(refresh)""",
)
for marker in ['offerCall', 'callAction', 'voiceMedia']:
    p = Path(path)
    text = p.read_text()
    old = f"    }}, true)\n  }},\n\n  async {marker}"
    new = f"    }})\n  }},\n\n  async {marker}"
    if old not in text:
        raise SystemExit(f'{path}: refresh marker before {marker} not found')
    p.write_text(text.replace(old, new, 1))

path = 'manager/src/services/normalizers.ts'
replace_once(
    path,
    """function jidLocal(value: any): string {
  return str(value).split('@')[0].replace(/:\\d+$/, '')
}

function identityKey(value: any): string {""",
    """function jidLocal(value: any): string {
  return str(value).split('@')[0].replace(/:\\d+$/, '')
}

function phoneFromRef(value: any): string {
  const ref = str(value).trim()
  if (!ref) return ''
  const lower = ref.toLowerCase()
  if (lower.endsWith('@lid') || lower.endsWith('@g.us') || lower.endsWith('@broadcast') || lower.endsWith('@newsletter')) return ''
  if (ref.includes('@') && !lower.endsWith('@s.whatsapp.net')) return ''
  const local = jidLocal(ref)
  return /^\\+?\\d+$/.test(local) ? local.replace(/\\D/g, '') : ''
}

function firstPhone(...values: any[]): string {
  for (const value of values) {
    const phone = phoneFromRef(value)
    if (phone) return phone
  }
  return ''
}

function identityKey(value: any): string {""",
)
replace_once(
    path,
    """      const rawRef = str(item.remoteJid || item.jid || item.number || '')
      const number = item.number || jidLocal(rawRef) || undefined
      const name = str(item.pushName || item.name || item.verifiedName || item.notify || number || rawRef || 'Contato')""",
    """      const rawRef = str(item.remoteJid || item.jid || item.number || '')
      const number = firstPhone(item.phoneNumber, item.phoneJid, item.remoteJidAlt, rawRef.endsWith('@lid') ? undefined : item.number, rawRef) || undefined
      const name = str(item.pushName || item.name || item.verifiedName || item.notify || number || 'Contato')""",
)
replace_once(
    path,
    """        subtitle: item.number || rawRef || item.subtitle,""",
    """        subtitle: firstPhone(item.phoneNumber, item.phoneJid, item.remoteJidAlt, item.number, rawRef) || (rawRef.endsWith('@lid') ? '' : rawRef) || item.subtitle,""",
)
replace_once(
    path,
    """    const remote = str(
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
    const number = str(item.number || jidLocal(remote) || '')""",
    """    const remote = str(
      item.callerPnJid ||
      item.callerPn ||
      item.displayPeerJid ||
      item.remoteJid ||
      item.peerJid ||
      item.peerJidAlt ||
      item.peerJidRaw ||
      item.from ||
      item.to ||
      '',
    )
    const number = firstPhone(item.number, item.callerPnJid, item.callerPn, item.displayPeerJid, item.remoteJid, item.peerJid, item.peerJidAlt, item.peerJidRaw)""",
)
replace_once(
    path,
    """      name: item.name || item.pushName || item.contactName || undefined,""",
    """      name: item.contactName || item.name || item.pushName || undefined,""",
)
