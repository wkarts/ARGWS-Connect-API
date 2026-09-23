<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FindHubShell from '@/layouts/FindHubShell.vue'
import PanelCard from '@/components/PanelCard.vue'
import PageHeader from '@/components/PageHeader.vue'
import AppModal from '@/components/AppModal.vue'
import EmptyState from '@/components/EmptyState.vue'
import InstanceToken from '@/components/InstanceToken.vue'
import FindHubBrowserAuth from '@/components/FindHubBrowserAuth.vue'
import FindHubEvents from '@/components/FindHubEvents.vue'
import FindHubMap from '@/components/FindHubMap.vue'
import FindHubLiveTracking from '@/components/FindHubLiveTracking.vue'
import FindHubTrackingSettings from '@/components/FindHubTrackingSettings.vue'
import FindHubTraccarConnection from '@/components/FindHubTraccarConnection.vue'
import { applyFindHubUpdate } from '@/services/findhub-live-state'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import { findHubPath, isFindHub } from '@/services/findhub-channel'
const route = useRoute(), router = useRouter()
const id = computed(() => String(route.params.id))
const section = computed(() => String(route.params.section || 'conta'))
const instance = ref<any>(null), auth = ref<any>(null), devices = ref<any[]>([]), history = ref<any[]>([])
const busy = ref(false), error = ref(''), feedback = ref(''), chosen = ref(''), confirm = ref<'disconnect'|'delete'|null>(null)
const snapshot = ref<any>(null), streamState = ref('Conectando atualizações…')
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
async function reloadSnapshot() { const currentId=id.value; const data=await connect.findHubSnapshot(currentId); if(currentId===id.value) { snapshot.value=data; devices.value=data.devices; if(auth.value) auth.value.historyEnabled=data.settings.historyEnabled } }

