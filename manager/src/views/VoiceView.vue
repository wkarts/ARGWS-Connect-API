<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { connect } from '@/services/connect'
import { isFindHub } from '@/services/findhub-channel'
import { featureEnabled } from '@/config/runtime'
import { friendlyError } from '@/services/errors'
import { isCallActive } from '@/services/normalizers'
import type { ConnectionItem, ContactItem, WhatsAppCall } from '@/types/domain'
import type { VoiceMediaSession, VoiceMediaState } from '@/services/voice-media'
import { VideoMediaSession, type CallCapabilities, type VideoMediaPreparation, type VideoMediaState } from '@/services/video-media'

const route = useRoute()
const router = useRouter()
const instances = ref<ConnectionItem[]>([])
const selected = ref(String(route.query.instance || ''))
const calls = ref<WhatsAppCall[]>([])
const contacts = ref<ContactItem[]>([])
const instanceDetails = ref<any>(null)
const instanceSettings = ref<Record<string, any>>({})
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const feedback = ref('')
const number = ref('')
const duration = ref(0)
const mediaState = ref<VoiceMediaState>('idle')
const mediaError = ref('')
const mediaCallId = ref('')
let voiceSession: VoiceMediaSession | null = null
let videoSession: VideoMediaSession | null = null
let videoPreparationController: AbortController | null = null
let pendingVideoPreparation: VideoMediaPreparation | undefined
let mediaGeneration = 0
let videoGeneration = 0
let callsRequest = 0
let disposed = false
const callCapabilities = ref<CallCapabilities | null>(null)
const videoState = ref<VideoMediaState>('idle')
const videoStream = shallowRef<MediaStream | null>(null)
const remoteCanvas = ref<HTMLCanvasElement | null>(null)
const remoteVideoReady = ref(false)
const cameraEnabled = ref(true)
const videoModalOpen = ref(false)
const videoModal = ref<HTMLElement | null>(null)
let timer: number | undefined
let contactsLoadedAt = 0

const selectedInstance = computed(() => instances.value.find((item) => item.id === selected.value))
const supportsCalls = computed(() => Boolean(selectedInstance.value?.capabilities.calls))
const supportsVoice = computed(() => Boolean(selectedInstance.value?.capabilities.voice))
const supportsVideo = computed(() => callCapabilities.value?.video === true && callCapabilities.value?.videoCodec === 'h264')
const activeCalls = computed(() => calls.value.filter(isCallActive))
const rejectsIncoming = computed(() => Boolean(instanceSettings.value?.rejectCall))
const mediaReady = computed(() => mediaState.value === 'ready')
const activeVideoCall = computed(() => calls.value.find((call) => call.callId === mediaCallId.value))
const videoTitle = computed(() => activeVideoCall.value ? callName(activeVideoCall.value) : 'Chamada de vídeo')
const videoStatus = computed(() => {
  if (videoState.value === 'requesting_camera') return 'Preparando câmera'
  if (videoState.value === 'connecting') return 'Conectando vídeo'
  if (videoState.value === 'ready' && remoteVideoReady.value) return 'Vídeo conectado'
  if (videoState.value === 'ready') return 'Aguardando vídeo remoto'
  if (videoState.value === 'error') return 'Vídeo indisponível'
  if (videoState.value === 'closed') return 'Vídeo encerrado'
  return 'Vídeo aguardando'
})
const mediaLabel = computed(() => {
  if (mediaState.value === 'requesting_microphone') return 'Aguardando microfone'
  if (mediaState.value === 'connecting') return 'Conectando áudio'
  if (mediaState.value === 'ready') return 'Áudio conectado'
  if (mediaState.value === 'error') return 'Falha no áudio'
  if (mediaState.value === 'closed') return 'Áudio encerrado'
  return 'Áudio aguardando'
})

function normalizeIdentity(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/:\d+(?=@)/, '')
}

function phoneFromIdentity(value: unknown): string {
  const normalized = normalizeIdentity(value)
  if (!normalized || normalized.endsWith('@lid') || normalized.includes('@g.us') || normalized.includes('@broadcast')) {
    return ''
  }
  if (normalized.endsWith('@s.whatsapp.net')) return normalized.split('@')[0].replace(/\D/g, '')
  if (/^\+?\d+$/.test(normalized)) return normalized.replace(/\D/g, '')
  return ''
}

