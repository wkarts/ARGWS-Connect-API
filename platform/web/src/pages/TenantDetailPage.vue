<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { CloudCog, ExternalLink, Globe2, Network, Pencil, Plus, RefreshCw, RotateCcw, Settings2 } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse, PlatformPlan, Tenant } from '../types'
import PageHeader from '../components/PageHeader.vue'
import ModalDialog from '../components/ModalDialog.vue'
import InlineAlert from '../components/InlineAlert.vue'
import { domainModeLabel, statusLabel } from '../utils/labels'

const route = useRoute()
const router = useRouter()
const tenant = ref<Tenant | null>(null)
const plans = ref<PlatformPlan[]>([])
const error = ref('')
const success = ref('')
const domainModal = ref(false)
const settingsModal = ref(false)
const retrying = ref(false)
const saving = ref(false)

const domainForm=reactive({hostname:'',is_primary:false,management_mode:'EXTERNAL_DNS',zone_name:'',dns_proxied:false})
const settingsForm = reactive({
  name: '', status: 'ACTIVE', plan_code: '', timezone: 'America/Bahia', demo_mode: false,
  landing_mode: 'DISABLED', landing_url: '', landing_title: '', landing_subtitle: '',
  landing_cta_label: 'Acessar Connect|API', landing_cta_url: '/login',
  whatsapp_enabled: true, whatsapp_billing_mode: 'INCLUDED', whatsapp_monthly_price: '',
  custom_integrations_enabled: true,
})

const features = computed(() => tenant.value?.features || {})
const demoMode = computed(() => Boolean(features.value.demo_mode))
const landingMode = computed(() => String(features.value.landing_mode || 'DISABLED'))
const whatsappEnabled = computed(() => features.value.whatsapp !== false && features.value.whatsapp_enabled !== false)
const whatsappBilling = computed(() => String(features.value.whatsapp_billing_mode || 'INCLUDED'))
const customIntegrationsInPlan=computed(()=>Boolean(features.value.custom_integrations_allowed))
const customIntegrationsEnabled=computed(()=>customIntegrationsInPlan.value&&features.value.custom_integrations_enabled!==false)
const tenantPlanName = computed(() => {
  const current = tenant.value
  if (!current) return '—'
  return plans.value.find(plan => plan.code === current.plan_code)?.name || current.plan_code
})

async function load() {
  error.value = ''
  try {
    const [tenantResponse, planResponse] = await Promise.all([
      api.get<ApiResponse<Tenant>>(`/control/v1/tenants/${route.params.id}`),
      api.get<ApiResponse<PlatformPlan[]>>('/control/v1/plans', { params: { include_inactive: true } }),
    ])
    tenant.value = tenantResponse.data.data
    plans.value = planResponse.data.data
  } catch (e) { error.value = apiError(e) }
}

function openSettings() {
  if (!tenant.value) return
  const current = tenant.value.features || {}
  Object.assign(settingsForm, {
    name: tenant.value.name, status: tenant.value.status, plan_code: tenant.value.plan_code,
    timezone: tenant.value.timezone, demo_mode: Boolean(current.demo_mode),
    landing_mode: String(current.landing_mode || 'DISABLED'), landing_url: String(current.landing_url || ''),
    landing_title: String(current.landing_title || tenant.value.name || ''),
    landing_subtitle: String(current.landing_subtitle || ''),
    landing_cta_label: String(current.landing_cta_label || 'Acessar Connect|API'),
    landing_cta_url: String(current.landing_cta_url || '/login'),
    whatsapp_enabled: current.whatsapp_enabled !== false,
    whatsapp_billing_mode: String(current.whatsapp_billing_mode || 'INCLUDED'),
    whatsapp_monthly_price: current.whatsapp_monthly_price == null ? '' : String(current.whatsapp_monthly_price),
    custom_integrations_enabled: current.custom_integrations_enabled !== false,
  })
  settingsModal.value = true
}

function openDomain(){
  Object.assign(domainForm,{hostname:'',is_primary:false,management_mode:'EXTERNAL_DNS',zone_name:'',dns_proxied:false})
  domainModal.value=true
}

