<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import InstanceToken from './InstanceToken.vue'
import StatusPill from './StatusPill.vue'
import FindHubTrackingModal from './FindHubTrackingModal.vue'
import FindHubPositionDetails from './FindHubPositionDetails.vue'
import { applyFindHubUpdate } from '@/services/findhub-live-state'
import { connect } from '@/services/connect'
import { findHubPath } from '@/services/findhub-channel'
import type { ConnectionItem } from '@/types/domain'
const props = defineProps<{ item: ConnectionItem }>()
const router = useRouter(), snapshot = ref<any>(null)
const trackingOpen = ref(false)
const status = computed(() => snapshot.value ? snapshot.value.connected ? 'connected' : 'disconnected' : 'unknown')
const selectedDeviceId = ref(''), streamState = ref('Conectando atualizações…')
const selectedDevice = computed(() => snapshot.value?.devices?.find((d: any) => d.id === selectedDeviceId.value) || snapshot.value?.devices?.[0])
let stream: AbortController | null = null, retry: ReturnType<typeof setTimeout> | null = null
function stopStream() { stream?.abort(); stream = null; if (retry) clearTimeout(retry); retry = null }
watch(() => [props.item.id, props.item.updatedAt], async () => {
  stopStream()
  const id = props.item.id, controller = new AbortController()
  stream = controller; snapshot.value = null; selectedDeviceId.value = ''; streamState.value = 'Conectando atualizações…'
  let failures = 0
  const open = async () => {
    if (controller.signal.aborted) return
    try {
      await connect.findHubStream(id, controller.signal, event => {
        if (controller.signal.aborted || props.item.id !== id) return
        snapshot.value = applyFindHubUpdate(snapshot.value, event, id)
        failures = 0; streamState.value = 'Atualizações conectadas'
      })
    } catch (error) {
      if (controller.signal.aborted) return
      if ([401, 403].includes((error as any)?.status)) { snapshot.value = null; streamState.value = 'Acesso não autorizado'; return }
      failures = Math.min(failures + 1, 5)
    }
    if (!controller.signal.aborted) {
      streamState.value = 'Atualizações interrompidas — reconectando'
      retry = setTimeout(() => { void open() }, Math.min(30000, 1000 * 2 ** failures))
    }
  }
  void open()
}, { immediate: true })
onBeforeUnmount(stopStream)
const count = (key: string) => snapshot.value?.counts?.[key]?.toLocaleString('pt-BR') ?? '—'
</script>
<template>
  <article class="instance-card findhub-card" @click="router.push(findHubPath(item.id))">
    <div class="instance-card-head">
      <div class="instance-avatar"><AppIcon name="location" :size="22" /></div>
      <div><strong>{{ item.name }}</strong><span>Conta Google · Canal de localização</span></div>
      <StatusPill :status="status" :label="!snapshot ? 'Não verificado' : undefined" />
    </div>
    <div class="provider-row"><span>Provider</span><strong>Google Find Hub</strong></div>
    <div class="instance-number">{{ snapshot?.email || 'Conta ainda não vinculada' }}</div>
    <InstanceToken :instance-id="item.id" :instance-name="item.name" />
    <div class="instance-stats">
      <div><b>{{ count('devices') }}</b><span>Dispositivos</span></div>
      <div><b>{{ count('tracking') }}</b><span>Rastreando</span></div>
      <div><b>{{ count('positions') }}</b><span>Posições salvas</span></div>
    </div>
    <div v-if="snapshot?.devices?.length" class="card-position" @click.stop>
      <label v-if="snapshot.devices.length > 1" class="field"><span>Dispositivo</span><select v-model="selectedDeviceId" class="select"><option value="">{{ snapshot.devices[0].name }}</option><option v-for="device in snapshot.devices.slice(1)" :key="device.id" :value="device.id">{{ device.name }}</option></select></label>
      <span v-else class="muted">{{ selectedDevice?.name }}</span>
      <FindHubPositionDetails :device="selectedDevice" :stale-after-seconds="snapshot.settings.staleAfterSeconds" compact />
      <small class="muted" role="status">{{ streamState }}</small>
    </div>
    <footer class="instance-card-actions" @click.stop>
      <button class="card-link" type="button" @click="trackingOpen=true">Rastrear Real Time</button>
      <button class="card-link" type="button" @click="router.push(findHubPath(item.id))">Abrir <AppIcon name="arrow" :size="15" /></button>
    </footer>
  </article>
  <FindHubTrackingModal :open="trackingOpen" :instance-id="item.id" :initial-device="selectedDevice?.id" @close="trackingOpen=false" />
</template>
<style scoped>
.card-position{margin-top:12px}.findhub-card{display:flex;flex-direction:column}.instance-card-actions{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:auto;padding-top:13px}.card-link{border:0;background:transparent;padding:0;min-height:24px;line-height:1.4;margin-top:0}.card-link:hover{text-decoration:underline}.card-link:focus-visible{outline:2px solid var(--primary);outline-offset:4px}
</style>
