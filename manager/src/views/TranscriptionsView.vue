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
  status: 'queued' | 'processing' | 'completed' | 'failed' | string
  text?: string | null
  language?: string | null
  detectedLanguage?: string | null
  durationMs?: number | null
  model?: string | null
  provider?: string | null
  errorMessage?: string | null
  createdAt?: string
  completedAt?: string | null
  attempts?: number
}

const jobs = ref<TranscriptionJob[]>([])
const selectedFile = ref<File | null>(null)
const language = ref('pt')
const busy = ref(false)
const loading = ref(true)
const error = ref('')
const success = ref('')
const selectedId = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
let timer: number | null = null

const selected = computed(() => jobs.value.find((job) => job.id === selectedId.value) || jobs.value[0] || null)
const active = computed(() => jobs.value.filter((job) => ['queued', 'processing'].includes(job.status)).length)
const selectedSize = computed(() => selectedFile.value ? (selectedFile.value.size / 1024 / 1024).toFixed(2) + ' MB · pronto para enviar' : 'OGG, Opus, MP3, M4A, WAV, WEBM ou AMR · até 25 MB')

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

function statusLabel(status: string) {
  return ({ queued: 'Na fila', processing: 'Transcrevendo', completed: 'Concluída', failed: 'Falhou' } as Record<string, string>)[status] || status
}

function selectFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] || null
  selectedFile.value = file
  error.value = ''
  success.value = ''
}

function openPicker() { fileInput.value?.click() }

async function load() {
  loading.value = true
  try {
    jobs.value = await connect.transcriptionList()
    if (!selectedId.value && jobs.value[0]) selectedId.value = jobs.value[0].id
  } catch (cause) {
    error.value = friendlyError(cause, 'Não foi possível consultar as transcrições.')
  } finally {
    loading.value = false
  }
  schedulePolling()
}

function schedulePolling() {
  if (timer !== null) window.clearInterval(timer)
  timer = active.value ? window.setInterval(() => void refreshActive(), 3000) : null
}

async function refreshActive() {
  const pending = jobs.value.filter((job) => ['queued', 'processing'].includes(job.status))
  if (!pending.length) { schedulePolling(); return }
  await Promise.all(pending.map(async (job) => {
    try {
      const fresh = await connect.transcription(job.id)
      const index = jobs.value.findIndex((item) => item.id === job.id)
      if (index >= 0) jobs.value[index] = fresh
    } catch { /* polling is best effort */ }
  }))
  schedulePolling()
}

async function upload() {
  if (!selectedFile.value) { error.value = 'Selecione um arquivo de áudio antes de enviar.'; return }
  if (selectedFile.value.size > 25 * 1024 * 1024) { error.value = 'O arquivo excede o limite padrão de 25 MB.'; return }
  busy.value = true
  error.value = ''
  success.value = ''
  try {
    const job = await connect.uploadTranscription(selectedFile.value, language.value)
    jobs.value = [job, ...jobs.value.filter((item) => item.id !== job.id)]
    selectedId.value = job.id
    selectedFile.value = null
    if (fileInput.value) fileInput.value.value = ''
    success.value = 'Áudio recebido. O motor local começou o processamento.'
    schedulePolling()
  } catch (cause) {
    error.value = friendlyError(cause, 'Não foi possível enviar o áudio.')
  } finally {
    busy.value = false
  }
}

