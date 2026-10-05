<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppIcon from '@/components/AppIcon.vue'
import DictationButton from '@/components/DictationButton.vue'
import { connect } from '@/services/connect'
import { isFindHub } from '@/services/findhub-channel'
import { friendlyError } from '@/services/errors'
import type { ConnectionItem, Conversation, Message } from '@/types/domain'

const instances = ref<ConnectionItem[]>([])
const selectedInstance = ref('')
const chats = ref<Conversation[]>([])
const selectedChat = ref<Conversation | null>(null)
const messages = ref<Message[]>([])
const draft = ref('')
const error = ref('')
const loadingMessages = ref(false)
const sending = ref(false)
const messageList = ref<HTMLElement | null>(null)
const draftTarget = ref<HTMLInputElement | null>(null)
const activeTranscriptions = ref(new Set<string>())
const expandedTranscripts = ref(new Set<string>())

function messageTimestamp(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1000
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : 0
}

function chronological(items: Message[]): Message[] {
  return [...items].sort((a, b) => messageTimestamp(a.timestamp) - messageTimestamp(b.timestamp))
}

function formatTime(value: unknown): string {
  const timestamp = messageTimestamp(value)
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

async function scrollToBottom(behavior: ScrollBehavior = 'auto') {
  await nextTick()
  const el = messageList.value
  if (el) el.scrollTo({ top: el.scrollHeight, behavior })
}

function closeChat() {
  selectedChat.value = null
  messages.value = []
  draft.value = ''
}

async function loadChats() {
  closeChat()
  error.value = ''
  if (!selectedInstance.value) return

  try {
    chats.value = await connect.conversations(selectedInstance.value)
  } catch (e) {
    error.value = friendlyError(e)
  }
}

async function openChat(chat: Conversation, behavior: ScrollBehavior = 'auto') {
  selectedChat.value = chat
  loadingMessages.value = true
  error.value = ''
  try {
    const rows = await connect.messages(selectedInstance.value, chat.rawRef || chat.id)
    messages.value = chronological(rows)
  } catch (e) {
    messages.value = []
    error.value = friendlyError(e)
  } finally {
    loadingMessages.value = false
    await scrollToBottom(behavior)
  }
}

async function refreshGroup() {
  const chat = selectedChat.value
  if (!chat?.isGroup || !chat.rawRef) return
  try {
    const info = await connect.groupInfo(selectedInstance.value, chat.rawRef)
    if (info?.subject) { chat.title = info.subject; selectedChat.value = { ...chat } }
  } catch (e) { error.value = friendlyError(e) }
}

async function send() {
  if (!draft.value.trim() || !selectedChat.value || sending.value) return

  const chat = selectedChat.value
  const number = chat.rawRef || chat.subtitle || ''
  const text = draft.value.trim()
  sending.value = true
  error.value = ''

  try {
    await connect.sendText(selectedInstance.value, number, text)
    draft.value = ''
    await openChat(chat, 'smooth')
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    sending.value = false
  }
}

function updateTranscript(message: Message, job: any) {
  message.transcriptionJobId = String(job.id || message.transcriptionJobId || '') || undefined
  message.transcriptionStatus = String(job.status || 'processing')
  message.transcriptionStage = job.stage ? String(job.stage) : null
  message.transcriptionProgress = Number(job.progressPercent || 0)
  if (job.status === 'completed') message.transcriptionText = String(job.text || '')
}

async function transcribeAudio(message: Message) {
  if (!message.isAudio || !message.transcriptionMessageId) return
  if (message.transcriptionStatus === 'completed' && message.transcriptionText) {
    const next = new Set(expandedTranscripts.value)
    if (next.has(message.id)) next.delete(message.id)
    else next.add(message.id)
    expandedTranscripts.value = next
    return
  }
  if (activeTranscriptions.value.has(message.id)) return

  const active = new Set(activeTranscriptions.value)
  active.add(message.id)
  activeTranscriptions.value = active
  error.value = ''
  try {
    const job = await connect.transcribeMessage(message.transcriptionMessageId, selectedInstance.value)
    updateTranscript(message, job)
    const deadline = Date.now() + 30 * 60 * 1000
    while (['queued', 'processing'].includes(message.transcriptionStatus || '') && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200))
      const current = await connect.speechJob(String(message.transcriptionJobId || job.id))
      updateTranscript(message, current)
    }
    if (message.transcriptionStatus === 'completed') {
      const next = new Set(expandedTranscripts.value)
      next.add(message.id)
      expandedTranscripts.value = next
    } else if (message.transcriptionStatus === 'failed') {
      throw new Error('Não foi possível transcrever este áudio. Você pode tentar novamente.')
    } else if (message.transcriptionStatus === 'cancelled') {
      throw new Error('A transcrição deste áudio foi cancelada.')
    } else {
      throw new Error('A transcrição continua na fila. Atualize a conversa para acompanhar o resultado.')
    }
  } catch (e) {
    error.value = friendlyError(e)
    if (!message.transcriptionJobId) message.transcriptionStatus = undefined
  } finally {
    const next = new Set(activeTranscriptions.value)
    next.delete(message.id)
    activeTranscriptions.value = next
  }
}

onMounted(async () => {
  instances.value = (await connect.connections().catch(() => [])).filter((item) => !isFindHub(item))
  selectedInstance.value = instances.value[0]?.id || ''
  await loadChats()
})
</script>

