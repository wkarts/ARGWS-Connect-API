<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Activity, Building2, CalendarDays, CheckCircle2, CircleCheck, Clock3, Globe2,
  RefreshCw, ShieldCheck, TriangleAlert, Workflow
} from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse, Paginated, Tenant } from '../types'
import PageHeader from '../components/PageHeader.vue'
import StatusBadge from '../components/StatusBadge.vue'

interface Dashboard {
  tenants: number
  active: number
  provisioning: number
  failed: number
  domains: number
}

interface AuditItem {
  id: string
  action: string
  entity_type: string
  tenant_name?: string | null
  actor_name?: string | null
  created_at: string
}

const data = ref<Dashboard>({ tenants: 0, active: 0, provisioning: 0, failed: 0, domains: 0 })
const tenants = ref<Tenant[]>([])
const audits = ref<AuditItem[]>([])
const loading = ref(false)
const error = ref('')

const healthy = computed(() => data.value.failed === 0)
const activePercent = computed(() => data.value.tenants ? Math.round((data.value.active / data.value.tenants) * 100) : 0)
const provisioningPercent = computed(() => data.value.tenants ? Math.round((data.value.provisioning / data.value.tenants) * 100) : 0)
const failedPercent = computed(() => data.value.tenants ? Math.round((data.value.failed / data.value.tenants) * 100) : 0)

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