function usableName(value: unknown): string {
  const name = String(value ?? '').trim()
  if (!name || /^\+?\d+$/.test(name) || name.includes('@lid') || name.includes('@s.whatsapp.net')) return ''
  const ownName = String(selectedInstance.value?.profileName || '').trim().toLocaleLowerCase('pt-BR')
  if (ownName && name.toLocaleLowerCase('pt-BR') === ownName) return ''
  return name
}

function callContact(call: WhatsAppCall): ContactItem | undefined {
  const raw = call.raw || {}
  if (raw.identityResolved !== true) return undefined

  const candidates = [
    call.remoteJid,
    call.number,
    raw.displayPeerJid,
    raw.peerJid,
    raw.callerPn,
    raw.callerPnJid,
  ].filter(Boolean)
  const exact = new Set(candidates.map(normalizeIdentity).filter(Boolean))
  const phones = new Set(candidates.map(phoneFromIdentity).filter(Boolean))

  return contacts.value.find((contact) => {
    const refs = [contact.rawRef, contact.number, ...(contact.aliases || [])].filter(Boolean)
    return refs.some((ref) => {
      const normalized = normalizeIdentity(ref)
      const phone = phoneFromIdentity(ref)
      return exact.has(normalized) || Boolean(phone && phones.has(phone))
    })
  })
}

function callNumber(call: WhatsAppCall): string {
  const raw = call.raw || {}
  if (raw.identityResolved !== true) return ''

  const contact = callContact(call)
  const candidates = [
    contact?.number,
    call.number,
    call.remoteJid,
    raw.displayPeerJid,
    raw.peerJid,
    raw.callerPnJid,
    raw.callerPn,
  ]
  for (const candidate of candidates) {
    const phone = phoneFromIdentity(candidate)
    if (phone) return phone
  }
  return ''
}

function callName(call: WhatsAppCall): string {
  const contactName = usableName(callContact(call)?.name)
  if (contactName) return contactName

  const raw = call.raw || {}
  if (raw.identityResolved === true) {
    const resolvedName = usableName(call.name)
    if (resolvedName) return resolvedName
  }

  return callNumber(call) || 'Contato WhatsApp'
}

function callAvatar(call: WhatsAppCall): string | undefined {
  const raw = call.raw || {}
  if (raw.identityResolved !== true) return undefined
  return callContact(call)?.avatar || call.avatar
}

function closeMedia() {
  mediaGeneration += 1
  voiceSession?.stop()
  voiceSession = null
  mediaCallId.value = ''
  if (mediaState.value !== 'error') mediaState.value = 'idle'
  closeVideo()
}

function closeVideo() {
  videoGeneration += 1
  videoPreparationController?.abort()
  videoPreparationController = null
  releaseVideoPreparation(pendingVideoPreparation)
  videoSession?.stop()
  videoSession = null
  videoStream.value?.getTracks().forEach(track => track.stop())
  videoStream.value = null
  videoState.value = 'idle'
  remoteVideoReady.value = false
  cameraEnabled.value = true
  videoModalOpen.value = false
}

function openVideoModal() {
  if (!videoStream.value) return
  videoModalOpen.value = true
  void nextTick(() => videoModal.value?.focus())
}

function minimizeVideoModal() {
  videoModalOpen.value = false
}

function handleVideoModalKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  minimizeVideoModal()
}

function releaseVideoPreparation(preparation?: VideoMediaPreparation) {
  if (pendingVideoPreparation === preparation) pendingVideoPreparation = undefined
  preparation?.stream.getTracks().forEach(track => track.stop())
}