<template>
  <AppShell>
    <PageHeader title="Conversas" description="Acompanhe atendimentos e mensagens em um só lugar." />

    <div v-if="error" class="alert error">{{ error }}</div>

    <div class="conversation-shell" :class="{ 'chat-open': Boolean(selectedChat) }">
      <aside class="conversation-list">
        <select v-model="selectedInstance" class="select" @change="loadChats">
          <option v-for="item in instances" :key="item.id" :value="item.id">{{ item.name }}</option>
        </select>

        <button
          v-for="chat in chats"
          :key="chat.id"
          class="conversation-row"
          :class="{ active: selectedChat?.id === chat.id }"
          @click="openChat(chat)"
        >
          <span class="avatar conversation-avatar">
            <img v-if="chat.avatar" :src="chat.avatar" alt="" />
            <template v-else>{{ chat.title.slice(0, 1).toUpperCase() }}</template>
          </span>
          <div>
            <strong>{{ chat.title }}</strong>
            <small>{{ chat.lastMessage || chat.subtitle }}</small>
          </div>
          <b v-if="chat.unread">{{ chat.unread }}</b>
        </button>

        <EmptyState
          v-if="!chats.length"
          title="Nenhuma conversa"
          description="As conversas deste canal aparecerão aqui."
        />
      </aside>

      <section class="chat-panel">
        <template v-if="selectedChat">
          <header>
            <button class="icon-button mobile-chat-back" type="button" aria-label="Voltar para conversas" @click="closeChat">
              <AppIcon name="chevron" :size="18" />
            </button>
            <span class="avatar conversation-avatar">
              <img v-if="selectedChat.avatar" :src="selectedChat.avatar" alt="" />
              <template v-else>{{ selectedChat.title.slice(0, 1).toUpperCase() }}</template>
            </span>
            <div class="chat-contact-title">
              <strong>{{ selectedChat.title }}</strong>
              <small>{{ selectedChat.isGroup ? 'Grupo' : selectedChat.subtitle }}</small>
            </div>
            <button v-if="selectedChat.isGroup" class="btn compact" type="button" @click="refreshGroup">Atualizar grupo</button>
          </header>

          <div ref="messageList" class="message-list">
            <div v-if="loadingMessages" class="muted-block">Carregando mensagens...</div>
            <template v-else>
              <div
                v-for="message in messages"
                :key="message.id"
                class="message-bubble"
                :class="message.direction"
              >
                <strong v-if="selectedChat.isGroup && message.direction === 'in'" class="message-author">{{ message.participantName || 'Participante' }}</strong>
                <p>{{ message.text }}</p>
                <div v-if="message.isAudio" class="message-transcription">
                  <button
                    class="message-transcription-action"
                    type="button"
                    :disabled="activeTranscriptions.has(message.id)"
                    @click="transcribeAudio(message)"
                  >
                    <template v-if="activeTranscriptions.has(message.id)">Transcrevendo{{ message.transcriptionProgress ? ` · ${message.transcriptionProgress}%` : '…' }}</template>
                    <template v-else-if="message.transcriptionStatus === 'completed'">{{ expandedTranscripts.has(message.id) ? 'Ocultar transcrição' : 'Mostrar transcrição' }}</template>
                    <template v-else-if="message.transcriptionStatus === 'queued' || message.transcriptionStatus === 'processing'">Retomar acompanhamento</template>
                    <template v-else>Transcrever áudio</template>
                  </button>
                  <p v-if="expandedTranscripts.has(message.id) && message.transcriptionText" class="message-transcription-text">{{ message.transcriptionText }}</p>
                  <small v-else-if="message.transcriptionStatus === 'queued' || message.transcriptionStatus === 'processing'" class="message-transcription-progress">
                    {{ message.transcriptionStage || 'Na fila' }}<template v-if="message.transcriptionProgress"> · {{ message.transcriptionProgress }}%</template>
                  </small>
                  <small v-else-if="message.transcriptionStatus === 'failed'" class="message-transcription-error">Falha na transcrição. Você pode tentar novamente.</small>
                </div>
                <small>{{ formatTime(message.timestamp) }}</small>
              </div>
            </template>
          </div>

          <form class="composer" @submit.prevent="send">
            <div class="composer-field">
              <input ref="draftTarget" v-model="draft" placeholder="Digite uma mensagem..." :disabled="sending" />
              <DictationButton v-model="draft" :target="draftTarget" :instance-id="selectedInstance" />
            </div>
            <button class="btn primary" :disabled="sending || !draft.trim()">
              {{ sending ? 'Enviando...' : 'Enviar' }}
            </button>
          </form>
        </template>

        <EmptyState
          v-else
          icon="chat"
          title="Selecione uma conversa"
          description="Escolha uma conversa ao lado para visualizar as mensagens."
        />
      </section>
    </div>
  </AppShell>
</template>

<style scoped>
.composer-field{display:flex;align-items:center;gap:8px;min-width:0}.composer-field>input{min-width:0;flex:1}.message-transcription{margin-top:8px;padding-top:7px;border-top:1px solid color-mix(in srgb,var(--border) 70%,transparent);display:grid;gap:5px}.message-transcription-action{justify-self:start;border:0;background:transparent;color:var(--primary);padding:0;font:inherit;font-size:11px;font-weight:700;cursor:pointer}.message-transcription-action:disabled{opacity:.65;cursor:wait}.message-transcription-text{margin:0!important;white-space:pre-wrap;font-size:12px;line-height:1.5}.message-transcription-progress,.message-transcription-error{font-size:10px;opacity:.75}
</style>
