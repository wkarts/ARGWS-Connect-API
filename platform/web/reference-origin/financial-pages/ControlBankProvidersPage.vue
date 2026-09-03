<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Landmark,
  Layers3,
  Power,
  PowerOff,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse, Paginated, PlatformPlan, Tenant } from '../types'
import PageHeader from '../components/PageHeader.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'

interface ProviderGovernance {
  provider: string
  name?: string
  display_name: string
  status?: string
  driver_status: string
  driver_version?: string | null
  driver_installed: boolean
  connection_driver_installed?: boolean
  implementation_available?: boolean
  globally_enabled: boolean
  tenant_visible: boolean
  integration_modes: string[]
  implemented_modes?: string[]
  catalog_integration_modes?: string[]
  environments: string[]
  capabilities: string[]
  catalog_capabilities?: string[]
  documentation_status: string
  documentation_checked_at?: string | null
  sandbox_verified_at?: string | null
  homologation_verified_at?: string | null
  production_verified_at?: string | null
  notes?: string | null
}

interface PlanProviderPolicy {
  plan_code: string
  mode: 'ALL' | 'SELECTED' | 'NONE'
  providers: string[]
  implicit: boolean
}

interface TenantDecision {
  provider: string
  allowed: boolean
  operationally_allowed?: boolean
  discoverable?: boolean
  source: string
  commercial_status: string
  driver_status: string
  driver_installed: boolean
  globally_enabled: boolean
  tenant_visible: boolean
  plan_mode: string
  tenant_override?: string | null
}

interface TenantProviderPolicy {
  tenant_id: string
  tenant_name: string
  tenant_slug: string
  plan_code: string
  mode: 'INHERIT' | 'CUSTOM'
  overrides: Array<{ provider: string; action: 'ALLOW' | 'DENY' | 'INHERIT' }>
  providers: TenantDecision[]
}

type GovernanceTab = 'GLOBAL' | 'PLAN' | 'TENANT'
type ProviderFilter = 'ALL' | 'INSTALLED' | 'ENABLED' | 'BLOCKED' | 'HIDDEN' | 'CATALOG'

const providers = ref<ProviderGovernance[]>([])
const plans = ref<PlatformPlan[]>([])
const tenants = ref<Tenant[]>([])
const selectedPlan = ref('')
const selectedTenant = ref('')
const activeTab = ref<GovernanceTab>('GLOBAL')
const search = ref('')
const providerFilter = ref<ProviderFilter>('ALL')
const selectedProviders = ref<string[]>([])

const planPolicy = reactive<{ mode: 'ALL' | 'SELECTED' | 'NONE'; selected: Record<string, boolean> }>({
  mode: 'ALL',
  selected: {},
})
const tenantPolicy = reactive<{
  mode: 'INHERIT' | 'CUSTOM'
  overrides: Record<string, 'ALLOW' | 'DENY' | 'INHERIT'>
  decisions: Record<string, TenantDecision>
}>({
  mode: 'INHERIT',
  overrides: {},
  decisions: {},
})

const loading = ref(false)
const saving = ref('')
const error = ref('')
const success = ref('')

const installedProviders = computed(() => providers.value.filter(item => item.driver_installed))
const installedCount = computed(() => installedProviders.value.length)
const enabledCount = computed(() => providers.value.filter(item => item.driver_installed && item.globally_enabled).length)
const visibleCount = computed(() => providers.value.filter(item => item.driver_installed && item.tenant_visible).length)
const directApiCount = computed(() => providers.value.filter(item => item.connection_driver_installed).length)
const cnabOnlyCount = computed(() => providers.value.filter(item => item.driver_installed && !item.connection_driver_installed).length)

const filteredProviders = computed(() => {
  const term = search.value.trim().toLocaleLowerCase('pt-BR')
  return providers.value.filter(item => {
    const matchesSearch = !term
      || item.display_name.toLocaleLowerCase('pt-BR').includes(term)
      || item.provider.toLocaleLowerCase('pt-BR').includes(term)
      || item.integration_modes.some(mode => mode.toLocaleLowerCase('pt-BR').includes(term))
      || item.capabilities.some(capability => capability.toLocaleLowerCase('pt-BR').includes(term))

    if (!matchesSearch) return false
    if (providerFilter.value === 'INSTALLED') return item.driver_installed
    if (providerFilter.value === 'ENABLED') return item.driver_installed && item.globally_enabled
    if (providerFilter.value === 'BLOCKED') return item.driver_installed && !item.globally_enabled
    if (providerFilter.value === 'HIDDEN') return item.driver_installed && !item.tenant_visible
    if (providerFilter.value === 'CATALOG') return !item.driver_installed
    return true
  })
})