async function attachMedia(callId: string, preparation?: VideoMediaPreparation) {
  if (!callId || !supportsVoice.value) { releaseVideoPreparation(preparation); return }
  // Transfer the prepared camera before closing the previous media session.
  if (pendingVideoPreparation === preparation) pendingVideoPreparation = undefined
  closeMedia()
  const generation = mediaGeneration
  const instanceId = selected.value
  const current = () => generation === mediaGeneration && !disposed
  mediaError.value = ''
  mediaCallId.value = callId
  const audio = (async () => {
    try {
      const session = await connect.voiceMedia(instanceId, callId, {
        onState: state => { if (current()) mediaState.value = state },
        onError: message => { if (current()) mediaError.value = message },
      })
      if (!current()) { session.stop(); return }
      voiceSession = session
    } catch (e) {
      if (current()) { mediaError.value = friendlyError(e); mediaState.value = 'error' }
    }
  })()
  await Promise.all([audio, preparation ? attachVideo(callId, preparation) : Promise.resolve()])
}

async function attachVideo(callId: string, preparation: VideoMediaPreparation) {
  if (pendingVideoPreparation === preparation) pendingVideoPreparation = undefined
  closeVideo()
  const generation = videoGeneration
  const instanceId = selected.value
  const current = () => generation === videoGeneration && selected.value === instanceId && mediaCallId.value === callId && !disposed
  if (!current()) { preparation.stream.getTracks().forEach(track => track.stop()); return }
  try {
    videoStream.value = preparation.stream
    openVideoModal()
    await nextTick()
    if (!remoteCanvas.value || !current()) throw new Error('A sessão de vídeo foi cancelada.')
    const session = await connect.videoMedia(instanceId, callId, preparation, remoteCanvas.value, {
      onSession: session => { if (current()) videoSession = session; else session.stop() },
      onState: state => {
        if (!current()) return
        videoState.value = state
        if (state === 'closed' || state === 'error') {
          remoteVideoReady.value = false
          videoStream.value = null
          videoModalOpen.value = false
        }
      },
      onError: message => { if (current()) mediaError.value = message },
      onRemoteFrame: () => { if (current()) remoteVideoReady.value = true },
    })
    if (!current()) { session.stop(); return }
    videoSession = session
  } catch (e) {
    preparation.stream.getTracks().forEach(track => track.stop())
    if (current()) {
      videoStream.value = null
      videoModalOpen.value = false
      mediaError.value = friendlyError(e)
      videoState.value = 'error'
    }
  }
}

async function loadCapabilities() {
  const instanceId = selected.value
  callCapabilities.value = null
  if (!instanceId) return
  const result = await connect.callCapabilities(instanceId).catch(() => null)
  if (selected.value === instanceId && !disposed) callCapabilities.value = result
}

async function refreshCalls() {
  await Promise.all([loadCalls(), loadCapabilities()])
}

async function prepareVideo() {
  if (!supportsVideo.value) throw new Error('Vídeo indisponível nesta instância. Atualize as capacidades e tente novamente.')
  // Some camera drivers allow only one capture, even within the same page.
  closeVideo()
  const generation = videoGeneration
  const instanceId = selected.value
  const controller = new AbortController()
  videoPreparationController = controller
  const current = () => generation === videoGeneration && selected.value === instanceId && !disposed
  videoState.value = 'requesting_camera'
  try {
    const preparation = await VideoMediaSession.prepare(callCapabilities.value?.videoMedia, controller.signal)
    if (!current()) {
      releaseVideoPreparation(preparation)
      throw new Error('A preparação de vídeo foi cancelada.')
    }
    pendingVideoPreparation = preparation
    return preparation
  } catch (error) {
    if (current()) videoState.value = 'error'
    throw error
  } finally {
    if (videoPreparationController === controller) videoPreparationController = null
  }
}

function toggleCamera() {
  cameraEnabled.value = !cameraEnabled.value
  videoSession?.setCameraEnabled(cameraEnabled.value)
}

function endVideoCall() {
  const call = activeVideoCall.value
  if (call) void action(call, 'end')
  else closeMedia()
}

async function reconnectVideo() {
  const callId = mediaCallId.value
  const instanceId = selected.value
  if (!callId || busy.value || disposed) return
  busy.value = true
  mediaError.value = ''
  let preparation: VideoMediaPreparation | undefined
  try {
    preparation = await prepareVideo()
    if (disposed || selected.value !== instanceId || mediaCallId.value !== callId) return
    await attachVideo(callId, preparation)
    preparation = undefined
  } catch (e) { if (!disposed && selected.value === instanceId) mediaError.value = friendlyError(e) }
  finally { releaseVideoPreparation(preparation); busy.value = false }
}

