<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import AppIcon from '@/components/AppIcon.vue'
import { connect } from '@/services/connect'
import { eventOptions, instanceConfigDefinitions } from '@/services/integration-definitions'
import { friendlyError } from '@/services/errors'
import type { InstanceConfigKey } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const instanceId = String(route.params.id)
const instance = ref<any>(null)
const selected = ref<InstanceConfigKey>('settings')
const value = ref<Record<string, any>>({})
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const feedback = ref('')
const headersText = ref('{}')
const ignoreText = ref('')

const keys = Object.keys(instanceConfigDefinitions) as InstanceConfigKey[]
const selectedDefinition = computed(() => instanceConfigDefinitions[selected.value])
const isEvent = computed(() => ['webhook','websocket','rabbitmq','nats','sqs','kafka','pusher'].includes(selected.value))
const missingRequirement = computed(() => {
  const v = value.value || {}
  if (selected.value === 'webhook' && !String(v.url || '').trim()) return 'Informe a URL antes de salvar o Webhook.'
  if (selected.value === 'proxy' && (!String(v.host || '').trim() || !String(v.port || '').trim() || !String(v.protocol || '').trim())) return 'Informe servidor, porta e protocolo antes de salvar o Proxy.'
  if (selected.value === 'pusher' && (!String(v.appId || '').trim() || !String(v.key || '').trim() || !String(v.secret || '').trim() || !String(v.cluster || '').trim())) return 'Informe App ID, chave, segredo e cluster antes de salvar o Pusher.'
  if (selected.value === 'chatwoot' && (!String(v.url || '').trim() || !String(v.accountId || '').trim() || !String(v.token || '').trim())) return 'Informe URL, Account ID e token antes de salvar o Chatwoot.'
  return ''
})

function defaults(key: InstanceConfigKey) {
  if (key === 'settings') return { rejectCall:false, groupsIgnore:false, alwaysOnline:false, readMessages:false, readStatus:false, syncFullHistory:false, msgCall:'' }
  if (key === 'proxy') return { enabled:false, host:'', port:'', protocol:'http', username:'', password:'' }
  if (key === 'webhook') return { enabled:false, url:'', headers:{}, byEvents:false, base64:false, events:[] }
  if (['websocket','rabbitmq','nats','sqs','kafka'].includes(key)) return { enabled:false, events:[] }
  if (key === 'pusher') return { enabled:false, appId:'', key:'', secret:'', cluster:'', useTLS:true, events:[] }
  if (key === 'chatwoot') return { enabled:false, url:'', accountId:'', token:'', nameInbox:'', signMsg:false, signDelimiter:'', reopenConversation:false, conversationPending:false, autoCreate:false, importContacts:false, mergeBrazilContacts:false, importMessages:false, daysLimitImportMessages:0, ignoreJids:[] }
  return {}
}

function normalizeLoaded(key: InstanceConfigKey, raw: any) {
  const data = raw?.[key] ?? raw ?? {}
  return { ...defaults(key), ...(data || {}) }
}

async function load() {
  loading.value = true
  error.value = ''
  feedback.value = ''
  try {
    if (!instance.value) instance.value = await connect.connection(instanceId)
    value.value = normalizeLoaded(selected.value, await connect.loadInstanceConfig(instanceId, selected.value))
    if (selected.value === 'webhook') headersText.value = JSON.stringify(value.value.headers || {}, null, 2)
    if (selected.value === 'chatwoot') ignoreText.value = Array.isArray(value.value.ignoreJids) ? value.value.ignoreJids.join('\n') : ''
  } catch (e) { error.value = friendlyError(e) }
  finally { loading.value = false }
}

async function choose(key: InstanceConfigKey) {
  selected.value = key
  await load()
}

function toggleEvent(eventName: string) {
  const current = new Set(Array.isArray(value.value.events) ? value.value.events : [])
  if (current.has(eventName)) current.delete(eventName)
  else current.add(eventName)
  value.value.events = [...current]
}

function selectAllEvents() { value.value.events = eventOptions.map(([key]) => key) }
function clearEvents() { value.value.events = [] }