const selectedInstalledProviders = computed(() => {
  const eligible = new Set(installedProviders.value.map(item => item.provider))
  return selectedProviders.value.filter(code => eligible.has(code))
})

function clearFeedback() {
  error.value = ''
  success.value = ''
}

function catalogOnly(item: ProviderGovernance) {
  return !item.driver_installed
}

function catalogModes(item: ProviderGovernance) {
  return item.catalog_integration_modes || []
}

function catalogCapabilities(item: ProviderGovernance) {
  return item.catalog_capabilities || []
}

function isSelected(provider: string) {
  return selectedProviders.value.includes(provider)
}

function setSelected(provider: string, checked: boolean) {
  if (checked && !selectedProviders.value.includes(provider)) selectedProviders.value.push(provider)
  if (!checked) selectedProviders.value = selectedProviders.value.filter(item => item !== provider)
}

function onSelectionChange(provider: string, event: Event) {
  setSelected(provider, (event.target as HTMLInputElement).checked)
}

function selectFilteredInstalled() {
  selectedProviders.value = filteredProviders.value.filter(item => item.driver_installed).map(item => item.provider)
}

function clearSelection() {
  selectedProviders.value = []
}

function operationalLabel(item: ProviderGovernance) {
  if (!item.driver_installed) return 'CATÁLOGO APENAS'
  if (!item.globally_enabled) return 'BLOQUEADO GLOBAL'
  if (!item.tenant_visible) return 'LIBERADO · OCULTO'
  return 'LIBERADO · VISÍVEL'
}

function operationalClass(item: ProviderGovernance) {
  if (!item.driver_installed) return 'bg-rose-50 text-rose-700'
  if (!item.globally_enabled) return 'bg-slate-100 text-slate-600'
  if (!item.tenant_visible) return 'bg-amber-50 text-amber-700'
  return 'bg-emerald-50 text-emerald-700'
}

function decisionLabel(decision?: TenantDecision) {
  if (!decision) return '—'
  const map: Record<string, string> = {
    DRIVER_UNAVAILABLE: 'Sem executor',
    GLOBAL_DISABLED: 'Bloqueado globalmente',
    TENANT_HIDDEN: 'Oculto pelo Control Plane',
    TENANT_DENY: 'Negado neste tenant',
    TENANT_ALLOW: 'Liberado por override',
    PLAN_NONE: 'Plano sem banking',
    PLAN_SELECTED: 'Liberado pelo plano',
    PLAN_NOT_SELECTED: 'Fora do plano',
    PLAN_ALL: 'Liberado pelo plano',
  }
  return map[decision.source] || decision.source
}

function tenantStateLabel(decision?: TenantDecision) {
  if (!decision) return '—'
  if (decision.source === 'TENANT_HIDDEN') return 'OCULTO'
  return decision.allowed ? 'LIBERADO' : 'BLOQUEADO'
}

function tenantStateClass(decision?: TenantDecision) {
  if (!decision) return 'bg-slate-100 text-slate-500'
  if (decision.source === 'TENANT_HIDDEN') return 'bg-amber-50 text-amber-700'
  return decision.allowed ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
}

async function loadBase() {
  loading.value = true
  clearFeedback()
  try {
    const [providerResponse, planResponse, tenantResponse] = await Promise.all([
      api.get<ApiResponse<ProviderGovernance[]>>('/control/v1/banking/providers/governance'),
      api.get<ApiResponse<PlatformPlan[]>>('/control/v1/plans', { params: { include_inactive: true } }),
      api.get<Paginated<Tenant>>('/control/v1/tenants', { params: { per_page: 100 } }),
    ])
    providers.value = providerResponse.data.data
    plans.value = planResponse.data.data
    tenants.value = tenantResponse.data.data
    if (!selectedPlan.value && plans.value.length) selectedPlan.value = plans.value[0].code
    if (!selectedTenant.value && tenants.value.length) selectedTenant.value = tenants.value[0].id
  } catch (reason) {
    error.value = apiError(reason)
  } finally {
    loading.value = false
  }
}