async function loadBehavior() {
  if (!selected.value) { instanceSettings.value = {}; return }
  try {
    const raw = await connect.loadInstanceConfig(selected.value, 'settings')
    instanceSettings.value = raw?.settings || raw || {}
  } catch {
    instanceSettings.value = {}
  }
}

async function loadContacts(force = false) {
  if (!featureEnabled('contacts', false) || !selected.value) {
    contacts.value = []
    return
  }
  if (!force && Date.now() - contactsLoadedAt < 15_000) return
  try {
    contacts.value = await connect.contacts(selected.value)
    contactsLoadedAt = Date.now()
  } catch {
    // A chamada continua utilizável mesmo se a agenda não puder ser atualizada.
  }
}

async function loadCalls(silent = false) {
  if (disposed) return
  const request = ++callsRequest
  const instanceId = selected.value
  const generation = mediaGeneration
  const current = () => !disposed && request === callsRequest && selected.value === instanceId && generation === mediaGeneration
  if (!instanceId) {
    calls.value = []
    contacts.value = []
    instanceDetails.value = null
    loading.value = false
    closeMedia()
    return
  }
  if (!silent) loading.value = true
  if (!silent) error.value = ''
  try {
    const details = await connect.connection(instanceId).catch(() => instanceDetails.value)
    if (!current()) return
    const result = supportsCalls.value ? await connect.calls(instanceId) : []
    // A snapshot requested before the current media was attached cannot end it.
    if (!current()) return
    instanceDetails.value = details
    calls.value = result
    void loadContacts()
    if (mediaCallId.value && !busy.value) {
      const current = calls.value.find((call) => call.callId === mediaCallId.value)
      if (!current || !isCallActive(current)) closeMedia()
    }
  } catch (e) {
    if (!silent && current()) error.value = friendlyError(e)
  } finally {
    if (request === callsRequest) loading.value = false
  }
}

function startPolling() {
  stopPolling()
  if (disposed) return
  let pending = false
  timer = window.setInterval(() => {
    if (pending) return
    pending = true
    void loadCalls(true).finally(() => { pending = false })
  }, 2000)
}
function stopPolling() {
  if (timer) window.clearInterval(timer)
  timer = undefined
}

async function makeTestCall(isVideo = false) {
  if (busy.value || disposed) return
  const normalized = number.value.replace(/\D/g, '')
  if (!normalized || !supportsCalls.value) return
  busy.value = true
  error.value = ''
  feedback.value = ''
  mediaError.value = ''
  let preparation: VideoMediaPreparation | undefined
  const instanceId = selected.value
  try {
    if (isVideo) preparation = await prepareVideo()
    if (disposed || selected.value !== instanceId || (preparation && pendingVideoPreparation !== preparation)) return
    const requestedDuration = Number(duration.value || 0)
    const result = await connect.offerCall(
      instanceId,
      normalized,
      requestedDuration > 0 ? requestedDuration : undefined,
      isVideo,
    )
    if (disposed || selected.value !== instanceId || (preparation && pendingVideoPreparation !== preparation)) return
    const callId = String(result?.callId || result?.id || '')
    feedback.value = 'Chamada de teste iniciada. A lista será atualizada automaticamente.'
    if (callId && supportsVoice.value) { await attachMedia(callId, preparation); preparation = undefined }
    await loadCalls(true)
  } catch (e) {
    if (!disposed && selected.value === instanceId) error.value = friendlyError(e)
  } finally {
    releaseVideoPreparation(preparation)
    busy.value = false
  }
}

