<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import WhatsAppStatusModal from '@/components/WhatsAppStatusModal.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import { featureEnabled } from '@/config/runtime'
import { isFindHub } from '@/services/findhub-channel'
import { useSessionStore } from '@/stores/session'
import type { ConnectionItem, Message } from '@/types/domain'

const route = useRoute()
const session = useSessionStore()
const instances = ref<ConnectionItem[]>([])
const selected = ref('')
const statuses = ref<Message[]>([])
const loading = ref(false)
const error = ref('')
const feedback = ref('')
const publishing = ref(false)
const deletingId = ref('')
const page = ref(1)
const limit = 50
const viewers = ref<{ id: string; count: number; viewers: Array<{ participant: string; status: string }> } | null>(null)
const viewerError = ref('')
const viewingId = ref('')
const instance = computed(() => instances.value.find((item) => item.id === selected.value))
const canPublish = computed(() => featureEnabled('statusPublish', true) && session.hasPermission('messages.send') &&
  instance.value?.status === 'connected' && instance.value?.capabilities.statusPublish &&
  instance.value?.provider !== 'WHATSAPP-BUSINESS')

function stamp(value?: string) {
  if (!value) return '—'
  const numeric = Number(value)
  const date = Number.isFinite(numeric) && numeric > 0
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR')
}

async function load() {
  statuses.value = []
  viewers.value = null
  error.value = ''
  if (!selected.value) return
  loading.value = true
  try { statuses.value = await connect.statuses(selected.value, page.value, limit) }
  catch (cause) { error.value = friendlyError(cause, 'Não foi possível consultar os Status.') }
  finally { loading.value = false }
}

async function changeInstance() {
  page.value = 1
  feedback.value = ''
  await load()
}

async function changePage(next: number) {
  page.value = Math.max(1, next)
  await load()
}

async function showViews(item: Message) {
  viewingId.value = item.id
  viewerError.value = ''
  viewers.value = null
  try { viewers.value = await connect.statusViews(selected.value, item.id) }
  catch (cause) { viewerError.value = friendlyError(cause, 'Não foi possível consultar as visualizações.') }
  finally { viewingId.value = '' }
}

async function remove(item: Message) {
  if (!window.confirm('Revogar este Status no WhatsApp para os destinatários e removê-lo do histórico?')) return
  deletingId.value = item.id
  error.value = ''
  feedback.value = ''
  try {
    await connect.deleteStatus(selected.value, item.id)
    feedback.value = 'Solicitação de revogação enviada ao WhatsApp.'
    await load()
  } catch (cause) { error.value = friendlyError(cause, 'Não foi possível revogar o Status.') }
  finally { deletingId.value = '' }
}

async function published() {
  page.value = 1
  await load()
}

onMounted(async () => {
  try {
    instances.value = (await connect.connections()).filter((item) => !isFindHub(item) &&
      item.provider !== 'WHATSAPP-BUSINESS' && (item.capabilities.statusRead || item.capabilities.statusPublish))
    const requested = String(route.query.instance || '')
    selected.value = instances.value.some((item) => item.id === requested) ? requested : instances.value[0]?.id || ''
    await load()
  } catch (cause) { error.value = friendlyError(cause, 'Não foi possível carregar as instâncias.') }
})
</script>

<template>
  <AppShell>
    <PageHeader title="Status do WhatsApp" description="Publique, consulte e revogue os Status da sua conta, inclusive os publicados pelo celular e sincronizados com a instância." />
    <div class="toolbar split-toolbar">
      <select v-model="selected" class="select" aria-label="Instância do WhatsApp" @change="changeInstance">
        <option v-for="item in instances" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
      <button class="btn ghost" :disabled="loading || !selected" @click="load">Atualizar</button>
      <button v-if="session.hasPermission('messages.send')" class="btn primary" :disabled="!canPublish" @click="publishing = true">Publicar Status</button>
    </div>
    <div v-if="error" class="alert error" role="alert">{{ error }}</div>
    <div v-if="feedback" class="alert success" role="status">{{ feedback }}</div>
    <PanelCard title="Status publicados" description="O histórico mostra os Status recebidos pela instância durante a vida útil do Status (24 horas).">
      <p v-if="!selected">Nenhuma instância WhatsApp com Status disponível.</p>
      <p v-else-if="loading">Consultando Status…</p>
      <p v-else-if="!statuses.length">Nenhum Status publicado encontrado nesta página.</p>
      <div v-else class="published-list">
        <article v-for="item in statuses" :key="item.id" class="published-item">
          <div><strong>{{ item.text || 'Status de mídia' }}</strong><small>{{ stamp(item.timestamp) }} · {{ item.id }}</small></div>
          <div class="published-actions">
            <button class="btn ghost compact" :disabled="Boolean(viewingId)" @click="showViews(item)">Visualizações</button>
            <button v-if="session.hasPermission('messages.send')" class="btn ghost compact" :disabled="Boolean(deletingId) || instance?.status !== 'connected'" @click="remove(item)">{{ deletingId === item.id ? 'Revogando…' : 'Revogar' }}</button>
          </div>
        </article>
      </div>
      <div v-if="selected" class="published-actions top-gap">
        <button class="btn ghost compact" :disabled="loading || page === 1" @click="changePage(page - 1)">Anterior</button>
        <span>Página {{ page }}</span>
        <button class="btn ghost compact" :disabled="loading || statuses.length < limit" @click="changePage(page + 1)">Próxima</button>
      </div>
    </PanelCard>
    <PanelCard v-if="viewers || viewerError" class="top-gap" title="Visualizações">
      <div v-if="viewerError" class="alert error">{{ viewerError }}</div>
      <template v-else><p>{{ viewers?.count || 0 }} visualização(ões)</p><p v-for="view in viewers?.viewers || []" :key="view.participant">{{ view.participant }} · {{ view.status }}</p></template>
    </PanelCard>
    <WhatsAppStatusModal v-if="publishing && instance" :instance-id="instance.id" :instance-name="instance.name" :provider="instance.provider" :connected="instance.status === 'connected'" @close="publishing = false" @published="published" />
  </AppShell>
</template>

<style scoped>
.published-list{display:grid;gap:12px}
.published-item{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--border);padding:12px 0}
.published-item strong{display:block;overflow-wrap:anywhere}
.published-item small{display:block;color:var(--muted);overflow-wrap:anywhere}
.published-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
@media(max-width:680px){.published-item{align-items:flex-start;flex-direction:column}}
</style>
