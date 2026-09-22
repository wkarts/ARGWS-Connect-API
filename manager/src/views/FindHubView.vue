<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import FindHubShell from '@/layouts/FindHubShell.vue'
import PanelCard from '@/components/PanelCard.vue'
import PageHeader from '@/components/PageHeader.vue'
import AppModal from '@/components/AppModal.vue'
import EmptyState from '@/components/EmptyState.vue'
import InstanceToken from '@/components/InstanceToken.vue'
import FindHubBrowserAuth from '@/components/FindHubBrowserAuth.vue'
import FindHubEvents from '@/components/FindHubEvents.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import { findHubPath, isFindHub } from '@/services/findhub-channel'
const route = useRoute(), router = useRouter()
const id = computed(() => String(route.params.id))
const section = computed(() => String(route.params.section || 'conta'))
const instance = ref<any>(null), auth = ref<any>(null), devices = ref<any[]>([]), history = ref<any[]>([])
const busy = ref(false), error = ref(''), feedback = ref(''), chosen = ref(''), confirm = ref<'disconnect'|'delete'|null>(null)
const binding = ref({ enabled:false, url:'', deviceId:'' })
const connected = computed(() => auth.value?.connected === true && auth.value?.ready === true)
const trackingCount = computed(() => devices.value.filter(d => d.trackingEnabled).length)
const tabs = [{key:'conta',label:'Conta e autenticação'},{key:'dispositivos',label:'Dispositivos'},{key:'historico',label:'Histórico'},{key:'integracoes',label:'Traccar'},{key:'eventos',label:'Eventos'}]
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
    await loadSelected()
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}
async function loadSelected() {
  history.value = []; binding.value = {enabled:false,url:'',deviceId:''}
  if (!chosen.value) return
  try {
    if (section.value === 'historico' && auth.value?.historyEnabled) history.value = await connect.findHubPositions(id.value,chosen.value,100)
    if (section.value === 'integracoes') {
      const row = await connect.findHubTraccar(id.value,chosen.value)
      binding.value = {enabled:row?.enabled ?? false,url:row?.url || '',deviceId:row?.traccarDeviceId || ''}
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
    device.position = await connect.findHubLocate(id.value,device.id)
    if (!device.position) feedback.value = 'Não houve relatório de localização utilizável para este dispositivo.'
    else device.lastLocationAt = device.position.timestamp
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
async function saveBinding(remove = false) {
  busy.value = true; error.value = ''; feedback.value = ''
  try {
    await connect.findHubTraccar(id.value,chosen.value,remove ? 'DELETE' : 'PUT',remove ? undefined : binding.value)
    await loadSelected(); feedback.value = remove ? 'Vínculo removido.' : 'Vínculo Traccar salvo.'
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
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
onMounted(load)
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
          <PanelCard title="Conta e conexão"><div class="detail-list"><div><span>Conta Google</span><strong>{{ auth?.email || 'Ainda não vinculada' }}</strong></div><div><span>Conexão validada</span><strong>{{ connected ? 'Conectada' : auth?.pending ? 'Vinculação em andamento' : 'Desconectada' }}</strong></div><div><span>Histórico de posições</span><strong>{{ auth?.historyEnabled ? 'Habilitado na instalação' : 'Desabilitado' }}</strong></div></div><InstanceToken :instance-id="id" :instance-name="instance.name || id" /></PanelCard>
          <PanelCard title="Dispositivos desta conta"><div class="summary-tiles"><div><b>{{ devices.length }}</b><span>Dispositivos cadastrados</span></div><div><b>{{ trackingCount }}</b><span>Rastreamentos habilitados</span></div></div><p class="muted">A disponibilidade de posições depende do aparelho, da rede e do Google. A hora do relatório indica a idade da localização.</p></PanelCard>
        </div>
        <FindHubBrowserAuth v-if="!connected" :key="id" class="top-gap" :instance-id="id" :initial-email="auth?.email" @connected="load" />
        <PanelCard v-else class="top-gap" title="Conta Google conectada" description="O acesso ao protocolo e o catálogo de dispositivos foram validados."><button class="btn primary" @click="router.push(findHubPath(id,'dispositivos'))">Administrar dispositivos</button></PanelCard>
        <div class="danger-zone"><div><strong>Desvincular ou excluir esta conta</strong><p>Desvincular remove credenciais Google, catálogo local, vínculos e histórico associados. Não remove a conta nem apaga o smartphone no Google.</p></div><div class="toolbar"><button class="btn ghost" :disabled="busy" @click="confirm='disconnect'">Desvincular conta Google</button><button class="btn danger" :disabled="busy" @click="confirm='delete'">Excluir instância</button></div></div>
      </template>
      <PanelCard v-else-if="section==='dispositivos'" title="Dispositivos" description="Somente dispositivos retornados pela conta Google vinculada.">
        <div class="toolbar"><button class="btn primary" :disabled="busy || !connected" @click="refreshDevices">Sincronizar dispositivos</button><span class="muted">{{ connected ? 'Conexão validada' : 'Vincule a conta para obter novas posições' }}</span></div>
        <EmptyState v-if="!devices.length" icon="location" title="Nenhum dispositivo sincronizado" description="Conecte a conta Google e sincronize o catálogo." />
        <div class="instance-grid top-gap"><article v-for="device in devices" :key="device.id" class="instance-card"><h3>{{ device.name }}</h3><p>{{ deviceType(device.deviceType) }} · {{ [device.manufacturer,device.model].filter(Boolean).join(' ') }}</p><div class="detail-list"><div><span>Último relatório</span><strong>{{ stamp(device.lastLocationAt) }}</strong></div><div><span>Rastreamento</span><strong>{{ device.trackingEnabled ? 'Habilitado' : 'Desabilitado' }}</strong></div></div><label class="field top-gap"><span>Intervalo entre consultas (segundos)</span><input v-model.number="device.trackingIntervalSeconds" type="number" :min="auth?.minimumIntervalSeconds || 30" max="3600" :disabled="device.trackingEnabled" /></label><div v-if="device.position" class="alert"><strong>{{ device.position.latitude }}, {{ device.position.longitude }}</strong><p>{{ stamp(device.position.timestamp) }} · Precisão: {{ device.position.accuracy ?? '—' }} m · Origem: {{ device.position.source }}</p></div><footer class="toolbar top-gap"><button class="btn ghost" :disabled="!connected || device.locating" @click="locate(device)">{{ device.locating ? 'Localizando…' : 'Localizar agora' }}</button><button class="btn primary" :disabled="device.saving || (!connected && !device.trackingEnabled)" @click="tracking(device)">{{ device.trackingEnabled ? 'Parar rastreamento' : 'Iniciar rastreamento' }}</button></footer></article></div>
      </PanelCard>
      <PanelCard v-else-if="section==='historico'" title="Histórico de localização" description="Até 100 posições persistidas do dispositivo selecionado, mais recentes primeiro.">
        <p v-if="!auth?.historyEnabled" class="alert">O histórico está desabilitado nesta instalação. A ativação deve ser feita pelo administrador; não há coleta retroativa.</p>
        <label class="field"><span>Dispositivo</span><select v-model="chosen" :disabled="!devices.length" @change="loadSelected"><option v-for="device in devices" :key="device.id" :value="device.id">{{ device.name }}</option></select></label>
        <EmptyState v-if="!history.length" icon="location" title="Nenhuma posição persistida" description="Localizações aparecem aqui somente quando o histórico está habilitado e novos relatórios são recebidos." />
        <div v-else class="findhub-table"><table><thead><tr><th>Relatório</th><th>Latitude</th><th>Longitude</th><th>Precisão (m)</th><th>Origem</th></tr></thead><tbody><tr v-for="position in history" :key="position.id"><td>{{ stamp(position.recordedAt) }}</td><td>{{ position.latitude }}</td><td>{{ position.longitude }}</td><td>{{ position.accuracy ?? '—' }}</td><td>{{ position.source }}</td></tr></tbody></table></div>
      </PanelCard>
      <PanelCard v-else-if="section==='integracoes'" title="Integração Traccar" description="Encaminhe posições para um receptor HTTP/OsmAnd explicitamente autorizado.">
        <div class="form-stack"><label class="field"><span>Dispositivo Google</span><select v-model="chosen" :disabled="busy || !devices.length" @change="loadSelected"><option v-for="device in devices" :key="device.id" :value="device.id">{{ device.name }}</option></select></label><template v-if="chosen"><label class="toggle-field"><input v-model="binding.enabled" type="checkbox" /><span>Encaminhar posições deste dispositivo</span></label><label class="field"><span>URL do receptor Traccar</span><input v-model="binding.url" type="url" placeholder="https://seu-receptor-traccar" /></label><label class="field"><span>Identificador cadastrado no Traccar</span><input v-model="binding.deviceId" placeholder="android-equipe-01" /></label><p class="muted">Este destino recebe latitude, longitude e a hora do relatório. Use um endereço acessível pela API, não o endpoint administrativo do Traccar.</p><div class="toolbar"><button class="btn primary" :disabled="busy || !binding.url || !binding.deviceId" @click="saveBinding(false)">Salvar vínculo</button><button class="btn ghost" :disabled="busy" @click="saveBinding(true)">Remover vínculo</button></div></template><EmptyState v-else icon="location" title="Sincronize um dispositivo primeiro" description="Os vínculos são individuais por dispositivo, não por conversa ou número." /></div>
      </PanelCard>
      <FindHubEvents v-else-if="section==='eventos'" :key="id" :instance-id="id" />
    </template>
    <AppModal :open="confirm!==null" :title="confirm==='delete' ? 'Excluir instância Google Find Hub' : 'Desvincular conta Google'" subtitle="Confirme a remoção dos dados locais desta conta." @close="confirm=null"><p>Esta operação remove credenciais, catálogo, histórico e vínculos locais associados a esta conta. Nenhum dispositivo físico será apagado. As demais instâncias não serão alteradas.</p><template #footer><button class="btn ghost" :disabled="busy" @click="confirm=null">Cancelar</button><button class="btn danger" :disabled="busy" @click="accountAction">Confirmar</button></template></AppModal>
  </FindHubShell>
</template>
<style scoped>
.findhub-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}.findhub-tabs a{padding:10px 14px;border:1px solid var(--border);border-radius:10px;color:var(--text);background:var(--surface);text-decoration:none}.findhub-tabs a.active{background:var(--primary);color:#fff}.findhub-table{overflow:auto;margin-top:20px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:12px;border-bottom:1px solid var(--border)}.instance-card h3{margin:0}.instance-card footer{margin-top:20px}
</style>
