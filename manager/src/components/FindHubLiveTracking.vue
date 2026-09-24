<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import PanelCard from './PanelCard.vue'
import FindHubMap from './FindHubMap.vue'
import FindHubPositionDetails from './FindHubPositionDetails.vue'
import { locateResultMessage, locateErrorMessage, queryMessage } from '@/services/findhub-position'
import { connect } from '@/services/connect'
import { useFindHubAvatar } from '@/services/use-findhub-avatar'
import { friendlyError } from '@/services/errors'
import { findHubAvailability } from '@/services/findhub-stream'
const props = defineProps<{ instanceId: string; snapshot: any; streamState: string; initialDevice?: string }>()
const emit = defineEmits<{ refresh: [] }>()
const selected = ref(props.initialDevice || ''), interval = ref(60), timeout = ref(30000), error = ref(''), feedback = ref(''), busy = ref(false), now = ref(Date.now()), trail = ref<any[]>([])
const clock = setInterval(() => { now.value = Date.now() }, 5000)
onBeforeUnmount(() => clearInterval(clock))
const device = computed(() => props.snapshot.devices.find((d: any) => d.id === selected.value))
const avatar = useFindHubAvatar(() => props.instanceId, () => device.value)
const status = computed(() => findHubAvailability(device.value, props.snapshot.settings.staleAfterSeconds, now.value))
const lastQueryMessage = computed(() => queryMessage(device.value?.lastQuery))
watch(() => device.value?.lastQuery?.completedAt, () => { if (device.value?.lastQuery?.status === 'new_report') { error.value = ''; feedback.value = '' } })
watch(() => props.initialDevice, value => { if (value && props.snapshot.devices.some((d: any) => d.id === value)) selected.value = value })
watch(() => props.snapshot.devices.map((d: any) => d.id).join(','), () => { if(!props.snapshot.devices.some((d: any) => d.id === selected.value)) selected.value = props.snapshot.devices[0]?.id || '' }, { immediate: true })
watch(selected, () => { trail.value = []; error.value = ''; feedback.value = ''; interval.value = device.value?.trackingIntervalSeconds ?? props.snapshot.settings.intervalSeconds; timeout.value = device.value?.locationTimeoutMs || props.snapshot.settings.timeoutMs }, { immediate:true })
watch(() => device.value?.latestPosition, (position: any) => { if (position && !trail.value.some(p => p.timestamp===position.timestamp && p.latitude===position.latitude && p.longitude===position.longitude)) { trail.value.push(position); trail.value = trail.value.slice(-500) } }, { immediate:true })
async function action(kind: 'locate'|'start'|'stop') {
 if(!device.value || busy.value) return
 const deviceId = device.value.id, instanceId = props.instanceId, previous = device.value.latestPosition
 busy.value = true; error.value = ''; feedback.value = ''
 try {
  if(kind==='locate') {
    const position = await connect.findHubLocate(instanceId, deviceId, timeout.value)
    if (selected.value === deviceId && props.instanceId === instanceId) feedback.value = locateResultMessage(position, previous)
  } else if(kind==='start') await connect.findHubStartTracking(instanceId, deviceId, interval.value, timeout.value)
  else await connect.findHubStopTracking(instanceId, deviceId)
  if (props.instanceId === instanceId) emit('refresh')
 } catch(e) {
  if (selected.value === deviceId && props.instanceId === instanceId) error.value = friendlyError(new Error(locateErrorMessage(e, timeout.value)))
 } finally { busy.value=false }
}
</script>
<template><PanelCard title="Localização em tempo real" description="Atualizações por eventos. A posição e o horário exibidos são os efetivamente recebidos, sem simulação de movimento."><div v-if="error" class="alert error" role="alert">{{ error }}</div><div v-else-if="feedback" class="alert" role="status">{{ feedback }}</div><div class="toolbar"><label class="field device-choice"><span>Dispositivo da conta</span><select v-model="selected" :disabled="busy" class="select"><option v-for="d in snapshot.devices" :key="d.id" :value="d.id">{{ d.name }}</option></select></label><span class="muted" role="status">{{ streamState }}</span></div><div v-if="device" class="tracking-tools"><label class="field"><span>Intervalo entre consultas (segundos)</span><input v-model.number="interval" type="number" min="0" step="1" max="86400"/></label><label class="field"><span>Timeout da consulta (milissegundos)</span><input v-model.number="timeout" type="number" min="1" max="2147483647" step="1"/></label><div class="toolbar"><button class="btn ghost" :disabled="busy || !snapshot.connected" @click="action('locate')">Localizar agora</button><button class="btn ghost" :disabled="busy || !snapshot.connected" @click="action('start')">{{ device.trackingEnabled ? 'Aplicar intervalo' : 'Iniciar rastreamento' }}</button><button v-if="device.trackingEnabled" class="btn ghost" :disabled="busy" @click="action('stop')">Parar</button></div></div><p class="muted">Recomendado: 60 segundos. 0 consulta novamente ao concluir a anterior; 1, 2 ou mais são aceitos. Falhas e limites do Google podem impor recuo, sem alterar sua configuração.</p><p class="muted">Timeout configurável a partir de 1 ms. Um prazo muito curto pode encerrar a espera antes de o Google responder; ele não acelera o GPS.</p><div class="map-status" role="status"><strong>{{ status }}</strong></div><FindHubPositionDetails :device="device" :stale-after-seconds="snapshot.settings.staleAfterSeconds"/><div v-if="lastQueryMessage" class="alert" role="status">{{ lastQueryMessage }}</div><FindHubMap :key="selected" :position="device?.latestPosition" :trail="trail" :tile-url="snapshot.map?.tileUrl" :avatar-data="avatar" :device-name="device?.name"/><p class="muted top-gap">Uma posição recente não comprova que o aparelho está online. Offline/online só são indicados quando o provedor informa esse estado. O Google pode retornar a última posição conhecida; o intervalo configurado não garante novas coordenadas nesse prazo.</p><p class="muted">Os mapas usam tiles externos OpenStreetMap por padrão; o provedor recebe a área visualizada. A instalação pode configurar um servidor próprio de tiles.</p></PanelCard></template>
<style scoped>.device-choice{min-width:220px;flex:1}.tracking-tools{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin:18px 0}.tracking-tools .field{flex:1;min-width:200px}.tracking-tools .toolbar{margin:0}.map-status{display:flex;gap:16px;flex-wrap:wrap;margin:14px 0;color:var(--muted)}.map-status strong{color:var(--text)}</style>
