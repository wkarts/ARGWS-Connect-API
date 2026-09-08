<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import StatusPill from '@/components/StatusPill.vue'
import AppModal from '@/components/AppModal.vue'
import AppIcon from '@/components/AppIcon.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import type { ProviderMigrationResult, WhatsAppProvider } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const data = ref<any>(null)
const error = ref('')
const feedback = ref('')
const busy = ref(false)
const id = String(route.params.id)
const qrOpen = ref(false)
const pairOpen = ref(false)
const qrImage = ref('')
const pairCode = ref('')
const pairNumber = ref('')
const migrationOpen = ref(false)
const migrationBusy = ref(false)
const migrationResult = ref<ProviderMigrationResult | null>(null)
let watchTimer: number | undefined

const connected = computed(() => ['open', 'connected'].includes(String(data.value?.connectionStatus || data.value?.status || '').toLowerCase()))
const provider = computed<WhatsAppProvider>(() => data.value?.provider || data.value?.integration || '')
const providerLabel = computed(() => data.value?.providerLabel || provider.value || '—')
const capabilities = computed(() => data.value?.capabilities || {})
const migrationTarget = computed<WhatsAppProvider>(() => provider.value === 'WHATSAPP-ZAPO' ? 'WHATSAPP-BAILEYS' : 'WHATSAPP-ZAPO')
const migrationTargetLabel = computed(() => migrationTarget.value === 'WHATSAPP-ZAPO' ? 'ZAPO' : 'Baileys')
const canMigrate = computed(() => ['WHATSAPP-BAILEYS', 'WHATSAPP-ZAPO'].includes(String(provider.value)))

const capabilityGroups = computed(() => [
  { label: 'Mensagens', enabled: capabilities.value.messaging },
  { label: 'Contatos', enabled: capabilities.value.contacts },
  { label: 'Conversas', enabled: capabilities.value.chats },
  { label: 'Grupos', enabled: capabilities.value.groups },
  { label: 'Status', enabled: capabilities.value.statusRead && capabilities.value.statusPublish },
  { label: 'Presença', enabled: capabilities.value.presence },
  { label: 'Estado de conversa', enabled: capabilities.value.chatState },
  { label: 'Identificação PN/LID', enabled: capabilities.value.pnLid },
  { label: 'Mensagens interativas', enabled: capabilities.value.interactiveMessages },
  { label: 'Mídia', enabled: capabilities.value.media },
  { label: 'Perfil', enabled: capabilities.value.profile },
  { label: 'Perfil comercial', enabled: capabilities.value.businessProfile },
  { label: 'Catálogo comercial', enabled: capabilities.value.businessCatalog },
  { label: 'Privacidade', enabled: capabilities.value.privacy },
  { label: 'Marcadores', enabled: capabilities.value.labels },
  { label: 'Confirmações', enabled: capabilities.value.receipts },
  { label: 'Chamadas', enabled: capabilities.value.calls },
])

async function load() {
  error.value = ''
  try { data.value = await connect.connection(id) }
  catch (e) { error.value = friendlyError(e) }
}

function stopWatch() {
  if (watchTimer) window.clearInterval(watchTimer)
  watchTimer = undefined
}

function watchConnection() {
  stopWatch()
  let attempts = 0
  watchTimer = window.setInterval(async () => {
    attempts += 1
    try {
      await load()
      if (connected.value) {
        qrOpen.value = false
        pairOpen.value = false
        feedback.value = 'Conexão realizada com sucesso.'
        stopWatch()
      } else if (attempts >= 60) stopWatch()
    } catch { /* aguardando */ }
  }, 1500)
}

