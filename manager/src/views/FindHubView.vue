<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FindHubShell from '@/layouts/FindHubShell.vue'
import PanelCard from '@/components/PanelCard.vue'
import PageHeader from '@/components/PageHeader.vue'
import AppModal from '@/components/AppModal.vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import InstanceToken from '@/components/InstanceToken.vue'
import FindHubBrowserAuth from '@/components/FindHubBrowserAuth.vue'
import FindHubEvents from '@/components/FindHubEvents.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import { findHubPath, isFindHub } from '@/services/findhub-channel'
import { applyFindHubEvent, defaultFindHubPolicy, findHubReportAge, mergeFindHubDevices } from '@/services/findhub-monitoring'
import type { FindHubPolicy } from '@/services/findhub-monitoring'
const route = useRoute(), router = useRouter()
const id = computed(() => String(route.params.id))
const section = computed(() => String(route.params.section || 'conta'))
const instance = ref<any>(null), auth = ref<any>(null), devices = ref<any[]>([]), history = ref<any[]>([])
const busy = ref(false), error = ref(''), feedback = ref(''), chosen = ref(''), confirm = ref<'disconnect'|'delete'|null>(null)
const policy = ref<FindHubPolicy>(defaultFindHubPolicy()), policyReady = ref(false), savingPolicy = ref(false), confirmRetention = ref(false)
const drafts = ref<Record<string, { intervalSeconds: number; timeoutSeconds: number }>>({})
const binding = ref({ enabled: false, url: '', deviceId: '' })
const period = ref({ from: '', to: '' }), nextCursor = ref<string|null>(null), historyBusy = ref(false), historyStale = ref(false)
const live = ref(true), liveState = ref<'connecting'|'connected'|'fallback'|'paused'>('connecting'), now = ref(Date.now())
const connected = computed(() => auth.value?.connected === true && auth.value?.ready === true)
const trackingCount = computed(() => devices.value.filter(d => d.trackingEnabled).length)
const minimum = computed(() => auth.value?.minimumIntervalSeconds || 30)
const tabs = [{ key:'conta', label:'Conta', icon:'user' }, { key:'dispositivos', label:'Dispositivos', icon:'location' }, { key:'configuracao', label:'Configurações', icon:'settings' }, { key:'historico', label:'Histórico', icon:'clock' }, { key:'integracoes', label:'Traccar', icon:'integration' }, { key:'eventos', label:'Eventos', icon:'webhook' }]
const stamp = (value: any) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR') : 'Não disponível'
const deviceType = (value: string) => ({ PHONE:'Android', TABLET:'Tablet', WATCH:'Relógio', HEADPHONES:'Fone', EARBUDS:'Fone', TRACKER:'Tag / rastreador', UNKNOWN:'Tipo não informado' }[value] || value)
const catalogName = (type: number) => ({ 1:'Android', 2:'Rede Find Hub e tags', 5:'Acessórios Fast Pair', 7:'Dispositivos supervisionados' }[type] || `Catálogo ${type}`)
const liveLabel = computed(() => !live.value ? 'Atualização visual pausada' : liveState.value === 'connected' ? 'Eventos ao vivo' : liveState.value === 'paused' ? 'Pausado com a página oculta' : 'Atualização periódica de segurança')
let mounted = false, loadSerial = 0, selectedSerial = 0, stream: AbortController|null = null
let pollTimer: ReturnType<typeof setInterval>|null = null, retryTimer: ReturnType<typeof setTimeout>|null = null, pollRunning = false, lastPoll = 0
function mergeDevices(list: any[]) {
  devices.value = mergeFindHubDevices(devices.value, list)
  for (const device of list) if (!drafts.value[device.id]) drafts.value[device.id] = {
    intervalSeconds: device.trackingIntervalSeconds || auth.value?.settings?.defaultIntervalSeconds || 60,
    timeoutSeconds: (device.locationTimeoutMs || auth.value?.settings?.locationTimeoutMs || 30000) / 1000,
  }
  if (!list.some(device => device.id === chosen.value)) chosen.value = list[0]?.id || ''
}
async function snapshot() {
  if (pollRunning) return
  pollRunning = true
  const currentId = id.value
  try {
    const [status, list] = await Promise.all([connect.findHubAuthStatus(currentId), connect.findHubDevices(currentId)])
    if (!mounted || currentId !== id.value) return
    auth.value = status; mergeDevices(list)
    if (!policyReady.value) { policy.value = { ...defaultFindHubPolicy(), ...status.settings }; policyReady.value = true }
  } finally { pollRunning = false }
}
async function load() {
  const serial = ++loadSerial, currentId = id.value
  busy.value = true; error.value = ''
  try {
    const data = await connect.connection(currentId)
    if (currentId !== id.value || serial !== loadSerial) return
    if (!isFindHub(data)) { await router.replace('/findhub'); return }
    instance.value = data
    await snapshot()
    if (serial !== loadSerial || currentId !== id.value) return
    await loadSelected()
    startStream()
  } catch (e) { if (serial === loadSerial) error.value = friendlyError(e) }
  finally { if (serial === loadSerial) busy.value = false }
}
async function loadHistory(more = false) {
  if (!chosen.value || historyBusy.value) return
  const currentId = id.value, deviceId = chosen.value, serial = ++selectedSerial
  historyBusy.value = true; error.value = ''
  if (!more) { history.value = []; nextCursor.value = null; historyStale.value = false }
  try {
    const params: Record<string, unknown> = { limit: 100 }
    if (more && nextCursor.value) params.cursor = nextCursor.value
    if (period.value.from) params.from = new Date(period.value.from).toISOString()
    if (period.value.to) params.to = new Date(period.value.to).toISOString()
    const page = await connect.findHubHistory(currentId, deviceId, params)
    if (serial !== selectedSerial || id.value !== currentId || chosen.value !== deviceId) return
    history.value = more ? [...history.value, ...page.items] : page.items
    nextCursor.value = page.nextCursor
  } catch (e) { if (serial === selectedSerial) error.value = friendlyError(e) }
  finally { if (serial === selectedSerial) historyBusy.value = false }
}
async function loadSelected() {
  selectedSerial++; historyBusy.value = false
  history.value = []; nextCursor.value = null; binding.value = { enabled:false, url:'', deviceId:'' }
  if (!chosen.value) return
  if (section.value === 'historico') { await loadHistory(); return }
  if (section.value !== 'integracoes') return
  const currentId = id.value, deviceId = chosen.value, serial = selectedSerial
  try {
    const row = await connect.findHubTraccar(currentId, deviceId)
    if (serial !== selectedSerial || currentId !== id.value || deviceId !== chosen.value) return
    binding.value = { enabled:row?.enabled ?? false, url:row?.url || '', deviceId:row?.traccarDeviceId || '' }
  } catch (e) { if (serial === selectedSerial) error.value = friendlyError(e) }
}
function stopStream() {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  const previous = stream; stream = null; previous?.abort()
}
function startStream() {
  if (stream || !mounted || !live.value || !connected.value || document.hidden) return
  const controller = new AbortController(), currentId = id.value
  stream = controller; liveState.value = 'connecting'
  void connect.findHubStream(currentId, message => {
    if (stream !== controller || currentId !== id.value) return
    liveState.value = 'connected'; now.value = Date.now()
    if (message.event === 'findhub.devices.updated' && Array.isArray(message.data?.devices)) {
      mergeDevices(message.data.devices)
      if (auth.value) auth.value.catalog = message.data.catalog
    } else if (message.event === 'connection.update') {
      void snapshot().catch(() => {})
    } else {
      const changed = applyFindHubEvent(devices.value, message)
      if (changed && message.event === 'findhub.location.updated' && (message.data?.device?.id || message.data?.deviceId) === chosen.value) historyStale.value = true
    }
  }, controller.signal).catch(() => {
    if (!controller.signal.aborted) liveState.value = 'fallback'
  }).finally(() => {
    if (stream !== controller) return
    stream = null
    if (mounted && live.value && !document.hidden && connected.value) {
      liveState.value = 'fallback'
      retryTimer = setTimeout(startStream, 5000)
    }
  })
}
function visibility() {
  if (document.hidden || !live.value) { stopStream(); liveState.value = 'paused' }
  else { lastPoll = 0; void snapshot().catch(() => {}); startStream() }
}
async function refreshDevices() {
  busy.value = true; error.value = ''
  const currentId = id.value
  try {
    const list = await connect.findHubRefreshDevices(currentId)
    if (currentId !== id.value) return
    mergeDevices(list); await snapshot()
    feedback.value = 'Catálogos consultados. Dispositivos e configurações locais foram preservados.'
  } catch (e) { if (currentId === id.value) error.value = friendlyError(e) }
  finally { busy.value = false }
}
async function locate(device: any) {
  const currentId = id.value
  device.locating = true; error.value = ''; feedback.value = ''
  try {
    const position = await connect.findHubLocate(currentId, device.id, drafts.value[device.id].timeoutSeconds * 1000)
    if (currentId !== id.value) return
    if (!position) feedback.value = 'O Google não retornou uma posição utilizável dentro desta consulta.'
    else applyFindHubEvent(devices.value, { event:'findhub.location.updated', data:{ deviceId:device.id, location:position }, receivedAt:new Date().toISOString() })
    if (currentId !== id.value) return
    await snapshot()
  } catch (e) { if (currentId === id.value) error.value = friendlyError(e) }
  finally { device.locating = false }
}
async function saveDevice(device: any) {
  const currentId = id.value
  device.saving = true; error.value = ''
  try {
    const draft = drafts.value[device.id]
    const result = await connect.findHubConfigureDevice(currentId, device.id, { intervalSeconds:Number(draft.intervalSeconds), timeoutMs:Number(draft.timeoutSeconds) * 1000 })
    if (currentId !== id.value) return
    Object.assign(device, result); feedback.value = 'Parâmetros do dispositivo salvos.'
  } catch (e) { if (currentId === id.value) error.value = friendlyError(e) }
  finally { device.saving = false }
}
async function tracking(device: any) {
  const currentId = id.value
  device.saving = true; error.value = ''
  try {
    if (device.trackingEnabled) await connect.findHubStopTracking(currentId, device.id)
    else {
      const draft = drafts.value[device.id]
      await connect.findHubConfigureDevice(currentId, device.id, { intervalSeconds:Number(draft.intervalSeconds), timeoutMs:Number(draft.timeoutSeconds) * 1000 })
      if (currentId !== id.value) return
      await connect.findHubStartTracking(currentId, device.id, Number(draft.intervalSeconds))
    }
    if (currentId !== id.value) return
    await snapshot()
  } catch (e) { if (currentId === id.value) error.value = friendlyError(e) }
  finally { device.saving = false }
}
async function savePolicy(confirmed = false) {
  const currentId = id.value
  const old = auth.value?.settings?.historyRetentionDays || 0
  if (!confirmed && policy.value.historyRetentionDays > 0 && (!old || policy.value.historyRetentionDays < old)) { confirmRetention.value = true; return }
  savingPolicy.value = true; error.value = ''; confirmRetention.value = false
  try {
    const saved = await connect.findHubSettings(currentId, { ...policy.value })
    if (currentId !== id.value) return
    policy.value = saved
    if (auth.value) { auth.value.settings = saved; auth.value.historyEnabled = saved.historyEnabled }
    feedback.value = 'Configurações desta conta salvas. A política se aplica aos próximos relatórios e à retenção do histórico local.'
  } catch (e) { if (currentId === id.value) error.value = friendlyError(e) }
  finally { if (currentId === id.value) savingPolicy.value = false }
}
async function saveBinding(remove = false) {
  const currentId = id.value
  busy.value = true; error.value = ''; feedback.value = ''
  try {
    await connect.findHubTraccar(currentId, chosen.value, remove ? 'DELETE' : 'PUT', remove ? undefined : binding.value)
    if (currentId !== id.value) return
    await loadSelected(); feedback.value = remove ? 'Vínculo removido.' : 'Vínculo Traccar salvo.'
  } catch (e) { if (currentId === id.value) error.value = friendlyError(e) }
  finally { if (currentId === id.value) busy.value = false }
}
async function accountAction() {
  const currentId = id.value
  busy.value = true; error.value = ''; stopStream()
  try {
    if (confirm.value === 'delete') { await connect.removeConnection(currentId); if (currentId !== id.value) return; await router.replace('/findhub') }
    else { await connect.findHubDisconnect(currentId); if (currentId !== id.value) return; confirm.value = null; await load() }
    confirm.value = null
  } catch (e) { if (currentId === id.value) error.value = friendlyError(e) }
  finally { if (currentId === id.value) busy.value = false }
}
watch(() => id.value, () => {
  stopStream(); loadSerial++; selectedSerial++; instance.value = null; auth.value = null
  devices.value = []; drafts.value = {}; chosen.value = ''; policyReady.value = false
  error.value = ''; feedback.value = ''; busy.value = false; savingPolicy.value = false; void load()
})
watch(() => section.value, () => { error.value = ''; feedback.value = ''; void loadSelected() })
watch(chosen, () => { void loadSelected() })
watch(live, visibility)
onMounted(() => {
  mounted = true; void load()
  document.addEventListener('visibilitychange', visibility)
  pollTimer = setInterval(() => {
    now.value = Date.now()
    if (!live.value || document.hidden || !instance.value) return
    const seconds = auth.value?.settings?.uiRefreshSeconds || 5
    const delay = (liveState.value === 'connected' ? Math.max(30, seconds) : seconds) * 1000
    if (now.value - lastPoll < delay) return
    lastPoll = now.value
    void snapshot().then(startStream).catch(() => { liveState.value = 'fallback' })
  }, 1000)
})
onBeforeUnmount(() => {
  mounted = false; loadSerial++; selectedSerial++; stopStream()
  if (pollTimer) clearInterval(pollTimer)
  document.removeEventListener('visibilitychange', visibility)
})
</script>
<template>
  <FindHubShell>
    <PageHeader :title="instance?.name || 'Google Find Hub'" description="Conta Google independente · Dispositivos e localização">
      <button class="btn ghost" @click="router.push('/findhub')">Contas Google</button><button class="btn ghost" :disabled="busy" @click="load"><AppIcon name="refresh" :size="16" /> Atualizar</button>
    </PageHeader>
    <nav class="findhub-tabs" aria-label="Seções da conta Google"><RouterLink v-for="tab in tabs" :key="tab.key" :to="findHubPath(id,tab.key)" :class="{active:section===tab.key}">{{ tab.label }}</RouterLink></nav>
    <div v-if="error" class="alert error" role="alert">{{ error }}</div><div v-if="feedback" class="alert" role="status">{{ feedback }}</div>
    <div v-if="!instance" class="cards-skeleton"></div>
    <template v-else>
      <template v-if="section==='conta'">
        <div class="detail-grid">
          <PanelCard title="Conta e conexão"><div class="detail-list"><div><span>Conta Google</span><strong>{{ auth?.email || 'Ainda não vinculada' }}</strong></div><div><span>Conexão validada</span><strong>{{ connected ? 'Conectada' : auth?.pending ? 'Vinculação em andamento' : 'Desconectada' }}</strong></div><div><span>Histórico de posições</span><strong>{{ auth?.historyEnabled ? 'Habilitado' : 'Desabilitado' }}</strong></div></div><InstanceToken :instance-id="id" :instance-name="instance.name || id" /></PanelCard>
          <PanelCard title="Dispositivos desta conta"><div class="summary-tiles"><div><b>{{ devices.length }}</b><span>Dispositivos cadastrados</span></div><div><b>{{ trackingCount }}</b><span>Rastreamentos habilitados</span></div></div><p class="muted">O intervalo controla as solicitações. A frequência e a idade das posições dependem do aparelho, da rede e do Google; não há garantia de GPS contínuo.</p></PanelCard>
        </div>
        <FindHubBrowserAuth v-if="!connected" :key="id" class="top-gap" :instance-id="id" :initial-email="auth?.email" @connected="load" />
        <PanelCard v-else class="top-gap" title="Conta Google conectada" description="O acesso ao protocolo e ao catálogo de dispositivos foi validado."><div class="toolbar"><button class="btn ghost" @click="router.push(findHubPath(id,'dispositivos'))">Administrar dispositivos</button><button class="card-link" @click="router.push(findHubPath(id,'configuracao'))">Configurar rastreamento e histórico <AppIcon name="arrow" :size="15" /></button></div></PanelCard>
        <div class="danger-zone"><div><strong>Desvincular ou excluir esta conta</strong><p>Remove credenciais, catálogo, vínculos e histórico locais. Não apaga dispositivos na conta Google.</p></div><div class="toolbar"><button class="btn ghost" :disabled="busy" @click="confirm='disconnect'">Desvincular conta Google</button><button class="btn danger" :disabled="busy" @click="confirm='delete'">Excluir instância</button></div></div>
      </template>
      <PanelCard v-else-if="section==='dispositivos'" title="Dispositivos" description="Catálogos Google autorizados, últimas posições e parâmetros por dispositivo.">
        <div class="toolbar"><button class="btn ghost" :disabled="busy || !connected" @click="refreshDevices">{{ busy ? 'Consultando catálogos…' : 'Sincronizar dispositivos' }}</button><label class="live-toggle"><input v-model="live" type="checkbox" /> {{ liveLabel }}</label></div>
        <div v-if="auth?.catalog" class="catalog-status top-gap"><p :class="{ 'muted':auth.catalog.complete }">{{ auth.catalog.complete ? 'Consultas do catálogo concluídas.' : 'Catálogo parcial: uma ou mais fontes não puderam ser consultadas ou decodificadas.' }} Última sincronização: {{ stamp(auth.catalog.updatedAt) }}.</p><div class="catalog-sources"><span v-for="source in auth.catalog.sources" :key="source.type">{{ catalogName(source.type) }}: {{ source.status === 'OK' ? `${source.returned} registros` : 'indisponível' }}</span></div><p class="muted">Tags e aparelhos supervisionados são solicitados separadamente. A presença no Family Link não garante acesso por este protocolo: somente itens retornados e autorizados pelo Google aparecem aqui.</p></div>
        <EmptyState v-if="!devices.length" icon="location" title="Nenhum dispositivo sincronizado" description="Conecte a conta Google e sincronize o catálogo." />
        <div class="instance-grid top-gap"><article v-for="device in devices" :key="device.id" class="instance-card findhub-device-card">
          <div class="findhub-device-heading"><div><h3>{{ device.name }}</h3><p class="muted">{{ deviceType(device.deviceType) }}<template v-if="device.manufacturer || device.model"> · {{ [device.manufacturer,device.model].filter(Boolean).join(' ') }}</template></p></div><span class="status-badge" :class="device.trackingEnabled ? 'online' : 'offline'">{{ device.trackingEnabled ? 'Monitorando' : 'Pausado' }}</span></div>
          <div class="detail-list"><div><span>Posição medida</span><strong>{{ stamp(device.lastLocationAt) }}</strong></div><div><span>Idade do relatório</span><strong>{{ findHubReportAge(device.lastLocationAt,now) }}</strong></div><div><span>Recebida pela API</span><strong>{{ stamp(device.lastReceivedAt) }}</strong></div><div><span>Próxima consulta</span><strong>{{ device.trackingStatus?.inProgress ? 'Em andamento' : device.trackingEnabled ? stamp(device.trackingStatus?.nextAttemptAt) : 'Rastreamento parado' }}</strong></div></div>
          <div class="findhub-device-fields top-gap"><label class="field"><span>Intervalo entre consultas (s)</span><input v-model.number="drafts[device.id].intervalSeconds" type="number" :min="minimum" max="86400" :disabled="device.saving" /></label><label class="field"><span>Tempo máximo de resposta (s)</span><input v-model.number="drafts[device.id].timeoutSeconds" type="number" min="5" max="180" :disabled="device.saving" /></label></div>
          <p class="muted">Sem consultas sobrepostas. Falhas consecutivas aumentam temporariamente a espera.</p>
          <div v-if="device.position" class="position-panel"><strong>{{ device.position.latitude }}, {{ device.position.longitude }}</strong><p>Precisão: {{ device.position.accuracy ?? '—' }} m · {{ device.position.source === 'NETWORK' ? 'Rede Find Hub' : 'Relatório recente' }}</p><p v-if="device.position.semanticLocation">{{ device.position.semanticLocation }}</p></div>
          <p v-else class="muted">Nenhuma posição recebida. O cadastro do aparelho não comprova uma localização disponível.</p>
          <p v-if="device.locationSupported===false" class="muted">O catálogo não forneceu uma chave de localização para este item. A consulta pode depender de autorização adicional ou de dados no próximo relatório.</p>
          <p v-if="device.trackingStatus?.lastError" class="alert">{{ device.trackingStatus.lastError }}</p>
          <footer class="findhub-device-actions"><button class="card-link" :disabled="device.saving" @click="saveDevice(device)">Salvar parâmetros</button><button class="card-link" :disabled="!connected || device.locating" @click="locate(device)">{{ device.locating ? 'Localizando…' : 'Localizar agora' }}</button><button class="card-link" :disabled="device.saving || (!connected && !device.trackingEnabled)" @click="tracking(device)">{{ device.trackingEnabled ? 'Parar rastreamento' : 'Iniciar rastreamento' }}</button></footer>
        </article></div>
      </PanelCard>
      <div v-else-if="section==='configuracao'" class="config-layout">
        <aside class="config-nav"><div class="config-nav-item active"><span><AppIcon name="settings" :size="20" /></span><div><strong>Rastreamento e histórico</strong><small>Política exclusiva desta conta Google.</small></div></div><button class="config-nav-item" @click="router.push(findHubPath(id,'eventos'))"><span><AppIcon name="integration" :size="20" /></span><div><strong>Eventos e webhooks</strong><small>Distribuição dos relatórios recebidos.</small></div></button><button class="config-nav-item" @click="router.push(findHubPath(id,'integracoes'))"><span><AppIcon name="location" :size="20" /></span><div><strong>Traccar</strong><small>Encaminhamento por dispositivo.</small></div></button></aside>
        <PanelCard class="config-workspace" title="Rastreamento e histórico" description="Configurações persistidas por conta. Não modificam as instâncias WhatsApp.">
          <form class="form-stack" @submit.prevent="savePolicy(false)">
            <label class="toggle-field"><input v-model="policy.historyEnabled" type="checkbox" /><span>Salvar histórico dos relatórios de localização recebidos</span></label>
            <label class="field"><span>Retenção do histórico (dias)</span><input v-model.number="policy.historyRetentionDays" type="number" min="0" max="3650" /><small>0 mantém por tempo indeterminado. Um valor maior que 0 remove registros mais antigos desta conta em lotes. Não há recuperação de posições que nunca foram coletadas.</small></label>
            <div class="findhub-device-fields"><label class="field"><span>Intervalo padrão para novos dispositivos (s)</span><input v-model.number="policy.defaultIntervalSeconds" type="number" :min="minimum" max="86400" /><small>Os dispositivos existentes mantêm seus parâmetros individuais.</small></label><label class="field"><span>Tempo máximo padrão de resposta (ms)</span><input v-model.number="policy.locationTimeoutMs" type="number" min="5000" max="180000" step="1000" /><small>Aplicado quando o dispositivo não possui um tempo específico.</small></label></div>
            <label class="field"><span>Atualização visual de segurança (s)</span><input v-model.number="policy.uiRefreshSeconds" type="number" min="1" max="60" /><small>Eventos chegam ao vivo. Na falta do fluxo de eventos, este intervalo atualiza os dados já recebidos pela API; não faz uma nova consulta Google.</small></label>
            <p class="muted">A última posição continua disponível após recarregar a página, mesmo com o histórico desabilitado. Desabilitar o histórico interrompe novas gravações, mas não apaga por si só os registros existentes. A retenção é uma política separada.</p>
            <div class="toolbar"><button class="btn ghost" type="button" @click="policy={...defaultFindHubPolicy(),...auth?.settings}">Restaurar valores salvos</button><button class="btn primary" type="submit" :disabled="savingPolicy || !policyReady">{{ savingPolicy ? 'Salvando…' : 'Salvar configurações' }}</button></div>
          </form>
        </PanelCard>
      </div>
      <PanelCard v-else-if="section==='historico'" title="Histórico de localização" description="Relatórios persistidos, mais recentes primeiro. Filtros por período e paginação por dispositivo.">
        <div v-if="!auth?.historyEnabled" class="alert">A gravação de novas posições está desabilitada nesta conta. <RouterLink :to="findHubPath(id,'configuracao')">Configurar histórico e retenção</RouterLink>. Os registros que já existirem continuam consultáveis.</div>
        <label class="field"><span>Dispositivo</span><select v-model="chosen" class="select" :disabled="!devices.length"><option v-for="device in devices" :key="device.id" :value="device.id">{{ device.name }}</option></select></label>
        <p v-if="historyStale" class="alert">Novos relatórios recebidos. <button class="card-link" :disabled="historyBusy" @click="loadHistory(false)">Atualizar histórico</button></p>
        <form class="history-filters top-gap" @submit.prevent="loadHistory(false)"><label class="field"><span>De</span><input v-model="period.from" type="datetime-local" /></label><label class="field"><span>Até</span><input v-model="period.to" type="datetime-local" /></label><button class="btn ghost" :disabled="historyBusy || !chosen">Consultar</button></form>
        <EmptyState v-if="!history.length && !historyBusy" icon="location" title="Nenhuma posição neste período" description="O histórico contém apenas posições realmente recebidas enquanto a gravação estava habilitada e que ainda estão dentro da retenção." />
        <div v-else class="findhub-table"><table><thead><tr><th>Relatório</th><th>Latitude</th><th>Longitude</th><th>Precisão (m)</th><th>Origem</th></tr></thead><tbody><tr v-for="position in history" :key="position.id"><td>{{ stamp(position.recordedAt) }}</td><td>{{ position.latitude }}</td><td>{{ position.longitude }}</td><td>{{ position.accuracy ?? '—' }}</td><td>{{ position.source }}</td></tr></tbody></table></div>
        <div class="toolbar top-gap"><span class="muted">{{ history.length }} registros carregados</span><button v-if="nextCursor" class="btn ghost" :disabled="historyBusy" @click="loadHistory(true)">Carregar mais</button><span v-if="historyBusy" role="status">Consultando histórico…</span></div>
      </PanelCard>
      <PanelCard v-else-if="section==='integracoes'" title="Integração Traccar" description="Encaminhe posições para um receptor HTTP/OsmAnd explicitamente autorizado.">
        <div class="form-stack"><label class="field"><span>Dispositivo Google</span><select v-model="chosen" class="select" :disabled="busy || !devices.length"><option v-for="device in devices" :key="device.id" :value="device.id">{{ device.name }}</option></select></label><template v-if="chosen"><label class="toggle-field"><input v-model="binding.enabled" type="checkbox" /><span>Encaminhar posições deste dispositivo</span></label><label class="field"><span>URL do receptor Traccar</span><input v-model="binding.url" type="url" placeholder="https://seu-receptor-traccar" /></label><label class="field"><span>Identificador cadastrado no Traccar</span><input v-model="binding.deviceId" placeholder="android-equipe-01" /></label><p class="muted">Este destino recebe latitude, longitude e a hora do relatório. Use um endereço acessível pela API, não o endpoint administrativo do Traccar.</p><div class="toolbar"><button class="btn ghost" :disabled="busy" @click="saveBinding(true)">Remover vínculo</button><button class="btn primary" :disabled="busy || !binding.url || !binding.deviceId" @click="saveBinding(false)">Salvar vínculo</button></div></template><EmptyState v-else icon="location" title="Sincronize um dispositivo primeiro" description="Os vínculos são individuais por dispositivo, não por conversa ou número." /></div>
      </PanelCard>
      <FindHubEvents v-else-if="section==='eventos'" :key="id" :instance-id="id" />
    </template>
    <AppModal :open="confirm!==null" :title="confirm==='delete' ? 'Excluir instância Google Find Hub' : 'Desvincular conta Google'" subtitle="Confirme a remoção dos dados locais desta conta." @close="confirm=null"><p>Esta operação remove credenciais, catálogo, histórico e vínculos locais associados a esta conta. Nenhum dispositivo físico será apagado. As demais instâncias não serão alteradas.</p><template #footer><button class="btn ghost" :disabled="busy" @click="confirm=null">Cancelar</button><button class="btn danger" :disabled="busy" @click="accountAction">Confirmar</button></template></AppModal>
    <AppModal :open="confirmRetention" title="Aplicar retenção do histórico" subtitle="Esta política se aplica somente à conta Google selecionada." @close="confirmRetention=false"><p>Registros com mais de {{ policy.historyRetentionDays }} dias serão removidos em lotes. Essa limpeza não pode ser desfeita e não altera a última posição do dispositivo. Confirme para salvar a política.</p><template #footer><button class="btn ghost" @click="confirmRetention=false">Cancelar</button><button class="btn primary" @click="savePolicy(true)">Confirmar política</button></template></AppModal>
  </FindHubShell>
