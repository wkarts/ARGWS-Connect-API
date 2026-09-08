<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import AppIcon from '@/components/AppIcon.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import type { ConnectionItem, Message } from '@/types/domain'

const instances = ref<ConnectionItem[]>([])
const selected = ref('')
const messages = ref<Message[]>([])
const query = ref('')
const loading = ref(false)
const error = ref('')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return messages.value
  return messages.value.filter((item) => item.text.toLowerCase().includes(q))
})

function timestamp(value?: string) {
  if (!value) return '—'
  const numeric = Number(value)
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR')
}

async function loadMessages() {
  messages.value = []
  error.value = ''
  if (!selected.value) return
  loading.value = true
  try { messages.value = await connect.messages(selected.value, '') }
  catch (e) { error.value = friendlyError(e) }
  finally { loading.value = false }
}

onMounted(async () => {
  instances.value = await connect.connections().catch(() => [])
  selected.value = instances.value[0]?.id || ''
  await loadMessages()
})
</script>

<template>
  <AppShell>
    <PageHeader title="Mensagens" description="Consulte o histórico recente por instância."/>
    <div class="toolbar split-toolbar">
      <select v-model="selected" class="select" @change="loadMessages">
        <option v-for="i in instances" :key="i.id" :value="i.id">{{ i.name }}</option>
      </select>
      <div class="search-box"><AppIcon name="search" :size="17"/><input v-model="query" placeholder="Buscar mensagem..."/></div>
      <button class="btn ghost" @click="loadMessages"><AppIcon name="refresh" :size="17"/>Atualizar</button>
    </div>
    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-else-if="loading" class="cards-skeleton"></div>
    <EmptyState v-else-if="!selected" icon="mail" title="Nenhuma instância disponível" description="Cadastre uma instância para consultar mensagens."/>
    <EmptyState v-else-if="!filtered.length" icon="mail" title="Nenhuma mensagem encontrada" description="As mensagens recentes desta instância aparecerão aqui."/>
    <div v-else class="message-history">
      <article v-for="item in filtered" :key="item.id" class="message-history-row">
        <span class="message-direction" :class="item.direction"><AppIcon :name="item.direction === 'out' ? 'arrow' : 'chat'" :size="16"/></span>
        <div><p>{{ item.text }}</p><small>{{ timestamp(item.timestamp) }}</small></div>
        <span class="direction-label">{{ item.direction === 'out' ? 'Enviada' : item.direction === 'in' ? 'Recebida' : 'Sistema' }}</span>
      </article>
    </div>
  </AppShell>
</template>
