<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'

type TranscriptionJob = {
  id: string
  workerId?: string | null
  mode?: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | string
  stage?: string | null
  progressPercent?: number
  processedDurationMs?: number | null
  text?: string | null
  language?: string | null
  detectedLanguage?: string | null
  durationMs?: number | null
  model?: string | null
  provider?: string | null
  errorCode?: string | null
  errorMessage?: string | null
  createdAt?: string
  updatedAt?: string
  completedAt?: string | null
  attempts?: number
}

const jobs = ref<TranscriptionJob[]>([])
const workerHealth = ref<any>(null)
const modelBusy = ref(false)
const selectedFile = ref<File | null>(null)
const language = ref('pt')
const busy = ref(false)
const loading = ref(true)
const error = ref('')
const success = ref('')
const selectedId = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const previewUrl = ref('')
const recording = ref(false)
const recordingPaused = ref(false)
const recordingSeconds = ref(0)
const recordingLevel = ref(0)
const recordingDb = ref(-60)
const recordingSupported = computed(() => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined')
const MAX_RECORDING_SECONDS = 60 * 60
const DEFAULT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const maxUploadBytes = computed(() => {
  const value = Number(workerHealth.value?.maxUploadBytes)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_UPLOAD_BYTES
})
let recorder: MediaRecorder | null = null
let recordingStream: MediaStream | null = null
let recordingChunks: Blob[] = []
let recordingMimeType = ''
let discardRecording = false
let recordingTimer: number | null = null
let meterFrame: number | null = null
let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let timer: number | null = null

const selected = computed(() => jobs.value.find((job) => job.id === selectedId.value) || jobs.value[0] || null)
const active = computed(() => jobs.value.filter((job) => ['queued', 'processing'].includes(job.status)).length)
const modelDownload = computed(() => workerHealth.value?.modelDownload || null)
const selectedSize = computed(() => selectedFile.value
  ? `${formatSize(selectedFile.value.size)} · pronto para enviar`
  : `OGG, Opus, MP3, M4A, WAV, WEBM ou AMR · até ${formatSize(maxUploadBytes.value)}`)

function stamp(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR')
}

function duration(value?: number | null) {
  const milliseconds = Number(value)
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '—'
  const seconds = Math.round(milliseconds / 1000)
  return String(Math.floor(seconds / 60)) + ':' + String(seconds % 60).padStart(2, '0')
}

function clock(value: number) {
  const seconds = Math.max(0, Math.floor(value))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function formatSize(value: number) {
  const bytes = Math.max(0, Number(value) || 0)
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function modelDownloadLabel(status?: string) {
  return ({
    not_installed: 'Ainda não instalado',
    downloading: 'Baixando para o volume persistente',
    ready: 'Instalado neste servidor',
    failed: 'O download falhou',
    unavailable: 'Instalação manual',
  } as Record<string, string>)[String(status || '')] || 'Verificando o modelo'
}

function queuedAge(value?: string) {
  const createdAt = value ? new Date(value).getTime() : NaN
  if (!Number.isFinite(createdAt)) return 'tempo indisponível'
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000))
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}min`
    : clock(seconds)
}

function statusLabel(status: string) {
  return ({ queued: 'Na fila', processing: 'Processando', completed: 'Concluída', cancelled: 'Cancelada', failed: 'Falhou' } as Record<string, string>)[status] || status
}

function stageLabel(stage?: string | null) {
  return ({
    queued: 'Aguardando a vez na fila',
    waiting_for_capacity: 'Aguardando capacidade de áudio',
    awaiting_redelivery: 'Aguardando retorno da entrega original',
    retrying: 'Aguardando nova tentativa',
    preparing: 'Preparando áudio',
    normalizing: 'Normalizando áudio',
    voice_activity_detection: 'Identificando voz',
    finalizing: 'Salvando resultado',
    downloading: 'Buscando áudio privado no MinIO',
    loading_model: 'Preparando o modelo local',
    transcribing: 'Transcrevendo por trechos',
    completed: 'Transcrição concluída',
    failed: 'Processamento interrompido',
  } as Record<string, string>)[String(stage || '')] || 'Preparando processamento'
}

function canDelete(job?: TranscriptionJob | null) {
  return !!job
}

function canRetry(job?: TranscriptionJob | null) {
  return !!job && job.status === 'failed' && job.mode !== 'dictation' && job.errorCode !== 'WORKER_HEARTBEAT_EXPIRED'
}

function clearPreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
}

function setSelectedFile(file: File | null) {
  clearPreview()
  selectedFile.value = file
  if (file) previewUrl.value = URL.createObjectURL(file)
}

function selectFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] || null
  setSelectedFile(file)
  error.value = ''
  success.value = ''
}

function openPicker() { fileInput.value?.click() }

function recordingType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  return candidates.find((value) => typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(value)) || ''
}

function stopMeter() {
  if (meterFrame !== null) window.cancelAnimationFrame(meterFrame)
  meterFrame = null
  analyser = null
  if (audioContext) void audioContext.close().catch(() => undefined)
  audioContext = null
  recordingLevel.value = 0
  recordingDb.value = -60
}

function startMeter(stream: MediaStream) {
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextCtor) return
  audioContext = new AudioContextCtor()
  const source = audioContext.createMediaStreamSource(stream)
  analyser = audioContext.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  const values = new Uint8Array(analyser.fftSize)
  const tick = () => {
    if (!analyser) return
    analyser.getByteTimeDomainData(values)
    let sum = 0
    for (const value of values) {
      const sample = (value - 128) / 128
      sum += sample * sample
    }
    const rms = Math.sqrt(sum / values.length)
    const db = 20 * Math.log10(Math.max(rms, 0.00001))
    recordingDb.value = Math.max(-60, Math.min(0, Math.round(db)))
    recordingLevel.value = Math.max(0, Math.min(1, (db + 60) / 60))
    meterFrame = window.requestAnimationFrame(tick)
  }
  tick()
}

function clearRecordingTimer() {
  if (recordingTimer !== null) window.clearInterval(recordingTimer)
  recordingTimer = null
}

function stopRecordingResources() {
  clearRecordingTimer()
  stopMeter()
  recordingStream?.getTracks().forEach((track) => track.stop())
  recordingStream = null
  recorder = null
  recordingPaused.value = false
  recording.value = false
}

function finishRecording() {
  const chunks = recordingChunks
  const mimeType = recordingMimeType || 'audio/webm'
  const shouldDiscard = discardRecording
  recordingChunks = []
  stopRecordingResources()
  if (shouldDiscard) return
  if (!chunks.length) {
    error.value = 'O microfone não capturou dados de áudio. Confira a permissão e tente novamente.'
    return
  }
  const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm'
  const blob = new Blob(chunks, { type: mimeType })
  if (blob.size === 0) {
    error.value = 'A gravação não contém dados de áudio. Confira o microfone e grave novamente.'
    return
  }
  setSelectedFile(new File([blob], `gravacao-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`, { type: mimeType.split(';')[0] }))
  success.value = 'Gravação concluída. Confira o áudio e envie para transcrever.'
}

async function startRecording() {
  if (recording.value) return
  if (!recordingSupported.value) {
    error.value = 'Este navegador não permite gravação de áudio. Use HTTPS ou localhost e autorize o microfone.'
    return
  }
  error.value = ''
  success.value = ''
  setSelectedFile(null)
  if (fileInput.value) fileInput.value.value = ''
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    recordingMimeType = recordingType()
    const options: MediaRecorderOptions = { audioBitsPerSecond: 32000 }
    if (recordingMimeType) options.mimeType = recordingMimeType
    recorder = new MediaRecorder(recordingStream, options)
    recordingChunks = []
    discardRecording = false
    recorder.ondataavailable = (event) => { if (event.data.size) recordingChunks.push(event.data) }
    recorder.onerror = () => { error.value = 'O navegador interrompeu a gravação. Tente novamente.'; discardRecording = true }
    recorder.onstop = finishRecording
    recorder.start(1000)
    recording.value = true
    recordingPaused.value = false
    recordingSeconds.value = 0
    startMeter(recordingStream)
    recordingTimer = window.setInterval(() => {
      recordingSeconds.value += 1
      if (recordingSeconds.value >= MAX_RECORDING_SECONDS) stopRecording(false)
    }, 1000)
  } catch (cause) {
    stopRecordingResources()
    error.value = friendlyError(cause, 'Não foi possível acessar o microfone. Autorize o uso do áudio e tente novamente.')
  }
}

function togglePauseRecording() {
  if (!recorder) return
  if (recorder.state === 'recording') {
    recorder.pause()
    recordingPaused.value = true
  } else if (recorder.state === 'paused') {
    recorder.resume()
    recordingPaused.value = false
  }
}

function stopRecording(discard = false) {
  if (!recorder) return
  discardRecording = discard
  clearRecordingTimer()
  if (recorder.state === 'inactive') finishRecording()
  else recorder.stop()
}

async function load() {
  loading.value = true
  error.value = ''
  const [jobsResult, healthResult] = await Promise.allSettled([
    connect.transcriptionList(100),
    connect.transcriptionHealth(),
  ])
  if (jobsResult.status === 'fulfilled') {
    jobs.value = jobsResult.value
    if (!jobs.value.some((job) => job.id === selectedId.value)) selectedId.value = jobs.value[0]?.id || ''
  } else {
    error.value = friendlyError(jobsResult.reason, 'Não foi possível consultar as transcrições.')
  }
  if (healthResult.status === 'fulfilled') {
    workerHealth.value = healthResult.value
  } else if (!error.value) {
    error.value = friendlyError(healthResult.reason, 'Não foi possível consultar o estado do worker.')
  }
  loading.value = false
  schedulePolling()
}

async function downloadModel() {
  const model = modelDownload.value
  if (!model?.available || modelBusy.value) return
  modelBusy.value = true
  error.value = ''
  success.value = ''
  try {
    const result = await connect.downloadSpeechModel(String(model.id || workerHealth.value?.model || 'Xenova/whisper-small'))
    workerHealth.value = {
      ...workerHealth.value,
      modelDownload: { ...model, ...result },
    }
    success.value = result.installed
      ? 'O modelo já está instalado e pronto para ser reutilizado.'
      : 'Download iniciado. Os arquivos ficarão no volume persistente para os próximos usos.'
  } catch (cause) {
    error.value = friendlyError(cause, 'Não foi possível iniciar o download do modelo.')
    try { workerHealth.value = await connect.transcriptionHealth() } catch { /* Keep the current download state visible. */ }
  } finally {
    modelBusy.value = false
    schedulePolling()
  }
}

function schedulePolling() {
  if (timer !== null) window.clearTimeout(timer)
  timer = null
  const needsWorkerCheck = !workerHealth.value || (workerHealth.value.enabled && (!workerHealth.value.workerReady || modelDownload.value?.status === 'downloading'))
  if (active.value || needsWorkerCheck) {
    timer = window.setTimeout(() => {
      timer = null
      void refreshActive()
    }, 5000)
  }
}

async function refreshActive() {
  const [jobsResult, healthResult] = await Promise.allSettled([
    connect.transcriptionList(100),
    connect.transcriptionHealth(),
  ])
  if (jobsResult.status === 'fulfilled') {
    jobs.value = jobsResult.value
    if (!jobs.value.some((job) => job.id === selectedId.value)) selectedId.value = jobs.value[0]?.id || ''
    error.value = ''
  } else {
    error.value = friendlyError(jobsResult.reason, 'Não foi possível atualizar a fila de transcrição.')
  }
  if (healthResult.status === 'fulfilled') {
    workerHealth.value = healthResult.value
  } else if (jobsResult.status === 'fulfilled') {
    error.value = friendlyError(healthResult.reason, 'Não foi possível consultar o estado do worker.')
  }
  schedulePolling()
}

async function upload() {
  if (!selectedFile.value) { error.value = 'Selecione um arquivo de áudio antes de enviar.'; return }
  if (selectedFile.value.size === 0) {
    error.value = 'O arquivo está vazio. Grave novamente ou selecione outro áudio.'
    return
  }
  if (selectedFile.value.size > maxUploadBytes.value) {
    error.value = `O arquivo excede o limite configurado de ${formatSize(maxUploadBytes.value)}.`
    return
  }
  busy.value = true
  error.value = ''
  success.value = ''
  try {
    const job = await connect.uploadTranscription(selectedFile.value, language.value)
    jobs.value = [job, ...jobs.value.filter((item) => item.id !== job.id)]
    selectedId.value = job.id
    setSelectedFile(null)
    if (fileInput.value) fileInput.value.value = ''
    success.value = 'Áudio recebido. O motor local começou o processamento.'
    schedulePolling()
  } catch (cause) {
    error.value = friendlyError(cause, 'Não foi possível enviar o áudio.')
    try { workerHealth.value = await connect.transcriptionHealth() } catch { /* Preserve the upload error and the last status. */ }
    schedulePolling()
  } finally {
    busy.value = false
  }
}

async function retry() {
  if (!canRetry(selected.value)) return
  busy.value = true
  error.value = ''
  try {
    const job = await connect.retryTranscription(selected.value.id)
    const index = jobs.value.findIndex((item) => item.id === job.id)
    if (index >= 0) jobs.value[index] = job
    schedulePolling()
  } catch (cause) {
    error.value = friendlyError(cause, 'Não foi possível reenfileirar a transcrição.')
  } finally { busy.value = false }
}

async function removeSelected() {
  const job = selected.value
  if (!canDelete(job)) return
  const activeJob = ['queued', 'processing'].includes(job.status)
  if (!window.confirm(activeJob
    ? 'Cancelar e excluir esta transcrição agora? O áudio temporário será removido do MinIO quando aplicável e um resultado atrasado será ignorado.'
    : 'Excluir esta transcrição e, quando aplicável, o áudio temporário do MinIO?')) return
  busy.value = true
  error.value = ''
  success.value = ''
  try {
    await connect.deleteTranscription(job.id)
    jobs.value = jobs.value.filter((item) => item.id !== job.id)
    selectedId.value = jobs.value[0]?.id || ''
    success.value = 'Transcrição excluída com segurança.'
    schedulePolling()
  } catch (cause) {
    error.value = friendlyError(cause, 'Não foi possível excluir a transcrição.')
  } finally { busy.value = false }
}

async function copyText() {
  if (!selected.value?.text) return
  await navigator.clipboard?.writeText(selected.value.text)
  success.value = 'Texto copiado para a área de transferência.'
}

onMounted(() => void load())
onBeforeUnmount(() => {
  if (timer !== null) window.clearTimeout(timer)
  if (recorder) stopRecording(true)
  clearPreview()
})
</script>

<template>
  <AppShell>
    <div class="transcription-page">
      <PageHeader title="Transcrição de áudio" description="Converta áudios em texto com o motor local da instalação, sem enviar conteúdo a provedores externos.">
        <button class="btn ghost" :disabled="loading" @click="load"><AppIcon name="refresh" :size="16" />{{ loading ? 'Atualizando…' : 'Atualizar' }}</button>
      </PageHeader>
      <section class="privacy-note"><AppIcon name="shield" :size="21" /><div><strong>Processamento privado</strong><p>O arquivo fica no MinIO privado e é processado pelo worker local. O painel recebe apenas o estado do job e o texto resultante.</p></div></section>
      <p v-if="error" class="notice error" role="alert">{{ error }}</p>
      <p v-if="success" class="notice success" role="status">{{ success }}</p>
      <p v-if="workerHealth?.enabled && modelDownload?.status === 'downloading'" class="notice worker-ready" role="status">Baixando o modelo de voz · {{ modelDownload.progressPercent || 0 }}% concluído. O áudio será processado após o download e o primeiro carregamento.</p>
      <p v-else-if="workerHealth && !workerHealth.workerReady && modelDownload?.installed" class="notice error" role="alert">Modelo instalado. O worker ainda está carregando o modelo ou não está ativo; aguarde e confira se o perfil <code>transcription</code> está habilitado.</p>
      <p v-else-if="workerHealth && !workerHealth.workerReady && modelDownload?.available" class="notice worker-ready" role="status">A API baixa o modelo automaticamente ao iniciar. Acompanhe o progresso aqui ou repita o download manualmente se necessário.</p>
      <p v-else-if="workerHealth && !workerHealth.workerReady" class="notice error" role="alert">O worker local não está consumindo a fila. Ative o perfil <code>transcription</code> no <code>COMPOSE_PROFILES</code> e recrie somente o container do worker.</p>
      <p v-else-if="workerHealth" class="notice worker-ready" role="status">Worker local ativo · {{ workerHealth.consumerCount }} consumidor(es) · {{ workerHealth.queuedJobs || 0 }} na fila persistida · {{ workerHealth.processingJobs || 0 }} em processamento<span v-if="workerHealth.oldestQueuedSeconds"> · mais antigo há {{ clock(workerHealth.oldestQueuedSeconds) }}</span></p>

      <section v-if="workerHealth?.enabled && modelDownload" class="model-card" aria-live="polite">
        <div class="model-copy">
          <strong>Modelo de voz · {{ modelDownload.id || workerHealth.model }}</strong>
          <p>{{ modelDownloadLabel(modelDownload.status) }} · Baixa aproximadamente 250 MB uma vez e mantém os arquivos no volume persistente entre reinícios e atualizações. Português, inglês e espanhol usam o mesmo modelo.</p>
          <div v-if="modelDownload.status === 'downloading'" class="model-progress">
            <progress :value="modelDownload.progressPercent || 0" max="100">{{ modelDownload.progressPercent || 0 }}%</progress>
            <small>{{ modelDownload.progressPercent || 0 }}% · {{ formatSize(modelDownload.downloadedBytes || 0) }} baixados<span v-if="modelDownload.totalBytes"> de {{ formatSize(modelDownload.totalBytes) }}</span></small>
          </div>
          <p v-if="modelDownload.errorMessage" class="model-error" role="alert">{{ modelDownload.errorMessage }}</p>
        </div>
        <button v-if="modelDownload.available && !modelDownload.installed && modelDownload.status !== 'downloading'" type="button" class="btn primary model-button" :disabled="modelBusy" @click="downloadModel"><AppIcon name="download" :size="15" />{{ modelBusy ? 'Iniciando…' : modelDownload.status === 'failed' ? 'Tentar novamente' : 'Baixar modelo' }}</button>
        <span v-else-if="modelDownload.installed" class="model-ready"><AppIcon name="check" :size="15" />Instalado</span>
      </section>

      <div class="transcription-layout">
        <PanelCard title="Novo áudio" description="Envie uma gravação para iniciar uma transcrição.">
          <div v-if="!recording" class="capture-actions">
            <button type="button" class="btn primary record-button" :disabled="busy || !recordingSupported" @click="startRecording"><AppIcon name="mic" :size="16" />Gravar áudio</button>
            <span>Até 1 hora · medidor de volume em tempo real</span>
          </div>
          <div v-if="recording" class="recording-panel" role="status" aria-live="polite">
            <div class="recording-heading"><span class="record-dot"></span><strong>{{ recordingPaused ? 'Gravação pausada' : 'Gravando áudio' }}</strong><time>{{ clock(recordingSeconds) }} / 60:00</time></div>
            <div class="level-meter" aria-label="Nível do microfone"><span :style="{ width: `${recordingLevel * 100}%` }"></span></div>
            <div class="recording-meta"><span>{{ recordingDb }} dB</span><span>{{ recordingPaused ? 'Retome quando quiser' : 'Fale normalmente perto do microfone' }}</span></div>
            <div class="recording-controls"><button type="button" class="btn ghost compact" @click="togglePauseRecording"><AppIcon :name="recordingPaused ? 'mic' : 'pause'" :size="14" />{{ recordingPaused ? 'Continuar' : 'Pausar' }}</button><button type="button" class="btn primary compact" @click="stopRecording(false)"><AppIcon name="stop" :size="14" />Concluir gravação</button><button type="button" class="btn ghost compact danger-button" @click="stopRecording(true)"><AppIcon name="close" :size="14" />Descartar</button></div>
          </div>
          <div v-if="!recording" class="drop-zone" :class="{ selected: selectedFile }" role="button" tabindex="0" @click="openPicker" @keydown.enter="openPicker" @keydown.space.prevent="openPicker">
            <input ref="fileInput" class="sr-only" type="file" accept="audio/*,video/webm,.ogg,.opus,.mp3,.m4a,.wav,.webm,.amr" @change="selectFile" />
            <span class="drop-icon"><AppIcon :name="selectedFile ? 'check' : 'folder'" :size="24" /></span>
            <strong>{{ selectedFile ? selectedFile.name : 'Escolha ou arraste um áudio' }}</strong>
            <small>{{ selectedSize }}</small>
            <button type="button" class="btn ghost compact" @click.stop="openPicker">{{ selectedFile ? 'Trocar arquivo' : 'Selecionar arquivo' }}</button>
          </div>
          <audio v-if="previewUrl && !recording" class="audio-preview" controls preload="metadata" :src="previewUrl"></audio>
          <div class="upload-options">
            <label class="field"><span>Idioma do áudio</span><select v-model="language"><option value="pt">Português</option><option value="en">English</option><option value="es">Español</option><option value="">Detecção automática</option></select></label>
            <button class="btn primary upload-button" :disabled="busy || !selectedFile" @click="upload"><AppIcon name="arrow" :size="16" />{{ busy ? 'Enviando…' : 'Transcrever áudio' }}</button>
          </div>
          <p v-if="!recordingSupported" class="recording-support"><AppIcon name="warning" :size="13" /> A gravação exige HTTPS ou localhost e permissão para o microfone.</p>
          <p class="privacy-hint"><AppIcon name="shield" :size="13" /> Nenhuma chave de OpenAI ou outro provedor é necessária.</p>
        </PanelCard>

        <PanelCard title="Atividade" :description="active ? String(active) + ' áudio(s) na fila ou em processamento' : 'Histórico e situação da fila desta instalação.'">
          <div v-if="loading" class="empty-state"><AppIcon name="refresh" :size="24" /><strong>Consultando jobs…</strong></div>
          <div v-else-if="!jobs.length" class="empty-state"><AppIcon name="mic" :size="25" /><strong>Nenhuma transcrição ainda</strong><span>Envie o primeiro áudio para começar.</span></div>
          <div v-else class="job-list"><button v-for="job in jobs" :key="job.id" type="button" class="job-row" :class="{ active: selected?.id === job.id }" @click="selectedId = job.id"><span class="job-state" :class="job.status"><i></i></span><span class="job-main"><strong>{{ job.text ? job.text.slice(0, 72) : statusLabel(job.status) }}</strong><small>{{ stamp(job.createdAt) }} · {{ job.status === 'processing' ? stageLabel(job.stage) : job.status === 'queued' ? `Na fila há ${queuedAge(job.createdAt)}` : duration(job.durationMs) }}</small></span><span class="job-status">{{ job.status === 'processing' ? `${job.progressPercent || 0}%` : statusLabel(job.status) }}</span></button></div>
        </PanelCard>
      </div>

      <PanelCard v-if="selected" title="Resultado" :description="statusLabel(selected.status) + ' · ' + (selected.provider === 'local' ? 'motor local' : (selected.provider || 'worker'))">
        <template #actions><button v-if="canRetry(selected)" class="btn ghost compact" :disabled="busy" @click="retry"><AppIcon name="refresh" :size="14" />{{ selected.status === 'failed' ? 'Tentar novamente' : 'Reenfileirar' }}</button><button v-if="selected.text" class="btn ghost compact" :disabled="busy" @click="copyText"><AppIcon name="copy" :size="14" />Copiar texto</button><button v-if="canDelete(selected)" class="btn ghost compact danger-button" :disabled="busy" @click="removeSelected"><AppIcon name="trash" :size="14" />{{ ['queued', 'processing'].includes(selected.status) ? 'Cancelar e excluir' : 'Excluir' }}</button></template>
        <div v-if="selected.status === 'queued' || selected.status === 'processing'" class="processing-state"><span class="spinner"></span><div class="processing-copy"><strong>{{ statusLabel(selected.status) }} · {{ stageLabel(selected.stage) }}</strong><p v-if="selected.status === 'queued'">Este áudio permanece na fila. A tela mostra a idade da fila e atualiza o estado automaticamente.</p><p v-else>Áudio processado: {{ duration(selected.processedDurationMs) }}. Tentativa {{ selected.attempts || 1 }}<template v-if="selected.workerId"> · worker {{ selected.workerId }}</template>.</p><div v-if="selected.status === 'processing'" class="job-progress" role="progressbar" :aria-valuenow="selected.progressPercent || 0" aria-valuemin="0" aria-valuemax="100"><span :style="{ width: `${Math.max(4, selected.progressPercent || 0)}%` }"></span></div></div></div>
        <div v-else-if="selected.status === 'failed'" class="result-error"><AppIcon name="warning" :size="19" /><div><strong>Não foi possível concluir</strong><p>{{ selected.errorMessage || 'O worker retornou uma falha sem detalhes.' }}</p><p v-if="selected.workerId">Worker: {{ selected.workerId }} · tentativa {{ selected.attempts || 1 }}</p></div></div>
        <div v-else-if="selected.status === 'completed'" class="result-body"><p>{{ selected.text || 'Sem texto reconhecido.' }}</p><footer><span>Idioma: {{ selected.detectedLanguage || selected.language || 'detectado automaticamente' }}</span><span>Duração: {{ duration(selected.durationMs) }}</span><span>Concluída: {{ stamp(selected.completedAt) }}</span><span v-if="selected.workerId">Worker: {{ selected.workerId }}</span><span>Tentativa: {{ selected.attempts || 1 }}</span></footer></div>
        <div v-else class="result-error"><AppIcon name="warning" :size="19" /><div><strong>{{ statusLabel(selected.status) }}</strong><p>Este trabalho foi interrompido.</p></div></div>
      </PanelCard>
    </div>
  </AppShell>
</template>

<style scoped>
.transcription-page{display:grid;gap:18px;min-width:0}.transcription-page :deep(.page-header){margin-bottom:0}.privacy-note{display:flex;gap:12px;align-items:flex-start;padding:15px 17px;border:1px solid var(--border);border-radius:13px;background:var(--primary-soft);color:var(--primary)}.privacy-note strong{font-size:13px}.privacy-note p{margin:4px 0 0;color:var(--muted);font-size:11px;line-height:1.5}.notice{margin:0;padding:12px 14px;border-radius:9px;font-size:12px;line-height:1.5}.notice.error{background:var(--danger-soft);color:var(--danger)}.notice.success{background:var(--success-soft);color:var(--success)}.transcription-layout{display:grid;grid-template-columns:minmax(320px,.9fr) minmax(0,1.1fr);gap:16px}.capture-actions{display:flex;align-items:center;gap:10px;margin-bottom:12px}.capture-actions>span{color:var(--muted);font-size:10px}.record-button{min-height:38px}.recording-panel{display:grid;gap:11px;margin-bottom:12px;padding:16px;border:1px solid color-mix(in srgb,var(--danger) 35%,var(--border));border-radius:12px;background:var(--danger-soft)}.recording-heading,.recording-meta{display:flex;align-items:center;gap:8px}.recording-heading strong{font-size:12px}.recording-heading time{margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums;font-size:12px}.record-dot{width:9px;height:9px;border-radius:50%;background:var(--danger);box-shadow:0 0 0 4px color-mix(in srgb,var(--danger) 18%,transparent);animation:pulse 1.2s infinite}.level-meter{height:9px;overflow:hidden;border-radius:99px;background:color-mix(in srgb,var(--danger) 15%,var(--surface))}.level-meter span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--success),#eab308,var(--danger));transition:width .08s linear}.recording-meta{justify-content:space-between;color:var(--muted);font-size:10px}.recording-meta span:first-child{color:var(--text);font-variant-numeric:tabular-nums;font-weight:700}.recording-controls{display:flex;flex-wrap:wrap;gap:8px}.danger-button{color:var(--danger)}.audio-preview{width:100%;height:38px;margin-top:11px}.drop-zone{display:grid;justify-items:center;gap:7px;padding:30px 18px;border:1px dashed var(--border);border-radius:12px;background:var(--surface-2);cursor:pointer;transition:border-color .15s,background .15s}.drop-zone:hover,.drop-zone:focus-visible,.drop-zone.selected{border-color:var(--primary);background:var(--primary-soft);outline:none}.drop-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:14px;background:var(--surface);color:var(--primary);box-shadow:var(--shadow)}.drop-zone strong{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.drop-zone small{color:var(--muted);font-size:10px}.upload-options{display:flex;align-items:flex-end;gap:12px;margin-top:15px}.field{display:grid;gap:5px;min-width:0;flex:1}.field span{color:var(--muted);font-size:10px;font-weight:700}.field select{min-height:38px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);padding:8px;font-size:11px}.upload-button{min-height:38px;white-space:nowrap}.recording-support{display:flex;align-items:center;gap:5px;margin:13px 0 0;color:var(--danger);font-size:10px}.privacy-hint{display:flex;align-items:center;gap:5px;margin:13px 0 0;color:var(--muted);font-size:10px}.job-list{display:grid;gap:3px;max-height:280px;overflow:auto}.job-row{display:flex;align-items:center;gap:10px;width:100%;padding:10px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--text);text-align:left;cursor:pointer}.job-row:hover,.job-row.active{border-color:var(--border);background:var(--surface-2)}.job-state{display:grid;place-items:center;width:20px;height:20px;border-radius:7px;background:var(--surface-2);flex:none}.job-state i{width:7px;height:7px;border-radius:50%;background:var(--muted)}.job-state.completed{background:var(--success-soft)}.job-state.completed i{background:var(--success)}.job-state.processing{background:var(--primary-soft)}.job-state.processing i{background:var(--primary);animation:pulse 1.2s infinite}.job-state.failed{background:var(--danger-soft)}.job-state.failed i{background:var(--danger)}.job-main{display:grid;gap:3px;min-width:0;flex:1}.job-main strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.job-main small{color:var(--muted);font-size:9px}.job-status{color:var(--muted);font-size:9px;white-space:nowrap}.empty-state{display:grid;justify-items:center;gap:7px;padding:35px 12px;color:var(--muted);text-align:center}.empty-state strong{color:var(--text);font-size:12px}.empty-state span{font-size:10px}.processing-state,.result-error{display:flex;align-items:flex-start;gap:12px;padding:16px;border-radius:10px;background:var(--surface-2);color:var(--primary)}.processing-state strong,.result-error strong{font-size:12px;color:var(--text)}.processing-state p,.result-error p{margin:4px 0 0;color:var(--muted);font-size:11px;line-height:1.5}.result-error{background:var(--danger-soft);color:var(--danger)}.result-body p{margin:0;min-height:80px;white-space:pre-wrap;font-size:13px;line-height:1.7}.result-body footer{display:flex;flex-wrap:wrap;gap:12px;margin-top:17px;padding-top:12px;border-top:1px solid var(--border);color:var(--muted);font-size:10px}.spinner{width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite;flex:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{50%{opacity:.25}}@media(max-width:860px){.transcription-layout{grid-template-columns:1fr}}@media(max-width:520px){.upload-options{align-items:stretch;flex-direction:column}.upload-button{width:100%}.transcription-page{gap:13px}.privacy-note{padding:13px}.capture-actions{align-items:stretch;flex-direction:column}.capture-actions>span{line-height:1.4}.recording-heading time{font-size:11px}.recording-controls>*{flex:1}.result-body p{font-size:12px}}
</style>

<style scoped>
.model-card{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:15px 17px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}.model-copy{display:grid;gap:5px;min-width:0}.model-copy strong{font-size:12px}.model-copy p{margin:0;color:var(--muted);font-size:10px;line-height:1.5}.model-button{flex:none;white-space:nowrap}.model-ready{display:flex;align-items:center;gap:5px;flex:none;color:var(--success);font-size:11px;font-weight:700}.model-progress{display:grid;gap:4px;max-width:440px}.model-progress progress{width:100%;height:8px;accent-color:var(--primary)}.model-progress small{color:var(--muted);font-size:9px}.model-error{color:var(--danger)!important}.processing-copy{flex:1;min-width:0}.job-progress{height:7px;margin-top:11px;overflow:hidden;border-radius:99px;background:var(--border)}.job-progress span{display:block;height:100%;border-radius:inherit;background:var(--primary);transition:width .35s ease}@media(max-width:520px){.model-card{align-items:stretch;flex-direction:column}.model-button{width:100%}}
</style>
