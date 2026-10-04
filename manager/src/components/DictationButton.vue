<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'

type InsertMode = 'append' | 'replace' | 'insert-at-cursor'
type DictationState = 'idle' | 'requesting_permission' | 'listening' | 'processing' | 'completed' | 'error'

const props = withDefaults(defineProps<{
  modelValue: string
  target?: HTMLInputElement | HTMLTextAreaElement | null
  mode?: InsertMode
  instanceId?: string
  language?: string
  autoStop?: boolean
  silenceTimeoutMs?: number
  maxDurationSeconds?: number
}>(), {
  target: null,
  mode: 'insert-at-cursor',
  instanceId: '',
  language: 'pt-BR',
  autoStop: true,
  silenceTimeoutMs: 1500,
  maxDurationSeconds: 300,
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const state = ref<DictationState>('idle')
const error = ref('')
const elapsedSeconds = ref(0)
const stage = ref('')
const progress = ref(0)
const disposed = ref(false)
const isSecure = typeof window !== 'undefined' && (window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1')
const label = computed(() => ({
  idle: 'Iniciar ditado',
  requesting_permission: 'Aguardando microfone',
  listening: 'Parar ditado',
  processing: 'Ditando…',
  completed: 'Ditado inserido',
  error: 'Tentar ditado novamente',
} as Record<DictationState, string>)[state.value])

let stream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let timer: number | null = null
let meterTimer: number | null = null
let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let lastSpeechAt = 0
let heardSpeech = false
let selection = { start: 0, end: 0 }
let activeJob = ''
let targetListeners: Array<[string, EventListener]> = []
let boundTarget: HTMLInputElement | HTMLTextAreaElement | null = null

function rememberSelection() {
  const target = props.target
  if (!target || target.selectionStart === null || target.selectionEnd === null) return
  selection = { start: target.selectionStart, end: target.selectionEnd }
}

function attachTarget(target?: HTMLInputElement | HTMLTextAreaElement | null) {
  for (const [eventName, listener] of targetListeners) boundTarget?.removeEventListener(eventName, listener)
  targetListeners = []
  boundTarget = target || null
  if (!target) return
  const listener: EventListener = () => rememberSelection()
  for (const eventName of ['focus', 'keyup', 'click', 'input', 'select']) {
    target.addEventListener(eventName, listener)
    targetListeners.push([eventName, listener])
  }
  rememberSelection()
}

watch(() => props.target, (target) => attachTarget(target), { immediate: true })

function stopAudioResources() {
  if (timer !== null) window.clearInterval(timer)
  if (meterTimer !== null) window.clearInterval(meterTimer)
  timer = null
  meterTimer = null
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  analyser = null
  if (audioContext) void audioContext.close().catch(() => undefined)
  audioContext = null
  recorder = null
}

function mediaType() {
  if (typeof MediaRecorder === 'undefined') return ''
  if (typeof MediaRecorder.isTypeSupported !== 'function') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4']
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) || ''
}

function microphoneError(cause: unknown) {
  const name = String((cause as { name?: string })?.name || '')
  if (!isSecure) return 'É necessário utilizar HTTPS para acessar o microfone.'
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'O acesso ao microfone foi bloqueado.'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'Nenhum microfone foi encontrado.'
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'O microfone está sendo usado por outro aplicativo.'
  if (name === 'NotSupportedError' || typeof MediaRecorder === 'undefined') return 'O navegador atual não oferece suporte ao ditado.'
  return 'Não foi possível acessar o microfone. Verifique a permissão e tente novamente.'
}

function monitorSilence() {
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!stream || !AudioContextCtor) return
  try {
    audioContext = new AudioContextCtor()
    const source = audioContext.createMediaStreamSource(stream)
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    meterTimer = window.setInterval(() => {
      if (!analyser) return
      analyser.getByteTimeDomainData(samples)
      let squareSum = 0
      for (const sample of samples) {
        const normalized = (sample - 128) / 128
        squareSum += normalized * normalized
      }
      const rms = Math.sqrt(squareSum / samples.length)
      if (rms >= 0.012) {
        heardSpeech = true
        lastSpeechAt = Date.now()
      } else if (props.autoStop && heardSpeech && Date.now() - lastSpeechAt >= props.silenceTimeoutMs) {
        stopRecording()
      }
    }, 100)
  } catch {
    // Silence stopping is optional; the manual stop button remains available.
  }
}

async function startRecording() {
  if (!isSecure) {
    state.value = 'error'
    error.value = 'É necessário utilizar HTTPS para acessar o microfone.'
    return
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    state.value = 'error'
    error.value = 'O navegador atual não oferece suporte ao ditado.'
    return
  }

  rememberSelection()
  error.value = ''
  stage.value = ''
  state.value = 'requesting_permission'
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const mimeType = mediaType()
    recorder = new MediaRecorder(stream, {
      audioBitsPerSecond: 32000,
      ...(mimeType ? { mimeType } : {}),
    })
    chunks = []
    heardSpeech = false
    lastSpeechAt = Date.now()
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
    recorder.onerror = () => {
      error.value = 'O navegador interrompeu a gravação. Tente novamente.'
      state.value = 'error'
      stopAudioResources()
    }
    recorder.onstop = () => { void finishRecording() }
    recorder.start(250)
    state.value = 'listening'
    elapsedSeconds.value = 0
    timer = window.setInterval(() => {
      elapsedSeconds.value += 1
      if (elapsedSeconds.value >= props.maxDurationSeconds) stopRecording()
    }, 1000)
    monitorSilence()
  } catch (cause) {
    stopAudioResources()
    state.value = 'error'
    error.value = microphoneError(cause)
  }
}

