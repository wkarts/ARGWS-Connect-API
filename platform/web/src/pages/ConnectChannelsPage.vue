<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Cable, MessageSquare, Network, RefreshCw, ShieldCheck } from 'lucide-vue-next'
import { RouterLink } from 'vue-router'
import { listEngineInstances, type EngineInstance } from '../api/connectEngine'
import PageHeader from '../components/PageHeader.vue'

const loading = ref(false)
const instances = ref<EngineInstance[]>([])
const error = ref('')

const providerStats = computed(() => {
  const map = new Map<string, { provider: string; total: number; online: number }>()
  for (const item of instances.value) {
    const key = String(item.provider || 'UNKNOWN').toUpperCase()
    const row = map.get(key) || { provider: key, total: 0, online: 0 }
    row.total += 1
    const state = String(item.state || item.status || '').toLowerCase()
    if (['open', 'connected', 'online', 'ready'].some((value) => state.includes(value))) row.online += 1
    map.set(key, row)
  }
  return [...map.values()].sort((a, b) => a.provider.localeCompare(b.provider))
})

async function load() {
  loading.value = true
  error.value = ''
  try { instances.value = await listEngineInstances() }
  catch (reason) { error.value = reason instanceof Error ? reason.message : 'Não foi possível carregar os canais.' }
  finally { loading.value = false }
}

onMounted(load)
</script>

<template>
  <PageHeader title="Canais" subtitle="Visão consolidada dos providers e instâncias vinculadas a este tenant.">
    <template #actions><button class="btn-secondary" :disabled="loading" @click="load"><RefreshCw :size="15" :class="loading ? 'animate-spin' : ''" /> Atualizar</button></template>
  </PageHeader>

  <div v-if="error" class="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{{ error }}</div>

  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    <section v-for="item in providerStats" :key="item.provider" class="metric-card">
      <div><p class="text-xs font-semibold uppercase tracking-wide text-slate-500">{{ item.provider }}</p><p class="mt-2 text-2xl font-semibold text-slate-950">{{ item.online }} / {{ item.total }}</p><p class="mt-1 text-xs text-slate-500">instâncias online / total</p></div>
      <div class="grid h-11 w-11 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600"><Cable :size="21" /></div>
    </section>
    <section v-if="!loading && !providerStats.length" class="rounded-2xl border border-dashed border-slate-200 bg-white p-6 sm:col-span-2 xl:col-span-3">
      <MessageSquare :size="22" class="text-slate-300"/><p class="mt-3 text-sm font-semibold text-slate-700">Nenhum canal provisionado</p><p class="mt-1 text-sm text-slate-500">Crie uma instância para habilitar WhatsApp Business, Baileys ou CONNECT conforme as capabilities do Engine.</p><RouterLink to="/instances" class="btn-primary mt-4 inline-flex">Gerenciar instâncias</RouterLink>
    </section>
  </div>

  <section class="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div class="flex items-center gap-3"><ShieldCheck :size="19" class="text-emerald-600"/><div><p class="text-sm font-semibold text-slate-900">Provider isolado por instância</p><p class="mt-1 text-xs leading-5 text-slate-500">A Platform não expõe a chave global do Engine ao navegador. Toda operação é resolvida pelo EngineBinding do tenant no Control API.</p></div></div>
    <div class="mt-4 flex items-center justify-between rounded-xl bg-slate-50 p-4"><div class="flex items-center gap-3"><Network :size="18" class="text-blue-600"/><span class="text-sm text-slate-700">{{ instances.length }} instância(s) vinculada(s)</span></div><RouterLink to="/instances" class="text-xs font-semibold text-blue-600">Abrir instâncias</RouterLink></div>
  </section>
</template>