async function save() {
  error.value = ''
  feedback.value = ''
  if (missingRequirement.value) {
    error.value = missingRequirement.value
    return
  }
  saving.value = true
  try {
    if (selected.value === 'webhook') {
      try { value.value.headers = JSON.parse(headersText.value || '{}') }
      catch { throw new Error('Os cabeçalhos precisam estar em formato JSON válido.') }
    }
    if (selected.value === 'chatwoot') value.value.ignoreJids = ignoreText.value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean)
    await connect.saveInstanceConfig(instanceId, selected.value, value.value)
    feedback.value = 'Configuração salva com sucesso.'
    await load()
  } catch (e) { error.value = friendlyError(e) }
  finally { saving.value = false }
}

onMounted(load)
</script>

<template>
  <AppShell>
    <PageHeader title="Configurações da instância" :description="instance ? `${instance.name || instance.instanceName} · ${instance.providerLabel}` : 'Conexões, eventos e comportamento.'">
      <button class="btn ghost" @click="router.push(`/instancias/${encodeURIComponent(instanceId)}`)">Voltar</button>
      <button class="btn primary" :disabled="saving || loading || Boolean(missingRequirement)" @click="save"><AppIcon name="check" :size="16"/>{{ saving ? 'Salvando...' : 'Salvar' }}</button>
    </PageHeader>

    <div class="config-layout">
      <aside class="config-nav">
        <button v-for="key in keys" :key="key" :class="['config-nav-item', {active:selected===key}]" @click="choose(key)">
          <span><AppIcon :name="key==='webhook' ? 'workflow' : key==='chatwoot' ? 'chat' : key==='proxy' ? 'channels' : 'settings'" :size="17"/></span>
          <div><strong>{{ instanceConfigDefinitions[key].label }}</strong><small>{{ instanceConfigDefinitions[key].description }}</small></div>
        </button>
      </aside>

      <section class="config-workspace">
        <div v-if="feedback" class="alert success">{{ feedback }}</div>
        <div v-if="error" class="alert error">{{ error }}</div>
        <div v-if="loading" class="cards-skeleton"></div>

        <PanelCard v-else :title="selectedDefinition.label" :description="selectedDefinition.description">
          <div class="form-stack">
            <div v-if="missingRequirement" class="config-ready-note"><AppIcon name="warning" :size="17"/><span>{{ missingRequirement }} O recurso permanece disponível para configuração.</span></div>
            <template v-if="selected==='settings'">
              <label class="toggle-field"><input v-model="value.rejectCall" type="checkbox"/><span><strong>Rejeitar chamadas recebidas</strong><small>Quando ativado, chamadas recebidas são recusadas automaticamente.</small></span></label>
              <label class="field"><span>Mensagem ao rejeitar</span><input v-model="value.msgCall" placeholder="Mensagem opcional"/></label>
              <label class="toggle-field"><input v-model="value.groupsIgnore" type="checkbox"/><span><strong>Ignorar grupos</strong></span></label>
              <label class="toggle-field"><input v-model="value.alwaysOnline" type="checkbox"/><span><strong>Manter presença online</strong></span></label>
              <label class="toggle-field"><input v-model="value.readMessages" type="checkbox"/><span><strong>Marcar mensagens como lidas</strong></span></label>
              <label class="toggle-field"><input v-model="value.readStatus" type="checkbox"/><span><strong>Ler atualizações de Status</strong></span></label>
              <label class="toggle-field"><input v-model="value.syncFullHistory" type="checkbox"/><span><strong>Sincronizar histórico completo</strong></span></label>
            </template>

            <template v-else-if="selected==='proxy'">
              <label class="toggle-field"><input v-model="value.enabled" type="checkbox"/><span><strong>Usar proxy nesta instância</strong></span></label>
              <div class="field-grid two"><label class="field"><span>Servidor</span><input v-model="value.host"/></label><label class="field"><span>Porta</span><input v-model="value.port" inputmode="numeric"/></label></div>
              <div class="field-grid two"><label class="field"><span>Protocolo</span><select v-model="value.protocol" class="select"><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select></label><label class="field"><span>Usuário</span><input v-model="value.username"/></label></div>
              <label class="field"><span>Senha</span><input v-model="value.password" type="password" autocomplete="new-password"/></label>
            </template>

            <template v-else-if="selected==='webhook'">
              <label class="toggle-field"><input v-model="value.enabled" type="checkbox"/><span><strong>Ativar Webhook</strong><small>Você pode configurar a URL mesmo antes de ativar o envio.</small></span></label>
              <label class="field"><span>URL</span><input v-model="value.url" type="url" placeholder="https://..."/></label>
              <div class="field-grid two"><label class="toggle-field"><input v-model="value.byEvents" type="checkbox"/><span><strong>Separar por eventos</strong></span></label><label class="toggle-field"><input v-model="value.base64" type="checkbox"/><span><strong>Enviar mídia codificada</strong></span></label></div>
              <label class="field"><span>Cabeçalhos adicionais</span><textarea v-model="headersText" rows="6" spellcheck="false"></textarea><small>Objeto JSON com os cabeçalhos enviados nas requisições.</small></label>
            </template>

            <template v-else-if="selected==='pusher'">
              <label class="toggle-field"><input v-model="value.enabled" type="checkbox"/><span><strong>Ativar Pusher</strong></span></label>
              <div class="field-grid two"><label class="field"><span>App ID</span><input v-model="value.appId"/></label><label class="field"><span>Chave</span><input v-model="value.key"/></label></div>
              <div class="field-grid two"><label class="field"><span>Segredo</span><input v-model="value.secret" type="password"/></label><label class="field"><span>Cluster</span><input v-model="value.cluster"/></label></div>
              <label class="toggle-field"><input v-model="value.useTLS" type="checkbox"/><span><strong>Conexão segura</strong></span></label>
            </template>

            <template v-else-if="isEvent">
              <label class="toggle-field"><input v-model="value.enabled" type="checkbox"/><span><strong>Ativar {{ selectedDefinition.label }}</strong><small>Os eventos selecionados serão encaminhados quando a integração estiver ativa.</small></span></label>
            </template>

            <template v-else-if="selected==='chatwoot'">
              <label class="toggle-field"><input v-model="value.enabled" type="checkbox"/><span><strong>Ativar Chatwoot</strong><small>Cadastre os dados abaixo e ative quando estiver pronto.</small></span></label>
              <label class="field"><span>URL</span><input v-model="value.url" type="url" placeholder="https://..."/></label>
              <div class="field-grid two"><label class="field"><span>Account ID</span><input v-model="value.accountId"/></label><label class="field"><span>Token</span><input v-model="value.token" type="password"/></label></div>
              <label class="field"><span>Nome da caixa</span><input v-model="value.nameInbox"/></label>
              <div class="toggle-grid">
                <label class="toggle-field"><input v-model="value.signMsg" type="checkbox"/><span><strong>Assinar mensagens</strong></span></label>
                <label class="toggle-field"><input v-model="value.reopenConversation" type="checkbox"/><span><strong>Reabrir conversa</strong></span></label>
                <label class="toggle-field"><input v-model="value.conversationPending" type="checkbox"/><span><strong>Criar como pendente</strong></span></label>
                <label class="toggle-field"><input v-model="value.autoCreate" type="checkbox"/><span><strong>Criar automaticamente</strong></span></label>
                <label class="toggle-field"><input v-model="value.importContacts" type="checkbox"/><span><strong>Importar contatos</strong></span></label>
                <label class="toggle-field"><input v-model="value.mergeBrazilContacts" type="checkbox"/><span><strong>Mesclar contatos do Brasil</strong></span></label>
                <label class="toggle-field"><input v-model="value.importMessages" type="checkbox"/><span><strong>Importar mensagens</strong></span></label>
              </div>
              <div class="field-grid two"><label class="field"><span>Delimitador da assinatura</span><input v-model="value.signDelimiter"/></label><label class="field"><span>Dias para importar mensagens</span><input v-model.number="value.daysLimitImportMessages" type="number" min="0"/></label></div>
              <label class="field"><span>Contatos ignorados</span><textarea v-model="ignoreText" rows="5" placeholder="Um identificador por linha"></textarea></label>
            </template>

            <div v-if="isEvent" class="event-selector">
              <div class="event-selector-head"><div><strong>Eventos</strong><small>Selecione o que deve ser encaminhado.</small></div><div class="page-actions"><button class="btn ghost compact" @click="selectAllEvents">Selecionar todos</button><button class="btn ghost compact" @click="clearEvents">Limpar</button></div></div>
              <div class="event-grid">
                <label v-for="([eventName,label]) in eventOptions" :key="eventName" :class="['event-option', {active:(value.events || []).includes(eventName)}]"><input type="checkbox" :checked="(value.events || []).includes(eventName)" @change="toggleEvent(eventName)"/><span>{{ label }}</span></label>
              </div>
            </div>
          </div>
        </PanelCard>
      </section>
    </div>
  </AppShell>
</template>
