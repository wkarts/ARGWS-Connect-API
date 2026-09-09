import { runtime } from '@/config/runtime'

export type OperationalEvent = { id: string; timestamp: string; title: string; severity: string; service?: string; count?: number; errors?: number }
export type OperationalArchive = { day: string; archived: boolean; bytes: number; count?: number; verifiedAt?: string }
export type OperationalSnapshot = {
  enabled: boolean; checkedAt: string; uptimeSeconds: number; timezone: string
  diskBytes: number; maxDiskBytes: number; dropped: number; maintenanceError: boolean
  services: Array<{ key: string; status: string; type: string; durationMs: number; checkedAt: string }>
  recent: OperationalEvent[]
}
export type OperationalBucket = {
  label: string; samples: number; requests: number | null; errors: number | null
  averageMs: number | null; errorRate: number | null; gapBatches: number
}
export type OperationalStatistics = {
  from: string; to: string; timezone: string; granularity: 'hour' | 'day'; generatedAt: string
  totals: OperationalBucket; series: OperationalBucket[]; incomplete: boolean
  archives: Array<{ day: string; bytes: number; archived: boolean }>
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
      if (response.status === 503) {
        const detail = await response.json().catch(() => ({}))
        if (detail.enabled === false) throw new Error('Monitoramento não habilitado. Atualize a configuração da instalação com os parâmetros operacionais.')
        throw new Error('O serviço de monitoramento está temporariamente indisponível. Os demais recursos não dependem deste painel.')
      }
      if (response.status === 403) throw new Error('Somente o administrador da instalação pode acessar os diagnósticos.')
      if (response.status === 429) throw new Error('Outra consulta está em andamento. Aguarde antes de atualizar.')
      throw new Error('Não foi possível consultar o histórico. Verifique o período, os limites e a integridade dos registros.')
    }
    return path === 'export' ? await response.blob() : await response.json()
  } finally { clearTimeout(timer) }
}
export const operations = {
  snapshot: (): Promise<OperationalSnapshot> => request('snapshot'),
  statistics: (from: string, to: string): Promise<OperationalStatistics> => request('statistics', { from, to }),
  archives: (): Promise<{ archives: OperationalArchive[] }> => request('archives'),
  history: (from: string, to: string, cursor = ''): Promise<{ events: OperationalEvent[]; nextCursor: string | null }> => request('history', { from, to, cursor }),
  async download(day: string) {
    const blob = await request('export', { day, format: 'log' }) as Blob
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = `connect-operations-${day}.log.gz`; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}
