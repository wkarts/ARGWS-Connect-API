<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import AppIcon from '@/components/AppIcon.vue'
import { connect } from '@/services/connect'
import { eventOptions, settingDescriptions, settingTitles, type InstanceSettingKey } from '@/config/instance-settings'
import { friendlyError } from '@/services/errors'

const route = useRoute()
const router = useRouter()
const id = String(route.params.id)
const kind = computed(() => String(route.params.kind || 'settings') as InstanceSettingKey)
const connection = ref<any>(null)
const model = ref<Record<string, any>>({})
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const feedback = ref('')
const headerLines = ref('')
const ignoredContacts = ref('')

function normalize(raw: any) {
  if (!raw) return {}
  if (['settings', 'proxy', 'chatwoot'].includes(kind.value)) return raw
  return raw?.[kind.value] || raw || {}
}

function defaults(key: InstanceSettingKey) {
  if (key === 'settings') return {
    rejectCall: false, msgCall: '', groupsIgnore: false, alwaysOnline: false,
    readMessages: false, readStatus: false, syncFullHistory: false,
  }
  if (key === 'proxy') return { enabled: false, host: '', port: '', protocol: 'http', username: '', password: '' }
  if (key === 'webhook') return { enabled: false, url: '', headers: {}, byEvents: false, base64: false, events: [] }
  if (['websocket', 'rabbitmq', 'sqs'].includes(key)) return { enabled: false, events: [] }
  if (key === 'chatwoot') return {
    enabled: false, url: '', accountId: '', token: '', nameInbox: '', signDelimiter: '',
    signMsg: false, reopenConversation: false, conversationPending: false, autoCreate: false,
    importContacts: false, mergeBrazilContacts: false, importMessages: false, daysLimitImportMessages: 0, ignoreJids: [],
  }
  return {}
}

function headersToLines(headers: Record<string, unknown> = {}) {
  return Object.entries(headers).map(([key, value]) => `${key}: ${String(value)}`).join('\n')
}

function linesToHeaders(value: string) {
  const result: Record<string, string> = {}
  for (const line of value.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const index = trimmed.indexOf(':')
    if (index <= 0) continue
    const key = trimmed.slice(0, index).trim()
    const entry = trimmed.slice(index + 1).trim()
    if (key) result[key] = entry
  }
  return result
}

async function load() {
  loading.value = true
  error.value = ''
  feedback.value = ''
  try {
    const [instance, raw] = await Promise.all([
      connect.connection(id),
      connect.instanceSetting(id, kind.value),
    ])
    connection.value = instance
    model.value = { ...defaults(kind.value), ...normalize(raw) }
    if (kind.value === 'webhook') headerLines.value = headersToLines(model.value.headers || {})
    if (kind.value === 'chatwoot') ignoredContacts.value = Array.isArray(model.value.ignoreJids) ? model.value.ignoreJids.join('\n') : ''
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    loading.value = false
  }
}

function toggleEvent(code: string, checked: boolean) {
  const set = new Set<string>(Array.isArray(model.value.events) ? model.value.events : [])
  if (checked) set.add(code)
  else set.delete(code)
  model.value.events = [...set]
}

function eventSelected(code: string) {
  return Array.isArray(model.value.events) && model.value.events.includes(code)
}

function selectAllEvents() {
  model.value.events = eventOptions.map(([code]) => code)
}

function clearEvents() {
  model.value.events = []
}