async function action(call: WhatsAppCall, next: 'accept' | 'reject' | 'end' | 'mute') {
  if (busy.value || disposed) return
  busy.value = true
  error.value = ''
  feedback.value = ''
  let preparation: VideoMediaPreparation | undefined
  const instanceId = selected.value
  try {
    if (next === 'accept' && call.isVideo) preparation = await prepareVideo()
    if (disposed || selected.value !== instanceId || (preparation && pendingVideoPreparation !== preparation)) return
    const nextMuted = !Boolean(call.muted)
    const payload = next === 'mute'
      ? { callId: call.callId, muted: nextMuted }
      : { callId: call.callId }
    await connect.callAction(instanceId, next, payload)
    if (disposed || selected.value !== instanceId || (preparation && pendingVideoPreparation !== preparation)) return

    if (next === 'accept' && supportsVoice.value) {
      await attachMedia(call.callId, preparation)
      preparation = undefined
      if (disposed || selected.value !== instanceId) return
      feedback.value = 'Atendimento solicitado. Acompanhe o estado da chamada e da mídia.'
    } else if (next === 'reject') {
      if (mediaCallId.value === call.callId) closeMedia()
      feedback.value = 'Chamada recusada.'
    } else if (next === 'end') {
      if (mediaCallId.value === call.callId) closeMedia()
      feedback.value = 'Chamada encerrada.'
    } else {
      if (mediaCallId.value === call.callId) voiceSession?.setMicMuted(nextMuted)
      feedback.value = nextMuted ? 'Microfone silenciado.' : 'Microfone ativado.'
    }
    await loadCalls(true)
  } catch (e) {
    if (!disposed && selected.value === instanceId) error.value = friendlyError(e)
  } finally {
    releaseVideoPreparation(preparation)
    busy.value = false
  }
}

function callDirection(call: WhatsAppCall) {
  if (call.direction === 'incoming') return 'Recebida'
  if (call.direction === 'outgoing') return 'Efetuada'
  return 'Chamada'
}

function stateLabel(state: string) {
  const s = String(state || '').toLowerCase()
  if (s === 'answered') return 'Em andamento'
  if (s === 'answered_elsewhere' || s === 'accepted_elsewhere') return 'Atendida em outro dispositivo'
  if (s === 'failed') return 'Falha na chamada'
  if (s === 'missed' || s === 'unanswered') return 'Não atendida'
  if (s.includes('ring')) return 'Chamando'
  if (s.includes('accept') || s.includes('active') || s.includes('connect')) return 'Em andamento'
  if (s.includes('reject')) return 'Recusada'
  if (s.includes('end') || s.includes('termin') || s.includes('close')) return 'Encerrada'
  return state || 'Em andamento'
}

onMounted(async () => {
  instances.value = (await connect.connections().catch(() => [])).filter((item) => !isFindHub(item))
  if (!selected.value || !instances.value.some((item) => item.id === selected.value)) {
    selected.value = instances.value.find((item) => item.capabilities.calls)?.id || instances.value[0]?.id || ''
  }
  await Promise.all([loadCalls(), loadBehavior(), loadContacts(true), loadCapabilities()])
  startPolling()
})
watch(selected, async () => {
  number.value = ''
  mediaError.value = ''
  contactsLoadedAt = 0
  closeMedia()
  await Promise.all([loadCalls(), loadBehavior(), loadContacts(true), loadCapabilities()])
  startPolling()
})
onBeforeUnmount(() => {
  disposed = true
  stopPolling()
  closeMedia()
})
</script>

