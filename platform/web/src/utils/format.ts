export function money(value: unknown): string {
  const number = Number(value || 0)
  return Number.isFinite(number)
    ? number.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : 'R$ 0,00'
}

export function dateBR(value?: string | null): string {
  if (!value) return '—'
  const normalized = value.length === 10 ? `${value}T12:00:00` : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR')
}

export function dateTimeBR(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR')
}

export function shortId(value?: string | null): string {
  if (!value) return '—'
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}

export function copyText(value?: string | null): Promise<void> {
  return navigator.clipboard.writeText(value || '')
}

export function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** index).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${units[index]}`
}