async function toggleProvider(item: ProviderGovernance, field: 'globally_enabled' | 'tenant_visible') {
  if (!item.driver_installed) {
    error.value = `${item.display_name} é somente catálogo. Primeiro é necessário existir um executor real do próprio banco.`
    return
  }
  saving.value = `provider:${item.provider}:${field}`
  clearFeedback()
  try {
    const value = !item[field]
    const response = await api.patch<ApiResponse<ProviderGovernance>>(
      `/control/v1/banking/providers/${item.provider}/governance`,
      { [field]: value },
    )
    Object.assign(item, response.data.data)
    success.value = `${item.display_name}: ${field === 'globally_enabled' ? (value ? 'habilitado globalmente' : 'bloqueado globalmente') : (value ? 'visível aos tenants' : 'oculto dos tenants')}.`
    await loadTenantPolicy()
  } catch (reason) {
    error.value = apiError(reason)
  } finally {
    saving.value = ''
  }
}

async function bulkProviderUpdate(
  changes: { globally_enabled?: boolean; tenant_visible?: boolean },
  actionLabel: string,
) {
  const targets = selectedInstalledProviders.value
  if (!targets.length) {
    error.value = 'Selecione ao menos um provider com executor instalado.'
    return
  }
  saving.value = 'bulk'
  clearFeedback()
  try {
    const response = await api.put<ApiResponse<ProviderGovernance[]>>(
      '/control/v1/banking/providers/governance/bulk',
      { providers: targets, ...changes },
    )
    const updated = new Map(response.data.data.map(item => [item.provider, item]))
    providers.value = providers.value.map(item => updated.get(item.provider) || item)
    success.value = `${actionLabel}: ${targets.length} provider(s) atualizado(s).`
    await loadTenantPolicy()
  } catch (reason) {
    error.value = apiError(reason)
  } finally {
    saving.value = ''
  }
}

async function loadPlanPolicy() {
  if (!selectedPlan.value || !providers.value.length) return
  clearFeedback()
  try {
    const response = await api.get<ApiResponse<PlanProviderPolicy>>(
      `/control/v1/banking/plans/${selectedPlan.value}/providers`,
    )
    const policy = response.data.data
    planPolicy.mode = policy.mode
    planPolicy.selected = Object.fromEntries(
      providers.value.map(item => [
        item.provider,
        item.driver_installed && policy.providers.includes(item.provider),
      ]),
    )
  } catch (reason) {
    error.value = apiError(reason)
  }
}

async function savePlanPolicy() {
  if (!selectedPlan.value) return
  saving.value = 'plan'
  clearFeedback()
  try {
    const selected = providers.value
      .filter(item => item.driver_installed && planPolicy.selected[item.provider])
      .map(item => item.provider)
    await api.put(`/control/v1/banking/plans/${selectedPlan.value}/providers`, {
      mode: planPolicy.mode,
      providers: planPolicy.mode === 'SELECTED' ? selected : [],
    })
    success.value = `Política bancária do plano ${selectedPlan.value} atualizada.`
    await loadTenantPolicy()
  } catch (reason) {
    error.value = apiError(reason)
  } finally {
    saving.value = ''
  }
}

async function loadTenantPolicy() {
  if (!selectedTenant.value || !providers.value.length) return
  clearFeedback()
  try {
    const response = await api.get<ApiResponse<TenantProviderPolicy>>(
      `/control/v1/banking/tenants/${selectedTenant.value}/providers`,
    )
    const policy = response.data.data
    tenantPolicy.mode = policy.mode
    tenantPolicy.overrides = Object.fromEntries(
      providers.value.map(item => [item.provider, 'INHERIT']),
    ) as Record<string, 'ALLOW' | 'DENY' | 'INHERIT'>
    for (const item of policy.overrides) tenantPolicy.overrides[item.provider] = item.action
    tenantPolicy.decisions = Object.fromEntries(policy.providers.map(item => [item.provider, item]))
  } catch (reason) {
    error.value = apiError(reason)
  }
}