<template>
  <AppShell>
    <PageHeader title="Chamadas" description="Efetue e receba chamadas WhatsApp em ambiente de teste.">
      <button class="btn ghost" :disabled="loading || busy" @click="refreshCalls"><AppIcon name="refresh" :size="16"/>Atualizar</button>
    </PageHeader>

    <div class="voice-instance-bar">
      <label><span>Instância</span><select v-model="selected" class="select" :disabled="busy"><option v-for="item in instances" :key="item.id" :value="item.id">{{ item.name }} · {{ item.providerLabel }}</option></select></label>
      <div v-if="selectedInstance" class="provider-inline"><span>Provider</span><strong>{{ selectedInstance.providerLabel }}</strong></div>
      <div v-if="supportsVoice" :class="['voice-media-state', { ready: mediaReady }]"><span class="pulse-dot"></span><strong>{{ mediaLabel }}</strong></div>
    </div>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="mediaError" class="alert warning">{{ mediaError }} A sinalização da chamada continua disponível.</div>
    <div v-if="feedback" class="alert success">{{ feedback }}</div>

    <EmptyState v-if="!instances.length" icon="phone" title="Nenhuma instância disponível" description="Crie uma instância antes de testar chamadas."/>

    <template v-else-if="selectedInstance">
      <div v-if="!supportsCalls" class="provider-call-notice">
        <AppIcon name="warning" :size="20"/><div><strong>Chamadas não disponíveis neste provider</strong><p>Nesta versão, chamadas de voz WhatsApp estão disponíveis em instâncias ZAPO. Você pode manter esta instância como está ou converter o provider pela tela da instância.</p></div>
      </div>

      <div v-else-if="rejectsIncoming" class="provider-call-notice">
        <AppIcon name="warning" :size="20"/><div><strong>Recebimento automático está bloqueado nesta instância</strong><p>A preferência de rejeitar chamadas recebidas está ativa. Desative-a antes de testar o recebimento.</p><button class="btn ghost compact top-gap" @click="router.push(`/instancias/${encodeURIComponent(selected)}/configuracao`)">Ajustar comportamento</button></div>
      </div>

      <div v-if="supportsCalls" class="voice-layout">
        <PanelCard title="Nova chamada de teste" description="Inicie uma chamada e encerre manualmente ou defina um tempo opcional.">
          <form class="form-stack" @submit.prevent="makeTestCall(false)">
            <label class="field"><span>Número do WhatsApp</span><input v-model="number" inputmode="numeric" placeholder="5575999999999" required/><small>Informe DDI, DDD e número.</small></label>
            <label class="field"><span>Encerramento automático</span><select v-model.number="duration" class="select"><option :value="0">Sem encerramento automático</option><option :value="60">1 minuto</option><option :value="120">2 minutos</option><option :value="300">5 minutos</option><option :value="600">10 minutos</option><option :value="1800">30 minutos</option></select><small>A chamada também pode ser encerrada manualmente a qualquer momento.</small></label>
            <div class="test-call-note"><AppIcon name="phone" :size="18"/><span>Ao iniciar ou atender, o navegador solicitará o microfone e conectará o áudio em tempo real. Use somente para validação.</span></div>
            <button class="btn primary" :disabled="busy || !number.replace(/\D/g,'')"><AppIcon name="phone" :size="16"/>{{ busy ? 'Iniciando...' : 'Efetuar chamada de teste' }}</button>
            <button v-if="supportsVideo" type="button" class="btn ghost" :disabled="busy || !number.replace(/\D/g,'')" @click="makeTestCall(true)">{{ videoState === 'requesting_camera' ? 'Aguardando câmera...' : 'Efetuar chamada de vídeo' }}</button>
            <small v-if="supportsVideo">Para vídeo, a câmera e o suporte do navegador são verificados antes de iniciar a chamada.</small>
          </form>
        </PanelCard>

        <PanelCard title="Chamadas atuais" description="Chamadas recebidas aparecem automaticamente enquanto esta tela estiver aberta.">
          <div v-if="loading" class="cards-skeleton"></div>
          <p v-else-if="!activeCalls.length" class="muted-block">Nenhuma chamada ativa neste momento.</p>
          <div v-else class="call-list">
            <div v-for="call in activeCalls" :key="call.callId" :class="['call-row', { 'media-active': mediaCallId===call.callId && mediaReady }]">
              <div class="call-avatar">
                <img v-if="callAvatar(call)" :src="callAvatar(call)" alt="" />
                <AppIcon v-else name="phone" :size="18"/>
              </div>
              <div class="call-main">
                <strong>{{ callName(call) }}</strong>
                <span v-if="callNumber(call) && callNumber(call) !== callName(call)">{{ callNumber(call) }}</span>
                <span v-else-if="call.raw?.identityResolved !== true">Número não identificado</span>
                <span>{{ callDirection(call) }} · {{ call.isVideo ? 'Vídeo' : 'Voz' }} · {{ stateLabel(call.state) }}</span>
                <small v-if="mediaCallId===call.callId">{{ mediaLabel }}</small>
              </div>
              <div class="call-actions">
                <button v-if="call.direction==='incoming' && (!call.isVideo || call.state.toLowerCase().includes('ring'))" class="btn primary compact" :disabled="busy || (call.isVideo && !supportsVideo)" @click="action(call,'accept')">{{ call.isVideo ? 'Atender com vídeo' : 'Atender com áudio' }}</button>
                <button v-if="call.isVideo && mediaCallId===call.callId && videoStream && !videoModalOpen" class="btn ghost compact" @click="openVideoModal">Abrir vídeo</button>
                <button v-if="call.isVideo && mediaCallId===call.callId && !videoStream && videoState==='error'" class="btn ghost compact" :disabled="busy || !supportsVideo" @click="reconnectVideo">Reconectar vídeo</button>
                <button v-if="call.direction==='incoming'" class="btn danger compact" :disabled="busy" @click="action(call,'reject')">Recusar</button>
                <button class="btn ghost compact" :disabled="busy" @click="action(call,'mute')">{{ call.muted ? 'Ativar microfone' : 'Silenciar' }}</button>
                <button class="btn danger compact" :disabled="busy" @click="action(call,'end')">Encerrar</button>
              </div>
            </div>
          </div>
        </PanelCard>
      </div>
    </template>

    <Teleport to="body">
      <div v-if="videoStream" class="video-call-portal">
        <div v-show="videoModalOpen" class="video-call-backdrop" @mousedown.self="minimizeVideoModal">
          <section ref="videoModal" class="video-call-modal" role="dialog" aria-modal="true" aria-labelledby="video-call-title" tabindex="-1" @keydown="handleVideoModalKeydown">
            <header class="video-call-header">
              <div>
                <span class="video-call-eyebrow">Chamada de vídeo</span>
                <h2 id="video-call-title">{{ videoTitle }}</h2>
                <span>{{ videoStatus }}</span>
              </div>
              <button class="video-call-minimize" type="button" aria-label="Minimizar chamada de vídeo" @click="minimizeVideoModal"><AppIcon name="close" :size="16"/>Minimizar</button>
            </header>

            <div class="video-call-stage">
              <div class="video-call-remote">
                <canvas ref="remoteCanvas" :class="{ 'video-hidden': !remoteVideoReady }" aria-label="Vídeo do outro participante"></canvas>
                <div v-if="!remoteVideoReady" class="video-call-placeholder">
                  <span class="video-call-placeholder-orb"><AppIcon name="phone" :size="22"/></span>
                  <strong>{{ videoState === 'error' || videoState === 'closed' ? 'Vídeo indisponível' : 'Aguardando vídeo remoto' }}</strong>
                  <small>O áudio continua independente da imagem.</small>
                </div>
              </div>
              <div class="video-call-local">
                <video :srcObject="videoStream" autoplay muted playsinline aria-label="Sua câmera"></video>
                <span>{{ cameraEnabled ? 'Sua câmera' : 'Câmera desligada' }}</span>
              </div>
            </div>

            <footer class="video-call-footer">
              <span class="video-call-live"><i></i>{{ videoStatus }}</span>
              <div class="video-call-actions">
                <button class="btn ghost compact" :disabled="videoState !== 'ready'" @click="toggleCamera">{{ cameraEnabled ? 'Desligar câmera' : 'Ligar câmera' }}</button>
                <button v-if="videoState === 'error' || videoState === 'closed'" class="btn ghost compact" :disabled="busy" @click="reconnectVideo">Reconectar vídeo</button>
                <button class="btn danger compact" :disabled="busy" @click="endVideoCall"><AppIcon name="phone" :size="15"/>Encerrar</button>
              </div>
            </footer>
          </section>
        </div>
        <button v-if="!videoModalOpen" class="video-call-minimized" type="button" @click="openVideoModal">
          <span class="video-call-live"><i></i>{{ videoTitle }}</span>
          <small>{{ videoStatus }} · Abrir</small>
        </button>
      </div>
    </Teleport>
  </AppShell>
