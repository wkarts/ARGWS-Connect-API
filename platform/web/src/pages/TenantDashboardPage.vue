<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Activity, AppWindow, Braces, Cable, CalendarDays, Clock3, FileCode2, KeyRound, Network,
  RefreshCw, ShieldCheck, Users, Workflow
} from 'lucide-vue-next'
import { api } from '../api/client'
import type { ApiResponse } from '../types'
import PageHeader from '../components/PageHeader.vue'
import { useAppStore } from '../stores/app'

interface CapabilityPayload {
  product: string
  tenant_id: string
  modules: string[]
}
interface AuditItem {
  id: string
  action: string
  entity_type: string
  actor_name?: string | null
  created_at: string
}

const app = useAppStore()
const loading = ref(false)
const capabilities = ref<CapabilityPayload | null>(null)
const usersCount = ref<number | null>(null)
const apiKeysCount = ref<number | null>(null)
const webhooksCount = ref<number | null>(null)
const audits = ref<AuditItem[]>([])

const modulesCount = computed(() => capabilities.value?.modules?.length ?? 0)
const tenantName = computed(() => app.tenant?.branding.name || 'Connect|API')

function valueOrDash(value: number | null) { return value === null ? '—' : String(value) }
function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}
function actionLabel(action: string) { return action.replaceAll('.', ' · ').replaceAll('_', ' ') }