function actionLabel(action: string) {
  return action.replaceAll('.', ' · ').replaceAll('_', ' ')
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [dashboardResult, tenantsResult, auditResult] = await Promise.allSettled([
      api.get<ApiResponse<Dashboard>>('/control/v1/dashboard'),
      api.get<Paginated<Tenant>>('/control/v1/tenants', { params: { page: 1, per_page: 5 } }),
      api.get<Paginated<AuditItem>>('/control/v1/audit', { params: { page: 1, per_page: 6 } }),
    ])

    if (dashboardResult.status === 'fulfilled') data.value = dashboardResult.value.data.data
    else throw dashboardResult.reason

    tenants.value = tenantsResult.status === 'fulfilled' ? tenantsResult.value.data.data : []
    audits.value = auditResult.status === 'fulfilled' ? auditResult.value.data.data : []
  } catch (exception) {
    error.value = apiError(exception)
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <PageHeader title="Dashboard" subtitle="Visão operacional do Connect|API Platform e de todos os tenants.">
    <template #actions>
      <button class="btn-secondary h-9 text-[12px]"><CalendarDays :size="15" /> Ambiente atual</button>
      <button class="btn-secondary h-9 text-[12px]" :disabled="loading" @click="load"><RefreshCw :size="15" :class="loading ? 'animate-spin' : ''" /> Atualizar</button>
    </template>
  </PageHeader>

  <p v-if="error" class="mb-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ error }}</p>

  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    <section class="metric-card">
      <div><p class="text-[12px] font-medium text-slate-600">Tenants ativos</p><p class="mt-1 text-[1.65rem] font-semibold tracking-[-.03em] text-slate-950">{{ data.active }}</p><p class="mt-1 text-[10px] font-medium text-emerald-600">{{ activePercent }}% da base</p></div>
      <div class="grid h-11 w-11 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600"><Building2 :size="21" /></div>
    </section>
    <section class="metric-card">
      <div><p class="text-[12px] font-medium text-slate-600">Tenants totais</p><p class="mt-1 text-[1.65rem] font-semibold tracking-[-.03em] text-slate-950">{{ data.tenants }}</p><p class="mt-1 text-[10px] text-slate-400">Base provisionada</p></div>
      <div class="grid h-11 w-11 place-items-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-600"><CircleCheck :size="21" /></div>
    </section>
    <section class="metric-card">
      <div><p class="text-[12px] font-medium text-slate-600">Provisionando</p><p class="mt-1 text-[1.65rem] font-semibold tracking-[-.03em] text-slate-950">{{ data.provisioning }}</p><p class="mt-1 text-[10px] text-amber-600">{{ provisioningPercent }}% em processamento</p></div>
      <div class="grid h-11 w-11 place-items-center rounded-xl border border-amber-100 bg-amber-50 text-amber-600"><Workflow :size="21" /></div>
    </section>
    <section class="metric-card">
      <div><p class="text-[12px] font-medium text-slate-600">Domínios</p><p class="mt-1 text-[1.65rem] font-semibold tracking-[-.03em] text-slate-950">{{ data.domains }}</p><p class="mt-1 text-[10px] text-slate-400">Gerenciados pela plataforma</p></div>
      <div class="grid h-11 w-11 place-items-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600"><Globe2 :size="21" /></div>
    </section>
    <section class="metric-card">
      <div><p class="text-[12px] font-medium text-slate-600">Status da plataforma</p><p class="mt-1 text-[1.35rem] font-semibold tracking-[-.02em]" :class="healthy ? 'text-emerald-600' : 'text-amber-600'">{{ healthy ? 'Healthy' : 'Atenção' }}</p><p class="mt-1 text-[10px]" :class="healthy ? 'text-emerald-600' : 'text-rose-600'">{{ data.failed }} falha(s) de provisionamento</p></div>
      <div class="grid h-11 w-11 place-items-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600"><ShieldCheck :size="21" /></div>
    </section>
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-3">
    <section class="dashboard-panel">
      <div class="dashboard-panel-header"><div><h2 class="section-title">Distribuição dos tenants</h2><p class="mt-0.5 text-[11px] text-slate-400">Estado atual da base</p></div><Activity :size="17" class="text-blue-600" /></div>
      <div class="dashboard-panel-body space-y-5">
        <div>
          <div class="mb-2 flex items-center justify-between text-[11px]"><span class="font-medium text-slate-600">Ativos</span><span class="font-semibold text-slate-950">{{ data.active }}</span></div>
          <div class="h-2 overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full bg-blue-600" :style="{ width: `${Math.min(activePercent, 100)}%` }" /></div>
        </div>
        <div>
          <div class="mb-2 flex items-center justify-between text-[11px]"><span class="font-medium text-slate-600">Provisionando</span><span class="font-semibold text-slate-950">{{ data.provisioning }}</span></div>
          <div class="h-2 overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full bg-cyan-500" :style="{ width: `${Math.min(provisioningPercent, 100)}%` }" /></div>
        </div>
        <div>
          <div class="mb-2 flex items-center justify-between text-[11px]"><span class="font-medium text-slate-600">Falha</span><span class="font-semibold text-slate-950">{{ data.failed }}</span></div>
          <div class="h-2 overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full bg-rose-500" :style="{ width: `${Math.min(failedPercent, 100)}%` }" /></div>
        </div>
      </div>
    </section>

    <section class="dashboard-panel">
      <div class="dashboard-panel-header"><div><h2 class="section-title">Telemetria Connect|API</h2><p class="mt-0.5 text-[11px] text-slate-400">API, eventos e webhooks</p></div><Activity :size="17" class="text-cyan-600" /></div>
      <div class="dashboard-panel-body">
        <div class="chart-grid flex h-[155px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/30 px-6 text-center">
          <div><p class="text-[12px] font-semibold text-slate-700">Séries temporais não publicadas pelo endpoint atual</p><p class="mt-1 text-[11px] leading-5 text-slate-400">O painel está preparado para receber métricas de API Traffic, webhooks, canais e instâncias sem inventar valores operacionais.</p></div>
        </div>
      </div>
    </section>

    <section class="dashboard-panel">
      <div class="dashboard-panel-header"><div><h2 class="section-title">PBX / VOIP</h2><p class="mt-0.5 text-[11px] text-slate-400">Qualidade e disponibilidade</p></div><CheckCircle2 :size="17" class="text-emerald-600" /></div>
      <div class="dashboard-panel-body">
        <div class="chart-grid flex h-[155px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/30 px-6 text-center">
          <div><p class="text-[12px] font-semibold text-slate-700">Painel preparado para MOS e disponibilidade</p><p class="mt-1 text-[11px] leading-5 text-slate-400">As séries serão exibidas quando PBX/VOIP disponibilizarem telemetria agregada no Control Plane.</p></div>
        </div>
      </div>
    </section>
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,.75fr)]">
    <section class="dashboard-panel overflow-hidden">
      <div class="dashboard-panel-header"><div><h2 class="section-title">Tenants</h2><p class="mt-0.5 text-[11px] text-slate-400">Últimos registros da base</p></div><RouterLink to="/tenants" class="text-[11px] font-semibold text-blue-600 hover:text-blue-700">Ver todos</RouterLink></div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[760px] text-left text-[12px]">
          <thead class="border-b border-slate-100 text-[10px] font-semibold uppercase tracking-[.04em] text-slate-400">
            <tr><th class="px-4 py-3">Tenant</th><th class="px-4 py-3">Plano</th><th class="px-4 py-3">Status</th><th class="px-4 py-3">Domínios</th><th class="px-4 py-3">Criado em</th></tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="tenant in tenants" :key="tenant.id" class="hover:bg-slate-50/60">
              <td class="px-4 py-3"><p class="font-medium text-slate-900">{{ tenant.name }}</p><p class="mt-0.5 text-[10px] text-slate-400">{{ tenant.slug }}</p></td>
              <td class="px-4 py-3"><span class="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-600">{{ tenant.plan_code }}</span></td>
              <td class="px-4 py-3"><StatusBadge :status="tenant.status" /></td>
              <td class="px-4 py-3 text-slate-600">{{ tenant.domains?.length || 0 }}</td>
              <td class="px-4 py-3 text-slate-500">{{ formatDate(tenant.created_at) }}</td>
            </tr>
            <tr v-if="!tenants.length"><td colspan="5" class="px-4 py-10 text-center text-[12px] text-slate-400">Nenhum tenant disponível.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="dashboard-panel">
      <div class="dashboard-panel-header"><div><h2 class="section-title">Atividade recente</h2><p class="mt-0.5 text-[11px] text-slate-400">Auditoria da plataforma</p></div><RouterLink to="/control-audit" class="text-[11px] font-semibold text-blue-600 hover:text-blue-700">Ver tudo</RouterLink></div>
      <div class="divide-y divide-slate-100 px-4">
        <div v-for="item in audits" :key="item.id" class="flex gap-3 py-3">
          <div class="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600"><Clock3 :size="14" /></div>
          <div class="min-w-0 flex-1"><p class="truncate text-[11px] font-medium text-slate-800">{{ actionLabel(item.action) }}</p><p class="mt-0.5 truncate text-[10px] text-slate-400">{{ item.tenant_name || item.actor_name || item.entity_type }}</p></div>
          <span class="shrink-0 text-[9px] text-slate-400">{{ formatDate(item.created_at) }}</span>
        </div>
        <div v-if="!audits.length" class="py-10 text-center"><TriangleAlert :size="20" class="mx-auto text-slate-300"/><p class="mt-2 text-[11px] text-slate-400">Nenhum evento recente.</p></div>
      </div>
    </section>
  </div>
</template>
