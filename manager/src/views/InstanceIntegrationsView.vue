<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import PageHeader from '@/components/PageHeader.vue'
import PanelCard from '@/components/PanelCard.vue'
import AppIcon from '@/components/AppIcon.vue'
import StatusPill from '@/components/StatusPill.vue'
import { connect } from '@/services/connect'
import { integrationDefinitions, integrationOrder } from '@/config/integrations'
import { settingDescriptions, settingOrder, settingTitles } from '@/config/instance-settings'
import { friendlyError } from '@/services/errors'

const route = useRoute()
const router = useRouter()
const id = String(route.params.id)
const item = ref<any>(null)
const error = ref('')
const loading = ref(true)

const provider = computed(() => {
  const value = String(item.value?.integration || '').toUpperCase()
  if (value === 'WHATSAPP-BAILEYS') return 'Baileys'
  if (value === 'WHATSAPP-ZAPO') return 'ZAPO'
  if (value === 'WHATSAPP-BUSINESS') return 'WhatsApp Business / Cloud API'
  return value || 'Não identificado'
})

async function load() {
  loading.value = true
  error.value = ''
  try { item.value = await connect.connection(id) }
  catch (e) { error.value = friendlyError(e) }
  finally { loading.value = false }
}

function goIntegration(key: string) {
  router.push(`/instancias/${encodeURIComponent(id)}/integracoes/${key}`)
}

function goSetting(key: string) {
  router.push(`/instancias/${encodeURIComponent(id)}/configuracoes/${key}`)
}

onMounted(load)
</script>

<template>
  <AppShell>
    <PageHeader :title="item?.name || item?.instanceName || 'Instância'" description="Automações, integrações e conexões desta instância.">
      <button class="btn ghost" @click="router.push(`/instancias/${encodeURIComponent(id)}`)"><AppIcon name="arrow" :size="16" class="icon-back"/>Voltar à instância</button>
    </PageHeader>

    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-else-if="loading" class="skeleton-page"></div>
    <template v-else>
      <div class="instance-context-strip">
        <div><span>Provider</span><strong>{{ provider }}</strong></div>
        <div><span>Canal</span><strong>WhatsApp</strong></div>
        <div><span>Situação</span><StatusPill :status="item?.connectionStatus || item?.status" /></div>
      </div>

      <div class="section-title top-gap-lg"><div><h2>Automações e inteligência</h2><p>Conecte os recursos já suportados pela sua instância.</p></div></div>
      <div class="integration-grid">
        <button v-for="key in integrationOrder" :key="key" class="integration-tile" @click="goIntegration(key)">
          <span class="integration-brand" :class="`accent-${integrationDefinitions[key].accent}`">{{ integrationDefinitions[key].title.slice(0, 2).toUpperCase() }}</span>
          <span class="integration-tile-copy"><strong>{{ integrationDefinitions[key].title }}</strong><small>{{ integrationDefinitions[key].description }}</small></span>
          <AppIcon name="arrow" :size="17"/>
        </button>
      </div>

      <div class="section-title top-gap-lg"><div><h2>Conexões e eventos</h2><p>Controle entrega de eventos, sincronizações e comportamento da instância.</p></div></div>
      <div class="settings-capability-grid">
        <PanelCard v-for="key in settingOrder" :key="key">
          <button class="setting-capability" @click="goSetting(key)">
            <span class="setting-capability-icon"><AppIcon :name="key === 'webhook' ? 'workflow' : key === 'settings' ? 'settings' : 'channels'" :size="20"/></span>
            <span><strong>{{ settingTitles[key] }}</strong><small>{{ settingDescriptions[key] }}</small></span>
            <AppIcon name="arrow" :size="16"/>
          </button>
        </PanelCard>
      </div>
    </template>
  </AppShell>
</template>
