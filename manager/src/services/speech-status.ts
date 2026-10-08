import type { SpeechHealth, TranscriptionJob } from '@/types/domain'

type SpeechHealthSnapshot = SpeechHealth & {
  connected?: boolean
  dictationQueuedJobs?: number
  dictationProcessingJobs?: number
}

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

export function speechWorkerLabel(health: SpeechHealthSnapshot | null, mode: 'transcription' | 'dictation') {
  if (!health) return 'Consultando'
  if (health.enabled === false || health.state === 'disabled' || (mode === 'dictation' && health.dictationEnabled === false)) return 'Desativado'
  const download = health.modelDownload
  if (download?.status === 'not_installed') return 'Modelo não instalado'
  if (download?.status === 'downloading' || download?.status === 'verifying') return 'Preparando modelo'
  if (download?.status === 'failed' && health.modelVerified !== true) return 'Modelo não verificado'
  if (health.state === 'offline' || health.connected === false || health.processAlive === false || health.brokerConnected === false) return 'Sem conexão'
  if (health.modelVerified === false) return 'Modelo não verificado'
  if (health.state === 'degraded') return 'Indisponível'

  const ready = mode === 'transcription' ? health.workerReady : health.dictationWorkerReady
  const capability = health.capabilities?.[mode]
  // Older responses can report readiness without capabilities. An explicit
  // unavailable mode must never inherit the other mode's engine readiness.
  if (capability !== true && !(capability === undefined && ready === true)) return 'Indisponível'
  if (health.state === 'capacity_exhausted') return 'Capacidade esgotada'
  if (health.acceptingJobs === false) return 'Indisponível'
  const processing = mode === 'transcription' ? health.processingJobs : health.dictationProcessingJobs
  const queued = mode === 'transcription' ? health.queuedJobs : health.dictationQueuedJobs
  // SQL workload is not proof of current native inference or recognition.
  if (Number(processing) > 0) return 'Trabalho em andamento'
  if (Number(queued) > 0) return 'Aguardando processamento'
  return ready === true ? 'Pronto' : 'Disponível sob demanda'
}

export function speechPoolLabel(health: SpeechHealthSnapshot | null) {
  if (!health) return 'Consultando disponibilidade do serviço de voz'
  const state = health.state || (health.enabled === false ? 'disabled' : health.workerReady ? 'ready' : 'offline')
  const idleOnDemand = state === 'warming' && health.acceptingJobs === true &&
    health.modelVerified === true && health.processAlive === true && health.brokerConnected === true &&
    health.connected !== false &&
    (health.capabilities?.transcription === true || (health.dictationEnabled !== false && health.capabilities?.dictation === true)) &&
    ![health.queuedJobs, health.processingJobs, health.dictationQueuedJobs, health.dictationProcessingJobs].some((count) => Number(count) > 0)
  if (idleOnDemand) return 'Serviço de voz disponível sob demanda. O modelo será carregado ao iniciar um trabalho.'
  return ({
    disabled: 'O serviço de voz está desativado nesta instalação.',
    offline: 'O serviço de voz está sem conexão. Aguarde o retorno do processamento.',
    warming: 'Inicialização do serviço de voz pendente. Consulte o estado do modelo e dos workers.',
    ready: 'Serviço de voz disponível.',
    busy: 'Há trabalhos marcados como em processamento. Consulte a etapa e o último avanço de cada áudio.',
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