async function save() {
  busy.value = true
  error.value = ''
  feedback.value = ''
  try {
    const payload = { ...model.value }
    if (kind.value === 'webhook') payload.headers = linesToHeaders(headerLines.value)
    if (kind.value === 'chatwoot') payload.ignoreJids = ignoredContacts.value.split(/\r?\n|,/).map((entry) => entry.trim()).filter(Boolean)
    if (payload.port !== '' && payload.port !== undefined && payload.port !== null) {
      const port = Number(payload.port)
      if (Number.isFinite(port)) payload.port = port
    }
    if (payload.daysLimitImportMessages !== '' && payload.daysLimitImportMessages !== undefined) {
      payload.daysLimitImportMessages = Number(payload.daysLimitImportMessages || 0)
    }
    await connect.saveInstanceSetting(id, kind.value, payload)
    feedback.value = 'Configuração salva com sucesso.'
    await load()
  } catch (e) {
    error.value = friendlyError(e)
  } finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <AppShell>
    <PageHeader :title="settingTitles[kind] || 'Configuração'" :description="`${settingDescriptions[kind] || ''} ${connection?.name ? `• ${connection.name}` : ''}`">
      <button class="btn ghost" @click="router.push(`/instancias/${encodeURIComponent(id)}/integracoes`)">Voltar</button>
      <button class="btn primary" :disabled="busy || loading" @click="save">{{ busy ? 'Salvando...' : 'Salvar' }}</button>
    </PageHeader>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="feedback" class="alert success">{{ feedback }}</div>
    <div v-if="loading" class="skeleton-page"></div>

    <PanelCard v-else>
      <div v-if="kind === 'settings'" class="settings-form-stack">
        <label class="toggle-field"><input v-model="model.rejectCall" type="checkbox"/><span><strong>Rejeitar chamadas</strong><small>Recuse chamadas recebidas automaticamente.</small></span></label>
        <label class="field"><span>Mensagem ao rejeitar</span><input v-model="model.msgCall" placeholder="Mensagem opcional"/></label>
        <label class="toggle-field"><input v-model="model.groupsIgnore" type="checkbox"/><span><strong>Ignorar grupos</strong><small>Não processe mensagens de grupos nesta instância.</small></span></label>
        <label class="toggle-field"><input v-model="model.alwaysOnline" type="checkbox"/><span><strong>Manter presença online</strong><small>Mantenha a conta disponível enquanto a conexão estiver ativa.</small></span></label>
        <label class="toggle-field"><input v-model="model.readMessages" type="checkbox"/><span><strong>Marcar mensagens como lidas</strong></span></label>
        <label class="toggle-field"><input v-model="model.readStatus" type="checkbox"/><span><strong>Ler atualizações de status</strong></span></label>
        <label class="toggle-field"><input v-model="model.syncFullHistory" type="checkbox"/><span><strong>Sincronizar histórico completo</strong><small>Recupere um histórico mais amplo quando a conexão permitir.</small></span></label>
      </div>

      <div v-else-if="kind === 'proxy'" class="settings-form-grid">
        <label class="toggle-field settings-span-2"><input v-model="model.enabled" type="checkbox"/><span><strong>Usar proxy nesta instância</strong></span></label>
        <label class="field"><span>Servidor</span><input v-model="model.host" placeholder="proxy.exemplo.com"/></label>
        <label class="field"><span>Porta</span><input v-model="model.port" type="number" placeholder="8080"/></label>
        <label class="field"><span>Protocolo</span><select v-model="model.protocol" class="select"><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select></label>
        <label class="field"><span>Usuário</span><input v-model="model.username" autocomplete="off"/></label>
        <label class="field"><span>Senha</span><input v-model="model.password" type="password" autocomplete="new-password"/></label>
      </div>

      <div v-else-if="kind === 'webhook'" class="settings-form-grid">
        <label class="toggle-field settings-span-2"><input v-model="model.enabled" type="checkbox"/><span><strong>Webhooks ativos</strong><small>Envie eventos desta instância para um endereço externo.</small></span></label>
        <label class="field settings-span-2"><span>Endereço de destino</span><input v-model="model.url" type="url" placeholder="https://..."/></label>
        <label class="toggle-field"><input v-model="model.byEvents" type="checkbox"/><span><strong>Separar por evento</strong></span></label>
        <label class="toggle-field"><input v-model="model.base64" type="checkbox"/><span><strong>Incluir mídia codificada</strong><small>Use quando o destino precisar receber o conteúdo da mídia junto ao evento.</small></span></label>
        <label class="field settings-span-2"><span>Cabeçalhos adicionais</span><textarea v-model="headerLines" rows="5" placeholder="Authorization: Bearer ...&#10;X-Chave: valor"></textarea><small>Informe um cabeçalho por linha no formato Nome: valor.</small></label>
      </div>

      <div v-else-if="kind === 'websocket' || kind === 'rabbitmq' || kind === 'sqs'" class="settings-form-stack">
        <label class="toggle-field"><input v-model="model.enabled" type="checkbox"/><span><strong>Integração ativa</strong><small>Distribua os eventos selecionados por este canal.</small></span></label>
      </div>

      <div v-else-if="kind === 'chatwoot'" class="settings-form-grid">
        <label class="toggle-field settings-span-2"><input v-model="model.enabled" type="checkbox"/><span><strong>Chatwoot ativo</strong><small>Sincronize esta instância com sua área de atendimento no Chatwoot.</small></span></label>
        <label class="field settings-span-2"><span>Endereço do Chatwoot</span><input v-model="model.url" type="url" placeholder="https://..."/></label>
        <label class="field"><span>Conta</span><input v-model="model.accountId"/></label>
        <label class="field"><span>Token de acesso</span><input v-model="model.token" type="password" autocomplete="new-password"/></label>
        <label class="field"><span>Nome da caixa</span><input v-model="model.nameInbox"/></label>
        <label class="field"><span>Separador da assinatura</span><input v-model="model.signDelimiter"/></label>
        <label class="toggle-field"><input v-model="model.signMsg" type="checkbox"/><span><strong>Assinar mensagens</strong></span></label>
        <label class="toggle-field"><input v-model="model.reopenConversation" type="checkbox"/><span><strong>Reabrir conversas</strong></span></label>
        <label class="toggle-field"><input v-model="model.conversationPending" type="checkbox"/><span><strong>Criar conversa como pendente</strong></span></label>
        <label class="toggle-field"><input v-model="model.autoCreate" type="checkbox"/><span><strong>Criar automaticamente</strong></span></label>
        <label class="toggle-field"><input v-model="model.importContacts" type="checkbox"/><span><strong>Importar contatos</strong></span></label>
        <label class="toggle-field"><input v-model="model.mergeBrazilContacts" type="checkbox"/><span><strong>Mesclar contatos brasileiros</strong></span></label>
        <label class="toggle-field"><input v-model="model.importMessages" type="checkbox"/><span><strong>Importar mensagens</strong></span></label>
        <label class="field"><span>Limite de dias</span><input v-model="model.daysLimitImportMessages" type="number" min="0"/></label>
        <label class="field settings-span-2"><span>Contatos ignorados</span><textarea v-model="ignoredContacts" rows="5" placeholder="Um contato por linha"></textarea></label>
      </div>

      <div v-if="kind === 'webhook' || kind === 'websocket' || kind === 'rabbitmq' || kind === 'sqs'" class="events-section">
        <div class="section-title compact-section"><div><h3>Eventos</h3><p>Escolha quais acontecimentos desta instância devem ser enviados.</p></div><div class="page-actions"><button class="btn ghost compact" @click="selectAllEvents">Selecionar todos</button><button class="btn ghost compact" @click="clearEvents">Limpar</button></div></div>
        <div class="event-option-grid">
          <label v-for="([code, label]) in eventOptions" :key="code" class="event-choice">
            <input type="checkbox" :checked="eventSelected(code)" @change="toggleEvent(code, ($event.target as HTMLInputElement).checked)"/>
            <span>{{ label }}</span>
          </label>
        </div>
      </div>
    </PanelCard>
  </AppShell>
</template>