const historyTrail = computed(() => [...history.value].reverse().map(p => ({...p,timestamp:p.recordedAt})))
const connected = computed(() => auth.value?.connected === true && auth.value?.ready === true)
const trackingCount = computed(() => devices.value.filter(d => d.trackingEnabled).length)
const tabs = [{key:'conta',label:'Conta e autenticação'},{key:'dispositivos',label:'Dispositivos'},{key:'mapa',label:'Mapa realtime'},{key:'configuracao',label:'Parâmetros'},{key:'historico',label:'Histórico'},{key:'integracoes',label:'Traccar'},{key:'eventos',label:'Eventos'}]
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
async function locate(device: any) {
  device.locating = true; error.value = ''; feedback.value = ''
  try {
    const position = await connect.findHubLocate(id.value,device.id)
    if (!position) feedback.value = 'Não houve relatório de localização utilizável para este dispositivo.'
    else if (!device.latestPosition || Date.parse(position.timestamp) >= Date.parse(device.latestPosition.timestamp)) { device.latestPosition=position; device.lastLocationAt=position.timestamp }
  } catch (e) { error.value = friendlyError(e) }
  finally { device.locating = false }
}
async function tracking(device: any) {
  device.saving = true; error.value = ''
  try {
    if (device.trackingEnabled) await connect.findHubStopTracking(id.value,device.id)
    else await connect.findHubStartTracking(id.value,device.id,Number(device.trackingIntervalSeconds || 60))
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
watch(() => [id.value,section.value], () => { error.value=''; feedback.value=''; void load() })
watch(id, startStream)
onMounted(() => { void load(); startStream() })
onBeforeUnmount(stopStream)
</script>
<template>
  <FindHubShell>
    <PageHeader :title="instance?.name || 'Google Find Hub'" description="Conta Google independente · Dispositivos e localização">
      <button class="btn ghost" @click="router.push('/findhub')">Contas Google</button><button class="btn ghost" :disabled="busy" @click="load">Atualizar</button>
    </PageHeader>
    <nav class="findhub-tabs" aria-label="Seções da conta Google"><RouterLink v-for="tab in tabs" :key="tab.key" :to="findHubPath(id,tab.key)" :class="{active:section===tab.key}">{{ tab.label }}</RouterLink></nav>
    <div v-if="error" class="alert error" role="alert">{{ error }}</div><div v-if="feedback" class="alert" role="status">{{ feedback }}</div>
    <div v-if="!instance" class="cards-skeleton"></div>
    <template v-else>
      <template v-if="section==='conta'">
        <div class="detail-grid">
          <PanelCard title="Conta e conexão"><div class="detail-list"><div><span>Conta Google</span><strong>{{ auth?.email || 'Ainda não vinculada' }}</strong></div><div><span>Conexão validada</span><strong>{{ connected ? 'Conectada' : auth?.pending ? 'Vinculação em andamento' : 'Desconectada' }}</strong></div><div><span>Histórico de posições</span><strong>{{ auth?.historyEnabled ? 'Habilitado para a conta' : 'Desabilitado' }}</strong></div></div><InstanceToken :instance-id="id" :instance-name="instance.name || id" /></PanelCard>
          <PanelCard title="Dispositivos desta conta"><div class="summary-tiles"><div><b>{{ devices.length }}</b><span>Dispositivos cadastrados</span></div><div><b>{{ trackingCount }}</b><span>Rastreamentos habilitados</span></div></div><p class="muted">A disponibilidade de posições depende do aparelho, da rede e do Google. A hora do relatório indica a idade da localização.</p></PanelCard>
        </div>
        <FindHubBrowserAuth v-if="!connected" :key="id" class="top-gap" :instance-id="id" :initial-email="auth?.email" @connected="load" />
        <PanelCard v-else class="top-gap" title="Conta Google conectada" description="O acesso ao protocolo e o catálogo de dispositivos foram validados."><button class="btn primary" @click="router.push(findHubPath(id,'dispositivos'))">Administrar dispositivos</button></PanelCard>
        <div class="danger-zone"><div><strong>Desvincular ou excluir esta conta</strong><p>Desvincular remove credenciais Google, catálogo local, vínculos e histórico associados. Não remove a conta nem apaga o smartphone no Google.</p></div><div class="toolbar"><button class="btn ghost" :disabled="busy" @click="confirm='disconnect'">Desvincular conta Google</button><button class="btn danger" :disabled="busy" @click="confirm='delete'">Excluir instância</button></div></div>
      </template>
      <PanelCard v-else-if="section==='dispositivos'" title="Dispositivos" description="Somente dispositivos retornados pela conta Google vinculada.">
        <div class="toolbar"><button class="btn primary" :disabled="busy || !connected" @click="refreshDevices">Sincronizar dispositivos</button><span class="muted">{{ connected ? 'Conexão validada' : 'Vincule a conta para obter novas posições' }}</span></div>
        <EmptyState v-if="!devices.length" icon="location" title="Nenhum dispositivo sincronizado" description="Conecte a conta Google e sincronize o catálogo." />
        <p class="muted">O catálogo combina os tipos disponibilizados pelo protocolo Google. Dispositivos compartilhados, Family Link e acessórios podem não estar acessíveis com as mesmas permissões; nenhum dispositivo é inventado a partir do e-mail.</p><div class="instance-grid top-gap"><article v-for="device in devices" :key="device.id" class="instance-card"><h3>{{ device.name }}</h3><p>{{ deviceType(device.deviceType) }} · {{ [device.manufacturer,device.model].filter(Boolean).join(' ') }}</p><div class="detail-list"><div><span>Último relatório</span><strong>{{ stamp(device.lastLocationAt) }}</strong></div><div><span>Rastreamento</span><strong>{{ device.trackingEnabled ? 'Habilitado' : 'Desabilitado' }}</strong></div></div><label class="field top-gap"><span>Intervalo entre consultas (segundos)</span><input v-model.number="device.trackingIntervalSeconds" type="number" :min="auth?.minimumIntervalSeconds || 30" max="86400" :disabled="device.trackingEnabled" /></label><div v-if="device.latestPosition" class="alert"><strong>{{ device.latestPosition.latitude }}, {{ device.latestPosition.longitude }}</strong><p>{{ stamp(device.latestPosition.timestamp) }} · Precisão: {{ device.latestPosition.accuracy ?? '—' }} m · Origem: {{ device.latestPosition.source }}</p></div><footer class="toolbar top-gap"><RouterLink class="card-link" :to="{path:findHubPath(id,'mapa'),query:{device:device.id}}">Acompanhar no mapa</RouterLink><button class="btn ghost" :disabled="!connected || device.locating" @click="locate(device)">{{ device.locating ? 'Localizando…' : 'Localizar agora' }}</button><button class="btn primary" :disabled="device.saving || (!connected && !device.trackingEnabled)" @click="tracking(device)">{{ device.trackingEnabled ? 'Parar rastreamento' : 'Iniciar rastreamento' }}</button></footer></article></div>
      </PanelCard>
      <FindHubLiveTracking v-else-if="section==='mapa' && snapshot" :key="id" :instance-id="id" :snapshot="snapshot" :stream-state="streamState" :initial-device="String(route.query.device || '')" @refresh="reloadSnapshot" />
      <FindHubTrackingSettings v-else-if="section==='configuracao'" :key="id" :instance-id="id" @saved="load" />
      <PanelCard v-else-if="section==='historico'" title="Histórico de localização" description="Posições persistidas desta conta, com horário do relatório e retenção configurável.">
        <p v-if="!auth?.historyEnabled" class="alert">Armazenamento desabilitado para esta conta. <RouterLink :to="findHubPath(id,'configuracao')">Configurar histórico e retenção</RouterLink>. Posições já existentes permanecem consultáveis até vencerem a retenção.</p>
        <div class="form-stack"><label class="field"><span>Dispositivo</span><select v-model="chosen" class="select" @change="loadSelected"><option v-for="d in devices" :key="d.id" :value="d.id">{{d.name}}</option></select></label><div class="toolbar"><label class="field"><span>Início</span><input v-model="from" type="datetime-local" /></label><label class="field"><span>Fim</span><input v-model="to" type="datetime-local" /></label><button class="btn ghost" @click="loadSelected">Filtrar</button></div></div>
        <EmptyState v-if="!history.length" icon="location" title="Nenhuma posição no período" description="Ative o histórico e o rastreamento para armazenar novos relatórios. Não há coleta retroativa." />
        <div v-else class="findhub-table"><FindHubMap :key="chosen" :position="historyTrail[historyTrail.length-1]" :trail="historyTrail" :tile-url="snapshot?.map?.tileUrl"/><table><thead><tr><th>Relatório</th><th>Latitude</th><th>Longitude</th><th>Precisão</th><th>Origem</th></tr></thead><tbody><tr v-for="(p,index) in history" :key="p.id || index"><td>{{stamp(p.recordedAt)}}</td><td>{{p.latitude}}</td><td>{{p.longitude}}</td><td>{{p.accuracy ?? '—'}} m</td><td>{{p.source}}</td></tr></tbody></table><p class="muted">Até 1.000 posições mais recentes do período. Use intervalos menores para consultar o restante.</p></div>
      </PanelCard>
      <FindHubTraccarConnection v-else-if="section==='integracoes'" :key="id" :instance-id="id" :devices="devices" />
      <FindHubEvents v-else-if="section==='eventos'" :key="id" :instance-id="id" />
    </template>
    <AppModal :open="confirm!==null" :title="confirm==='delete' ? 'Excluir instância Google Find Hub' : 'Desvincular conta Google'" subtitle="Confirme a remoção dos dados locais desta conta." @close="confirm=null"><p>Esta operação remove credenciais, catálogo, histórico e vínculos locais associados a esta conta. Nenhum dispositivo físico será apagado. As demais instâncias não serão alteradas.</p><template #footer><button class="btn ghost" :disabled="busy" @click="confirm=null">Cancelar</button><button class="btn danger" :disabled="busy" @click="accountAction">Confirmar</button></template></AppModal>
  </FindHubShell>
</template>
<style scoped>
.findhub-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}.findhub-tabs a{padding:10px 14px;border:1px solid var(--border);border-radius:10px;color:var(--text);background:var(--surface);text-decoration:none}.findhub-tabs a.active{background:var(--primary);color:#fff}.findhub-table{overflow:auto;margin-top:20px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid var(--border)}.instance-card h3{margin:0}.instance-card footer{margin-top:20px}
</style>
