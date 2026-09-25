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
const deviceType = (value: string) => ({ PHONE:'Smartphone', TABLET:'Tablet', WATCH:'Relógio', HEADPHONES:'Fone', EARBUDS:'Fone', TRACKER:'Rastreador', UNKNOWN:'Não informado' }[value] || value)
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
  if (!deviceId) return
  try {
    if (currentSection === 'historico') {
      const rows = await connect.findHubPositions(currentId,deviceId,1000,from.value ? new Date(from.value).toISOString() : undefined,to.value ? new Date(to.value).toISOString() : undefined)
      if(currentId===id.value && deviceId===chosen.value && currentSection===section.value) history.value=rows
    }

  } catch (e) { error.value = friendlyError(e) }
}
async function refreshDevices() {
  busy.value = true; error.value = ''
  try { devices.value = await connect.findHubRefreshDevices(id.value) }
  catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
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
    const count = Number(reconciliationResult.value?.recoveredPositions || 0)
    feedback.value = count
      ? `Reconciliação concluída: ${count} posição(ões) adicional(is) recuperada(s) do Google.`
      : 'Reconciliação concluída. O Google não devolveu posições adicionais para este intervalo.'
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
async function accountAction() {
  busy.value = true; error.value = ''
  try {
    if (confirm.value === 'delete') { await connect.removeConnection(id.value); await router.replace('/findhub') }
    else { await connect.findHubDisconnect(id.value); confirm.value = null; await load() }
    confirm.value = null
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}
watch(id, () => { instance.value=null; snapshot.value=null; chosen.value=''; error.value=''; feedback.value=''; void load() })
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
        <button class="btn danger" :disabled="busy" @click="confirm='disconnect'">Desconectar</button>
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
        <FindHubBrowserAuth v-if="!connected" :key="id" class="top-gap" :instance-id="id" :initial-email="auth?.email" @connected="load" />
        <div v-else class="instance-shortcuts top-gap">
          <button class="shortcut-card" @click="router.push(findHubPath(id,'dispositivos'))"><span><AppIcon name="channels" :size="22"/></span><div><strong>Dispositivos e localização</strong><small>Catálogo, mapa em tempo real e histórico.</small></div><AppIcon name="arrow" :size="18"/></button>
          <button class="shortcut-card" @click="router.push(findHubPath(id,'integracoes'))"><span><AppIcon name="workflow" :size="22"/></span><div><strong>Conexões e eventos</strong><small>Traccar, Webhooks, WebSocket e filas de eventos.</small></div><AppIcon name="arrow" :size="18"/></button>
        </div>
        <div class="danger-zone"><div><strong>Desvincular ou excluir esta conta</strong><p>Desvincular remove credenciais Google, catálogo local, vínculos e histórico associados. Não remove a conta nem apaga o smartphone no Google.</p></div><div class="toolbar"><button class="btn ghost" :disabled="busy" @click="confirm='disconnect'">Desvincular conta Google</button><button class="btn danger" :disabled="busy" @click="confirm='delete'">Excluir instância</button></div></div>
      </template>
      <PanelCard v-else-if="section==='dispositivos'" title="Dispositivos" description="Somente dispositivos retornados pela conta Google vinculada.">
        <div class="toolbar"><button class="btn primary" :disabled="busy || !connected" @click="refreshDevices">Sincronizar dispositivos</button><span class="muted">{{ connected ? 'Conexão validada' : 'Vincule a conta para obter novas posições' }}</span></div>
        <EmptyState v-if="!devices.length" icon="location" title="Nenhum dispositivo sincronizado" description="Conecte a conta Google e sincronize o catálogo." />
        <p class="muted">O catálogo combina os tipos disponibilizados pelo protocolo Google. Dispositivos compartilhados, Family Link e acessórios podem não estar acessíveis com as mesmas permissões; nenhum dispositivo é inventado a partir do e-mail.</p><div class="instance-grid top-gap"><article v-for="device in devices" :key="device.id" class="instance-card"><FindHubDeviceAvatar :instance-id="id" :device="device" @changed="reloadSnapshot" /><h3>{{ device.name }}</h3><p>{{ deviceType(device.deviceType) }} · {{ [device.manufacturer,device.model].filter(Boolean).join(' ') }}</p><div class="detail-list"><div><span>Último relatório</span><strong>{{ stamp(device.lastLocationAt) }}</strong></div><div><span>Rastreamento</span><strong>{{ device.trackingEnabled ? 'Habilitado' : 'Desabilitado' }}</strong></div></div><label class="field top-gap"><span>Intervalo entre consultas (segundos)</span><input v-model.number="device.trackingIntervalSeconds" type="number" min="0" step="1" max="86400" :disabled="device.trackingEnabled" /></label><FindHubPositionDetails :device="device" :stale-after-seconds="snapshot?.settings?.staleAfterSeconds"/><footer class="device-actions"><button class="btn ghost" type="button" @click="openDeviceMap(device.id)">Acompanhar no mapa</button><button class="btn ghost" :disabled="!connected || device.locating" @click="locate(device)">{{ device.locating ? 'Localizando…' : 'Localizar agora' }}</button><button class="btn primary" :disabled="device.saving || (!connected && !device.trackingEnabled)" @click="tracking(device)">{{ device.trackingEnabled ? 'Parar rastreamento' : 'Iniciar rastreamento' }}</button></footer></article></div>
      </PanelCard>
      <FindHubLiveTracking v-else-if="section==='mapa' && snapshot" :key="id" :instance-id="id" :snapshot="snapshot" :stream-state="streamState" :initial-device="String(route.query.device || '')" @refresh="reloadSnapshot" />
      <FindHubTrackingSettings ref="editor" header-actions v-else-if="section==='configuracao'" :key="id" :instance-id="id" @saved="load" />
      <PanelCard v-else-if="section==='historico'" title="Histórico de localização" description="Posições persistidas desta conta, com horário do relatório e retenção configurável.">
        <p v-if="!auth?.historyEnabled" class="alert">Armazenamento desabilitado para esta conta. <RouterLink :to="findHubPath(id,'configuracao')">Configurar histórico e retenção</RouterLink>. Posições já existentes permanecem consultáveis até vencerem a retenção.</p>
        <div class="form-stack"><label class="field"><span>Dispositivo</span><select v-model="chosen" class="select" @change="loadSelected"><option v-for="d in devices" :key="d.id" :value="d.id">{{d.name}}</option></select></label><div class="field-grid two"><label class="field"><span>Início</span><input v-model="from" type="datetime-local" /></label><label class="field"><span>Fim</span><input v-model="to" type="datetime-local" /></label></div><div class="toolbar"><button class="btn ghost" @click="loadSelected">Filtrar</button><button class="btn primary" :disabled="!connected || !chosen || reconciliationBusy || !auth?.historyEnabled" @click="reconcileHistory"><AppIcon name="refresh" :size="16"/>{{ reconciliationBusy ? 'Reconciliando…' : 'Tentar recuperar lacuna' }}</button></div><p class="muted">A reconciliação consulta novamente o Google Find Hub e salva relatórios RECENT/NETWORK antigos que ainda forem devolvidos. O Google não garante histórico completo do período.</p><div v-if="reconciliationResult" class="alert"><strong>Última reconciliação:</strong> {{ reconciliationResult.recoveredPositions }} posição(ões) nova(s), {{ reconciliationResult.attemptsCompleted }} tentativa(s). Período {{ stamp(reconciliationResult.from) }} → {{ stamp(reconciliationResult.to) }}.</div></div>
        <EmptyState v-if="!history.length" icon="location" title="Nenhuma posição no período" description="Ative o histórico e o rastreamento para armazenar novos relatórios. Você também pode tentar reconciliar uma lacuna recente com o Google Find Hub." />
        <div v-else class="findhub-table"><FindHubMap :key="chosen" :position="historyTrail[historyTrail.length-1]" :trail="historyTrail" :tile-url="snapshot?.map?.tileUrl" :avatar-data="historyAvatar" :device-name="devices.find(d => d.id===chosen)?.name"/><table><thead><tr><th>Relatório</th><th>Latitude</th><th>Longitude</th><th>Precisão</th><th>Origem</th></tr></thead><tbody><tr v-for="(p,index) in history" :key="p.id || index"><td>{{stamp(p.recordedAt)}}</td><td>{{p.latitude}}</td><td>{{p.longitude}}</td><td>{{p.accuracy ?? '—'}} m</td><td>{{p.source}}</td></tr></tbody></table><p class="muted">Até 1.000 posições mais recentes do período. Use intervalos menores para consultar o restante.</p></div>
      </PanelCard>
      <FindHubTraccarConnection ref="editor" header-actions v-else-if="section==='integracoes'" :key="id" :instance-id="id" :devices="devices" />
      <FindHubEvents ref="editor" header-actions :transport="eventTransport" v-else-if="section==='eventos'" :key="id+eventTransport" :instance-id="id" />
    </template>
      </section>
    </div>
    <FindHubTrackingModal :open="trackingOpen" :instance-id="id" :initial-device="trackingDevice" @close="trackingOpen=false" />
    <AppModal :open="confirm!==null" :title="confirm==='delete' ? 'Excluir instância Google Find Hub' : 'Desvincular conta Google'" subtitle="Confirme a remoção dos dados locais desta conta." @close="confirm=null"><p>Esta operação remove credenciais, catálogo, histórico e vínculos locais associados a esta conta. Nenhum dispositivo físico será apagado. As demais instâncias não serão alteradas.</p><template #footer><button class="btn ghost" :disabled="busy" @click="confirm=null">Cancelar</button><button class="btn danger" :disabled="busy" @click="accountAction">Confirmar</button></template></AppModal>
  </FindHubShell>
</template>
<style scoped>
.findhub-table{overflow:auto;margin-top:20px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid var(--border)}.instance-card h3{margin:0}.instance-card footer{margin-top:20px}.device-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.device-actions .btn{flex:1 0 auto;min-height:36px;margin:0;white-space:nowrap;justify-content:center}
</style>
