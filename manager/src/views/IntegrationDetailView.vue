<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import AppModal from '@/components/AppModal.vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import StatusPill from '@/components/StatusPill.vue'
import { connect } from '@/services/connect'
import { integrationDefinitions, integrationId, type IntegrationField, type IntegrationKey } from '@/config/integrations'
import { friendlyError } from '@/services/errors'

const route = useRoute()
const router = useRouter()
const id = String(route.params.id)
const integrationKey = computed(() => String(route.params.integration || '') as IntegrationKey)
const definition = computed(() => integrationDefinitions[integrationKey.value])
const connection = ref<any>(null)
const items = ref<any[]>([])
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const feedback = ref('')

const editorOpen = ref(false)
const editingId = ref('')
const formModel = ref<Record<string, any>>({})
const credentials = ref<any[]>([])

const settingsOpen = ref(false)
const settingsModel = ref<Record<string, any>>({})
const settingsOriginalTypes = ref<Record<string, string>>({})

const sessionsOpen = ref(false)
const sessions = ref<any[]>([])
const sessionRecordId = ref('')
const sessionBusy = ref(false)

const credentialsOpen = ref(false)
const credentialName = ref('')
const credentialKey = ref('')
const credentialBusy = ref(false)

function normalizeList(data: any) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.records)) return data.records
  return data ? [data] : []
}

function cleanObject(value: Record<string, any>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function fieldOptions(field: IntegrationField) {
  if (integrationKey.value === 'openai' && field.key === 'openaiCredsId') {
    return credentials.value.map((item) => ({
      value: String(item.id || item.openaiCredsId || ''),
      label: String(item.name || item.id || item.openaiCredsId || 'Credencial'),
    }))
  }
  return (field.options || []).map((option) => typeof option === 'string' ? { value: option, label: option } : option)
}

function newModel(source: Record<string, any> = {}) {
  const result: Record<string, any> = {}
  for (const field of definition.value?.fields || []) {
    let value = source[field.key]
    if (value === undefined) value = field.defaultValue
    if (field.type === 'list') value = Array.isArray(value) ? value.join('\n') : String(value || '')
    if (field.type === 'boolean') value = Boolean(value)
    result[field.key] = value ?? ''
  }
  for (const [key, value] of Object.entries(source)) {
    if (!(key in result)) result[key] = value
  }
  return result
}

function payloadFromModel() {
  const value = { ...formModel.value }
  for (const field of definition.value?.fields || []) {
    if (field.type === 'list') {
      value[field.key] = String(value[field.key] || '').split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean)
    } else if (field.type === 'number') {
      if (value[field.key] === '' || value[field.key] === null || value[field.key] === undefined) value[field.key] = undefined
      else {
        const number = Number(value[field.key])
        value[field.key] = Number.isFinite(number) ? number : undefined
      }
    }
  }
  return cleanObject(value)
}

async function load() {
  if (!definition.value) {
    error.value = 'Integração não encontrada.'
    loading.value = false
    return
  }
  loading.value = true
  error.value = ''
  try {
    const [instance, records] = await Promise.all([
      connect.connection(id),
      connect.integrationList(id, integrationKey.value),
    ])
    connection.value = instance
    items.value = normalizeList(records)
    if (integrationKey.value === 'openai') credentials.value = await connect.openAiCredentials(id).catch(() => [])
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    loading.value = false
  }
}

async function openEditor(item?: any) {
  error.value = ''
  feedback.value = ''
  if (integrationKey.value === 'openai') credentials.value = await connect.openAiCredentials(id).catch(() => [])
  editingId.value = item ? integrationId(item) : ''
  formModel.value = newModel(item || {
    enabled: true,
    triggerType: 'all',
    triggerOperator: 'contains',
    expire: 0,
    delayMessage: 0,
    listeningFromMe: false,
    stopBotFromMe: false,
    keepOpen: false,
    debounceTime: 0,
    ignoreJids: [],
  })
  editorOpen.value = true
}

