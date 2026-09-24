<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import AppModal from './AppModal.vue'
import FindHubLiveTracking from './FindHubLiveTracking.vue'
import { connect } from '@/services/connect'
import { applyFindHubUpdate } from '@/services/findhub-live-state'
import { friendlyError } from '@/services/errors'
const props = defineProps<{ open: boolean; instanceId: string; initialDevice?: string }>()
const emit = defineEmits<{ close: [] }>()
const snapshot = ref<any>(null), error = ref(''), state = ref('Conectando atualizações…'), content = ref<HTMLElement>()
let abort: AbortController | null = null, retry: ReturnType<typeof setTimeout> | null = null
let focusBefore: HTMLElement | null = null
function stop() { abort?.abort(); abort = null; if (retry) clearTimeout(retry); retry = null }
async function refresh() {
  const signal = abort?.signal, id = props.instanceId
  try { const data = await connect.findHubSnapshot(id); if (!signal?.aborted && props.open && props.instanceId === id) snapshot.value = data }
  catch (e) { if (!signal?.aborted && props.open) error.value = friendlyError(e) }
}
function keyboard(event: KeyboardEvent) {
  if (!props.open) return
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); return }
  if (event.key !== 'Tab') return
  const root = content.value?.closest('.app-modal')
  const controls = Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]') || []).filter(el => el.getClientRects().length)
  if (!controls.length) { event.preventDefault(); content.value?.focus(); return }
  const index = controls.indexOf(document.activeElement as HTMLElement)
  if (event.shiftKey && index <= 0) { event.preventDefault(); controls[controls.length - 1].focus() }
  else if (!event.shiftKey && (index === -1 || index === controls.length - 1)) { event.preventDefault(); controls[0].focus() }
}
watch(() => [props.open, props.instanceId] as const, async ([open, id]) => {
  stop(); document.removeEventListener('keydown', keyboard)
  snapshot.value = null; error.value = ''; state.value = 'Conectando atualizações…'
  if (!open) { focusBefore?.focus(); focusBefore = null; return }
  if (!focusBefore) focusBefore = document.activeElement as HTMLElement
  const controller = new AbortController(); abort = controller
  document.addEventListener('keydown', keyboard)
  await nextTick(); content.value?.focus()
  let failures = 0
  const start = async () => {
    if (controller.signal.aborted) return
    try {
      await connect.findHubStream(id, controller.signal, event => {
        if (controller.signal.aborted || id !== props.instanceId) return
        snapshot.value = applyFindHubUpdate(snapshot.value, event, id)
        failures = 0; state.value = 'Atualizações conectadas'; error.value = ''
      })
    } catch (e) {
      if (controller.signal.aborted) return
      error.value = friendlyError(e)
      if ([401,403].includes((e as any)?.status)) { state.value = 'Acesso não autorizado'; return }
    }
    if (!controller.signal.aborted) {
      state.value = 'Atualizações interrompidas — reconectando'
      retry = setTimeout(() => { void start() }, Math.min(30000, 1000 * 2 ** Math.min(++failures, 5)))
    }
  }
  void start()
}, { immediate: true })
onBeforeUnmount(() => { stop(); document.removeEventListener('keydown', keyboard); focusBefore?.focus() })
</script>
<template>
  <AppModal :open="open" title="Acompanhar dispositivo em tempo real" subtitle="A conta e o dispositivo continuam isolados. Fechar esta janela não desliga o rastreamento." wide @close="emit('close')">
    <div ref="content" role="dialog" aria-modal="true" aria-label="Rastreamento de dispositivos" tabindex="-1">
      <div v-if="error" class="alert error" role="alert">{{ error }}</div>
      <FindHubLiveTracking v-if="snapshot" :instance-id="instanceId" :snapshot="snapshot" :stream-state="state" :initial-device="initialDevice" @refresh="refresh" />
      <p v-else role="status">{{ state }}</p>
    </div>
  </AppModal>
</template>