async function saveSettings() {
  if (!tenant.value || saving.value) return
  saving.value = true; error.value = ''
  try {
    const mergedFeatures = {
      ...(tenant.value.features || {}), demo_mode: settingsForm.demo_mode,
      landing_mode: settingsForm.landing_mode,
      landing_url: settingsForm.landing_mode === 'EXTERNAL' ? settingsForm.landing_url.trim() : '',
      landing_title: settingsForm.landing_title.trim(), landing_subtitle: settingsForm.landing_subtitle.trim(),
      landing_cta_label: settingsForm.landing_cta_label.trim(),
      landing_cta_url: settingsForm.landing_cta_url.trim() || '/login',
      whatsapp_enabled: settingsForm.whatsapp_enabled,
      whatsapp_billing_mode: settingsForm.whatsapp_billing_mode,
      whatsapp_monthly_price: settingsForm.whatsapp_billing_mode === 'ADDON' && settingsForm.whatsapp_monthly_price !== '' ? Number(settingsForm.whatsapp_monthly_price) : null,
      custom_integrations_enabled: settingsForm.custom_integrations_enabled,
    }
    await api.patch(`/control/v1/tenants/${tenant.value.id}`, {
      name: settingsForm.name, status: settingsForm.status, plan_code: settingsForm.plan_code,
      timezone: settingsForm.timezone, features: mergedFeatures,
    })
    settingsModal.value = false; success.value = 'Configurações do cliente atualizadas e recursos do plano reconciliados.'; await load()
  } catch (e) { error.value = apiError(e) } finally { saving.value = false }
}

async function addDomain() {
  error.value = ''
  try {
    await api.post(`/control/v1/tenants/${route.params.id}/domains`, {
      hostname:domainForm.hostname,
      is_primary:domainForm.is_primary,
      management_mode:domainForm.management_mode,
      zone_name:domainForm.management_mode==='PLATFORM_MANAGED'?(domainForm.zone_name||domainForm.hostname):null,
      dns_proxied:domainForm.management_mode==='PLATFORM_MANAGED'&&domainForm.dns_proxied,
    })
    domainModal.value = false
    success.value = domainForm.management_mode==='PLATFORM_MANAGED'
      ? 'Domínio cadastrado. A plataforma iniciou a orquestração da zona Cloudflare.'
      : 'Domínio cadastrado. As instruções de DNS já podem ser consultadas em Domínios e SSL.'
    await load()
  } catch (e) { error.value = apiError(e) }
}

async function verify(id: string) {
  error.value = ''
  try { await api.post(`/control/v1/domains/${id}/verify`); success.value='Validação do domínio concluída.'; await load() }
  catch (e) { error.value = apiError(e) }
}

async function retry() {
  if (retrying.value) return
  retrying.value = true; error.value = ''
  try {
    const response = await api.post<ApiResponse<{ job_id: string; status: string }>>(`/control/v1/tenants/${route.params.id}/provision`)
    await router.push({ path: '/provisioning', query: { job: response.data.data.job_id, tenant: String(route.params.id) } })
  } catch (e) { error.value = apiError(e) } finally { retrying.value = false }
}

onMounted(load)
</script>