async function saveEditor() {
  busy.value = true
  error.value = ''
  try {
    const payload = payloadFromModel()
    if (editingId.value) await connect.integrationUpdate(id, integrationKey.value, editingId.value, payload)
    else await connect.integrationCreate(id, integrationKey.value, payload)
    editorOpen.value = false
    feedback.value = 'Configuração salva com sucesso.'
    await load()
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}

async function remove(item: any) {
  const recordId = integrationId(item)
  if (!recordId || !window.confirm('Excluir esta configuração?')) return
  busy.value = true
  error.value = ''
  try {
    await connect.integrationDelete(id, integrationKey.value, recordId)
    feedback.value = 'Configuração excluída.'
    await load()
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}

function settingLabel(key: string) {
  const labels: Record<string, string> = {
    expire: 'Encerrar após', keywordFinish: 'Palavra para encerrar', delayMessage: 'Atraso antes de responder',
    unknownMessage: 'Mensagem quando não houver resposta', listeningFromMe: 'Processar mensagens do atendente',
    stopBotFromMe: 'Permitir interrupção pelo atendente', keepOpen: 'Manter atendimento aberto',
    debounceTime: 'Aguardar mensagens em sequência', ignoreJids: 'Contatos ignorados', splitMessages: 'Dividir respostas longas',
    timePerChar: 'Ritmo de envio por caractere', speechToText: 'Converter áudio em texto',
    typebotIdFallback: 'Alternativa do Typebot', difyIdFallback: 'Alternativa do Dify', flowiseIdFallback: 'Alternativa do Flowise',
    openaiCredsId: 'Credencial padrão', openaiIdFallback: 'Alternativa da OpenAI', connectAIIdFallback: 'Alternativa do ConnectAI', botIdFallback: 'Alternativa do bot',
  }
  return labels[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

async function openSettings() {
  busy.value = true
  error.value = ''
  try {
    let raw = await connect.integrationSettings(id, integrationKey.value)
    if (Array.isArray(raw)) raw = raw[0] || {}
    const base = { ...(definition.value?.defaultSettings || {}), ...(raw || {}) }
    const next: Record<string, any> = {}
    const types: Record<string, string> = {}
    for (const [key, value] of Object.entries(base)) {
      if (Array.isArray(value)) {
        next[key] = value.join('\n')
        types[key] = 'array'
      } else {
        next[key] = value
        types[key] = typeof value
      }
    }
    settingsModel.value = next
    settingsOriginalTypes.value = types
    settingsOpen.value = true
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}

async function saveSettings() {
  busy.value = true
  error.value = ''
  try {
    const payload: Record<string, any> = {}
    for (const [key, value] of Object.entries(settingsModel.value)) {
      const type = settingsOriginalTypes.value[key]
      if (type === 'array') payload[key] = String(value || '').split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean)
      else if (type === 'number') payload[key] = Number(value || 0)
      else if (type === 'boolean') payload[key] = Boolean(value)
      else payload[key] = value
    }
    await connect.saveIntegrationSettings(id, integrationKey.value, payload)
    settingsOpen.value = false
    feedback.value = 'Preferências salvas com sucesso.'
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}

async function loadSessions(recordId: string) {
  sessionBusy.value = true
  error.value = ''
  try {
    sessions.value = normalizeList(await connect.integrationSessions(id, integrationKey.value, recordId))
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    sessionBusy.value = false
  }
}

async function openSessions(item: any) {
  const recordId = integrationId(item)
  if (!recordId) return
  sessionRecordId.value = recordId
  sessionsOpen.value = true
  await loadSessions(recordId)
}

async function changeSession(row: any, status: string) {
  const remote = String(row.remoteJid || row.jid || '')
  if (!remote) return
  sessionBusy.value = true
  try {
    await connect.integrationSessionStatus(id, integrationKey.value, remote, status)
    await loadSessions(sessionRecordId.value)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    sessionBusy.value = false
  }
}

async function ignoreSession(row: any) {
  const remote = String(row.remoteJid || row.jid || '')
  if (!remote) return
  sessionBusy.value = true
  try {
    await connect.integrationIgnoreContact(id, integrationKey.value, remote, 'add')
    feedback.value = 'Contato adicionado à lista de ignorados.'
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    sessionBusy.value = false
  }
}

async function openCredentials() {
  credentials.value = await connect.openAiCredentials(id).catch(() => [])
  credentialName.value = ''
  credentialKey.value = ''
  credentialsOpen.value = true
}

async function addCredential() {
  if (!credentialName.value.trim() || !credentialKey.value.trim()) return
  credentialBusy.value = true
  try {
    await connect.createOpenAiCredential(id, { name: credentialName.value.trim(), apiKey: credentialKey.value.trim() })
    credentialName.value = ''
    credentialKey.value = ''
    credentials.value = await connect.openAiCredentials(id)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    credentialBusy.value = false
  }
}

async function deleteCredential(item: any) {
  const credentialId = String(item.id || item.openaiCredsId || '')
  if (!credentialId || !window.confirm('Excluir esta credencial?')) return
  credentialBusy.value = true
  try {
    await connect.deleteOpenAiCredential(id, credentialId)
    credentials.value = await connect.openAiCredentials(id)
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    credentialBusy.value = false
  }
}

onMounted(load)
</script>

<template>
  <AppShell>
    <PageHeader :title="definition?.title || 'Integração'" :description="`Configuração vinculada a ${connection?.name || connection?.instanceName || 'esta instância'}.`">
      <button class="btn ghost" @click="router.push(`/instancias/${encodeURIComponent(id)}/integracoes`)">Voltar</button>
      <button v-if="integrationKey === 'openai'" class="btn ghost" :disabled="busy" @click="openCredentials">Credenciais</button>
      <button class="btn ghost" :disabled="busy" @click="openSettings">Preferências</button>
      <button class="btn primary" :disabled="busy" @click="openEditor()"><AppIcon name="plus" :size="16"/>Adicionar</button>
    </PageHeader>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="feedback" class="alert success">{{ feedback }}</div>
    <div v-if="loading" class="cards-skeleton"></div>
    <EmptyState v-else-if="!items.length" icon="automation" :title="`Nenhuma configuração ${definition?.title || ''}`" description="Adicione uma configuração para começar." >
      <button class="btn primary" @click="openEditor()">Adicionar configuração</button>
    </EmptyState>
    <div v-else class="integration-record-list">
      <PanelCard v-for="(item, index) in items" :key="integrationId(item) || index">
        <div class="integration-record">
          <span class="integration-brand" :class="`accent-${definition?.accent || 'blue'}`">{{ definition?.title.slice(0,2).toUpperCase() }}</span>
          <div class="integration-record-copy">
            <strong>{{ item.description || item.name || `${definition?.title} ${index + 1}` }}</strong>
            <small>{{ integrationId(item) || 'Configuração vinculada' }}</small>
          </div>
          <StatusPill :status="item.enabled === false ? 'unavailable' : 'ok'" :label="item.enabled === false ? 'Desativado' : 'Ativo'"/>
          <div class="integration-record-actions">
            <button v-if="integrationId(item)" class="btn ghost compact" @click="openSessions(item)">Sessões</button>
            <button class="btn ghost compact" @click="openEditor(item)">Editar</button>
            <button v-if="integrationId(item)" class="btn danger compact" @click="remove(item)">Excluir</button>
          </div>
        </div>
      </PanelCard>
    </div>

    <AppModal :open="editorOpen" :title="editingId ? `Editar ${definition?.title}` : `Novo ${definition?.title}`" subtitle="Configure como esta integração participa dos atendimentos." :wide="true" @close="editorOpen=false">
      <form class="integration-form-grid" @submit.prevent="saveEditor">
        <template v-for="field in definition?.fields || []" :key="field.key">
          <label v-if="field.type === 'boolean'" class="toggle-field integration-span-2">
            <input v-model="formModel[field.key]" type="checkbox"/>
            <span><strong>{{ field.label }}</strong><small v-if="field.hint">{{ field.hint }}</small></span>
          </label>
          <label v-else class="field" :class="{ 'integration-span-2': field.type === 'textarea' || field.type === 'list' }">
            <span>{{ field.label }}</span>
            <select v-if="field.type === 'select'" v-model="formModel[field.key]" class="select" :required="field.required">
              <option value="">Selecione</option>
              <option v-for="option in fieldOptions(field)" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <textarea v-else-if="field.type === 'textarea' || field.type === 'list'" v-model="formModel[field.key]" :rows="field.rows || 4" :placeholder="field.type === 'list' ? 'Um item por linha' : ''"></textarea>
            <input v-else v-model="formModel[field.key]" :type="field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'" :required="field.required"/>
            <small v-if="field.hint">{{ field.hint }}</small>
          </label>
        </template>
      </form>
      <template #footer>
        <button class="btn ghost" :disabled="busy" @click="editorOpen=false">Cancelar</button>
        <button class="btn primary" :disabled="busy" @click="saveEditor">{{ busy ? 'Salvando...' : 'Salvar' }}</button>
      </template>
    </AppModal>

    <AppModal :open="settingsOpen" :title="`Preferências ${definition?.title || ''}`" subtitle="Ajuste o comportamento padrão desta integração." :wide="true" @close="settingsOpen=false">
      <div class="settings-editor-grid">
        <label v-for="(value, key) in settingsModel" :key="key" class="field" :class="{ 'integration-span-2': settingsOriginalTypes[String(key)] === 'array' || String(key).toLowerCase().includes('message') }">
          <span>{{ settingLabel(String(key)) }}</span>
          <input v-if="settingsOriginalTypes[String(key)] === 'boolean'" v-model="settingsModel[String(key)]" type="checkbox" class="toggle-input"/>
          <textarea v-else-if="settingsOriginalTypes[String(key)] === 'array' || String(key).toLowerCase().includes('message')" v-model="settingsModel[String(key)]" rows="4"></textarea>
          <input v-else v-model="settingsModel[String(key)]" :type="settingsOriginalTypes[String(key)] === 'number' ? 'number' : 'text'"/>
        </label>
      </div>
      <template #footer>
        <button class="btn ghost" :disabled="busy" @click="settingsOpen=false">Cancelar</button>
        <button class="btn primary" :disabled="busy" @click="saveSettings">Salvar preferências</button>
      </template>
    </AppModal>

    <AppModal :open="sessionsOpen" :title="`Sessões ${definition?.title || ''}`" subtitle="Acompanhe e controle atendimentos vinculados a esta automação." :wide="true" @close="sessionsOpen=false">
      <div v-if="sessionBusy" class="cards-skeleton"></div>
      <EmptyState v-else-if="!sessions.length" icon="chat" title="Nenhuma sessão encontrada" description="As sessões ativas aparecerão aqui quando houver atendimentos vinculados."/>
      <div v-else class="session-list">
        <div v-for="(row, index) in sessions" :key="row.remoteJid || row.jid || index" class="session-row">
          <div><strong>{{ row.name || row.pushName || row.remoteJid || row.jid || 'Atendimento' }}</strong><small>{{ row.status || 'Sem estado informado' }}</small></div>
          <div class="session-actions">
            <button class="btn ghost compact" :disabled="sessionBusy" @click="changeSession(row,'opened')">Abrir</button>
            <button class="btn ghost compact" :disabled="sessionBusy" @click="changeSession(row,'paused')">Pausar</button>
            <button class="btn ghost compact" :disabled="sessionBusy" @click="changeSession(row,'closed')">Fechar</button>
            <button class="btn ghost compact" :disabled="sessionBusy" @click="ignoreSession(row)">Ignorar contato</button>
            <button class="btn danger compact" :disabled="sessionBusy" @click="changeSession(row,'delete')">Excluir</button>
          </div>
        </div>
      </div>
    </AppModal>

    <AppModal :open="credentialsOpen" title="Credenciais OpenAI" subtitle="Cadastre as credenciais usadas pelas automações desta instância." :wide="true" @close="credentialsOpen=false">
      <div class="credential-layout">
        <div class="credential-list">
          <div v-if="!credentials.length" class="muted-box">Nenhuma credencial cadastrada.</div>
          <div v-for="item in credentials" :key="item.id || item.openaiCredsId" class="credential-row">
            <div><strong>{{ item.name || 'Credencial' }}</strong><small>{{ item.id || item.openaiCredsId }}</small></div>
            <button class="btn danger compact" :disabled="credentialBusy" @click="deleteCredential(item)">Excluir</button>
          </div>
        </div>
        <form class="credential-form" @submit.prevent="addCredential">
          <h4>Nova credencial</h4>
          <label class="field"><span>Nome</span><input v-model="credentialName" required/></label>
          <label class="field"><span>Chave de acesso</span><input v-model="credentialKey" type="password" required autocomplete="new-password"/></label>
          <button class="btn primary" :disabled="credentialBusy || !credentialName.trim() || !credentialKey.trim()">Adicionar credencial</button>
        </form>
      </div>
    </AppModal>
  </AppShell>
</template>