function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return
  if (timer !== null) window.clearInterval(timer)
  timer = null
  recorder.stop()
}

function insertText(value: string) {
  const target = props.target
  const current = props.modelValue || ''
  let next = value
  let caret = current.length
  if (props.mode === 'replace') {
    caret = value.length
  } else if (props.mode === 'append' || !target) {
    const needsSpace = current.length > 0 && !/\s$/.test(current) && !/^\s/.test(value)
    next = current + (needsSpace ? ' ' : '') + value
    caret = next.length
  } else {
    const start = Math.max(0, Math.min(selection.start, current.length))
    const end = Math.max(start, Math.min(selection.end, current.length))
    next = current.slice(0, start) + value + current.slice(end)
    caret = start + value.length
  }
  emit('update:modelValue', next)
  window.setTimeout(() => {
    target?.focus()
    target?.setSelectionRange(caret, caret)
    selection = { start: caret, end: caret }
  }, 0)
}

function pause(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

async function waitForResult(id: string) {
  const timeout = Date.now() + 30 * 60 * 1000
  while (!disposed.value && activeJob === id && Date.now() < timeout) {
    const job = await connect.dictationJob(id)
    if (disposed.value || activeJob !== id) return
    stage.value = String(job.stage || job.status || '')
    progress.value = Number(job.progressPercent || 0)
    if (job.status === 'completed') {
      activeJob = ''
      const text = String(job.text || '').trim()
      if (!text) throw new Error('O motor não retornou texto para este trecho de áudio.')
      insertText(text)
      state.value = 'completed'
      return
    }
    if (job.status === 'failed') {
      activeJob = ''
      throw new Error(job.errorMessage || 'Não foi possível concluir o ditado.')
    }
    if (job.status === 'cancelled') {
      activeJob = ''
      throw new Error('O ditado foi cancelado.')
    }
    await pause(1000)
  }
  if (!disposed.value && activeJob === id) {
    activeJob = ''
    throw new Error('O ditado excedeu o tempo de espera. O job continua disponível na fila de voz.')
  }
}

async function finishRecording() {
  const capturedChunks = chunks
  const mimeType = recorder?.mimeType || capturedChunks[0]?.type || 'audio/webm'
  const durationMs = elapsedSeconds.value * 1000
  chunks = []
  stopAudioResources()
  if (!capturedChunks.length || disposed.value) {
    state.value = 'idle'
    return
  }
  const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : 'webm'
  const audio = new File([new Blob(capturedChunks, { type: mimeType })], `ditado.${extension}`, { type: mimeType.split(';')[0] })
  state.value = 'processing'
  stage.value = 'queued'
  progress.value = 0
  try {
    const job = await connect.dictate(audio, {
      language: props.language,
      instanceId: props.instanceId,
      durationMs,
      idempotencyKey: crypto.randomUUID(),
    })
    if (disposed.value || state.value !== 'processing') {
      void connect.cancelDictation(job.id).catch(() => undefined)
      return
    }
    activeJob = job.id
    await waitForResult(job.id)
  } catch (cause) {
    if (!disposed.value && state.value === 'processing') {
      state.value = 'error'
      error.value = friendlyError(cause, 'Não foi possível enviar o áudio para ditado.')
    }
  }
}

async function toggle() {
  if (state.value === 'listening') {
    stopRecording()
    return
  }
  if (state.value === 'requesting_permission' || state.value === 'processing') return
  state.value = 'idle'
  await startRecording()
}

async function cancel() {
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = () => {
      chunks = []
      stopAudioResources()
      state.value = 'idle'
    }
    stopRecording()
    return
  }
  const id = activeJob
  activeJob = ''
  if (id) await connect.cancelDictation(id).catch(() => undefined)
  state.value = 'idle'
  error.value = ''
}

