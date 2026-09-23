export type FindHubPolicy = {
  historyEnabled: boolean
  historyRetentionDays: number
  defaultIntervalSeconds: number
  locationTimeoutMs: number
  uiRefreshSeconds: number
}

export const defaultFindHubPolicy = (): FindHubPolicy => ({
  historyEnabled: false, historyRetentionDays: 0, defaultIntervalSeconds: 60,
  locationTimeoutMs: 30000, uiRefreshSeconds: 5,
})

// Updating a snapshot must not replace a form the operator is currently editing.
export function mergeFindHubDevices(current: any[], incoming: any[]): any[] {
  const existing = new Map(current.map(item => [item.id, item]))
  return incoming.map(item => {
    const previous = existing.get(item.id)
    if (!previous) return { ...item }
    const previousTime = Date.parse(previous.lastLocationAt || '')
    const nextTime = Date.parse(item.lastLocationAt || '')
    const latest = Number.isFinite(previousTime) && (!Number.isFinite(nextTime) || nextTime < previousTime)
      ? { position: previous.position, lastLocationAt: previous.lastLocationAt, lastReceivedAt: previous.lastReceivedAt } : {}
    Object.assign(previous, item, latest)
    return previous
  })
}

export function applyFindHubEvent(devices: any[], message: any): boolean {
  const data = message?.data
  if (!data || typeof data !== 'object') return false
  const id = data.device?.id || data.deviceId
  const device = devices.find(item => item.id === id)
  if (!device) return false
  if (message.event === 'findhub.location.updated' && data.location) {
    const incoming = Date.parse(data.location.timestamp)
    const previous = Date.parse(device.lastLocationAt || '')
    if (!Number.isFinite(incoming) || (Number.isFinite(previous) && incoming < previous)) return false
    device.position = data.location
    device.lastLocationAt = data.location.timestamp
    device.lastReceivedAt = message.receivedAt
    return true
  }
  if (message.event === 'findhub.tracking.update') {
    if (typeof data.enabled === 'boolean') device.trackingEnabled = data.enabled
    if (Number.isFinite(data.intervalSeconds)) device.trackingIntervalSeconds = data.intervalSeconds
    device.trackingStatus = { ...device.trackingStatus, ...data, inProgress: false, lastError: data.lastError, ...(data.enabled === false ? { nextAttemptAt: undefined } : {}) }
    return true
  }
  return false
}

export function findHubReportAge(value: unknown, now = Date.now()): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return 'Sem posição recebida'
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000))
  if (seconds < 60) return `Há ${seconds} s`
  if (seconds < 3600) return `Há ${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `Há ${Math.floor(seconds / 3600)} h`
  return `Há ${Math.floor(seconds / 86400)} dias`
}

// Streaming fetch keeps the instance API key in the header, unlike EventSource query-token workarounds.
export async function readFindHubEvents(body: ReadableStream<Uint8Array>, receive: (message: any) => void, signal: AbortSignal): Promise<void> {
  const reader = body.getReader(), decoder = new TextDecoder()
  let buffer = ''
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (!signal.aborted) {
      const item = await reader.read()
      if (item.done) break
      buffer += decoder.decode(item.value, { stream: true }).replace(/\r/g, '')
      if (buffer.length > 1048576) throw new Error('Evento excedeu o limite permitido.')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const lines = buffer.slice(0, boundary).split('\n'); buffer = buffer.slice(boundary + 2)
        const payload = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (payload) receive(JSON.parse(payload))
      }
    }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock() }
}