async function saveTenantPolicy() {
  if (!selectedTenant.value) return
  saving.value = 'tenant'
  clearFeedback()
  try {
    const overrides = providers.value
      .filter(item => item.driver_installed)
      .map(item => ({
        provider: item.provider,
        action: tenantPolicy.overrides[item.provider] || 'INHERIT',
      }))
    await api.put(`/control/v1/banking/tenants/${selectedTenant.value}/providers`, {
      mode: tenantPolicy.mode,
      overrides: tenantPolicy.mode === 'CUSTOM' ? overrides : [],
    })
    success.value = 'Política bancária do tenant atualizada.'
    await loadTenantPolicy()
  } catch (reason) {
    error.value = apiError(reason)
  } finally {
    saving.value = ''
  }
}

watch(selectedPlan, loadPlanPolicy)
watch(selectedTenant, loadTenantPolicy)
watch(activeTab, tab => {
  if (tab === 'PLAN') void loadPlanPolicy()
  if (tab === 'TENANT') void loadTenantPolicy()
})

onMounted(async () => {
  await loadBase()
  await Promise.all([loadPlanPolicy(), loadTenantPolicy()])
})
</script>

<template>
  <PageHeader
    title="Providers bancários"
    subtitle="Control Plane é a autoridade de liberação. Driver instalado significa apenas que o modo existe; você decide se o provider fica habilitado, visível, disponível no plano e liberado por tenant."
  >
    <button class="btn-secondary" :disabled="loading" @click="loadBase">
      <RefreshCw :size="17" :class="loading && 'animate-spin'" /> Atualizar
    </button>
  </PageHeader>

  <InlineAlert :message="error" @dismiss="error=''" />
  <InlineAlert :message="success" type="success" @dismiss="success=''" />

  <div class="mb-5 grid gap-3 md:grid-cols-5">
    <div class="card !p-4">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Catálogo</p>
      <p class="mt-1 text-2xl font-bold">{{ providers.length }}</p>
      <p class="text-xs text-slate-500">providers conhecidos</p>
    </div>
    <div class="card !p-4">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Executores</p>
      <p class="mt-1 text-2xl font-bold text-teal-700">{{ installedCount }}</p>
      <p class="text-xs text-slate-500">drivers realmente instalados</p>
    </div>
    <div class="card !p-4">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Liberados</p>
      <p class="mt-1 text-2xl font-bold text-emerald-700">{{ enabledCount }}</p>
      <p class="text-xs text-slate-500">globais ativos</p>
    </div>
    <div class="card !p-4">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Visíveis</p>
      <p class="mt-1 text-2xl font-bold text-blue-700">{{ visibleCount }}</p>
      <p class="text-xs text-slate-500">expostos ao tenant</p>
    </div>
    <div class="card !p-4">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Modos</p>
      <p class="mt-1 text-sm font-bold text-slate-800">API {{ directApiCount }} · CNAB-only {{ cnabOnlyCount }}</p>
      <p class="mt-1 text-xs text-slate-500">sem mistura de canais</p>
    </div>
  </div>

  <div class="mb-5 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
    <button
      class="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold"
      :class="activeTab === 'GLOBAL' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'"
      @click="activeTab = 'GLOBAL'"
    >
      <Landmark :size="17" /> Governança global
    </button>
    <button
      class="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold"
      :class="activeTab === 'PLAN' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'"
      @click="activeTab = 'PLAN'"
    >
      <Layers3 :size="17" /> Por plano
    </button>
    <button
      class="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold"
      :class="activeTab === 'TENANT' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'"
      @click="activeTab = 'TENANT'"
    >
      <Users :size="17" /> Por tenant
    </button>
  </div>

  <section v-if="activeTab === 'GLOBAL'" class="space-y-4">
    <div class="card">
      <div class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h2 class="font-bold text-slate-900">Autoridade global dos providers</h2>
          <p class="text-sm text-slate-500">
            <strong>Habilitado</strong> permite uso comercial. <strong>Visível</strong> controla descoberta no tenant. Ocultar não troca o banco de uma conexão existente.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <div class="relative">
            <Search :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input v-model="search" class="input !pl-9" placeholder="Banco, provider, modo..." />
          </div>
          <select v-model="providerFilter" class="select !w-auto">
            <option value="ALL">Todos</option>
            <option value="INSTALLED">Com executor</option>
            <option value="ENABLED">Habilitados</option>
            <option value="BLOCKED">Bloqueados</option>
            <option value="HIDDEN">Ocultos</option>
            <option value="CATALOG">Somente catálogo</option>
          </select>
        </div>
      </div>
    </div>

    <div class="card border-teal-100 bg-teal-50/40">
      <div class="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <strong>{{ selectedInstalledProviders.length }}</strong>
          <span class="text-slate-600">provider(s) selecionado(s)</span>
          <button class="text-xs font-semibold text-teal-700 hover:underline" @click="selectFilteredInstalled">Selecionar instalados filtrados</button>
          <button v-if="selectedProviders.length" class="text-xs font-semibold text-slate-500 hover:underline" @click="clearSelection">Limpar</button>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            class="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            :disabled="saving === 'bulk' || !selectedInstalledProviders.length"
            @click="bulkProviderUpdate({ globally_enabled: true }, 'Providers habilitados')"
          >
            <Power :size="14" /> Habilitar
          </button>
          <button
            class="flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            :disabled="saving === 'bulk' || !selectedInstalledProviders.length"
            @click="bulkProviderUpdate({ globally_enabled: false }, 'Providers bloqueados')"
          >
            <PowerOff :size="14" /> Bloquear
          </button>
          <button
            class="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            :disabled="saving === 'bulk' || !selectedInstalledProviders.length"
            @click="bulkProviderUpdate({ tenant_visible: true }, 'Providers exibidos')"
          >
            <Eye :size="14" /> Exibir
          </button>
          <button
            class="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            :disabled="saving === 'bulk' || !selectedInstalledProviders.length"
            @click="bulkProviderUpdate({ tenant_visible: false }, 'Providers ocultados')"
          >
            <EyeOff :size="14" /> Ocultar
          </button>
        </div>
      </div>
    </div>

    <div class="card overflow-hidden !p-0">
      <div class="overflow-x-auto">
        <table class="table min-w-[1180px]">
          <thead>
            <tr>
              <th class="w-10"></th>
              <th>Provider</th>
              <th>Estado operacional</th>
              <th>Executor</th>
              <th>Modo efetivo</th>
              <th>Capabilities efetivas</th>
              <th class="text-center">Habilitado</th>
              <th class="text-center">Exibir no tenant</th>
              <th>Documentação</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in filteredProviders" :key="item.provider" class="border-t border-slate-100 align-top">
              <td>
                <input
                  type="checkbox"
                  :checked="isSelected(item.provider)"
                  :disabled="!item.driver_installed"
                  @change="onSelectionChange(item.provider, $event)"
                />
              </td>
              <td>
                <p class="font-semibold text-slate-900">{{ item.display_name }}</p>
                <p class="font-mono text-xs text-slate-400">{{ item.provider }}</p>
                <p v-if="catalogOnly(item)" class="mt-1 text-[10px] font-semibold text-rose-600">NÃO LIBERÁVEL SEM DRIVER DO PRÓPRIO BANCO</p>
              </td>
              <td>
                <span class="badge" :class="operationalClass(item)">{{ operationalLabel(item) }}</span>
                <p v-if="item.driver_installed && !item.globally_enabled" class="mt-1 text-[10px] text-slate-500">planos/tenants não conseguem superar este bloqueio</p>
              </td>
              <td>
                <template v-if="item.driver_installed">
                  <StatusBadge :status="item.driver_status" />
                  <p class="mt-1 text-xs text-slate-400">{{ item.driver_version || 'executor instalado' }}</p>
                  <p class="mt-1 text-[10px]" :class="item.connection_driver_installed ? 'text-emerald-600' : 'text-amber-600'">
                    DIRECT_API: {{ item.connection_driver_installed ? 'disponível' : 'não implementada' }}
                  </p>
                </template>
                <template v-else>
                  <span class="badge bg-rose-50 text-rose-700">SEM EXECUTOR</span>
                </template>
              </td>
              <td class="max-w-[220px]">
                <div v-if="item.integration_modes.length" class="flex flex-wrap gap-1">
                  <span v-for="mode in item.integration_modes" :key="mode" class="badge bg-emerald-50 text-emerald-700">{{ mode }}</span>
                </div>
                <span v-else class="text-xs text-slate-400">Nenhum modo executável</span>
                <p v-if="catalogModes(item).length" class="mt-2 text-[10px] text-slate-400">Catálogo: {{ catalogModes(item).join(', ') }}</p>
              </td>
              <td class="max-w-[270px]">
                <div v-if="item.capabilities.length" class="flex flex-wrap gap-1">
                  <span v-for="capability in item.capabilities" :key="capability" class="badge bg-teal-50 text-teal-700">{{ capability }}</span>
                </div>
                <span v-else class="text-xs text-slate-400">Nenhuma capability executável</span>
                <p v-if="catalogOnly(item) && catalogCapabilities(item).length" class="mt-2 text-[10px] text-slate-400">
                  Apenas documentadas: {{ catalogCapabilities(item).join(', ') }}
                </p>
              </td>
              <td class="text-center">
                <button
                  class="inline-flex min-w-[112px] items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
                  :class="item.globally_enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'"
                  :disabled="saving.startsWith(`provider:${item.provider}`) || !item.driver_installed"
                  @click="toggleProvider(item, 'globally_enabled')"
                >
                  <CheckCircle2 v-if="item.globally_enabled" :size="14" />
                  <XCircle v-else :size="14" />
                  {{ !item.driver_installed ? 'Indisponível' : (item.globally_enabled ? 'Habilitado' : 'Bloqueado') }}
                </button>
              </td>
              <td class="text-center">
                <button
                  class="inline-flex min-w-[112px] items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"
                  :class="item.tenant_visible ? 'bg-blue-100 text-blue-700' : 'bg-amber-50 text-amber-700'"
                  :disabled="saving.startsWith(`provider:${item.provider}`) || !item.driver_installed"
                  @click="toggleProvider(item, 'tenant_visible')"
                >
                  <Eye v-if="item.tenant_visible" :size="14" />
                  <EyeOff v-else :size="14" />
                  {{ !item.driver_installed ? 'Indisponível' : (item.tenant_visible ? 'Visível' : 'Oculto') }}
                </button>
              </td>
              <td>
                <StatusBadge :status="item.documentation_status" />
                <p class="mt-1 text-xs text-slate-400">
                  {{ item.documentation_checked_at ? new Date(item.documentation_checked_at).toLocaleDateString('pt-BR') : 'sem conferência' }}
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>

  <section v-else-if="activeTab === 'PLAN'" class="card">
    <div class="mb-5 flex items-start gap-3">
      <div class="rounded-xl bg-violet-50 p-2 text-violet-700"><ShieldCheck :size="20" /></div>
      <div>
        <h2 class="font-bold text-slate-900">Entitlement bancário por plano</h2>
        <p class="text-sm text-slate-500">O plano nunca supera o bloqueio global. Você pode liberar todos, nenhum ou apenas providers específicos.</p>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div>
        <label class="label">Plano</label>
        <select v-model="selectedPlan" class="select">
          <option v-for="item in plans" :key="item.id" :value="item.code">{{ item.name }} · {{ item.code }}</option>
        </select>
      </div>
      <div>
        <label class="label">Política</label>
        <select v-model="planPolicy.mode" class="select">
          <option value="ALL">ALL — todos os providers instalados que estiverem globalmente habilitados</option>
          <option value="SELECTED">SELECTED — somente os providers selecionados abaixo</option>
          <option value="NONE">NONE — nenhum provider bancário</option>
        </select>
      </div>
    </div>

    <div v-if="planPolicy.mode === 'SELECTED'" class="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      <label
        v-for="item in installedProviders"
        :key="item.provider"
        class="flex items-center gap-3 rounded-xl border p-3"
        :class="item.globally_enabled ? 'border-slate-200 hover:bg-slate-50' : 'border-amber-200 bg-amber-50/40'"
      >
        <input v-model="planPolicy.selected[item.provider]" type="checkbox" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold">{{ item.display_name }}</p>
          <p class="font-mono text-[10px] text-slate-400">{{ item.provider }}</p>
          <p v-if="!item.globally_enabled" class="text-[10px] font-semibold text-amber-700">selecionável, mas bloqueado globalmente até você habilitar</p>
        </div>
      </label>
    </div>

    <div class="mt-5 flex items-center justify-between rounded-xl bg-slate-50 p-4">
      <p class="text-sm text-slate-600">
        Política efetiva do plano: <strong>{{ planPolicy.mode }}</strong>
        <template v-if="planPolicy.mode === 'SELECTED'"> · {{ Object.values(planPolicy.selected).filter(Boolean).length }} selecionado(s)</template>
      </p>
      <button class="btn-primary" :disabled="saving === 'plan' || !selectedPlan" @click="savePlanPolicy">
        <Save :size="16" /> Salvar política do plano
      </button>
    </div>
  </section>

  <section v-else class="card">
    <div class="mb-5 flex items-start gap-3">
      <div class="rounded-xl bg-blue-50 p-2 text-blue-700"><Building2 :size="20" /></div>
      <div>
        <h2 class="font-bold text-slate-900">Override bancário por tenant</h2>
        <p class="text-sm text-slate-500">Cada cliente herda o plano ou recebe ALLOW/DENY por provider. ALLOW nunca supera provider sem driver ou bloqueado globalmente.</p>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-2">
      <div>
        <label class="label">Tenant</label>
        <select v-model="selectedTenant" class="select">
          <option v-for="item in tenants" :key="item.id" :value="item.id">{{ item.name }} · {{ item.plan_code }}</option>
        </select>
      </div>
      <div>
        <label class="label">Modo administrativo</label>
        <select v-model="tenantPolicy.mode" class="select">
          <option value="INHERIT">INHERIT — herdar integralmente o plano</option>
          <option value="CUSTOM">CUSTOM — controlar provider por provider</option>
        </select>
      </div>
    </div>

    <div class="mt-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="item in providers"
        :key="item.provider"
        class="rounded-xl border border-slate-200 p-3"
        :class="!item.driver_installed && 'bg-slate-50 opacity-60'"
      >
        <div class="mb-2 flex items-start justify-between gap-2">
          <div>
            <p class="text-sm font-semibold">{{ item.display_name }}</p>
            <p class="font-mono text-[10px] text-slate-400">{{ item.provider }}</p>
          </div>
          <span class="badge" :class="tenantStateClass(tenantPolicy.decisions[item.provider])">
            {{ tenantStateLabel(tenantPolicy.decisions[item.provider]) }}
          </span>
        </div>

        <p class="mb-1 text-xs text-slate-500">{{ decisionLabel(tenantPolicy.decisions[item.provider]) }}</p>
        <p
          v-if="tenantPolicy.decisions[item.provider]?.source === 'TENANT_HIDDEN' && tenantPolicy.decisions[item.provider]?.operationally_allowed"
          class="mb-2 text-[10px] font-medium text-amber-700"
        >
          Oculto da descoberta; conexões existentes continuam autorizadas.
        </p>

        <select
          v-if="tenantPolicy.mode === 'CUSTOM'"
          v-model="tenantPolicy.overrides[item.provider]"
          class="select !py-1.5 text-xs"
          :disabled="!item.driver_installed"
        >
          <option value="INHERIT">INHERIT</option>
          <option value="ALLOW">ALLOW</option>
          <option value="DENY">DENY</option>
        </select>
        <div v-else class="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Herdando política do plano</div>

        <div class="mt-2 flex flex-wrap gap-1 text-[10px]">
          <span class="badge" :class="item.globally_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'">
            Global: {{ item.globally_enabled ? 'ON' : 'OFF' }}
          </span>
          <span class="badge" :class="item.tenant_visible ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'">
            {{ item.tenant_visible ? 'VISÍVEL' : 'OCULTO' }}
          </span>
        </div>
      </div>
    </div>

    <div class="mt-5 flex justify-end">
      <button class="btn-primary" :disabled="saving === 'tenant' || !selectedTenant" @click="saveTenantPolicy">
        <Save :size="16" /> Salvar política do tenant
      </button>
    </div>
  </section>
</template>