function stageLabel(value: string) {
  return ({
    queued: 'Na fila prioritária',
    preparing: 'Preparando áudio',
    downloading: 'Carregando áudio',
    normalizing: 'Normalizando áudio',
    voice_activity_detection: 'Localizando trechos de fala',
    transcribing: 'Transcrevendo',
    retrying: 'Recuperando o processamento',
    finalizing: 'Finalizando texto',
  } as Record<string, string>)[value] || 'Processando voz'
}

onBeforeUnmount(() => {
  disposed.value = true
  const id = activeJob
  activeJob = ''
  if (id) void connect.cancelDictation(id).catch(() => undefined)
  stopAudioResources()
  attachTarget(null)
})
</script>

<template>
  <div class="dictation-control" :class="{ listening: state === 'listening', busy: state === 'processing' }">
    <button
      class="dictation-button"
      type="button"
      :disabled="state === 'requesting_permission' || state === 'processing'"
      :aria-label="label"
      :title="label"
      @pointerdown="rememberSelection"
      @mousedown.prevent
      @click="toggle"
    >
      <AppIcon v-if="state !== 'listening' && state !== 'processing'" name="mic" :size="15" />
      <span v-else-if="state === 'listening'" class="dictation-stop" aria-hidden="true"></span>
      <span v-else class="dictation-spinner" aria-hidden="true"></span>
    </button>
    <span v-if="state === 'listening'" class="dictation-feedback" role="status">
      <span class="dictation-dot"></span>Ouvindo {{ String(Math.floor(elapsedSeconds / 60)).padStart(2, '0') }}:{{ String(elapsedSeconds % 60).padStart(2, '0') }}
    </span>
    <span v-else-if="state === 'requesting_permission'" class="dictation-feedback" role="status">Solicitando microfone…</span>
    <span v-else-if="state === 'processing'" class="dictation-feedback" role="status" aria-live="polite">
      {{ stageLabel(stage) }}<template v-if="progress > 0"> · {{ progress }}%</template>
    </span>
    <button v-if="state === 'listening' || state === 'processing'" class="dictation-cancel" type="button" aria-label="Cancelar ditado" @click="cancel">Cancelar</button>
    <span v-else-if="state === 'completed'" class="dictation-feedback success" role="status">Texto inserido</span>
    <span v-if="error" class="dictation-error" role="alert">{{ error }}</span>
  </div>
</template>

<style scoped>
.dictation-control{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}.dictation-button{display:grid;place-items:center;width:36px;height:36px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--primary);cursor:pointer;flex:none}.dictation-button:hover:not(:disabled){background:var(--primary-soft);border-color:var(--primary)}.dictation-button:disabled{opacity:.65;cursor:wait}.listening .dictation-button{background:var(--danger-soft);border-color:var(--danger);color:var(--danger)}.dictation-feedback{display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:11px}.dictation-feedback.success{color:var(--success)}.dictation-dot{width:8px;height:8px;border-radius:50%;background:var(--danger);animation:dictation-pulse 1.1s infinite}.dictation-stop{width:11px;height:11px;border-radius:2px;background:currentColor}.dictation-spinner{width:15px;height:15px;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:dictation-spin .8s linear infinite}.dictation-cancel{border:0;background:transparent;color:var(--danger);font-size:10px;cursor:pointer}.dictation-error{flex-basis:100%;color:var(--danger);font-size:11px;line-height:1.4}@keyframes dictation-spin{to{transform:rotate(360deg)}}@keyframes dictation-pulse{50%{opacity:.25}}
</style>
