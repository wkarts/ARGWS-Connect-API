/** Authenticated fetch is used instead of EventSource so API keys never enter URLs. */
export async function readFindHubStream(response: Response, signal: AbortSignal, receive: (event: any) => void): Promise<void> {
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('Resposta realtime inválida.')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal.aborted) {
      const part = await reader.read(); if (part.done) return
      buffer += decoder.decode(part.value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      if (buffer.length > 1024 * 1024) throw new Error('Resposta realtime excedeu o limite.')
      let end: number
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2)
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (data) receive(JSON.parse(data))
      }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
export function findHubAvailability(device: any, staleAfterSeconds: number, now = Date.now()): string {
  if (device?.latestPosition?.source === 'TRACCAR' && device?.providerStatus === 'offline') return 'Offline'
  const stamp = Date.parse(device?.latestPosition?.timestamp || '')
  if (!Number.isFinite(stamp)) return 'Sem localização'
  if (now - stamp > staleAfterSeconds * 1000) return 'Sem atualização recente'
  return device?.latestPosition?.source === 'TRACCAR' && device?.providerStatus === 'online' ? 'Online' : 'Posição recente'
}
