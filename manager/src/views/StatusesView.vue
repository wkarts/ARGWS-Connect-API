<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import WhatsAppStatusModal from '@/components/WhatsAppStatusModal.vue'
import AppModal from '@/components/AppModal.vue'
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
const opened = ref<Message | null>(null)
const mediaUrl = ref('')
const previewError = ref('')
const previewLoading = ref(false)
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

function closePreview() {
  opened.value = null
  mediaUrl.value = ''
  previewError.value = ''
}

async function openPreview(item: Message) {
  opened.value = item
  mediaUrl.value = ''
  previewError.value = ''
  if (!item.mediaKind) return
  const instanceId = selected.value
  previewLoading.value = true
  try {
    const media = await connect.statusMedia(instanceId, item.id)
    if (opened.value?.id !== item.id || selected.value !== instanceId) return
    if (!/^\w[\w.+-]*\/(?:\w[\w.+-]*)$/.test(media.mimetype) || !media.base64 ||
      !media.mimetype.startsWith(`${item.mediaKind}/`)) throw new Error('Mídia indisponível para este Status.')
    mediaUrl.value = `data:${media.mimetype};base64,${media.base64}`
  } catch (cause) {
    if (opened.value?.id === item.id) previewError.value = friendlyError(cause, 'Mídia indisponível para este Status.')
  } finally { previewLoading.value = false }
}

async function changeInstance() {
  closePreview()
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
    feedback.value = 'Comando de revogação aceito pelo provider. A entrega aos aparelhos não é confirmada por esta resposta.'
    if (opened.value?.id === item.id) closePreview()
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
    const requestedPost = String(route.query.post || '')
    const post = statuses.value.find((item) => item.id === requestedPost)
    if (post) await openPreview(post)
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
      <button class="btn ghost" :disabled="loading || !selected" @click="load">{{ loading ? 'Atualizando…' : 'Atualizar' }}</button>
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
          <div class="published-content"><strong>{{ item.text === '[Conteúdo]' ? (item.mediaKind ? `Status de ${item.mediaKind}` : 'Status publicado') : item.text || 'Status publicado' }}</strong><small>{{ stamp(item.timestamp) }} · {{ item.id }}</small></div>
          <div class="published-actions">
            <button class="btn ghost compact" @click="openPreview(item)">Abrir</button>
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
    <AppModal :open="Boolean(opened)" title="Status publicado" :subtitle="stamp(opened?.timestamp)" @close="closePreview">
      <div v-if="opened" class="status-preview">
        <p v-if="opened.text && opened.text !== '[Conteúdo]'">{{ opened.text }}</p>
        <p v-if="previewLoading">Carregando mídia…</p>
        <img v-if="opened.mediaKind === 'image' && mediaUrl" :src="mediaUrl" alt="Imagem publicada no Status" />
        <video v-if="opened.mediaKind === 'video' && mediaUrl" :src="mediaUrl" controls playsinline />
        <audio v-if="opened.mediaKind === 'audio' && mediaUrl" :src="mediaUrl" controls />
        <p v-if="previewError" class="alert error" role="alert">{{ previewError }}</p>
        <p v-else-if="!previewLoading && !mediaUrl && opened.mediaKind" class="muted">O arquivo de mídia não está disponível no histórico desta instância.</p>
        <small>ID: {{ opened.id }}</small>
      </div>
    </AppModal>
  </AppShell>
</template>

<style scoped>
.published-list{display:grid;gap:12px}
.published-content{min-width:0;flex:1}.status-preview{display:grid;gap:12px;min-width:0;overflow-wrap:anywhere}.status-preview p{white-space:pre-wrap;margin:0}.status-preview img,.status-preview video{display:block;width:100%;max-height:65vh;object-fit:contain;border-radius:10px;background:var(--surface-2)}.status-preview audio{width:100%}.status-preview small,.status-preview .muted{color:var(--muted)}
.published-item{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--border);padding:12px 0}
.published-item strong{display:block;overflow-wrap:anywhere}
.published-item small{display:block;color:var(--muted);overflow-wrap:anywhere}
.published-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
@media(max-width:680px){.published-item{align-items:stretch;flex-direction:column}.published-actions{width:100%}.published-actions .btn{flex:1}.toolbar .select{width:100%;min-width:0}}
</style>
