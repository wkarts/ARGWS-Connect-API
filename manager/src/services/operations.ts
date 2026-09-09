import { runtime } from '@/config/runtime'

export type OperationalEvent = { id: string; timestamp: string; title: string; severity: string; service?: string; count?: number; errors?: number }
export type OperationalArchive = { day: string; archived: boolean; bytes: number; count?: number; verifiedAt?: string }
export type OperationalSnapshot = {
  enabled: boolean; checkedAt: string; uptimeSeconds: number; timezone: string
  diskBytes: number; maxDiskBytes: number; dropped: number; maintenanceError: boolean
  services: Array<{ key: string; status: string; type: string; durationMs: number; checkedAt: string }>
  recent: OperationalEvent[]
}
async function request(path: string, params: Record<string, string> = {}) {
  const key = sessionStorage.getItem('connect_access_code') || ''
  if (!key) throw new Error('Este painel exige acesso administrativo com a chave global.')
  const url = new URL(`${runtime.apiBaseUrl}/operations/${path}`)
  for (const [name, value] of Object.entries(params)) if (value) url.searchParams.set(name, value)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), path === 'export' ? 60000 : 20000)
  try {
    const response = await fetch(url, { headers: { apikey: key }, credentials: 'same-origin', signal: controller.signal })
    if (!response.ok) {
      if (response.status === 503) throw new Error('Monitoramento operacional não habilitado ou temporariamente indisponível.')
      if (response.status === 403) throw new Error('Somente o administrador da instalação pode acessar os diagnósticos.')
      throw new Error('Não foi possível consultar o histórico. Verifique o período e aguarde a consulta anterior terminar.')
    }
    return path === 'export' ? await response.blob() : await response.json()
  } finally { clearTimeout(timer) }
}
export const operations = {
  snapshot: (): Promise<OperationalSnapshot> => request('snapshot'),
  archives: (): Promise<{ archives: OperationalArchive[] }> => request('archives'),
  history: (from: string, to: string, cursor = ''): Promise<{ events: OperationalEvent[]; nextCursor: string | null }> => request('history', { from, to, cursor }),
  async download(day: string) {
    const blob = await request('export', { day, format: 'text' }) as Blob
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = `connect-operations-${day}.log.gz`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}
