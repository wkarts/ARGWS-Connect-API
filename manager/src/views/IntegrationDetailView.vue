<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import AppModal from '@/components/AppModal.vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { connect } from '@/services/connect'
import {
  integrationDefinitions,
  integrationSettingsDefinitions,
  type FieldDefinition,
} from '@/services/integration-definitions'
import { friendlyError } from '@/services/errors'
import type { IntegrationKey } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const instanceId = String(route.params.id)
const key = String(route.params.key) as IntegrationKey
const definition = computed(() => integrationDefinitions[key])
const settingsFields = computed(() => integrationSettingsDefinitions[key] || [])
const instance = ref<any>(null)
const items = ref<any[]>([])
const loading = ref(true)
const saving = ref(false)
const error = ref('')
const feedback = ref('')
const editorOpen = ref(false)
const editingRef = ref('')
const formData = ref<Record<string, any>>({})
const sessionsOpen = ref(false)
const sessions = ref<any[]>([])
const sessionsLoading = ref(false)
const credentialsOpen = ref(false)
const credentials = ref<any[]>([])
const credentialForm = ref({ name: '', apiKey: '' })
const credentialBusy = ref(false)
const models = ref<any[]>([])
const modelsLoading = ref(false)
const settingsOpen = ref(false)
const settingsData = ref<Record<string, any>>({})
const settingsSaving = ref(false)
const settingsFeedback = ref('')

const title = computed(() => definition.value?.label || 'Integração')

function defaultsFor(fields: FieldDefinition[]) {
  const value: Record<string, any> = {}
  for (const field of fields) {
    if (field.defaultValue !== undefined) {
      value[field.key] = Array.isArray(field.defaultValue) ? [...field.defaultValue] : field.defaultValue
    }
  }
  return value
}

function editorDefaults() {
  const value = defaultsFor(definition.value?.fields || [])
  if (value.enabled === undefined) value.enabled = false
  if (!value.triggerType) value.triggerType = 'all'
  return value
}

function normalizeForFields(fields: FieldDefinition[], item: any, base: Record<string, any> = {}) {
  const value: Record<string, any> = { ...base, ...(item || {}) }
  for (const field of fields) {
    if (field.kind === 'list' && Array.isArray(value[field.key])) value[field.key] = value[field.key].join('\n')
  }
  return value
}

function normalizeForEditor(item: any) {
  return normalizeForFields(definition.value?.fields || [], item, editorDefaults())
}

function payloadFromFields(fields: FieldDefinition[], source: Record<string, any>) {
  const value: Record<string, any> = { ...source }
  for (const field of fields) {
    if (field.kind === 'list') {
      value[field.key] = String(value[field.key] || '').split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean)
    }
    if (field.kind === 'number' && value[field.key] !== '' && value[field.key] !== undefined && value[field.key] !== null) {
      value[field.key] = Number(value[field.key])
    }
  }
  return value
}

function payloadFromForm() {
  const value = payloadFromFields(definition.value?.fields || [], formData.value)
  delete value.id
  delete value.createdAt
  delete value.updatedAt
  delete value.instanceId
  return value
}

function validateFields(fields: FieldDefinition[], source: Record<string, any>) {
  for (const field of fields) {
    if (!field.required) continue
    const value = source[field.key]
    const empty = value === undefined || value === null || String(value).trim() === ''
    if (empty) return `Informe ${field.label.toLowerCase()}.`
  }
  return ''
}

function modelId(item: any) {
  return String(item?.id || item?.name || item?.model || '')
}

async function loadModels(credentialId = String(formData.value.openaiCredsId || '')) {
  if (key !== 'openai' || !credentialId) {
    models.value = []
    return
  }
  modelsLoading.value = true
  try { models.value = await connect.openAiModels(instanceId, credentialId) }
  catch { models.value = [] }
  finally { modelsLoading.value = false }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    instance.value = await connect.connection(instanceId)
    items.value = await connect.findIntegrations(instanceId, key)
    if (key === 'openai') await loadCredentials()
  } catch (e) { error.value = friendlyError(e) }
  finally { loading.value = false }
}

async function openCreate() {
  editingRef.value = ''
  formData.value = normalizeForEditor(null)
  feedback.value = ''
  models.value = []
  if (key === 'openai') await loadCredentials()
  editorOpen.value = true
}

async function openEdit(item: any) {
  editingRef.value = connect.integrationId(item, key)
  formData.value = normalizeForEditor(item)
  feedback.value = ''
  if (key === 'openai') {
    await loadCredentials()
    await loadModels(String(formData.value.openaiCredsId || ''))
  }
  editorOpen.value = true
}