<template>
  <PageHeader :title="tenant?.name || 'Cliente'" :subtitle="tenant ? `${tenant.slug} · ${tenantPlanName}` : 'Carregando…'">
    <button class="btn-secondary" @click="openSettings"><Settings2 :size="17" /> Configurar</button>
    <button class="btn-secondary" :disabled="retrying" @click="retry"><RotateCcw :size="17" :class="retrying&&'animate-spin'"/>{{retrying?'Reprocessando…':'Reprocessar provisionamento'}}</button>
    <button class="btn-primary" @click="openDomain"><Plus :size="17"/>Domínio próprio</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>

  <template v-if="tenant">
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <div class="card"><p class="text-xs text-slate-500">Estado</p><p class="mt-2 text-sm font-semibold">{{statusLabel(tenant.status)}}</p></div>
      <div class="card"><p class="text-xs text-slate-500">Plano</p><p class="mt-2 text-sm font-semibold">{{tenantPlanName}}</p></div>
      <div class="card"><p class="text-xs text-slate-500">Demonstração</p><p class="mt-2 text-sm font-semibold" :class="demoMode?'text-amber-700':'text-emerald-700'">{{demoMode?'Ativa':'Desativada'}}</p></div>
      <div class="card"><p class="text-xs text-slate-500">Landing page</p><p class="mt-2 text-sm font-semibold">{{landingMode==='DISABLED'?'Desativada':landingMode==='EXTERNAL'?'Externa':'Gerenciada'}}</p></div>
      <div class="card"><p class="text-xs text-slate-500">WhatsApp</p><p class="mt-2 text-sm font-semibold" :class="whatsappEnabled?'text-emerald-700':'text-slate-500'">{{whatsappEnabled?(whatsappBilling==='ADDON'?'Adicional':'Incluído'):'Desativado pelo plano/cliente'}}</p></div>
      <div class="card"><p class="text-xs text-slate-500">Integrações externas</p><p class="mt-2 text-sm font-semibold" :class="customIntegrationsEnabled?'text-emerald-700':'text-slate-500'">{{customIntegrationsEnabled?'Permitidas':customIntegrationsInPlan?'Desativadas para o cliente':'Não incluídas no plano'}}</p></div>
    </div>

    <section class="mt-5">
      <div class="mb-3 flex items-center justify-between"><div><h2 class="text-base font-semibold">Domínios do cliente</h2><p class="text-sm text-slate-500">O subdomínio Connect|API permanece disponível; domínios próprios podem ser gerenciados pela plataforma ou pelo DNS do cliente.</p></div><button class="inline-flex items-center gap-1 text-xs font-semibold text-teal-700" @click="openSettings"><Pencil :size="14"/>Operação</button></div>
      <div class="grid gap-3 lg:grid-cols-2">
        <article v-for="domain in tenant.domains" :key="domain.id" class="card">
          <div class="flex items-start gap-3"><div class="rounded-xl bg-teal-50 p-2.5 text-teal-700"><Globe2 :size="20"/></div><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><strong class="truncate">{{domain.hostname}}</strong><span v-if="domain.is_primary" class="badge bg-blue-100 text-blue-700">Principal</span></div><p class="mt-1 text-xs text-slate-500">{{domainModeLabel(domain.management_mode)}}</p><div class="mt-3 grid grid-cols-2 gap-2 text-xs"><div class="rounded-lg bg-slate-50 p-2"><span class="text-slate-400">DNS</span><p class="mt-1 font-semibold">{{domain.dns_verified_at?'Verificado':statusLabel(domain.status)}}</p></div><div class="rounded-lg bg-slate-50 p-2"><span class="text-slate-400">SSL</span><p class="mt-1 font-semibold">{{statusLabel(domain.ssl_status)}}</p></div></div><p v-if="domain.last_error" class="mt-2 text-xs text-rose-600">{{domain.last_error}}</p></div></div>
          <div class="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3"><a :href="`https://${domain.hostname}`" target="_blank" rel="noopener" class="btn-secondary !px-3 !py-2"><ExternalLink :size="14"/>Abrir</a><button v-if="domain.domain_type==='CUSTOM'" class="btn-secondary !px-3 !py-2" @click="verify(domain.id)"><RefreshCw :size="14"/>Verificar</button><RouterLink :to="{path:'/domains',query:{domain:domain.id}}" class="btn-secondary !px-3 !py-2"><CloudCog :size="14"/>Administrar</RouterLink></div>
        </article>
      </div>
    </section>
  </template>

  <ModalDialog :open="settingsModal" title="Configurar cliente" size="xl" @close="settingsModal=false">
    <form class="space-y-6" @submit.prevent="saveSettings">
      <section><h3 class="mb-3 font-semibold">Operação</h3><div class="grid gap-4 md:grid-cols-2"><div><label class="label">Nome</label><input v-model="settingsForm.name" class="input" required/></div><div><label class="label">Plano</label><select v-model="settingsForm.plan_code" class="select" required><option v-for="plan in plans" :key="plan.code" :value="plan.code">{{plan.name}}{{plan.is_active?'':' · inativo'}}</option></select><p class="mt-1 text-xs text-slate-500">Ao salvar, recursos e limites comerciais são sincronizados com a definição atual do plano.</p></div><div><label class="label">Estado</label><select v-model="settingsForm.status" class="select"><option value="ACTIVE">Ativo</option><option value="SUSPENDED">Suspenso</option><option value="BLOCKED">Bloqueado</option><option value="CANCELLED">Cancelado</option></select></div><div><label class="label">Fuso horário</label><input v-model="settingsForm.timezone" class="input"/></div></div><label class="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><input v-model="settingsForm.demo_mode" type="checkbox" class="mt-0.5"/><span><strong>Modo demonstração</strong><span class="mt-1 block text-amber-800">Somente para apresentação e testes comerciais.</span></span></label></section>
      <section class="border-t pt-5"><h3 class="mb-1 font-semibold">Landing page</h3><div class="mt-4 grid gap-4 md:grid-cols-2"><div><label class="label">Modo</label><select v-model="settingsForm.landing_mode" class="select"><option value="DISABLED">Sem landing pública</option><option value="PLATFORM">Gerenciada pela plataforma</option><option value="EXTERNAL">Landing externa</option></select></div><div v-if="settingsForm.landing_mode==='EXTERNAL'"><label class="label">URL</label><input v-model="settingsForm.landing_url" type="url" class="input"/></div><template v-if="settingsForm.landing_mode==='PLATFORM'"><div><label class="label">Título</label><input v-model="settingsForm.landing_title" class="input"/></div><div><label class="label">Subtítulo</label><input v-model="settingsForm.landing_subtitle" class="input"/></div><div><label class="label">Texto do botão</label><input v-model="settingsForm.landing_cta_label" class="input"/></div><div><label class="label">Destino</label><input v-model="settingsForm.landing_cta_url" class="input"/></div></template></div></section>
      <section class="border-t pt-5"><h3 class="mb-1 font-semibold">Comunicação e integrações</h3><p class="mb-4 text-sm text-slate-500">A definição do plano é soberana. Os controles abaixo apenas permitem desativar um recurso que já esteja comercialmente liberado.</p><div class="grid gap-4 md:grid-cols-2"><label class="flex items-center gap-2 rounded-xl border p-3 text-sm"><input v-model="settingsForm.whatsapp_enabled" type="checkbox"/>Permitir uso do WhatsApp quando incluso no plano</label><label class="flex items-center gap-2 rounded-xl border p-3 text-sm" :class="!customIntegrationsInPlan?'opacity-60':''"><input v-model="settingsForm.custom_integrations_enabled" type="checkbox" :disabled="!customIntegrationsInPlan"/>Permitir integrações personalizadas quando incluídas no plano</label><div><label class="label">Cobrança do WhatsApp</label><select v-model="settingsForm.whatsapp_billing_mode" class="select"><option value="INCLUDED">Incluído</option><option value="ADDON">Adicional</option></select></div><div v-if="settingsForm.whatsapp_billing_mode==='ADDON'"><label class="label">Valor mensal</label><input v-model="settingsForm.whatsapp_monthly_price" type="number" min="0" step="0.01" class="input"/></div></div></section>
      <div class="flex justify-end gap-2 border-t pt-4"><button type="button" class="btn-secondary" @click="settingsModal=false">Cancelar</button><button class="btn-primary" :disabled="saving">{{saving?'Salvando…':'Salvar e reconciliar plano'}}</button></div>
    </form>
  </ModalDialog>

  <ModalDialog :open="domainModal" title="Adicionar domínio próprio" size="lg" @close="domainModal=false">
    <form class="space-y-5" @submit.prevent="addDomain">
      <div><label class="label">Hostname completo</label><input v-model="domainForm.hostname" class="input" placeholder="connect.cliente.com.br" required/></div>
      <div><label class="label">Quem administrará o DNS?</label><div class="mt-2 grid gap-3 md:grid-cols-2"><label class="cursor-pointer rounded-xl border p-4" :class="domainForm.management_mode==='PLATFORM_MANAGED'?'border-teal-400 bg-teal-50':'border-slate-200'"><input v-model="domainForm.management_mode" type="radio" value="PLATFORM_MANAGED" class="mr-2"/><strong>Connect|API / Cloudflare</strong><p class="mt-2 text-xs text-slate-600">A plataforma cria/assume a zona, informa os nameservers e passa a operar DNS, proxy e DNSSEC.</p></label><label class="cursor-pointer rounded-xl border p-4" :class="domainForm.management_mode==='EXTERNAL_DNS'?'border-teal-400 bg-teal-50':'border-slate-200'"><input v-model="domainForm.management_mode" type="radio" value="EXTERNAL_DNS" class="mr-2"/><strong>Cliente / provedor externo</strong><p class="mt-2 text-xs text-slate-600">A plataforma entrega CNAME/TXT necessários e valida o apontamento sem acessar o DNS do cliente.</p></label></div></div>
      <div v-if="domainForm.management_mode==='PLATFORM_MANAGED'" class="rounded-xl border border-sky-200 bg-sky-50 p-4"><div class="flex items-start gap-3"><CloudCog :size="20" class="text-sky-700"/><div class="flex-1"><label class="label">Zona Cloudflare</label><input v-model="domainForm.zone_name" class="input mt-1" :placeholder="domainForm.hostname||'cliente.com.br'"/><label class="mt-3 flex items-center gap-2 text-sm"><input v-model="domainForm.dns_proxied" type="checkbox"/>Ativar proxy Cloudflare assim que a zona estiver operacional</label></div></div></div>
      <div v-else class="rounded-xl border border-slate-200 bg-slate-50 p-4"><div class="flex gap-3"><Network :size="20" class="text-slate-600"/><p class="text-sm text-slate-600">Depois do cadastro, abra <strong>Domínios e SSL</strong>. O Control Plane exibirá exatamente o CNAME e o registro TXT de validação que devem ser criados no DNS do cliente.</p></div></div>
      <label class="flex items-center gap-2 text-sm"><input v-model="domainForm.is_primary" type="checkbox"/>Tornar domínio principal</label>
      <div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="domainModal=false">Cancelar</button><button class="btn-primary">Cadastrar e iniciar orquestração</button></div>
    </form>
  </ModalDialog>
</template>
