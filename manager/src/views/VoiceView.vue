<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import type { ConnectionItem, ContactItem, WhatsAppCall } from '@/types/domain'
import type { VoiceMediaSession, VoiceMediaState } from '@/services/voice-media'

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
let timer: number | undefined
let contactsLoadedAt = 0

const selectedInstance = computed(() => instances.value.find((item) => item.id === selected.value))
const supportsCalls = computed(() => Boolean(selectedInstance.value?.capabilities.calls))
const supportsVoice = computed(() => Boolean(selectedInstance.value?.capabilities.voice))
const endedStates = ['ended', 'end', 'terminated', 'rejected', 'closed']
const activeCalls = computed(() => calls.value.filter((call) => !endedStates.includes(call.state.toLowerCase())))
const rejectsIncoming = computed(() => Boolean(instanceSettings.value?.rejectCall))
const mediaReady = computed(() => mediaState.value === 'ready')
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

function isCallActive(call: WhatsAppCall) {
  return !endedStates.includes(String(call.state || '').toLowerCase())
}

function closeMedia() {
  voiceSession?.stop()
  voiceSession = null
  mediaCallId.value = ''
  if (mediaState.value !== 'error') mediaState.value = 'idle'
}

async function attachMedia(callId: string) {
  if (!callId || !supportsVoice.value) return
  closeMedia()
  mediaError.value = ''
  mediaCallId.value = callId
  try {
    voiceSession = await connect.voiceMedia(selected.value, callId, {
      onState: (state) => { mediaState.value = state },
      onError: (message) => { mediaError.value = message },
    })
  } catch (e) {
    mediaError.value = friendlyError(e)
    mediaState.value = 'error'
  }
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
  if (!selected.value) {
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
  if (!selected.value) {
    calls.value = []
    contacts.value = []
    instanceDetails.value = null
    closeMedia()
    return
  }
  instanceDetails.value = await connect.connection(selected.value).catch(() => instanceDetails.value)
  if (!silent) loading.value = true
  if (!silent) error.value = ''
  try {
    calls.value = supportsCalls.value ? await connect.calls(selected.value) : []
    void loadContacts()
    if (mediaCallId.value) {
      const current = calls.value.find((call) => call.callId === mediaCallId.value)
      if (!current || !isCallActive(current)) closeMedia()
    }
  } catch (e) {
    if (!silent) error.value = friendlyError(e)
  } finally {
    if (!silent) loading.value = false
  }
}

function startPolling() {
  stopPolling()
  timer = window.setInterval(() => void loadCalls(true), 2000)
}
function stopPolling() {
  if (timer) window.clearInterval(timer)
  timer = undefined
}

async function makeTestCall() {
  const normalized = number.value.replace(/\D/g, '')
  if (!normalized || !supportsCalls.value) return
  busy.value = true
  error.value = ''
  feedback.value = ''
  mediaError.value = ''
  try {
    const requestedDuration = Number(duration.value || 0)
    const result = await connect.offerCall(
      selected.value,
      normalized,
      requestedDuration > 0 ? requestedDuration : undefined,
    )
    const callId = String(result?.callId || result?.id || '')
    feedback.value = 'Chamada de teste iniciada. A lista será atualizada automaticamente.'
    if (callId && supportsVoice.value) await attachMedia(callId)
    await loadCalls(true)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}

async function action(call: WhatsAppCall, next: 'accept' | 'reject' | 'end' | 'mute') {
  busy.value = true
  error.value = ''
  feedback.value = ''
  try {
    const nextMuted = !Boolean(call.muted)
    const payload = next === 'mute'
      ? { callId: call.callId, muted: nextMuted }
      : { callId: call.callId }
    await connect.callAction(selected.value, next, payload)

    if (next === 'accept' && supportsVoice.value) {
      await attachMedia(call.callId)
      feedback.value = 'Chamada atendida. Microfone e áudio conectados para o teste.'
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
    error.value = friendlyError(e)
  } finally {
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
  if (s.includes('ring')) return 'Chamando'
  if (s.includes('accept') || s.includes('active') || s.includes('connect')) return 'Em andamento'
  if (s.includes('reject')) return 'Recusada'
  if (s.includes('end') || s.includes('termin') || s.includes('close')) return 'Encerrada'
  return state || 'Em andamento'
}

onMounted(async () => {
  instances.value = await connect.connections().catch(() => [])
  if (!selected.value || !instances.value.some((item) => item.id === selected.value)) {
    selected.value = instances.value.find((item) => item.capabilities.calls)?.id || instances.value[0]?.id || ''
  }
  await Promise.all([loadCalls(), loadBehavior(), loadContacts(true)])
  startPolling()
})
watch(selected, async () => {
  number.value = ''
  mediaError.value = ''
  contactsLoadedAt = 0
  closeMedia()
  await Promise.all([loadCalls(), loadBehavior(), loadContacts(true)])
  startPolling()
})
onBeforeUnmount(() => {
  stopPolling()
  closeMedia()
})
</script>

<template>
  <AppShell>
    <PageHeader title="Chamadas" description="Efetue e receba chamadas WhatsApp em ambiente de teste.">
      <button class="btn ghost" :disabled="loading" @click="() => loadCalls()"><AppIcon name="refresh" :size="16"/>Atualizar</button>
    </PageHeader>

    <div class="voice-instance-bar">
      <label><span>Instância</span><select v-model="selected" class="select"><option v-for="item in instances" :key="item.id" :value="item.id">{{ item.name }} · {{ item.providerLabel }}</option></select></label>
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
          <form class="form-stack" @submit.prevent="makeTestCall">
            <label class="field"><span>Número do WhatsApp</span><input v-model="number" inputmode="numeric" placeholder="5575999999999" required/><small>Informe DDI, DDD e número.</small></label>
            <label class="field"><span>Encerramento automático</span><select v-model.number="duration" class="select"><option :value="0">Sem encerramento automático</option><option :value="60">1 minuto</option><option :value="120">2 minutos</option><option :value="300">5 minutos</option><option :value="600">10 minutos</option><option :value="1800">30 minutos</option></select><small>A chamada também pode ser encerrada manualmente a qualquer momento.</small></label>
            <div class="test-call-note"><AppIcon name="phone" :size="18"/><span>Ao iniciar ou atender, o navegador solicitará o microfone e conectará o áudio em tempo real. Use somente para validação.</span></div>
            <button class="btn primary" :disabled="busy || !number.replace(/\D/g,'')"><AppIcon name="phone" :size="16"/>{{ busy ? 'Iniciando...' : 'Efetuar chamada de teste' }}</button>
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
                <span>{{ callDirection(call) }} · {{ stateLabel(call.state) }}</span>
                <small v-if="mediaCallId===call.callId">{{ mediaLabel }}</small>
              </div>
              <div class="call-actions">
                <button v-if="call.direction==='incoming'" class="btn primary compact" :disabled="busy" @click="action(call,'accept')">Atender com áudio</button>
                <button v-if="call.direction==='incoming'" class="btn danger compact" :disabled="busy" @click="action(call,'reject')">Recusar</button>
                <button class="btn ghost compact" :disabled="busy" @click="action(call,'mute')">{{ call.muted ? 'Ativar microfone' : 'Silenciar' }}</button>
                <button class="btn danger compact" :disabled="busy" @click="action(call,'end')">Encerrar</button>
              </div>
            </div>
          </div>
        </PanelCard>
      </div>
    </template>
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
</style>