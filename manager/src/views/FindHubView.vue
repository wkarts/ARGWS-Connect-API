<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FindHubShell from '@/layouts/FindHubShell.vue'
import AppIcon from '@/components/AppIcon.vue'
import type { InstanceConfigKey } from '@/types/domain'
import PanelCard from '@/components/PanelCard.vue'
import PageHeader from '@/components/PageHeader.vue'
import AppModal from '@/components/AppModal.vue'
import EmptyState from '@/components/EmptyState.vue'
import InstanceToken from '@/components/InstanceToken.vue'
import FindHubBrowserAuth from '@/components/FindHubBrowserAuth.vue'
import FindHubEvents from '@/components/FindHubEvents.vue'
import FindHubMap from '@/components/FindHubMap.vue'
import FindHubPositionDetails from '@/components/FindHubPositionDetails.vue'
import { locateResultMessage, locateErrorMessage } from '@/services/findhub-position'
import FindHubLiveTracking from '@/components/FindHubLiveTracking.vue'
import FindHubTrackingModal from '@/components/FindHubTrackingModal.vue'
import FindHubDeviceAvatar from '@/components/FindHubDeviceAvatar.vue'
import FindHubTrackingSettings from '@/components/FindHubTrackingSettings.vue'
import FindHubTraccarConnection from '@/components/FindHubTraccarConnection.vue'
import { useFindHubAvatar } from '@/services/use-findhub-avatar'
import { applyFindHubUpdate } from '@/services/findhub-live-state'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import { findHubPath, isFindHub } from '@/services/findhub-channel'
const route = useRoute(), router = useRouter()
const id = computed(() => String(route.params.id))
const section = computed(() => String(route.params.section || 'conta'))
const instance = ref<any>(null), auth = ref<any>(null), devices = ref<any[]>([]), history = ref<any[]>([])
const busy = ref(false), error = ref(''), feedback = ref(''), chosen = ref(''), confirm = ref<'disconnect'|'delete'|null>(null)
const reconciliationBusy = ref(false), reconciliationResult = ref<any>(null)
function reconciliationTimestamp(value: any) { return Date.parse(value?.completedAt || value?.startedAt || '') || 0 }
const latestReconciliation = computed(() => {
  const local = reconciliationResult.value?.deviceId===chosen.value ? reconciliationResult.value : null
  const remote = snapshot.value?.devices?.find((device: any) => device.id===chosen.value)?.reconciliation || null
  return reconciliationTimestamp(remote) > reconciliationTimestamp(local) ? remote : local || remote
})
const snapshot = ref<any>(null), streamState = ref('Conectando atualizações…')
const trackingOpen = ref(false), trackingDevice = ref('')
function openDeviceMap(deviceId: string) { void router.push({ path: findHubPath(id.value, 'mapa'), query: { device: deviceId } }) }
function showTracking(deviceId = '') { trackingDevice.value = deviceId; trackingOpen.value = true }
watch(id, () => { sequence++; trackingOpen.value = false })
const from = ref(''), to = ref('')
let stream: AbortController | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
function stopStream() { stream?.abort(); stream=null; if(reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer=null }
function startStream() {
  stopStream(); const currentId = id.value, abort = new AbortController(); stream=abort
  let failures = 0
  const open = async () => {
    if(abort.signal.aborted) return
    try {
      await connect.findHubStream(currentId,abort.signal,event => {
        if(abort.signal.aborted || currentId!==id.value) return
        failures=0; streamState.value='Atualizações conectadas'
        snapshot.value=applyFindHubUpdate(snapshot.value,event,currentId)
        if(snapshot.value) { devices.value=snapshot.value.devices; if(auth.value) {auth.value.historyEnabled=snapshot.value.settings.historyEnabled; auth.value.connected=snapshot.value.connected; auth.value.ready=snapshot.value.connected} }
        if(section.value==='historico' && event.data?.location && event.data.device?.id===chosen.value && snapshot.value?.settings.historyEnabled && !from.value && !to.value) {
          const p=event.data.location
          if(!history.value.some(row => row.recordedAt===p.timestamp && row.latitude===p.latitude && row.longitude===p.longitude)) history.value=[{...p,recordedAt:p.timestamp},...history.value].slice(0,1000)
        }
      })
    } catch(e) {
      if(abort.signal.aborted) return
      streamState.value='Realtime interrompido — reconectando'
      if((e as any)?.status===401 || (e as any)?.status===403) { streamState.value='Acesso ao realtime não autorizado'; return }
      failures=Math.min(failures+1,5)
    }
    if(!abort.signal.aborted) reconnectTimer=setTimeout(() => { void open() },Math.min(60000,2000*2**failures))
  }
  void open()
}
let sequence = 0
let snapshotRefreshSequence = 0
async function reloadSnapshot() {
  const requestId = sequence
  const refreshId = ++snapshotRefreshSequence
  const currentId = id.value
  if (!currentId) return
  const incoming = await connect.findHubSnapshot(currentId)
  if (requestId !== sequence || refreshId !== snapshotRefreshSequence || currentId !== id.value) return
  snapshot.value = applyFindHubUpdate(snapshot.value, { event: 'snapshot', data: incoming }, currentId)
  devices.value = snapshot.value.devices
}

const historyAvatar = useFindHubAvatar(() => id.value, () => devices.value.find(d => d.id===chosen.value))
const historyTrail = computed(() => [...history.value].reverse().map(p => ({...p,timestamp:p.recordedAt})))
const connected = computed(() => auth.value?.connected === true && auth.value?.ready === true)
const linked = computed(() => auth.value?.linked === true)
const authRequiresRenewal = computed(() => linked.value && auth.value?.state === 'AUTH_REQUIRED')
const trackingCount = computed(() => devices.value.filter(d => d.trackingEnabled).length)
const editor = ref<any>(null)
const eventTransports = ['webhook','websocket','rabbitmq','nats','sqs','kafka','pusher'] as const
const eventTransport = computed<InstanceConfigKey>(() => eventTransports.includes(route.query.transport as any) ? route.query.transport as InstanceConfigKey : 'webhook')
const navigation = [
  { key:'dispositivos', label:'Dispositivos', icon:'channels', description:'Catálogo e localização dos dispositivos desta conta.' },
  { key:'mapa', label:'Mapa em tempo real', icon:'location', description:'Posições recebidas e acompanhamento da movimentação.' },
  { key:'configuracao', label:'Rastreamento', icon:'settings', description:'Intervalo, timeout, histórico e retenção.' },
  { key:'historico', label:'Histórico', icon:'list', description:'Consultar as posições armazenadas por período.' },
  { key:'integracoes', label:'Traccar', icon:'workflow', description:'Conexão com o serviço interno ou externo.' },
  ...eventTransports.map(transport => ({ key:'eventos', transport, label:({webhook:'Webhooks',websocket:'WebSocket',rabbitmq:'RabbitMQ',nats:'NATS',sqs:'SQS',kafka:'Kafka',pusher:'Pusher'})[transport], icon:'workflow', description:'Entrega de eventos de localização.' })),
]
const activeNavigation = computed(() => navigation.find(item => item.key === section.value && (!('transport' in item) || item.transport === eventTransport.value)))
const editableSection = computed(() => ['configuracao','integracoes','eventos'].includes(section.value))
function navigate(item: typeof navigation[number]) { void router.push({path:findHubPath(id.value,item.key),query:'transport' in item ? {transport:item.transport} : {}}) }
async function saveEditor() { if(editor.value && !editor.value.busy) await editor.value.save() }

const stamp = (value: any) => value ? new Date(value).toLocaleString('pt-BR') : 'Não disponível'
const deviceType = (value: string) => ({
  BEACON:'Beacon', HEADPHONES:'Fone de ouvido', KEYS:'Chaves', WATCH:'Relógio', WALLET:'Carteira', BAG:'Bolsa',
  LAPTOP:'Notebook/Laptop', CAR:'Veículo', REMOTE_CONTROL:'Controle remoto', BADGE:'Crachá', BIKE:'Bicicleta',
  CAMERA:'Câmera', CAT:'Gato', CHARGER:'Carregador', CLOTHING:'Vestuário', DOG:'Cachorro', NOTEBOOK:'Caderno',
  PASSPORT:'Passaporte', PHONE:'Smartphone', SPEAKER:'Caixa de som', TABLET:'Tablet', TOY:'Brinquedo',
  UMBRELLA:'Guarda-chuva', STYLUS:'Caneta/Stylus', EARBUDS:'Earbuds', TRACKER:'Rastreador',
  UNKNOWN:'Não informado',
}[value] || value)
const accessRole = (item: any) => item?.thisAccount ? 'Esta conta' : item?.isOwner ? 'Proprietário' : item?.hasAccess ? 'Com acesso' : 'Sem acesso'
async function load() {
  busy.value = true; error.value = ''
  try {
    const currentId = id.value
    const data = await connect.connection(currentId)
    if (!isFindHub(data)) { await router.replace('/findhub'); return }
    const [status, list] = await Promise.all([connect.findHubAuthStatus(currentId), connect.findHubDevices(currentId)])
    if (currentId !== id.value) return
    instance.value = data; auth.value = status; devices.value = list
    if (!list.some(d => d.id === chosen.value)) chosen.value = list[0]?.id || ''
    await reloadSnapshot()
    await loadSelected()
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}
async function loadSelected() {
  history.value = []
  const currentId=id.value, deviceId=chosen.value, currentSection=section.value
  if (reconciliationResult.value?.deviceId && reconciliationResult.value.deviceId !== deviceId) reconciliationResult.value = null
  if (!deviceId) return
  try {
    if (currentSection === 'historico') {
      const rows = await connect.findHubPositions(currentId,deviceId,1000,from.value ? new Date(from.value).toISOString() : undefined,to.value ? new Date(to.value).toISOString() : undefined)
      if(currentId===id.value && deviceId===chosen.value && currentSection===section.value) {
        history.value=rows
        if (!reconciliationResult.value) reconciliationResult.value=snapshot.value?.devices?.find((device: any) => device.id===deviceId)?.reconciliation || null
      }
    }

  } catch (e) { error.value = friendlyError(e) }
}
async function refreshDevices() {
  busy.value = true; error.value = ''
  try { devices.value = await connect.findHubRefreshDevices(id.value) }
  catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}
async function captureCatalog(catalog: 'spot'|'android'|'auto'|'fastpair'|'supervised') {
  if (busy.value) return
  busy.value = true; error.value = ''; feedback.value = ''
  try {
    await connect.findHubCaptureCatalog(id.value, catalog)
    feedback.value = `Catálogo ${catalog.toUpperCase()} capturado em protobuf bruto (.pb).`
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}
async function captureDeviceUpdate(device: any) {
  if (device.captureBusy) return
  device.captureBusy = true; error.value = ''; feedback.value = ''
  try {
    const timeoutMs = Number(device.locationTimeoutMs ?? snapshot.value?.settings?.timeoutMs ?? 120000)
    await connect.findHubCaptureDeviceUpdate(id.value, device.id, timeoutMs)
    feedback.value = `DeviceUpdate bruto capturado para ${device.name}.`
  } catch (e) { error.value = friendlyError(e) }
  finally { device.captureBusy = false }
}
async function reconnectStoredAccount() {
  if (busy.value) return
  busy.value = true; error.value = ''; feedback.value = ''
  try {
    const result = await connect.connectConnection(id.value)
    if (result?.error) {
      const message = friendlyError(new Error(String(result.message || 'Não foi possível reconectar a conta Google Find Hub.')))
      await load()
      error.value = message
      return
    }
    await load()
    feedback.value = connected.value
      ? 'Conta reconectada usando as credenciais já armazenadas.'
      : 'As credenciais continuam preservadas, mas a conexão com o Google ainda não foi restabelecida.'
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}
function reconciliationFeedback(result: any) {
  const provider = Number(result?.providerReportsDecoded || 0)
  const valid = Number(result?.validProviderReports || 0)
  const imported = Number(result?.importedReports || 0)
  const recovered = Number(result?.recoveredPositions || 0)
  const stored = Number(result?.alreadyStoredReports || 0)
  const outside = Number(result?.reportsOutsideTargetRange || 0)

  switch (result?.status) {
    case 'recovered':
      return `Reconciliação concluída: ${recovered} posição(ões) nova(s) recuperada(s) dentro do período; ${provider} relatório(s) recebido(s) do Google e ${imported} importado(s) no total.`
    case 'imported_outside_target':
      return `O Google devolveu ${provider} relatório(s) e ${imported} foi(foram) importado(s), mas nenhum novo ponto pertence ao período selecionado. ${outside} relatório(s) válido(s) ficou(ficaram) fora da faixa.`
    case 'duplicates_only':
      return `O Google devolveu ${provider} relatório(s); ${valid} virou(viraram) posição(ões) válida(s), porém ${stored} já existia(m) no histórico. Nenhuma duplicidade foi criada.`
    case 'provider_reports_unusable':
      return `O Google devolveu ${provider} relatório(s), mas nenhum pôde ser convertido em uma posição válida. Consulte os detalhes de decodificação abaixo.`
    case 'retention_filtered':
      return `O Google devolveu posições válidas, mas os relatórios novos estavam fora da retenção configurada do histórico.`
    case 'no_provider_reports':
      return 'A reconciliação foi executada, mas o Google não devolveu nenhum relatório de localização correlacionado nas tentativas realizadas.'
    default:
      return `Reconciliação concluída sem novas posições no período. O Google devolveu ${provider} relatório(s), dos quais ${valid} foi(foram) válido(s).`
  }
}
async function reconcileHistory() {
  if (!chosen.value || reconciliationBusy.value) return
  reconciliationBusy.value = true; reconciliationResult.value = null; error.value = ''; feedback.value = ''
  try {
    const data = {
      from: from.value ? new Date(from.value).toISOString() : undefined,
      to: to.value ? new Date(to.value).toISOString() : undefined,
      attempts: snapshot.value?.settings?.reconciliationAttempts,
      timeoutMs: snapshot.value?.settings?.timeoutMs,
    }
    reconciliationResult.value = await connect.findHubReconcile(id.value, chosen.value, data)
    await loadSelected()
    await reloadSnapshot()
    feedback.value = reconciliationFeedback(reconciliationResult.value)
  } catch (e) { error.value = friendlyError(e) }
  finally { reconciliationBusy.value = false }
}
async function locate(device: any) {
  if (device.locating) return
  const currentId = id.value, deviceId = device.id, previous = device.latestPosition
  const timeoutMs = device.locationTimeoutMs ?? snapshot.value?.settings?.timeoutMs
  device.locating = true; error.value = ''; feedback.value = ''
  try {
    const position = await connect.findHubLocate(currentId, deviceId, timeoutMs)
    if (currentId !== id.value) return
    feedback.value = locateResultMessage(position, previous)
    await reloadSnapshot()
  } catch (e) { if (currentId === id.value) error.value = friendlyError(new Error(locateErrorMessage(e, timeoutMs))) }
  finally { device.locating = false }
}
async function tracking(device: any) {
  device.saving = true; error.value = ''
  try {
    if (device.trackingEnabled) await connect.findHubStopTracking(id.value,device.id)
    else await connect.findHubStartTracking(id.value,device.id,Number(device.trackingIntervalSeconds ?? 60))
    await load()
  } catch (e) { error.value = friendlyError(e) }
  finally { device.saving = false }
}
async function sound(device: any, operation: 'start'|'stop') {
  if (device.soundBusy) return
  device.soundBusy = true; error.value = ''; feedback.value = ''
  try {
    await connect.findHubSound(id.value, device.id, operation, device.soundComponent || 'UNSPECIFIED')
    feedback.value = operation === 'start'
      ? `Comando para tocar som enviado ao Google para ${device.name}.`
      : `Comando para parar o som enviado ao Google para ${device.name}.`
  } catch (e) { error.value = friendlyError(e) }
  finally { device.soundBusy = false }
}
async function accountAction() {
  busy.value = true; error.value = ''
  try {
    if (confirm.value === 'delete') { await connect.removeConnection(id.value); await router.replace('/findhub') }
    else { await connect.findHubDisconnect(id.value); confirm.value = null; await load() }
    confirm.value = null
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}
watch(id, () => { instance.value=null; snapshot.value=null; chosen.value=''; reconciliationResult.value=null; error.value=''; feedback.value=''; void load() })
watch(section, () => { error.value=''; feedback.value=''; void loadSelected() })
watch(id, startStream)
onMounted(() => { void load(); startStream() })
onBeforeUnmount(() => { sequence++; stopStream() })
</script>
<template>
  <FindHubShell>
    <PageHeader :title="section==='conta' ? instance?.name || 'Google Find Hub' : editableSection ? 'Configurações da instância' : activeNavigation?.label || 'Google Find Hub'" :description="section==='conta' ? 'Conexão, dispositivos, integrações e configurações desta instância.' : `${instance?.name || 'Google Find Hub'} · Google Find Hub`">
      <template v-if="section==='conta'">
        <button class="btn primary" :disabled="!connected" @click="showTracking()"><AppIcon name="location" :size="16"/>Rastrear em tempo real</button>
        <button class="btn ghost" :disabled="busy" @click="load"><AppIcon name="refresh" :size="16"/>Atualizar</button>
        <button class="btn ghost" @click="router.push(findHubPath(id,'dispositivos'))">Dispositivos</button>
        <button class="btn ghost" @click="router.push(findHubPath(id,'integracoes'))">Integrações</button>
        <button class="btn ghost" @click="router.push(findHubPath(id,'configuracao'))">Configurações</button>
        <button class="btn ghost" :disabled="busy" @click="confirm='disconnect'">Desvincular Google</button>
      </template>
      <template v-else>
        <button class="btn ghost" @click="router.push(findHubPath(id,'conta'))">Voltar</button>
        <button v-if="editableSection" class="btn primary" :disabled="!editor?.ready || editor?.busy || busy" @click="saveEditor"><AppIcon name="check" :size="16"/>{{ editor?.busy ? 'Salvando…' : 'Salvar' }}</button>
        <button v-else class="btn ghost" :disabled="busy" @click="load"><AppIcon name="refresh" :size="16"/>Atualizar</button>
      </template>
    </PageHeader>
    <div :class="{'config-layout':section!=='conta'}">
      <aside v-if="section!=='conta'" class="config-nav" aria-label="Recursos da instância Google Find Hub">
        <button v-for="item in navigation" :key="item.key+('transport' in item ? item.transport : '')" :class="['config-nav-item',{active:activeNavigation===item}]" :aria-current="activeNavigation===item ? 'page' : undefined" @click="navigate(item)">
          <span><AppIcon :name="item.icon" :size="17"/></span><div><strong>{{ item.label }}</strong><small>{{ item.description }}</small></div>
        </button>
      </aside>
      <section class="config-workspace">
    <div v-if="error" class="alert error" role="alert">{{ error }}</div><div v-if="feedback" class="alert" role="status">{{ feedback }}</div>
    <div v-if="!instance" class="cards-skeleton"></div>
    <template v-else>
      <template v-if="section==='conta'">
        <section class="provider-hero"><div class="provider-hero-icon"><AppIcon name="location" :size="22"/></div><div><small>Provider atual</small><strong>Google Find Hub</strong><p>Canal de localização · {{ connected ? 'Conectado' : 'Aguardando conexão' }}</p></div></section>
        <div class="detail-grid">
          <PanelCard title="Conta e conexão"><div class="detail-list"><div><span>Conta Google</span><strong>{{ auth?.email || 'Ainda não vinculada' }}</strong></div><div><span>Conexão validada</span><strong>{{ connected ? 'Conectada' : auth?.pending ? 'Vinculação em andamento' : 'Desconectada' }}</strong></div><div><span>Histórico de posições</span><strong>{{ auth?.historyEnabled ? 'Habilitado para a conta' : 'Desabilitado' }}</strong></div></div><InstanceToken :instance-id="id" :instance-name="instance.name || id" /></PanelCard>
          <PanelCard title="Dispositivos desta conta"><div class="summary-tiles"><div><b>{{ devices.length }}</b><span>Dispositivos cadastrados</span></div><div><b>{{ trackingCount }}</b><span>Rastreamentos habilitados</span></div></div><p class="muted">A disponibilidade de posições depende do aparelho, da rede e do Google. A hora do relatório indica a idade da localização.</p><div v-for="device in devices" :key="device.id" class="top-gap"><strong>{{ device.name }}</strong><FindHubPositionDetails :device="device" :stale-after-seconds="snapshot?.settings?.staleAfterSeconds" compact /></div></PanelCard>
        </div>
        <PanelCard v-if="!connected && linked && !authRequiresRenewal" class="top-gap" title="Conta vinculada · conexão interrompida" description="As credenciais Google continuam armazenadas. Uma falha de rede, reinicialização ou indisponibilidade temporária não exige nova vinculação.">
          <div class="detail-list"><div><span>Conta Google</span><strong>{{ auth?.email || 'Conta vinculada' }}</strong></div><div><span>Estado da autenticação</span><strong>{{ auth?.state || 'Não informado' }}</strong></div></div>
          <div class="toolbar top-gap"><button class="btn primary" :disabled="busy" @click="reconnectStoredAccount">{{ busy ? 'Reconectando…' : 'Reconectar com credenciais salvas' }}</button></div>
          <p class="muted">Use “Desvincular conta Google” somente quando quiser remover definitivamente as credenciais e os dados associados.</p>
        </PanelCard>
        <template v-else-if="!connected && authRequiresRenewal">
          <PanelCard class="top-gap" title="Autenticação Google precisa ser renovada" description="O Google recusou as credenciais armazenadas. A instância, os dispositivos, o histórico, o rastreamento e os vínculos existentes serão preservados.">
            <div class="detail-list"><div><span>Conta Google</span><strong>{{ auth?.email || 'Conta vinculada' }}</strong></div><div><span>Estado da autenticação</span><strong>Renovação necessária</strong></div></div>
            <p class="muted top-gap">Renove a autenticação abaixo usando a mesma conta Google. Não é necessário desvincular nem excluir a instância.</p>
          </PanelCard>
          <FindHubBrowserAuth :key="id+'-renewal'" class="top-gap" :instance-id="id" :initial-email="auth?.email" renewal @connected="load" />
        </template>
        <FindHubBrowserAuth v-else-if="!connected" :key="id" class="top-gap" :instance-id="id" :initial-email="auth?.email" @connected="load" />
        <div v-else class="instance-shortcuts top-gap">
          <button class="shortcut-card" @click="router.push(findHubPath(id,'dispositivos'))"><span><AppIcon name="channels" :size="22"/></span><div><strong>Dispositivos e localização</strong><small>Catálogo, mapa em tempo real e histórico.</small></div><AppIcon name="arrow" :size="18"/></button>
          <button class="shortcut-card" @click="router.push(findHubPath(id,'integracoes'))"><span><AppIcon name="workflow" :size="22"/></span><div><strong>Conexões e eventos</strong><small>Traccar, Webhooks, WebSocket e filas de eventos.</small></div><AppIcon name="arrow" :size="18"/></button>
        </div>
        <div class="danger-zone"><div><strong>Conta Google e dados locais</strong><p>Desvincular remove somente as credenciais Google e encerra a conexão. Dispositivos, histórico, rastreamento, configurações e vínculos locais permanecem preservados para reconexão. Somente “Excluir instância” remove definitivamente os dados locais.</p></div><div class="toolbar"><button class="btn ghost" :disabled="busy" @click="confirm='disconnect'">Desvincular conta Google</button><button class="btn danger" :disabled="busy" @click="confirm='delete'">Excluir instância</button></div></div>
      </template>
      <PanelCard v-else-if="section==='dispositivos'" title="Dispositivos" description="Somente dispositivos retornados pela conta Google vinculada.">
        <div class="toolbar"><button class="btn primary" :disabled="busy || !connected" @click="refreshDevices">Sincronizar dispositivos</button><button class="btn ghost" :disabled="busy || !connected" @click="captureCatalog('spot')">Capturar SPOT .pb</button><button class="btn ghost" :disabled="busy || !connected" @click="captureCatalog('android')">Capturar Android .pb</button><span class="muted">{{ connected ? 'Conexão validada' : 'Vincule a conta para obter novas posições' }}</span></div>
        <EmptyState v-if="!devices.length" icon="location" title="Nenhum dispositivo sincronizado" description="Conecte a conta Google e sincronize o catálogo." />
        <p class="muted">O catálogo combina os tipos disponibilizados pelo protocolo Google. Dispositivos compartilhados, Family Link e acessórios podem não estar acessíveis com as mesmas permissões; nenhum dispositivo é inventado a partir do e-mail.</p>
        <div class="alert top-gap">As capturas reais de 2026 revelaram um layout mais novo que o protobuf original: modelo, fabricante, codinome, operadora, IMEI, versão do Google Play Services, SDK Android e Family Link já são decodificados quando o Google os fornece. Bateria, MEID e número de série continuam sem mapeamento confirmado; use o DeviceUpdate .pb para avançar essa análise.</div><details class="device-metadata top-gap"><summary>Capturas avançadas de catálogo</summary><div class="toolbar top-gap"><button class="btn ghost" :disabled="busy || !connected" @click="captureCatalog('auto')">Capturar AUTO .pb</button><button class="btn ghost" :disabled="busy || !connected" @click="captureCatalog('fastpair')">Capturar FASTPAIR .pb</button><button class="btn ghost" :disabled="busy || !connected" @click="captureCatalog('supervised')">Capturar SUPERVISED .pb</button></div><p class="muted">Esses DeviceType existem no protobuf de referência. A disponibilidade depende da conta e do provider Google; falha em um catálogo complementar não altera o catálogo SPOT.</p></details>
        <div class="instance-grid top-gap"><article v-for="device in devices" :key="device.id" class="instance-card"><FindHubDeviceAvatar :instance-id="id" :device="device" @changed="reloadSnapshot" /><h3>{{ device.name }}</h3><p>{{ deviceType(device.deviceType) }} · {{ [device.manufacturer,device.model].filter(Boolean).join(' ') }}<span v-if="device.familyLinkManaged"> · Family Link</span></p>
          <div class="detail-list">
            <div><span>ID interno Connect|API</span><strong>{{ device.id }}</strong></div>
            <div><span>Google Device ID</span><strong>{{ device.googleDeviceId || 'Não informado' }}</strong></div>
            <div><span>Tipo do identificador</span><strong>{{ device.identifierType || 'Não informado' }}</strong></div>
            <div><span>IMEI</span><strong>{{ device.imei || 'Não fornecido pelo Google para este dispositivo' }}</strong></div>
            <div><span>Operadora</span><strong>{{ device.carrier || 'Não informado' }}</strong></div>
            <div><span>Codinome</span><strong>{{ device.deviceCodename || 'Não informado' }}</strong></div>
            <div><span>Produto</span><strong>{{ device.productName || 'Não informado' }}</strong></div>
            <div><span>Android SDK</span><strong>{{ device.androidSdkVersion ?? 'Não informado' }}</strong></div>
            <div><span>Google Play Services</span><strong>{{ device.gmsCoreVersionCode ?? 'Não informado' }}</strong></div>
            <div><span>Primeiro registro no provider</span><strong>{{ stamp(device.providerRegisteredAt) }}</strong></div>
            <div><span>Último status do provider</span><strong>{{ stamp(device.providerStatusAt) }}</strong></div>
            <div><span>Resposta do catálogo</span><strong>{{ stamp(device.providerResponseAt) }}</strong></div>
            <div v-if="device.familyLinkManaged"><span>Family Link</span><strong>{{ device.familyLinkMemberName || 'Dispositivo supervisionado' }}</strong></div>
            <div><span>Fast Pair Model ID</span><strong>{{ device.fastPairModelId || 'Não informado' }}</strong></div>
            <div><span>Pareado em</span><strong>{{ stamp(device.pairedAt) }}</strong></div>
            <div><span>Owner key version</span><strong>{{ device.ownerKeyVersion ?? 'Não informado' }}</strong></div>
            <div><span>Mínimo para agregação de rede</span><strong>{{ device.networkAggregationMinReports ?? 'Não informado' }}</strong></div>
            <div><span>Último relatório de posição</span><strong>{{ stamp(device.lastLocationAt) }}</strong></div>
            <div><span>Rastreamento</span><strong>{{ device.trackingEnabled ? 'Habilitado' : 'Desabilitado' }}</strong></div>
          </div>
          <details class="device-metadata top-gap">
            <summary>Identificadores e metadados completos</summary>
            <div class="detail-list top-gap">
              <div><span>IDs canônicos</span><strong>{{ device.canonicalIds?.length ? device.canonicalIds.join(' · ') : 'Não fornecido' }}</strong></div>
              <div><span>ID numérico Android</span><strong>{{ device.androidDeviceNumericId || 'Não informado' }}</strong></div>
              <div><span>ID opaco do metadata</span><strong>{{ device.providerOpaqueId || 'Não informado' }}</strong></div>
              <div><span>Fabricante</span><strong>{{ device.manufacturer || 'Não informado' }}</strong></div>
              <div><span>Modelo</span><strong>{{ device.model || 'Não informado' }}</strong></div>
              <div><span>Fingerprint identity key</span><strong>{{ device.identityKeyFingerprint || 'Não informado' }}</strong></div>
              <div><span>Fingerprint account key</span><strong>{{ device.accountKeyFingerprint || 'Não informado' }}</strong></div>
              <div><span>Fingerprint public address</span><strong>{{ device.publicAddressFingerprint || 'Não informado' }}</strong></div>
              <div><span>Segredos criados em</span><strong>{{ stamp(device.secretsCreatedAt) }}</strong></div>
            </div>
            <div v-if="device.accessInformation?.length" class="findhub-table top-gap"><table><thead><tr><th>Conta com acesso</th><th>Papel</th><th>Acesso</th></tr></thead><tbody><tr v-for="(access,index) in device.accessInformation" :key="access.email || index"><td>{{ access.email || 'Não informado' }}</td><td>{{ accessRole(access) }}</td><td>{{ access.hasAccess ? 'Permitido' : 'Não permitido' }}</td></tr></tbody></table></div>
            <p v-if="device.familyLinkManaged" class="muted top-gap">O Google devolveu este aparelho como dispositivo supervisionado do Family Link. Metadados podem ser reduzidos por privacidade e algumas ações ainda não possuem wire mapeado.</p>
          </details>
          <details class="device-metadata top-gap" open>
            <summary>Frescor real do provider Google</summary>
            <div class="detail-list top-gap">
              <div><span>Solicitações enviadas</span><strong>{{ device.providerRequestCount ?? 0 }}</strong></div>
              <div><span>Relatórios recebidos</span><strong>{{ device.providerReportCount ?? 0 }}</strong></div>
              <div><span>Relatórios repetidos/sem posição nova</span><strong>{{ device.providerRepeatedReportCount ?? 0 }}</strong></div>
              <div><span>Última solicitação enviada</span><strong>{{ stamp(device.lastProviderRequestAt) }}</strong></div>
              <div><span>Timestamp do último relatório Google</span><strong>{{ stamp(device.lastProviderReportAt) }}</strong></div>
              <div><span>Recebido pela Connect|API</span><strong>{{ stamp(device.lastReceivedAt) }}</strong></div>
            </div>
            <p class="muted">Esses tempos distinguem a frequência das solicitações da frequência em que o Google realmente fornece uma observação nova.</p>
          </details>
          <label class="field top-gap"><span>Intervalo entre consultas (segundos)</span><input v-model.number="device.trackingIntervalSeconds" type="number" min="0" step="1" max="86400" :disabled="device.trackingEnabled" /></label>
          <FindHubPositionDetails :device="device" :stale-after-seconds="snapshot?.settings?.staleAfterSeconds"/>
          <div v-if="device.identifierType==='SPOT'" class="field-grid two top-gap">
            <label class="field"><span>Componente do som</span><select v-model="device.soundComponent" class="select" :disabled="device.soundBusy"><option value="UNSPECIFIED">Dispositivo</option><option value="RIGHT">Direito</option><option value="LEFT">Esquerdo</option><option value="CASE">Estojo/Case</option></select></label>
            <div class="toolbar sound-actions"><button class="btn ghost" :disabled="!connected || device.soundBusy" @click="sound(device,'start')">Tocar som</button><button class="btn ghost" :disabled="!connected || device.soundBusy" @click="sound(device,'stop')">Parar som</button></div>
          </div>
          <footer class="device-actions"><button class="btn ghost" type="button" @click="openDeviceMap(device.id)">Acompanhar no mapa</button><button class="btn ghost" :disabled="!connected || device.captureBusy || device.locateSupported===false" @click="captureDeviceUpdate(device)">{{ device.captureBusy ? 'Capturando .pb…' : 'Capturar DeviceUpdate .pb' }}</button><button class="btn ghost" :disabled="!connected || device.locating || device.locateSupported===false" @click="locate(device)">{{ device.locating ? 'Localizando…' : device.locateSupported===false ? 'Localização ainda não mapeada' : 'Localizar agora' }}</button><button class="btn primary" :disabled="device.saving || device.locateSupported===false || (!connected && !device.trackingEnabled)" @click="tracking(device)">{{ device.trackingEnabled ? 'Parar rastreamento' : 'Iniciar rastreamento' }}</button></footer></article></div>
      </PanelCard>
      <FindHubLiveTracking v-else-if="section==='mapa' && snapshot" :key="id" :instance-id="id" :snapshot="snapshot" :stream-state="streamState" :initial-device="String(route.query.device || '')" @refresh="reloadSnapshot" />
      <FindHubTrackingSettings ref="editor" header-actions v-else-if="section==='configuracao'" :key="id" :instance-id="id" @saved="load" />
      <PanelCard v-else-if="section==='historico'" title="Histórico de localização" description="Posições persistidas desta conta, com horário do relatório e retenção configurável.">
        <p v-if="!auth?.historyEnabled" class="alert">Armazenamento desabilitado para esta conta. <RouterLink :to="findHubPath(id,'configuracao')">Configurar histórico e retenção</RouterLink>. Posições já existentes permanecem consultáveis até vencerem a retenção.</p>
        <div class="form-stack"><label class="field"><span>Dispositivo</span><select v-model="chosen" class="select" @change="loadSelected"><option v-for="d in devices" :key="d.id" :value="d.id">{{d.name}}</option></select></label><div class="field-grid two"><label class="field"><span>Início</span><input v-model="from" type="datetime-local" /></label><label class="field"><span>Fim</span><input v-model="to" type="datetime-local" /></label></div><div class="toolbar"><button class="btn ghost" @click="loadSelected">Filtrar</button><button class="btn primary" :disabled="!connected || !chosen || reconciliationBusy || !auth?.historyEnabled" @click="reconcileHistory"><AppIcon name="refresh" :size="16"/>{{ reconciliationBusy ? 'Reconciliando…' : 'Tentar recuperar lacuna' }}</button></div><p class="muted">A reconciliação consulta novamente o Google Find Hub e salva relatórios RECENT/NETWORK antigos que ainda forem devolvidos. O Google não garante histórico completo do período.</p><div v-if="latestReconciliation" class="alert reconciliation-result"><strong>Última reconciliação:</strong> {{ latestReconciliation.attemptsCompleted }} tentativa(s) · {{ latestReconciliation.trigger==='boot' ? 'automática no boot' : latestReconciliation.trigger==='periodic' ? 'automática periódica' : 'manual' }}. Período {{ stamp(latestReconciliation.from) }} → {{ stamp(latestReconciliation.to) }}.<div class="reconciliation-metrics"><span><b>{{ latestReconciliation.providerReportsDecoded ?? latestReconciliation.providerReportsObserved ?? 0 }}</b> reports Google</span><span><b>{{ latestReconciliation.validProviderReports ?? 0 }}</b> posições válidas</span><span><b>{{ latestReconciliation.importedReports ?? 0 }}</b> importadas</span><span><b>{{ latestReconciliation.alreadyStoredReports ?? 0 }}</b> já existentes</span><span><b>{{ latestReconciliation.recoveredPositions ?? 0 }}</b> novas na lacuna</span><span><b>{{ latestReconciliation.reportsOutsideTargetRange ?? 0 }}</b> fora da faixa</span></div><p class="muted top-gap">{{ reconciliationFeedback(latestReconciliation) }}</p><details v-if="latestReconciliation.attempts?.length" class="reconciliation-details"><summary>Detalhes técnicos das tentativas</summary><div class="findhub-table"><table><thead><tr><th>Tentativa</th><th>FCM</th><th>Reports</th><th>Criptografados</th><th>Decriptados</th><th>Válidos</th><th>Importados</th><th>Já existentes</th><th>Falhas decode</th></tr></thead><tbody><tr v-for="item in latestReconciliation.attempts" :key="item.attempt"><td>{{ item.attempt }}</td><td>{{ item.fcmPayloadsReceived }}</td><td>{{ item.providerReportsDecoded }}</td><td>{{ item.reportsWithEncryptedLocation }}</td><td>{{ item.decryptedReports }}</td><td>{{ item.validReports }}</td><td>{{ item.importedReports }}</td><td>{{ item.alreadyStoredReports }}</td><td>{{ (item.metadataDecodeFailures || 0) + (item.decryptRejectedReports || 0) + (item.decryptErrors || 0) + (item.invalidReports || 0) }}</td></tr></tbody></table></div></details></div></div>
        <EmptyState v-if="!history.length" icon="location" title="Nenhuma posição no período" description="Ative o histórico e o rastreamento para armazenar novos relatórios. Você também pode tentar reconciliar uma lacuna recente com o Google Find Hub." />
        <div v-else class="findhub-table"><FindHubMap :key="chosen" :position="historyTrail[historyTrail.length-1]" :trail="historyTrail" :tile-url="snapshot?.map?.tileUrl" :avatar-data="historyAvatar" :device-name="devices.find(d => d.id===chosen)?.name"/><table><thead><tr><th>Relatório</th><th>Latitude</th><th>Longitude</th><th>Precisão</th><th>Origem</th></tr></thead><tbody><tr v-for="(p,index) in history" :key="p.id || index"><td>{{stamp(p.recordedAt)}}</td><td>{{p.latitude}}</td><td>{{p.longitude}}</td><td>{{p.accuracy ?? '—'}} m</td><td>{{p.source}}</td></tr></tbody></table><p class="muted">Até 1.000 posições mais recentes do período. Use intervalos menores para consultar o restante.</p></div>
      </PanelCard>
      <FindHubTraccarConnection ref="editor" header-actions v-else-if="section==='integracoes'" :key="id" :instance-id="id" :devices="devices" />
      <FindHubEvents ref="editor" header-actions :transport="eventTransport" v-else-if="section==='eventos'" :key="id+eventTransport" :instance-id="id" />
    </template>
      </section>
    </div>
    <FindHubTrackingModal :open="trackingOpen" :instance-id="id" :initial-device="trackingDevice" @close="trackingOpen=false" />
    <AppModal :open="confirm!==null" :title="confirm==='delete' ? 'Excluir instância Google Find Hub' : 'Desvincular conta Google'" :subtitle="confirm==='delete' ? 'Esta é a única operação que remove definitivamente os dados locais.' : 'Somente as credenciais Google serão removidas; os dados locais serão preservados.'" @close="confirm=null"><p v-if="confirm==='delete'">A exclusão remove definitivamente credenciais, catálogo de dispositivos, histórico de posições, rastreamento, avatares e vínculos locais desta instância. Nenhum dispositivo físico será apagado no Google. Use o backup da stack se precisar de possibilidade de recuperação.</p><p v-else>Desvincular encerra a conexão e remove somente as credenciais Google. A instância, os dispositivos, o histórico, o rastreamento, as configurações e os vínculos Traccar permanecem armazenados para que a mesma conta possa ser conectada novamente.</p><template #footer><button class="btn ghost" :disabled="busy" @click="confirm=null">Cancelar</button><button :class="['btn',confirm==='delete' ? 'danger' : 'primary']" :disabled="busy" @click="accountAction">{{ confirm==='delete' ? 'Excluir definitivamente' : 'Desvincular preservando dados' }}</button></template></AppModal>
  </FindHubShell>
</template>
<style scoped>
.findhub-table{overflow:auto;margin-top:20px}.device-metadata summary{cursor:pointer;font-weight:600}.device-metadata strong{overflow-wrap:anywhere}.sound-actions{align-self:end;margin-bottom:2px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid var(--border)}.instance-card h3{margin:0}.instance-card footer{margin-top:20px}.device-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.device-actions .btn{flex:1 0 auto;min-height:36px;margin:0;white-space:nowrap;justify-content:center}.reconciliation-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:12px}.reconciliation-metrics span{display:flex;flex-direction:column;gap:2px}.reconciliation-details{margin-top:12px}.reconciliation-details summary{cursor:pointer;font-weight:600}
</style>