async function restart() {
  busy.value = true; feedback.value = ''; error.value = ''
  try { await connect.restartConnection(id); feedback.value = 'Instância reiniciada.'; await load() }
  catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

async function disconnect() {
  if (!window.confirm('Desconectar esta instância agora?')) return
  busy.value = true; feedback.value = ''; error.value = ''
  try { await connect.disconnectConnection(id); feedback.value = 'Instância desconectada.'; await load() }
  catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

async function remove() {
  if (!window.confirm('Excluir definitivamente esta instância e os dados associados?')) return
  busy.value = true; error.value = ''
  try { await connect.removeConnection(id); router.push('/instancias') }
  catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

function extractQr(result: any) { return String(result?.base64 || result?.qrcode?.base64 || '') }
function extractPair(result: any) { return String(result?.pairingCode || result?.qrcode?.pairingCode || result?.code || '') }

async function showQr() {
  busy.value = true; error.value = ''; feedback.value = ''; qrImage.value = ''
  try {
    const result = await connect.connectConnection(id, { pairing: false })
    const image = extractQr(result)
    if (!image.startsWith('data:image')) throw new Error('O QR Code ainda não ficou disponível. Tente novamente em alguns segundos.')
    qrImage.value = image
    qrOpen.value = true
    watchConnection()
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

async function showPair() {
  busy.value = true; error.value = ''; feedback.value = ''; pairCode.value = ''
  try {
    const number = (pairNumber.value || data.value?.number || '').replace(/\D/g, '')
    if (!number) { pairOpen.value = true; return }
    const result = await connect.connectConnection(id, { pairing: true, number })
    const code = extractPair(result)
    if (!code) throw new Error('O código ainda não ficou disponível. Tente novamente em alguns segundos.')
    pairCode.value = code
    pairOpen.value = true
    watchConnection()
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}

async function copyPair() {
  if (pairCode.value) await navigator.clipboard.writeText(pairCode.value)
}

function lossText(value: any) {
  if (typeof value === 'string') return value
  return String(value?.message || value?.detail || value?.key || 'Ajuste identificado')
}

async function preflightMigration() {
  migrationBusy.value = true
  migrationResult.value = null
  error.value = ''
  try {
    migrationResult.value = await connect.migrateProvider(id, migrationTarget.value, true)
    migrationOpen.value = true
  } catch (e) { error.value = friendlyError(e) }
  finally { migrationBusy.value = false }
}

async function confirmMigration() {
  migrationBusy.value = true
  error.value = ''
  try {
    const result = await connect.migrateProvider(id, migrationTarget.value, false)
    migrationResult.value = result
    await load()
    feedback.value = `Provider alterado para ${migrationTargetLabel.value} preservando a instância e suas configurações.`
    migrationOpen.value = false
  } catch (e) { error.value = friendlyError(e) }
  finally { migrationBusy.value = false }
}

onMounted(async () => { await load(); pairNumber.value = data.value?.number || '' })
onBeforeUnmount(stopWatch)
</script>

<template>
  <AppShell>
    <PageHeader :title="data?.name || data?.instanceName || 'Instância'" description="Conexão, recursos, integrações e configurações desta instância.">
      <button class="btn ghost" :disabled="busy" @click="load"><AppIcon name="refresh" :size="16"/>Atualizar</button>
      <button class="btn ghost" :disabled="busy" @click="router.push(`/instancias/${encodeURIComponent(id)}/integracoes`)">Integrações</button>
      <button class="btn ghost" :disabled="busy" @click="router.push(`/instancias/${encodeURIComponent(id)}/configuracao`)">Configurações</button>
      <button class="btn ghost" :disabled="busy" @click="restart">Reiniciar</button>
      <button class="btn danger" :disabled="busy || !connected" @click="disconnect">Desconectar</button>
    </PageHeader>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="feedback" class="alert success">{{ feedback }}</div>
    <div v-if="!data" class="skeleton-page"></div>

    <template v-else>
      <div class="provider-hero">
        <div class="provider-hero-icon"><AppIcon name="radio" :size="24"/></div>
        <div>
          <span>Provider atual</span>
          <strong>{{ providerLabel }}</strong>
          <small>Canal WhatsApp · {{ connected ? 'Conectado' : 'Aguardando conexão' }}</small>
        </div>
        <button v-if="canMigrate" class="btn ghost" :disabled="migrationBusy || busy" @click="preflightMigration">
          <AppIcon name="refresh" :size="16"/>Trocar para {{ migrationTargetLabel }}
        </button>
      </div>

      <PanelCard v-if="!connected && capabilities.qrCode" title="Conectar WhatsApp" description="Escolha como deseja vincular esta instância.">
        <div class="connect-choice-grid">
          <button class="connect-choice" :disabled="busy" @click="showQr">
            <span class="connect-choice-icon"><AppIcon name="radio" :size="24"/></span>
            <strong>QR Code</strong>
            <small>Escaneie pelo celular para conectar.</small>
          </button>
          <button v-if="capabilities.pairingCode" class="connect-choice" :disabled="busy" @click="showPair">
            <span class="connect-choice-icon"><AppIcon name="hash" :size="24"/></span>
            <strong>Código de pareamento</strong>
            <small>Use um código numérico no celular.</small>
          </button>
        </div>
      </PanelCard>

      <PanelCard v-else-if="!connected && provider==='WHATSAPP-BUSINESS'" title="WhatsApp Business / Cloud API" description="Esta conexão usa os dados da conta empresarial e não utiliza QR Code."/>

      <div class="detail-grid top-gap">
        <PanelCard title="Situação atual">
          <div class="detail-list">
            <div><span>Status</span><StatusPill :status="data.connectionStatus || data.status"/></div>
            <div><span>Provider</span><strong>{{ providerLabel }}</strong></div>
            <div><span>Nome</span><strong>{{ data.name || data.instanceName || '—' }}</strong></div>
            <div><span>Número</span><strong>{{ data.number || data.ownerJid?.split('@')?.[0] || '—' }}</strong></div>
            <div><span>Última atualização</span><strong>{{ data.updatedAt ? new Date(data.updatedAt).toLocaleString('pt-BR') : '—' }}</strong></div>
          </div>
        </PanelCard>
        <PanelCard title="Resumo">
          <div class="summary-tiles">
            <div><b>{{ data._count?.Contact || 0 }}</b><span>Contatos</span></div>
            <div><b>{{ data._count?.Chat || 0 }}</b><span>Conversas</span></div>
            <div><b>{{ data._count?.Message || 0 }}</b><span>Mensagens</span></div>
          </div>
          <button v-if="capabilities.calls" class="btn primary full top-gap" @click="router.push({path:'/chamadas', query:{instance:id}})"><AppIcon name="phone" :size="16"/>Abrir chamadas de teste</button>
        </PanelCard>
      </div>

      <PanelCard class="top-gap" title="Recursos do provider" description="Capacidades disponíveis para esta tecnologia de conexão.">
        <div class="capability-grid">
          <div v-for="item in capabilityGroups" :key="item.label" :class="['capability-item', item.enabled ? 'available' : 'unavailable']">
            <AppIcon :name="item.enabled ? 'check' : 'close'" :size="15"/><span>{{ item.label }}</span>
          </div>
        </div>
      </PanelCard>

      <div class="instance-shortcuts top-gap">
        <button class="shortcut-card" @click="router.push(`/instancias/${encodeURIComponent(id)}/integracoes`)">
          <span><AppIcon name="automation" :size="21"/></span><div><strong>Automações e IA</strong><small>n8n, Typebot, Dify, Flowise, OpenAI, ConnectAI e ConnectBot.</small></div><AppIcon name="arrow" :size="16"/>
        </button>
        <button class="shortcut-card" @click="router.push(`/instancias/${encodeURIComponent(id)}/configuracao`)">
          <span><AppIcon name="settings" :size="21"/></span><div><strong>Conexões e eventos</strong><small>Webhooks, WebSocket, RabbitMQ, NATS, SQS, Kafka, Pusher, Chatwoot e Proxy.</small></div><AppIcon name="arrow" :size="16"/>
        </button>
      </div>

      <div class="danger-zone">
        <div><strong>Excluir instância</strong><p>Esta ação remove definitivamente a instância e seus dados associados.</p></div>
        <button class="btn danger" :disabled="busy" @click="remove">Excluir instância</button>
      </div>
    </template>

    <AppModal :open="qrOpen" title="Conectar por QR Code" subtitle="Abra o WhatsApp no celular e escaneie o código." @close="qrOpen=false; stopWatch()">
      <div class="connection-auth-modal">
        <div class="qr-connect-box"><img v-if="qrImage" :src="qrImage" alt="QR Code para conexão"/></div>
        <div class="connection-help"><span class="pulse-dot"></span><strong>Aguardando conexão</strong><p>Esta janela será fechada automaticamente quando o vínculo for concluído.</p></div>
      </div>
    </AppModal>

    <AppModal :open="pairOpen" title="Código de pareamento" subtitle="Vincule a instância usando o código no seu celular." @close="pairOpen=false; stopWatch()">
      <div class="form-stack">
        <label v-if="!pairCode" class="field"><span>Número do WhatsApp</span><input v-model="pairNumber" inputmode="numeric" placeholder="5575999999999"/><small>Informe DDI, DDD e número.</small></label>
        <button v-if="!pairCode" class="btn primary full" :disabled="busy || !pairNumber.replace(/\D/g,'')" @click="showPair">Gerar código</button>
        <template v-else>
          <div class="pair-code-card"><small>Seu código</small><strong>{{ pairCode }}</strong></div>
          <button class="btn ghost full" @click="copyPair"><AppIcon name="copy" :size="16"/>Copiar código</button>
          <div class="connection-help"><span class="pulse-dot"></span><strong>Aguardando conexão</strong><p>Conclua o pareamento no celular. A tela será atualizada automaticamente.</p></div>
        </template>
      </div>
    </AppModal>

    <AppModal :open="migrationOpen" :title="`Trocar provider para ${migrationTargetLabel}`" subtitle="A sessão será validada antes da troca e o provider anterior será restaurado automaticamente se a conversão falhar." :wide="true" @close="migrationOpen=false">
      <div class="migration-review">
        <div class="migration-path"><strong>{{ providerLabel }}</strong><AppIcon name="arrow" :size="22"/><strong>{{ migrationTargetLabel }}</strong></div>
        <div class="alert success" v-if="migrationResult?.dryRun">Validação concluída. A sessão pode ser convertida sem novo pareamento.</div>
        <div v-if="migrationResult?.losses?.length" class="migration-losses">
          <strong>Ajustes identificados</strong>
          <ul><li v-for="(loss,index) in migrationResult.losses" :key="index">{{ lossText(loss) }}</li></ul>
        </div>
        <p class="muted-block">A instância, token, integrações, webhooks e configurações permanecem vinculados à mesma instância.</p>
      </div>
      <template #footer>
        <button class="btn ghost" :disabled="migrationBusy" @click="migrationOpen=false">Cancelar</button>
        <button class="btn primary" :disabled="migrationBusy || !migrationResult?.dryRun" @click="confirmMigration">{{ migrationBusy ? 'Convertendo...' : `Confirmar troca para ${migrationTargetLabel}` }}</button>
      </template>
    </AppModal>
  </AppShell>
</template>
