<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import { connect } from '@/services/connect'
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

async function loadChats() {
  selectedChat.value = null
  messages.value = []
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

async function send() {
  if (!draft.value.trim() || !selectedChat.value || sending.value) return

  const chat = selectedChat.value
  const number = (chat.rawRef || chat.subtitle || '').split('@')[0]
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

onMounted(async () => {
  instances.value = await connect.connections().catch(() => [])
  selectedInstance.value = instances.value[0]?.id || ''
  await loadChats()
})
</script>

<template>
  <AppShell>
    <PageHeader title="Conversas" description="Acompanhe atendimentos e mensagens em um só lugar." />

    <div v-if="error" class="alert error">{{ error }}</div>

    <div class="conversation-shell">
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
            <span class="avatar conversation-avatar">
              <img v-if="selectedChat.avatar" :src="selectedChat.avatar" alt="" />
              <template v-else>{{ selectedChat.title.slice(0, 1).toUpperCase() }}</template>
            </span>
            <div>
              <strong>{{ selectedChat.title }}</strong>
              <small>{{ selectedChat.subtitle }}</small>
            </div>
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
                <p>{{ message.text }}</p>
                <small>{{ formatTime(message.timestamp) }}</small>
              </div>
            </template>
          </div>

          <form class="composer" @submit.prevent="send">
            <input v-model="draft" placeholder="Digite uma mensagem..." :disabled="sending" />
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