async function save() {
  feedback.value = ''
  const validation = validateFields(definition.value?.fields || [], formData.value)
  if (validation) {
    feedback.value = validation
    return
  }
  if (key === 'openai' && !credentials.value.length) {
    feedback.value = 'Cadastre uma credencial OpenAI antes de salvar esta configuração.'
    return
  }

  saving.value = true
  try {
    const payload = payloadFromForm()
    if (editingRef.value) await connect.updateIntegration(instanceId, key, editingRef.value, payload)
    else await connect.createIntegration(instanceId, key, payload)
    editorOpen.value = false
    feedback.value = 'Configuração salva com sucesso.'
    await load()
  } catch (e) { feedback.value = friendlyError(e) }
  finally { saving.value = false }
}

async function remove(item: any) {
  const ref = connect.integrationId(item, key)
  if (!ref || !window.confirm('Excluir esta configuração?')) return
  try {
    await connect.deleteIntegration(instanceId, key, ref)
    feedback.value = 'Configuração excluída.'
    await load()
  } catch (e) { error.value = friendlyError(e) }
}

async function showSessions(item: any) {
  const ref = connect.integrationId(item, key)
  if (!ref) return
  sessionsOpen.value = true
  sessionsLoading.value = true
  sessions.value = []
  try { sessions.value = await connect.integrationSessions(instanceId, key, ref) }
  catch (e) { error.value = friendlyError(e) }
  finally { sessionsLoading.value = false }
}

async function changeSession(row: any, status: string) {
  const remoteJid = String(row.remoteJid || row.jid || '')
  if (!remoteJid) return
  try {
    await connect.integrationSessionStatus(instanceId, key, remoteJid, status)
    if (status === 'delete') sessions.value = sessions.value.filter((item) => item !== row)
    else row.status = status
  } catch (e) { error.value = friendlyError(e) }
}

async function ignoreSession(row: any) {
  const remoteJid = String(row.remoteJid || row.jid || '')
  if (!remoteJid) return
  try {
    await connect.integrationIgnoreJid(instanceId, key, remoteJid, 'add')
    feedback.value = 'Contato adicionado à lista de ignorados.'
  } catch (e) { error.value = friendlyError(e) }
}

async function loadCredentials() {
  credentials.value = await connect.openAiCredentials(instanceId).catch(() => [])
}

async function addCredential() {
  if (!credentialForm.value.name.trim() || !credentialForm.value.apiKey.trim()) return
  credentialBusy.value = true
  try {
    await connect.createOpenAiCredential(instanceId, {
      name: credentialForm.value.name.trim(),
      apiKey: credentialForm.value.apiKey.trim(),
    })
    credentialForm.value = { name: '', apiKey: '' }
    await loadCredentials()
  } catch (e) { error.value = friendlyError(e) }
  finally { credentialBusy.value = false }
}

async function removeCredential(item: any) {
  const id = String(item.id || item.openaiCredsId || '')
  if (!id || !window.confirm('Excluir esta credencial?')) return
  try {
    await connect.deleteOpenAiCredential(instanceId, id)
    await loadCredentials()
    if (String(formData.value.openaiCredsId || '') === id) {
      formData.value.openaiCredsId = ''
      models.value = []
    }
  } catch (e) { error.value = friendlyError(e) }
}

async function openSettings() {
  settingsOpen.value = true
  settingsFeedback.value = ''
  if (key === 'openai') await loadCredentials()
  const fields = settingsFields.value
  const defaults = defaultsFor(fields)
  try {
    const raw = await connect.integrationSettings(instanceId, key)
    const data = Array.isArray(raw) ? raw[0] || {} : raw || {}
    settingsData.value = normalizeForFields(fields, data, defaults)
  } catch (e: any) {
    if (Number(e?.status || 0) === 404) settingsData.value = normalizeForFields(fields, {}, defaults)
    else {
      settingsData.value = normalizeForFields(fields, {}, defaults)
      settingsFeedback.value = friendlyError(e)
    }
  }
}

async function saveSettings() {
  settingsFeedback.value = ''
  const validation = validateFields(settingsFields.value, settingsData.value)
  if (validation) {
    settingsFeedback.value = validation
    return
  }
  if (key === 'openai' && !credentials.value.length) {
    settingsFeedback.value = 'Cadastre uma credencial OpenAI antes de salvar as preferências.'
    return
  }
  settingsSaving.value = true
  try {
    const payload = payloadFromFields(settingsFields.value, settingsData.value)
    await connect.saveIntegrationSettings(instanceId, key, payload)
    settingsFeedback.value = 'Preferências salvas com sucesso.'
  } catch (e) { settingsFeedback.value = friendlyError(e) }
  finally { settingsSaving.value = false }
}

onMounted(load)
</script>

