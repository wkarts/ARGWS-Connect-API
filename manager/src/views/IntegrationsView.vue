<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { connect } from '@/services/connect'
import { integrationDefinitions, integrationOrder } from '@/config/integrations'
import { friendlyError } from '@/services/errors'
import type { ConnectionItem } from '@/types/domain'

const router = useRouter()
const items = ref<ConnectionItem[]>([])
const loading = ref(true)
const error = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try { items.value = await connect.connections() }
  catch (e) { error.value = friendlyError(e) }
  finally { loading.value = false }
}

function openInstance(id: string) {
  router.push(`/instancias/${encodeURIComponent(id)}/integracoes`)
}

onMounted(load)
</script>

<template>
  <AppShell>
    <PageHeader title="Integrações" description="Conecte automações, inteligência e serviços externos às suas instâncias." />

    <div class="integration-catalog">
      <PanelCard v-for="key in integrationOrder" :key="key">
        <div class="integration-catalog-card">
          <span class="integration-brand" :class="`accent-${integrationDefinitions[key].accent}`">{{ integrationDefinitions[key].title.slice(0, 2).toUpperCase() }}</span>
          <div>
            <h3>{{ integrationDefinitions[key].title }}</h3>
            <p>{{ integrationDefinitions[key].description }}</p>
          </div>
        </div>
      </PanelCard>
    </div>

    <div class="section-title top-gap-lg">
      <div><h2>Escolha uma instância</h2><p>As integrações são configuradas individualmente em cada conexão.</p></div>
      <button class="btn ghost" @click="load"><AppIcon name="refresh" :size="16"/>Atualizar</button>
    </div>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-else-if="loading" class="cards-skeleton"></div>
    <EmptyState v-else-if="!items.length" icon="radio" title="Nenhuma instância disponível" description="Crie uma instância para começar a configurar integrações." />
    <div v-else class="instance-integration-list">
      <button v-for="item in items" :key="item.id" class="instance-integration-row" @click="openInstance(item.id)">
        <span class="instance-avatar"><img v-if="item.avatar" :src="item.avatar" alt=""/><AppIcon v-else name="radio"/></span>
        <span class="instance-integration-copy"><strong>{{ item.name }}</strong><small>{{ item.profileName || item.number || item.channel }}</small></span>
        <span class="instance-integration-action">Configurar <AppIcon name="arrow" :size="16"/></span>
      </button>
    </div>
  </AppShell>
</template>
