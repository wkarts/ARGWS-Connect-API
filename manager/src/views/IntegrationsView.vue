<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import { connect } from '@/services/connect'
import { integrationDefinitions } from '@/services/integration-definitions'
import { friendlyError } from '@/services/errors'
import type { ConnectionItem, IntegrationKey, IntegrationSummary } from '@/types/domain'

const route = useRoute()
const router = useRouter()
const instances = ref<ConnectionItem[]>([])
const selected = ref(String(route.params.id || route.query.instance || ''))
const summaries = ref<IntegrationSummary[]>([])
const loading = ref(false)
const error = ref('')

const selectedInstance = computed(() => instances.value.find((item) => item.id === selected.value))
const automationKeys: IntegrationKey[] = ['n8n','typebot','connectBot']
const aiKeys: IntegrationKey[] = ['dify','flowise','openai','connectAI']

function summaryFor(key: IntegrationKey) {
  return summaries.value.find((item) => item.key === key) || {
    key,
    label: integrationDefinitions[key].label,
    configured: false,
    count: 0,
    status: 'not_configured' as const,
    detail: 'Pronto para configurar',
  }
}

async function loadSummaries() {
  if (!selected.value) { summaries.value = []; return }
  loading.value = true
  error.value = ''
  try { summaries.value = await connect.integrationSummaries(selected.value) }
  catch (e) { error.value = friendlyError(e) }
  finally { loading.value = false }
}

function openIntegration(key: IntegrationKey) {
  router.push(`/instancias/${encodeURIComponent(selected.value)}/integracoes/${key}`)
}

onMounted(async () => {
  instances.value = await connect.connections().catch(() => [])
  if (!selected.value || !instances.value.some((item) => item.id === selected.value)) selected.value = instances.value[0]?.id || ''
  await loadSummaries()
})
watch(selected, loadSummaries)
</script>

<template>
  <AppShell>
    <PageHeader title="Integrações" description="Automação, inteligência e serviços conectados às suas instâncias.">
      <button class="btn ghost" :disabled="loading" @click="loadSummaries"><AppIcon name="refresh" :size="16"/>Atualizar</button>
    </PageHeader>

    <div class="integration-instance-bar">
      <label><span>Instância</span><select v-model="selected" class="select"><option v-for="item in instances" :key="item.id" :value="item.id">{{ item.name }} · {{ item.providerLabel }}</option></select></label>
      <div v-if="selectedInstance" class="provider-inline"><span>Provider</span><strong>{{ selectedInstance.providerLabel }}</strong></div>
    </div>

    <div v-if="error" class="alert error">{{ error }}</div>
    <EmptyState v-if="!instances.length" icon="automation" title="Nenhuma instância disponível" description="Crie uma instância antes de configurar integrações."/>

    <template v-else>
      <section class="integration-section">
        <div class="section-title"><div><h2>Automações</h2><p>Conecte fluxos e aplicações sem depender de uma conta previamente cadastrada nesta interface.</p></div></div>
        <div class="integration-grid">
          <button v-for="key in automationKeys" :key="key" class="integration-card" @click="openIntegration(key)">
            <span class="integration-symbol"><AppIcon name="automation" :size="22"/></span>
            <div><strong>{{ integrationDefinitions[key].label }}</strong><small>{{ integrationDefinitions[key].description }}</small></div>
            <span :class="['integration-status', summaryFor(key).configured ? 'configured' : 'ready']">{{ summaryFor(key).status === 'error' ? 'Indisponível' : summaryFor(key).configured ? `${summaryFor(key).count} configurada${summaryFor(key).count === 1 ? '' : 's'}` : 'Desativado' }}</span>
            <span class="integration-action">{{ summaryFor(key).configured ? 'Gerenciar' : 'Configurar' }} <AppIcon name="arrow" :size="14"/></span>
          </button>
        </div>
      </section>

      <section class="integration-section">
        <div class="section-title"><div><h2>Inteligência</h2><p>Configure credenciais e agentes somente quando a integração exigir.</p></div></div>
        <div class="integration-grid">
          <button v-for="key in aiKeys" :key="key" class="integration-card" @click="openIntegration(key)">
            <span class="integration-symbol"><AppIcon name="workflow" :size="22"/></span>
            <div><strong>{{ integrationDefinitions[key].label }}</strong><small>{{ integrationDefinitions[key].description }}</small></div>
            <span :class="['integration-status', summaryFor(key).configured ? 'configured' : 'ready']">{{ summaryFor(key).status === 'error' ? 'Indisponível' : summaryFor(key).configured ? `${summaryFor(key).count} configurada${summaryFor(key).count === 1 ? '' : 's'}` : 'Desativado' }}</span>
            <span class="integration-action">{{ summaryFor(key).configured ? 'Gerenciar' : 'Configurar' }} <AppIcon name="arrow" :size="14"/></span>
          </button>
        </div>
      </section>

      <PanelCard title="Conexões e eventos" description="Webhooks, filas, tempo real, atendimento e rede são configurados por instância.">
        <button class="btn primary" :disabled="!selected" @click="router.push(`/instancias/${encodeURIComponent(selected)}/configuracao`)"><AppIcon name="settings" :size="16"/>Abrir configurações da instância</button>
      </PanelCard>
    </template>
  </AppShell>
</template>
