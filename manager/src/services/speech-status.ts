import type { SpeechHealth, TranscriptionJob } from '@/types/domain'

export function speechStageLabel(stage?: string | null) {
  return ({
    queued: 'Aguardando a vez na fila',
    waiting_for_capacity: 'Aguardando capacidade de áudio',
    awaiting_redelivery: 'Aguardando reconciliação da entrega',
    retrying: 'Aguardando nova tentativa',
    preparing: 'Preparando áudio',
    warming: 'Carregando o motor de voz',
    normalizing: 'Normalizando áudio',
    voice_activity_detection: 'Identificando voz',
    finalizing: 'Salvando resultado',
    downloading: 'Carregando áudio',
    loading_model: 'Carregando o modelo local',
    transcribing: 'Transcrevendo por trechos',
    yielded: 'Aguardando a próxima janela de processamento',
    completed: 'Transcrição concluída',
    cancelled: 'Cancelada',
    failed: 'Processamento interrompido',
  } as Record<string, string>)[String(stage || '')] || 'Aguardando atualização do motor'
}

export function speechPoolLabel(health: SpeechHealth | null) {
  if (!health) return 'Consultando disponibilidade do serviço de voz'
  const state = health.state || (health.enabled === false ? 'disabled' : health.workerReady ? 'ready' : 'offline')
  return ({
    disabled: 'O serviço de voz está desativado nesta instalação.',
    offline: 'O serviço de voz está sem conexão. Aguarde o retorno do processamento.',
    warming: 'O modelo está sendo carregado. A inicialização ainda não terminou.',
    ready: 'Serviço de voz disponível.',
    busy: 'O motor está processando áudio. Os próximos pedidos aguardam na fila.',
    capacity_exhausted: 'A capacidade de voz está esgotada. Aguarde uma vaga antes de enviar outro áudio.',
    degraded: 'O serviço de voz está degradado. Consulte o estado do modelo e a última evolução dos trabalhos.',
  } as Record<string, string>)[state]
}

export function reportedSpeechProgress(job: Partial<TranscriptionJob>): number | null {
  if (job.status === 'completed') return 100
  if (job.durationKnown !== true) return null
  if (job.status !== 'processing' || (!job.engineProgressAt && !(Number(job.processedDurationMs) > 0))) return null
  const value = Number(job.progressPercent)
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null
}

// Supervision heartbeats deliberately do not count as recognition progress.
export function speechProgressToken(job: Partial<TranscriptionJob>): string {
  return [job.status, job.stage, job.engineProgressAt, job.processedDurationMs, job.durationKnown, job.progressPercent, job.text].join('|')
}

export function speechPollDelay(status: string, unchangedPolls = 0, hidden = false, retryAfterSeconds = 0): number {
  const base = status === 'processing' ? 1000 : status === 'queued' ? 2000 : 15000
  const delay = Math.min(status === 'idle' ? 30000 : 10000, base * Math.max(1, 1 + Math.floor(unchangedPolls / 2)))
  const retryAfter = Number.isFinite(retryAfterSeconds) ? Math.min(2147483000, Math.max(0, retryAfterSeconds) * 1000) : 0
  return Math.max(delay, hidden ? 30000 : 0, retryAfter)
}

export function speechDeadline(deadlineAt: string | null | undefined, acceptedAt: number, budgetMs = 120000): number {
  const serverDeadline = Date.parse(deadlineAt || '')
  return Math.min(acceptedAt + budgetMs, Number.isFinite(serverDeadline) ? serverDeadline : Number.POSITIVE_INFINITY)
}
