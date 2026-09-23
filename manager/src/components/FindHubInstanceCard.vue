<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'
import InstanceToken from './InstanceToken.vue'
import { findHubPath } from '@/services/findhub-channel'
import type { ConnectionItem } from '@/types/domain'
const props = defineProps<{ item: ConnectionItem }>()
const router = useRouter()
</script>
<template>
  <article class="instance-card findhub-card">
    <div class="instance-card-head">
      <div class="instance-avatar"><AppIcon name="location" :size="22" /></div>
      <div><strong>{{ props.item.name }}</strong><span>Conta Google · Canal de localização</span></div>
    </div>
    <div class="provider-row"><span>Canal</span><strong>Google Find Hub</strong></div>
    <p class="muted-block">Dispositivos Android, posições e rastreamento. A situação da vinculação é verificada ao abrir a conta.</p>
    <InstanceToken :instance-id="props.item.id" :instance-name="props.item.name" />
    <footer class="instance-card-actions"><button class="card-link instance-card-action" @click="router.push(findHubPath(props.item.id,'dispositivos'))">Dispositivos</button><button class="card-link instance-card-action" @click="router.push(findHubPath(props.item.id))">Abrir <AppIcon name="arrow" :size="15" /></button></footer>
  </article>
</template>

<style scoped>
.instance-card-actions{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-top:auto;padding-top:16px;border-top:1px solid var(--border)}.instance-card-action{display:inline-flex;align-items:center;gap:6px}.findhub-card{display:flex;flex-direction:column;gap:12px}.muted-block{margin:0;line-height:1.55}
</style>
