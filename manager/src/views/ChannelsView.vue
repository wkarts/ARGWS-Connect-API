<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import StatusPill from '@/components/StatusPill.vue'
import AppIcon from '@/components/AppIcon.vue'
import { connect } from '@/services/connect'
import type { ConnectionItem } from '@/types/domain'

type ChannelSummary = {
  name: string
  total: number
  connected: number
}

const items = ref<ConnectionItem[]>([])

onMounted(async () => {
  items.value = await connect.connections().catch(() => [])
})

const groups = computed<ChannelSummary[]>(() => {
  const grouped: Record<string, ChannelSummary> = {}

  for (const item of items.value) {
    const channel = item.channel || 'Canal'
    const current = grouped[channel] ?? (grouped[channel] = {
      name: channel,
      total: 0,
      connected: 0,
    })

    current.total += 1
    if (item.status === 'connected') current.connected += 1
  }

  return Object.values(grouped)
})
</script>

<template>
  <AppShell>
    <PageHeader title="Canais" description="Acompanhe os canais de comunicação disponíveis." />

    <div class="channel-grid">
      <PanelCard v-for="item in groups" :key="item.name">
        <div class="channel-card">
          <span class="channel-icon" :class="{ 'whatsapp-brand': item.name === 'WhatsApp' }">
            <AppIcon :name="item.name === 'WhatsApp' ? 'whatsapp' : 'channels'" :size="23" />
          </span>
          <div>
            <h3>{{ item.name }}</h3>
            <p>{{ item.connected }} de {{ item.total }} conexões ativas</p>
          </div>
          <StatusPill :status="item.connected === item.total ? 'ok' : 'attention'" />
        </div>
      </PanelCard>
    </div>
  </AppShell>
</template>

<style scoped>
.channel-icon.whatsapp-brand {
  color: #25d366;
  background: color-mix(in srgb, #25d366 11%, var(--surface));
}
</style>