</template>
<style scoped>
.findhub-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}.findhub-tabs a{padding:10px 14px;border:1px solid var(--border);border-radius:10px;color:var(--text);background:var(--surface);text-decoration:none}.findhub-tabs a.active{background:var(--primary);color:#fff}.findhub-table{overflow:auto;margin-top:20px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid var(--border)}.instance-card h3{margin:0}.findhub-device-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.findhub-device-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.findhub-device-actions{display:flex;gap:16px;justify-content:space-between;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:16px;margin-top:16px}.findhub-device-card{min-width:0}.position-panel{padding:12px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px}.position-panel p{margin:6px 0 0}.catalog-status p{margin:6px 0}.catalog-sources{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--muted)}.catalog-sources span{padding:5px 8px;border:1px solid var(--border);border-radius:7px}.live-toggle{display:flex;gap:8px;align-items:center;font-size:12px;color:var(--muted)}.history-filters{display:grid;grid-template-columns:1fr 1fr auto;gap:12px;align-items:end}.config-workspace{min-width:0}.field small{color:var(--muted);font-size:12px;line-height:1.5}@media(max-width:680px){.findhub-device-fields,.history-filters{grid-template-columns:1fr}.findhub-tabs{gap:6px}.findhub-tabs a{padding:8px 10px}}
</style>