</template>

<style scoped>
.call-avatar {
  overflow: hidden;
}
.call-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.call-main strong,
.call-main span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.video-call-portal { position: fixed; inset: 0; z-index: 120; pointer-events: none; }
.video-call-backdrop { position: fixed; inset: 0; display: grid; place-items: center; padding: clamp(14px, 3vw, 32px); background: rgba(3, 10, 22, .62); backdrop-filter: blur(8px); pointer-events: auto; }
.video-call-modal { width: min(900px, calc(100vw - 28px)); max-height: min(720px, calc(100vh - 28px)); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; overflow: hidden; border: 1px solid rgba(148, 163, 184, .25); border-radius: 20px; background: #0b1220; color: #e5edf8; box-shadow: 0 28px 90px rgba(0, 0, 0, .38); outline: none; }
.video-call-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 18px 20px; border-bottom: 1px solid rgba(148, 163, 184, .16); }
.video-call-header h2 { margin: 3px 0 2px; color: #fff; font-size: 18px; letter-spacing: -.02em; }
.video-call-header>div>span:last-child { color: #a8b7cb; font-size: 12px; }
.video-call-eyebrow { color: #7dd3fc; font-size: 10px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
.video-call-minimize { display: inline-flex; align-items: center; gap: 7px; min-height: 32px; padding: 0 10px; border: 1px solid rgba(148, 163, 184, .25); border-radius: 9px; background: rgba(255, 255, 255, .05); color: #dbeafe; font-size: 11px; }
.video-call-minimize:hover { border-color: rgba(125, 211, 252, .65); background: rgba(125, 211, 252, .1); }
.video-call-stage { position: relative; min-height: min(54vh, 540px); overflow: hidden; background: radial-gradient(circle at 50% 36%, #1d3557, #0a1220 68%); }
.video-call-remote { display: grid; width: 100%; height: 100%; min-height: inherit; place-items: center; color: #e5edf8; }
.video-call-remote canvas { display: block; width: 100%; height: 100%; max-width: 100%; max-height: min(54vh, 540px); object-fit: contain; }
.video-hidden { display: none !important; }
.video-call-placeholder { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 8px; text-align: center; }
.video-call-placeholder strong { color: #fff; font-size: 14px; }
.video-call-placeholder small { color: #9fb0c6; font-size: 11px; }
.video-call-placeholder-orb { display: grid; width: 46px; height: 46px; place-items: center; border: 1px solid rgba(125, 211, 252, .35); border-radius: 50%; background: rgba(125, 211, 252, .12); color: #7dd3fc; }
.video-call-local { position: absolute; top: 18px; right: 18px; width: clamp(126px, 22%, 190px); overflow: hidden; border: 1px solid rgba(255, 255, 255, .32); border-radius: 12px; background: #111c2e; color: #fff; box-shadow: 0 10px 28px rgba(0, 0, 0, .28); }
.video-call-local video { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; transform: scaleX(-1); }
.video-call-local span { display: block; padding: 6px 8px; color: #dbeafe; font-size: 10px; }
.video-call-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 13px 16px; border-top: 1px solid rgba(148, 163, 184, .16); background: #0d1728; }
.video-call-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.video-call-footer .btn.ghost { border-color: rgba(148, 163, 184, .25); background: rgba(255, 255, 255, .05); color: #dbeafe; }
.video-call-live { display: inline-flex; align-items: center; gap: 7px; min-width: 0; color: #b9c7d9; font-size: 11px; }
.video-call-live i { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #38d39f; box-shadow: 0 0 0 4px rgba(56, 211, 159, .13); }
.video-call-minimized { position: fixed; right: 24px; bottom: 24px; z-index: 121; display: grid; gap: 5px; min-width: 208px; padding: 12px 14px; border: 1px solid rgba(148, 163, 184, .28); border-radius: 13px; background: #0d1728; color: #e5edf8; box-shadow: 0 15px 40px rgba(0, 0, 0, .26); pointer-events: auto; text-align: left; }
.video-call-minimized:hover { border-color: rgba(125, 211, 252, .65); transform: translateY(-1px); }
.video-call-minimized small { padding-left: 14px; color: #9fb0c6; font-size: 10px; }
@media (max-width: 680px) {
  .video-call-header { padding: 15px; }
  .video-call-stage { min-height: 52vh; }
  .video-call-footer { align-items: stretch; flex-direction: column; }
  .video-call-actions { justify-content: stretch; }
  .video-call-actions .btn { flex: 1; }
  .video-call-minimized { right: 14px; bottom: 14px; left: 14px; min-width: 0; }
}
</style>
