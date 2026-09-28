<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import FindHubShell from '@/layouts/FindHubShell.vue'
import FindHubInstanceCard from '@/components/FindHubInstanceCard.vue'
import PageHeader from '@/components/PageHeader.vue'
import AppModal from '@/components/AppModal.vue'
import EmptyState from '@/components/EmptyState.vue'
import { connect } from '@/services/connect'
import { friendlyError } from '@/services/errors'
import { isFindHub, findHubPath, FINDHUB_PROVIDER } from '@/services/findhub-channel'
import type { ConnectionItem } from '@/types/domain'
const router = useRouter()
const items = ref<ConnectionItem[]>([]), loading = ref(true), busy = ref(false), error = ref(''), open = ref(false), name = ref('')
async function load() {
  loading.value = true; error.value = ''
  try { items.value = (await connect.connections()).filter(isFindHub) }
  catch (e) { error.value = friendlyError(e) }
  finally { loading.value = false }
}
async function create() {
  if (busy.value || !name.value.trim()) return
  busy.value = true; error.value = ''
  try {
    const result = await connect.createConnection({ instanceName: name.value.trim(), integration: FINDHUB_PROVIDER })
    open.value = false
    await router.push(findHubPath(String(result?.instance?.instanceId || name.value.trim())))
  } catch (e) { error.value = friendlyError(e) }
  finally { busy.value = false }
}
onMounted(load)
</script>
<template>
  <FindHubShell>
    <PageHeader title="Google Find Hub" description="Contas Google, dispositivos Android e localização.">
      <button class="btn ghost" :disabled="loading" @click="load">Atualizar</button>
      <button class="btn primary" @click="open=true">Adicionar conta</button>
    </PageHeader>
    <div v-if="error" class="alert error">{{ error }}</div>
    <div v-if="loading" class="cards-skeleton"></div>
    <EmptyState v-else-if="!items.length" icon="location" title="Nenhuma conta Google cadastrada" description="Adicione uma conta para configurar a vinculação e administrar seus dispositivos." />
    <div v-else class="instance-grid"><FindHubInstanceCard v-for="item in items" :key="item.id" :item="item" /></div>
    <AppModal :open="open" title="Adicionar conta Google Find Hub" subtitle="Cada instância administra uma conta Google independente." @close="open=false">
      <form class="form-stack" @submit.prevent="create"><label class="field"><span>Nome da conta na Connect|API</span><input v-model="name" required maxlength="100" placeholder="Ex.: Dispositivos da equipe" /></label><p>A autenticação Google é uma etapa separada. Nenhuma configuração de mensagens é aplicada a esta conta.</p></form>
      <template #footer><button class="btn ghost" :disabled="busy" @click="open=false">Cancelar</button><button class="btn primary" :disabled="busy || !name.trim()" @click="create">{{ busy ? 'Criando...' : 'Criar conta' }}</button></template>
    </AppModal>
  </FindHubShell>
</template>