async function load() {
  loading.value = true
  try {
    const [capResult, usersResult, keysResult, hooksResult, auditResult] = await Promise.allSettled([
      api.get<ApiResponse<CapabilityPayload>>('/v1/connect/capabilities'),
      api.get<ApiResponse<unknown[]>>('/v1/users'),
      api.get<ApiResponse<unknown[]>>('/v1/api-keys'),
      api.get<ApiResponse<unknown[]>>('/v1/outbound-webhooks'),
      api.get<ApiResponse<AuditItem[]>>('/v1/audit/events', { params: { limit: 6 } }),
    ])
    capabilities.value = capResult.status === 'fulfilled' ? capResult.value.data.data : null
    usersCount.value = usersResult.status === 'fulfilled' ? usersResult.value.data.data.length : null
    apiKeysCount.value = keysResult.status === 'fulfilled' ? keysResult.value.data.data.length : null
    webhooksCount.value = hooksResult.status === 'fulfilled' ? hooksResult.value.data.data.length : null
    audits.value = auditResult.status === 'fulfilled' ? auditResult.value.data.data : []
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <PageHeader title="Dashboard" :subtitle="`Visão operacional do ambiente ${tenantName}.`">
    <template #actions>
      <button class="btn-secondary h-9 text-[12px]"><CalendarDays :size="15" /> Ambiente atual</button>
      <button class="btn-secondary h-9 text-[12px]" :disabled="loading" @click="load"><RefreshCw :size="15" :class="loading ? 'animate-spin' : ''" /> Atualizar</button>
    </template>
  </PageHeader>

  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    <section class="metric-card">
      <div><p class="text-[12px] font-medium text-slate-600">Módulos Connect|API</p><p class="mt-1 text-[1.65rem] font-semibold tracking-[-.03em] text-slate-950">{{ modulesCount }}</p><p class="mt-1 text-[10px] text-emerald-600">Capabilities publicadas</p></div>
      <div class="grid h-11 w-11 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600"><Network :size="21" /></div>
    </section>
    <section class="metric-card">
      <div><p class="text-[12px] font-medium text-slate-600">Usuários</p><p class="mt-1 text-[1.65rem] font-semibold tracking-[-.03em] text-slate-950">{{ valueOrDash(usersCount) }}</p><p class="mt-1 text-[10px] text-slate-400">Acesso ao tenant</p></div>
      <div class="grid h-11 w-11 place-items-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-600"><Users :size="21" /></div>
    </section>
    <section class="metric-card">
      <div><p class="text-[12px] font-medium text-slate-600">API Keys</p><p class="mt-1 text-[1.65rem] font-semibold tracking-[-.03em] text-slate-950">{{ valueOrDash(apiKeysCount) }}</p><p class="mt-1 text-[10px] text-slate-400">Credenciais configuradas</p></div>
      <div class="grid h-11 w-11 place-items-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600"><KeyRound :size="21" /></div>
    </section>
    <section class="metric-card">
      <div><p class="text-[12px] font-medium text-slate-600">Webhooks</p><p class="mt-1 text-[1.65rem] font-semibold tracking-[-.03em] text-slate-950">{{ valueOrDash(webhooksCount) }}</p><p class="mt-1 text-[10px] text-slate-400">Endpoints de saída</p></div>
      <div class="grid h-11 w-11 place-items-center rounded-xl border border-violet-100 bg-violet-50 text-violet-600"><Webhook :size="21" /></div>
    </section>
    <section class="metric-card">
      <div><p class="text-[12px] font-medium text-slate-600">Isolamento</p><p class="mt-1 text-[1.35rem] font-semibold tracking-[-.02em] text-emerald-600">Ativo</p><p class="mt-1 text-[10px] text-emerald-600">Database + storage por tenant</p></div>
      <div class="grid h-11 w-11 place-items-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600"><ShieldCheck :size="21" /></div>
    </section>
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-3">
    <section class="dashboard-panel">
      <div class="dashboard-panel-header"><div><h2 class="section-title">Comunicação</h2><p class="mt-0.5 text-[11px] text-slate-400">Canais e instâncias</p></div><Cable :size="17" class="text-blue-600" /></div>
      <div class="dashboard-panel-body">
        <div class="grid grid-cols-2 gap-3">
          <RouterLink to="/channels" class="rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition hover:border-blue-200 hover:bg-blue-50/40"><Cable :size="19" class="text-blue-600"/><p class="mt-4 text-[12px] font-semibold text-slate-900">Canais</p><p class="mt-1 text-[10px] text-slate-400">Gerenciar conexões</p></RouterLink>
          <RouterLink to="/instances" class="rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition hover:border-cyan-200 hover:bg-cyan-50/40"><Network :size="19" class="text-cyan-600"/><p class="mt-4 text-[12px] font-semibold text-slate-900">Instâncias</p><p class="mt-1 text-[10px] text-slate-400">Ambientes isolados</p></RouterLink>
        </div>
      </div>
    </section>

    <section class="dashboard-panel xl:col-span-2">
      <div class="dashboard-panel-header"><div><h2 class="section-title">Studios</h2><p class="mt-0.5 text-[11px] text-slate-400">Criação, integração e automação</p></div><Workflow :size="17" class="text-violet-600" /></div>
      <div class="dashboard-panel-body">
        <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <RouterLink to="/templates" class="rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition hover:border-blue-200 hover:bg-blue-50/40"><FileCode2 :size="19" class="text-blue-600"/><p class="mt-4 text-[12px] font-semibold text-slate-900">Templates</p><p class="mt-1 text-[10px] text-slate-400">Mensagens e interações</p></RouterLink>
          <RouterLink to="/integrations" class="rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition hover:border-cyan-200 hover:bg-cyan-50/40"><Braces :size="19" class="text-cyan-600"/><p class="mt-4 text-[12px] font-semibold text-slate-900">Integrações</p><p class="mt-1 text-[10px] text-slate-400">Actions e dados REST</p></RouterLink>
          <RouterLink to="/micro-apps" class="rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition hover:border-emerald-200 hover:bg-emerald-50/40"><AppWindow :size="19" class="text-emerald-600"/><p class="mt-4 text-[12px] font-semibold text-slate-900">Micro Apps</p><p class="mt-1 text-[10px] text-slate-400">Experiências web</p></RouterLink>
          <RouterLink to="/automations" class="rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition hover:border-violet-200 hover:bg-violet-50/40"><Workflow :size="19" class="text-violet-600"/><p class="mt-4 text-[12px] font-semibold text-slate-900">Automações</p><p class="mt-1 text-[10px] text-slate-400">Recipes declarativas</p></RouterLink>
        </div>
      </div>
    </section>
  </div>

  <div class="mt-4 grid gap-4 sm:grid-cols-3">
    <RouterLink to="/events" class="dashboard-panel block transition hover:border-blue-200 hover:shadow-md">
      <div class="dashboard-panel-body flex items-center gap-4"><div class="grid h-11 w-11 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600"><Activity :size="20"/></div><div><p class="text-[12px] font-semibold text-slate-900">Eventos</p><p class="mt-1 text-[10px] text-slate-400">Fluxo operacional e integrações em tempo real</p></div></div>
    </RouterLink>
    <RouterLink to="/pbx" class="dashboard-panel block transition hover:border-cyan-200 hover:shadow-md">
      <div class="dashboard-panel-body flex items-center gap-4"><div class="grid h-11 w-11 place-items-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-600"><Network :size="20"/></div><div><p class="text-[12px] font-semibold text-slate-900">Connect PBX</p><p class="mt-1 text-[10px] text-slate-400">Telefonia, ramais e operação PBX</p></div></div>
    </RouterLink>
    <RouterLink to="/voip" class="dashboard-panel block transition hover:border-blue-200 hover:shadow-md">
      <div class="dashboard-panel-body flex items-center gap-4"><div class="grid h-11 w-11 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600"><Cable :size="20"/></div><div><p class="text-[12px] font-semibold text-slate-900">VOIP</p><p class="mt-1 text-[10px] text-slate-400">Recursos de voz e conectividade</p></div></div>
    </RouterLink>
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,.8fr)]">
    <section class="dashboard-panel">
      <div class="dashboard-panel-header"><div><h2 class="section-title">Capacidades disponíveis</h2><p class="mt-0.5 text-[11px] text-slate-400">Módulos declarados pelo backend</p></div><Activity :size="17" class="text-blue-600" /></div>
      <div class="dashboard-panel-body">
        <div class="flex flex-wrap gap-2">
          <span v-for="moduleName in capabilities?.modules || []" :key="moduleName" class="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-medium capitalize text-blue-700">{{ moduleName }}</span>
          <p v-if="!capabilities?.modules?.length" class="text-[11px] text-slate-400">Não foi possível carregar as capabilities deste tenant.</p>
        </div>
      </div>
    </section>

    <section class="dashboard-panel">
      <div class="dashboard-panel-header"><div><h2 class="section-title">Atividade recente</h2><p class="mt-0.5 text-[11px] text-slate-400">Auditoria do tenant</p></div><RouterLink to="/audit" class="text-[11px] font-semibold text-blue-600 hover:text-blue-700">Ver tudo</RouterLink></div>
      <div class="divide-y divide-slate-100 px-4">
        <div v-for="item in audits" :key="item.id" class="flex gap-3 py-3">
          <div class="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600"><Clock3 :size="14" /></div>
          <div class="min-w-0 flex-1"><p class="truncate text-[11px] font-medium text-slate-800">{{ actionLabel(item.action) }}</p><p class="mt-0.5 truncate text-[10px] text-slate-400">{{ item.actor_name || item.entity_type }}</p></div>
          <span class="shrink-0 text-[9px] text-slate-400">{{ formatDate(item.created_at) }}</span>
        </div>
        <div v-if="!audits.length" class="py-10 text-center"><Clock3 :size="20" class="mx-auto text-slate-300"/><p class="mt-2 text-[11px] text-slate-400">Nenhum evento acessível.</p></div>
      </div>
    </section>
  </div>
</template>
