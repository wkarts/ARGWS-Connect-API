<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import InstanceToken from './InstanceToken.vue'
import StatusPill from './StatusPill.vue'
import { connect } from '@/services/connect'
import { findHubPath } from '@/services/findhub-channel'
import type { ConnectionItem } from '@/types/domain'
const props = defineProps<{ item: ConnectionItem }>()
const router = useRouter(), snapshot = ref<any>(null)
const status = computed(() => snapshot.value ? snapshot.value.connected ? 'connected' : 'disconnected' : 'unknown')
watch(() => [props.item.id, props.item.updatedAt], async () => {
  const id = props.item.id; snapshot.value = null
  try { const result = await connect.findHubSnapshot(id); if (props.item.id === id) snapshot.value = result } catch { /* Do not invent a healthy status. */ }
}, { immediate: true })
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
    <footer class="instance-card-actions" @click.stop>
      <button class="card-link" type="button" @click="router.push(findHubPath(item.id,'mapa'))">Rastrear Real Time</button>
      <button class="card-link" type="button" @click="router.push(findHubPath(item.id))">Abrir <AppIcon name="arrow" :size="15" /></button>
    </footer>
  </article>
</template>
<style scoped>
.findhub-card{display:flex;flex-direction:column}.instance-card-actions{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:auto;padding-top:13px}.card-link{border:0;background:transparent;padding:0;min-height:24px;line-height:1.4;margin-top:0}.card-link:hover{text-decoration:underline}.card-link:focus-visible{outline:2px solid var(--primary);outline-offset:4px}
</style>