async function retry() {
  if (!selected.value || selected.value.status !== 'failed') return
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

async function copyText() {
  if (!selected.value?.text) return
  await navigator.clipboard?.writeText(selected.value.text)
  success.value = 'Texto copiado para a área de transferência.'
}

onMounted(() => void load())
onBeforeUnmount(() => { if (timer !== null) window.clearInterval(timer) })
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

      <div class="transcription-layout">
        <PanelCard title="Novo áudio" description="Envie uma gravação para iniciar uma transcrição.">
          <div class="drop-zone" :class="{ selected: selectedFile }" role="button" tabindex="0" @click="openPicker" @keydown.enter="openPicker" @keydown.space.prevent="openPicker">
            <input ref="fileInput" class="sr-only" type="file" accept="audio/*,.ogg,.opus,.mp3,.m4a,.wav,.webm,.amr" @change="selectFile" />
            <span class="drop-icon"><AppIcon :name="selectedFile ? 'check' : 'mic'" :size="24" /></span>
            <strong>{{ selectedFile ? selectedFile.name : 'Escolha ou arraste um áudio' }}</strong>
            <small>{{ selectedSize }}</small>
            <button type="button" class="btn ghost compact" @click.stop="openPicker">{{ selectedFile ? 'Trocar arquivo' : 'Selecionar arquivo' }}</button>
          </div>
          <div class="upload-options">
            <label class="field"><span>Idioma do áudio</span><select v-model="language"><option value="pt">Português</option><option value="en">English</option><option value="es">Español</option><option value="">Detecção automática</option></select></label>
            <button class="btn primary upload-button" :disabled="busy || !selectedFile" @click="upload"><AppIcon name="arrow" :size="16" />{{ busy ? 'Enviando…' : 'Transcrever áudio' }}</button>
          </div>
          <p class="privacy-hint"><AppIcon name="shield" :size="13" /> Nenhuma chave de OpenAI ou outro provedor é necessária.</p>
        </PanelCard>

        <PanelCard title="Atividade" :description="active ? String(active) + ' processamento(s) em andamento' : 'Processamentos recentes desta instalação.'">
          <div v-if="loading" class="empty-state"><AppIcon name="refresh" :size="24" /><strong>Consultando jobs…</strong></div>
          <div v-else-if="!jobs.length" class="empty-state"><AppIcon name="mic" :size="25" /><strong>Nenhuma transcrição ainda</strong><span>Envie o primeiro áudio para começar.</span></div>
          <div v-else class="job-list"><button v-for="job in jobs" :key="job.id" type="button" class="job-row" :class="{ active: selected?.id === job.id }" @click="selectedId = job.id"><span class="job-state" :class="job.status"><i></i></span><span class="job-main"><strong>{{ job.text ? job.text.slice(0, 72) : statusLabel(job.status) }}</strong><small>{{ stamp(job.createdAt) }} · {{ duration(job.durationMs) }}</small></span><span class="job-status">{{ statusLabel(job.status) }}</span></button></div>
        </PanelCard>
      </div>

      <PanelCard v-if="selected" title="Resultado" :description="statusLabel(selected.status) + ' · ' + (selected.provider === 'local' ? 'motor local' : (selected.provider || 'worker'))">
        <template #actions><button v-if="selected.status === 'failed'" class="btn ghost compact" :disabled="busy" @click="retry"><AppIcon name="refresh" :size="14" />Tentar novamente</button><button v-if="selected.text" class="btn ghost compact" @click="copyText"><AppIcon name="copy" :size="14" />Copiar texto</button></template>
        <div v-if="selected.status === 'queued' || selected.status === 'processing'" class="processing-state"><span class="spinner"></span><div><strong>{{ statusLabel(selected.status) }}</strong><p>O worker local está processando o áudio. Esta tela atualiza automaticamente.</p></div></div>
        <div v-else-if="selected.status === 'failed'" class="result-error"><AppIcon name="warning" :size="19" /><div><strong>Não foi possível concluir</strong><p>{{ selected.errorMessage || 'O worker retornou uma falha sem detalhes.' }}</p></div></div>
        <div v-else class="result-body"><p>{{ selected.text || 'A transcrição terminou sem texto reconhecido.' }}</p><footer><span>Idioma: {{ selected.detectedLanguage || selected.language || 'detectado automaticamente' }}</span><span>Duração: {{ duration(selected.durationMs) }}</span><span>Concluída: {{ stamp(selected.completedAt) }}</span></footer></div>
      </PanelCard>
    </div>
  </AppShell>
</template>

<style scoped>
.transcription-page{display:grid;gap:18px;min-width:0}.transcription-page :deep(.page-header){margin-bottom:0}.privacy-note{display:flex;gap:12px;align-items:flex-start;padding:15px 17px;border:1px solid var(--border);border-radius:13px;background:var(--primary-soft);color:var(--primary)}.privacy-note strong{font-size:13px}.privacy-note p{margin:4px 0 0;color:var(--muted);font-size:11px;line-height:1.5}.notice{margin:0;padding:12px 14px;border-radius:9px;font-size:12px;line-height:1.5}.notice.error{background:var(--danger-soft);color:var(--danger)}.notice.success{background:var(--success-soft);color:var(--success)}.transcription-layout{display:grid;grid-template-columns:minmax(320px,.9fr) minmax(0,1.1fr);gap:16px}.drop-zone{display:grid;justify-items:center;gap:7px;padding:30px 18px;border:1px dashed var(--border);border-radius:12px;background:var(--surface-2);cursor:pointer;transition:border-color .15s,background .15s}.drop-zone:hover,.drop-zone:focus-visible,.drop-zone.selected{border-color:var(--primary);background:var(--primary-soft);outline:none}.drop-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:14px;background:var(--surface);color:var(--primary);box-shadow:var(--shadow)}.drop-zone strong{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.drop-zone small{color:var(--muted);font-size:10px}.upload-options{display:flex;align-items:flex-end;gap:12px;margin-top:15px}.field{display:grid;gap:5px;min-width:0;flex:1}.field span{color:var(--muted);font-size:10px;font-weight:700}.field select{min-height:38px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);padding:8px;font-size:11px}.upload-button{min-height:38px;white-space:nowrap}.privacy-hint{display:flex;align-items:center;gap:5px;margin:13px 0 0;color:var(--muted);font-size:10px}.job-list{display:grid;gap:3px;max-height:280px;overflow:auto}.job-row{display:flex;align-items:center;gap:10px;width:100%;padding:10px;border:1px solid transparent;border-radius:9px;background:transparent;color:var(--text);text-align:left;cursor:pointer}.job-row:hover,.job-row.active{border-color:var(--border);background:var(--surface-2)}.job-state{display:grid;place-items:center;width:20px;height:20px;border-radius:7px;background:var(--surface-2);flex:none}.job-state i{width:7px;height:7px;border-radius:50%;background:var(--muted)}.job-state.completed{background:var(--success-soft)}.job-state.completed i{background:var(--success)}.job-state.processing{background:var(--primary-soft)}.job-state.processing i{background:var(--primary);animation:pulse 1.2s infinite}.job-state.failed{background:var(--danger-soft)}.job-state.failed i{background:var(--danger)}.job-main{display:grid;gap:3px;min-width:0;flex:1}.job-main strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.job-main small{color:var(--muted);font-size:9px}.job-status{color:var(--muted);font-size:9px;white-space:nowrap}.empty-state{display:grid;justify-items:center;gap:7px;padding:35px 12px;color:var(--muted);text-align:center}.empty-state strong{color:var(--text);font-size:12px}.empty-state span{font-size:10px}.processing-state,.result-error{display:flex;align-items:flex-start;gap:12px;padding:16px;border-radius:10px;background:var(--surface-2);color:var(--primary)}.processing-state strong,.result-error strong{font-size:12px;color:var(--text)}.processing-state p,.result-error p{margin:4px 0 0;color:var(--muted);font-size:11px;line-height:1.5}.result-error{background:var(--danger-soft);color:var(--danger)}.result-body p{margin:0;min-height:80px;white-space:pre-wrap;font-size:13px;line-height:1.7}.result-body footer{display:flex;flex-wrap:wrap;gap:12px;margin-top:17px;padding-top:12px;border-top:1px solid var(--border);color:var(--muted);font-size:10px}.spinner{width:18px;height:18px;border:2px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite;flex:none}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{50%{opacity:.25}}@media(max-width:860px){.transcription-layout{grid-template-columns:1fr}}@media(max-width:520px){.upload-options{align-items:stretch;flex-direction:column}.upload-button{width:100%}.transcription-page{gap:13px}.privacy-note{padding:13px}.result-body p{font-size:12px}}
</style>