<template>
  <AppShell>
    <PageHeader :title="title" :description="definition?.description || 'Configuração da integração.'">
      <button class="btn ghost" @click="router.push(`/instancias/${encodeURIComponent(instanceId)}/integracoes`)">Voltar</button>
      <button class="btn ghost" @click="openSettings"><AppIcon name="settings" :size="16"/>Preferências</button>
      <button v-if="key==='openai'" class="btn ghost" @click="credentialsOpen=true"><AppIcon name="key" :size="16"/>Credenciais</button>
      <button class="btn primary" @click="openCreate"><AppIcon name="plus" :size="16"/>Adicionar</button>
    </PageHeader>

    <div class="integration-context" v-if="instance"><span>Instância</span><strong>{{ instance.name || instance.instanceName }}</strong><span>Provider</span><strong>{{ instance.providerLabel }}</strong></div>
    <div v-if="feedback" class="alert" :class="feedback.includes('sucesso') || feedback.includes('excluída') || feedback.includes('ignorados') ? 'success' : 'error'">{{ feedback }}</div>
    <div v-if="error" class="alert error">{{ error }}</div>

    <div v-if="loading" class="cards-skeleton"></div>
    <EmptyState v-else-if="!items.length" icon="automation" :title="`${title} ainda não configurado`" description="Este recurso está disponível. Adicione a primeira configuração quando quiser utilizá-lo.">
      <button class="btn primary" @click="openCreate">Configurar agora</button>
    </EmptyState>

    <div v-else class="integration-records">
      <PanelCard v-for="(item,index) in items" :key="connect.integrationId(item,key) || index">
        <div class="integration-record-head">
          <div><strong>{{ item.description || item.name || `${title} ${index + 1}` }}</strong><small>{{ item.enabled === false ? 'Pausado' : 'Ativo' }}</small></div>
          <span :class="['integration-status', item.enabled === false ? 'ready' : 'configured']">{{ item.enabled === false ? 'Pausado' : 'Ativo' }}</span>
        </div>
        <div class="integration-record-details">
          <span v-if="item.webhookUrl">{{ item.webhookUrl }}</span>
          <span v-else-if="item.url">{{ item.url }}</span>
          <span v-else-if="item.apiUrl">{{ item.apiUrl }}</span>
          <span v-else-if="item.agentUrl">{{ item.agentUrl }}</span>
          <span v-else>Gatilho: {{ item.triggerType || 'all' }}</span>
        </div>
        <div class="page-actions top-gap">
          <button class="btn ghost compact" @click="showSessions(item)">Sessões</button>
          <button class="btn ghost compact" @click="openEdit(item)">Editar</button>
          <button class="btn danger compact" @click="remove(item)">Excluir</button>
        </div>
      </PanelCard>
    </div>

    <AppModal :open="editorOpen" :title="editingRef ? `Editar ${title}` : `Novo ${title}`" subtitle="Configure esta integração para a instância selecionada." :wide="true" @close="editorOpen=false">
      <form class="integration-form" @submit.prevent="save">
        <template v-for="field in definition?.fields || []" :key="field.key">
          <label v-if="field.kind==='boolean'" class="toggle-field">
            <input v-model="formData[field.key]" type="checkbox"/><span><strong>{{ field.label }}</strong><small v-if="field.hint">{{ field.hint }}</small></span>
          </label>
          <label v-else class="field">
            <span>{{ field.label }}</span>
            <select v-if="field.key==='openaiCredsId'" v-model="formData[field.key]" class="select" :required="field.required" @change="loadModels()">
              <option value="">Selecione uma credencial</option>
              <option v-for="cred in credentials" :key="cred.id || cred.openaiCredsId" :value="cred.id || cred.openaiCredsId">{{ cred.name || cred.id || cred.openaiCredsId }}</option>
            </select>
            <select v-else-if="key==='openai' && field.key==='model' && models.length" v-model="formData[field.key]" class="select">
              <option value="">Selecione um modelo</option>
              <option v-for="model in models" :key="modelId(model)" :value="modelId(model)">{{ modelId(model) }}</option>
            </select>
            <select v-else-if="field.kind==='select'" v-model="formData[field.key]" class="select" :required="field.required">
              <option v-for="option in field.options || []" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <textarea v-else-if="field.kind==='textarea' || field.kind==='list'" v-model="formData[field.key]" rows="4" :required="field.required" :placeholder="field.placeholder"></textarea>
            <input v-else v-model="formData[field.key]" :type="field.kind==='password' ? 'password' : field.kind==='number' ? 'number' : field.kind==='url' ? 'url' : 'text'" :required="field.required" :placeholder="field.placeholder"/>
            <small v-if="field.hint">{{ field.hint }}</small>
            <small v-if="key==='openai' && field.key==='model' && modelsLoading">Consultando modelos disponíveis...</small>
          </label>
        </template>
        <div v-if="key==='openai' && !credentials.length" class="alert warning">Cadastre uma credencial antes de salvar uma configuração OpenAI. O restante da integração continua disponível.</div>
      </form>
      <template #footer>
        <button class="btn ghost" :disabled="saving" @click="editorOpen=false">Cancelar</button>
        <button class="btn primary" :disabled="saving || (key==='openai' && !credentials.length)" @click="save">{{ saving ? 'Salvando...' : 'Salvar' }}</button>
      </template>
    </AppModal>

    <AppModal :open="settingsOpen" :title="`Preferências ${title}`" subtitle="Defina comportamento padrão, fallback e contatos ignorados." :wide="true" @close="settingsOpen=false">
      <div class="form-stack">
        <div v-if="settingsFeedback" class="alert" :class="settingsFeedback.includes('sucesso') ? 'success' : 'error'">{{ settingsFeedback }}</div>
        <template v-for="field in settingsFields" :key="field.key">
          <label v-if="field.kind==='boolean'" class="toggle-field">
            <input v-model="settingsData[field.key]" type="checkbox"/><span><strong>{{ field.label }}</strong><small v-if="field.hint">{{ field.hint }}</small></span>
          </label>
          <label v-else class="field">
            <span>{{ field.label }}</span>
            <select v-if="field.key==='openaiCredsId'" v-model="settingsData[field.key]" class="select" :required="field.required">
              <option value="">Selecione uma credencial</option>
              <option v-for="cred in credentials" :key="cred.id || cred.openaiCredsId" :value="cred.id || cred.openaiCredsId">{{ cred.name || cred.id || cred.openaiCredsId }}</option>
            </select>
            <textarea v-else-if="field.kind==='textarea' || field.kind==='list'" v-model="settingsData[field.key]" rows="4" :placeholder="field.placeholder"></textarea>
            <input v-else v-model="settingsData[field.key]" :type="field.kind==='number' ? 'number' : 'text'" :placeholder="field.placeholder"/>
            <small v-if="field.hint">{{ field.hint }}</small>
          </label>
        </template>
      </div>
      <template #footer>
        <button class="btn ghost" :disabled="settingsSaving" @click="settingsOpen=false">Fechar</button>
        <button class="btn primary" :disabled="settingsSaving || (key==='openai' && !credentials.length)" @click="saveSettings">{{ settingsSaving ? 'Salvando...' : 'Salvar preferências' }}</button>
      </template>
    </AppModal>

    <AppModal :open="sessionsOpen" :title="`Sessões ${title}`" subtitle="Acompanhe e controle sessões desta integração." :wide="true" @close="sessionsOpen=false">
      <div v-if="sessionsLoading" class="cards-skeleton"></div>
      <EmptyState v-else-if="!sessions.length" icon="chat" title="Nenhuma sessão encontrada" description="As sessões aparecerão aqui quando a integração iniciar conversas."/>
      <div v-else class="session-list">
        <div v-for="(row,index) in sessions" :key="row.remoteJid || row.id || index" class="session-row">
          <div><strong>{{ row.remoteJid || row.jid || 'Sessão' }}</strong><small>{{ row.status || 'Sem estado informado' }}</small></div>
          <div class="page-actions">
            <button class="btn ghost compact" @click="changeSession(row,'opened')">Abrir</button>
            <button class="btn ghost compact" @click="changeSession(row,'paused')">Pausar</button>
            <button class="btn ghost compact" @click="changeSession(row,'closed')">Fechar</button>
            <button class="btn ghost compact" @click="ignoreSession(row)">Ignorar contato</button>
            <button class="btn danger compact" @click="changeSession(row,'delete')">Excluir</button>
          </div>
        </div>
      </div>
    </AppModal>

    <AppModal :open="credentialsOpen" title="Credenciais OpenAI" subtitle="Cadastre as credenciais utilizadas pelas configurações desta instância." :wide="true" @close="credentialsOpen=false">
      <div class="credential-layout">
        <div class="credential-list">
          <div v-for="cred in credentials" :key="cred.id || cred.openaiCredsId" class="credential-row"><div><strong>{{ cred.name || 'Credencial' }}</strong><small>{{ cred.id || cred.openaiCredsId }}</small></div><button class="btn danger compact" @click="removeCredential(cred)">Excluir</button></div>
          <p v-if="!credentials.length" class="muted-block">Nenhuma credencial cadastrada.</p>
        </div>
        <form class="form-stack" @submit.prevent="addCredential">
          <label class="field"><span>Nome</span><input v-model="credentialForm.name" required placeholder="Ex.: Atendimento"/></label>
          <label class="field"><span>Chave de acesso</span><input v-model="credentialForm.apiKey" required type="password" autocomplete="new-password"/></label>
          <button class="btn primary" :disabled="credentialBusy">{{ credentialBusy ? 'Adicionando...' : 'Adicionar credencial' }}</button>
        </form>
      </div>
    </AppModal>
  </AppShell>
</template>
