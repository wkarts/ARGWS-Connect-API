<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  CheckCircle2, Clock3, Database, ExternalLink, Globe2, HardDrive,
  PlayCircle, RefreshCw, RotateCcw, Search, ServerCog, ShieldCheck, TriangleAlert,
} from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse, Paginated, ProvisioningJob } from '../types'
import { appConfirm } from '../composables/useAppDialog'
import PageHeader from '../components/PageHeader.vue'
import PaginationBar from '../components/PaginationBar.vue'
import StatusBadge from '../components/StatusBadge.vue'
import InlineAlert from '../components/InlineAlert.vue'
import DrawerPanel from '../components/DrawerPanel.vue'
import { domainModeLabel, statusLabel } from '../utils/labels'

interface ProvisioningDatabase {
  status:string
  database_name?:string|null
  database_user?:string|null
  credential_version?:number|null
  migrated_revision?:string|null
  provisioned_at?:string|null
  last_error?:string|null
}
interface ProvisioningStorage {
  status:string
  provider?:string|null
  bucket?:string|null
  prefix?:string|null
  provisioned_at?:string|null
  last_error?:string|null
}
interface ProvisioningDomain {
  id?:string|null
  hostname?:string|null
  status:string
  ssl_status:string
  management_mode?:string|null
  dns_provider?:string|null
  dns_verified:boolean
  last_checked_at?:string|null
  last_reconciled_at?:string|null
  last_error?:string|null
}
interface LatestJob {
  id:string
  operation:string
  status:string
  current_step:string
  progress:number
  attempts:number
  correlation_id:string
  started_at?:string|null
  finished_at?:string|null
  last_error?:string|null
}
interface TenantProvisioning {
  tenant_id:string
  tenant_name:string
  tenant_slug:string
  tenant_status:string
  plan_code:string
  ready:boolean
  issues:string[]
  database:ProvisioningDatabase
  storage:ProvisioningStorage
  domain:ProvisioningDomain
  latest_job?:LatestJob|null
}
interface ProvisioningOverview {
  total:number
  ready:number
  attention:number
  running:number
  tenants:TenantProvisioning[]
}

const route=useRoute()
const overview=ref<ProvisioningOverview>({total:0,ready:0,attention:0,running:0,tenants:[]})
const jobs=ref<ProvisioningJob[]>([])
const selectedTenant=ref<TenantProvisioning|null>(null)
const selectedJob=ref<ProvisioningJob|null>(null)
const page=ref(1)
const pages=ref(1)
const totalJobs=ref(0)
const jobStatus=ref('')
const query=ref('')
const loading=ref(false)
const actionBusy=ref('')
const error=ref('')
const success=ref('')
const lastUpdatedAt=ref<Date|null>(null)
const targetJobId=computed(()=>typeof route.query.job==='string'?route.query.job:'')
const targetTenantId=computed(()=>typeof route.query.tenant==='string'?route.query.tenant:'')
const autoRefreshing=computed(()=>overview.value.running>0||jobs.value.some(item=>['PENDING','RUNNING'].includes(item.status)))
const visibleTenants=computed(()=>{
  const term=query.value.trim().toLowerCase()
  if(!term)return overview.value.tenants
  return overview.value.tenants.filter(item=>[
    item.tenant_name,item.tenant_slug,item.plan_code,item.tenant_status,item.domain.hostname,
  ].some(value=>String(value||'').toLowerCase().includes(term)))
})
let timer:ReturnType<typeof setInterval>|null=null

const stepLabels:Record<string,string>={
  CREATED:'Solicitação criada',RETRY_CREATED:'Nova tentativa criada',DATABASE:'Banco de dados',
  MIGRATIONS:'Migrações',STORAGE:'Armazenamento',DOMAIN:'Domínio e DNS',BOOTSTRAP:'Dados iniciais',
  VALIDATION:'Validação final',COMPLETED:'Concluído',BOOTSTRAP_RECONCILE:'Reconciliação inicial',
}
const operationLabels:Record<string,string>={PROVISION:'Provisionamento completo'}
const stepLabel=(value?:string|null)=>stepLabels[String(value||'').toUpperCase()]||String(value||'Etapa não informada').replaceAll('_',' ')
const operationLabel=(value?:string|null)=>operationLabels[String(value||'').toUpperCase()]||String(value||'Operação')
const tenantName=(id:string)=>overview.value.tenants.find(item=>item.tenant_id===id)?.tenant_name||id

async function load(silent=false){
  if(loading.value&&!silent)return
  if(!silent)loading.value=true
  error.value=''
  try{
    const [overviewResponse,jobResponse]=await Promise.all([
      api.get<ApiResponse<ProvisioningOverview>>('/control/v1/provisioning/overview'),
      api.get<Paginated<ProvisioningJob>>('/control/v1/provisioning',{params:{page:page.value,per_page:25,status:jobStatus.value||undefined}}),
    ])
    overview.value=overviewResponse.data.data
    jobs.value=jobResponse.data.data
    pages.value=Math.max(1,jobResponse.data.meta.pages)
    totalJobs.value=jobResponse.data.meta.total

    if(targetTenantId.value&&!selectedTenant.value){
      selectedTenant.value=overview.value.tenants.find(item=>item.tenant_id===targetTenantId.value)||null
    }else if(selectedTenant.value){
      selectedTenant.value=overview.value.tenants.find(item=>item.tenant_id===selectedTenant.value?.tenant_id)||selectedTenant.value
    }

    if(targetJobId.value){
      const target=await api.get<ApiResponse<ProvisioningJob>>(`/control/v1/provisioning/${targetJobId.value}`)
      selectedJob.value=target.data.data
    }else if(selectedJob.value){
      selectedJob.value=jobs.value.find(item=>item.id===selectedJob.value?.id)||selectedJob.value
    }
    lastUpdatedAt.value=new Date()
  }catch(exception){error.value=apiError(exception)}finally{if(!silent)loading.value=false}
}

async function runAction(tenant:TenantProvisioning,action:string,confirmation?:string){
  if(confirmation){
    const ok=await appConfirm({
      title:'Confirmar ação de provisionamento',
      message:confirmation,
      confirmLabel:'Executar ação',
      cancelLabel:'Cancelar',
      tone:'warning',
    })
    if(!ok)return
  }
  const key=`${tenant.tenant_id}:${action}`
  actionBusy.value=key;error.value='';success.value=''
  try{
    const response=await api.post<ApiResponse<TenantProvisioning>>(`/control/v1/tenants/${tenant.tenant_id}/provisioning/actions`,{action})
    selectedTenant.value=response.data.data
    const messages:Record<string,string>={
      VALIDATE:'Validação concluída.',MIGRATE_DATABASE:'Migrações reaplicadas com a credencial atual do tenant.',
      ENSURE_STORAGE:'Storage verificado e reconciliado.',RECONCILE_DOMAIN:'Domínio e DNS reconciliados.',
      ACTIVATE_IF_READY:'Cliente ativado após validação dos recursos.',
    }
    success.value=messages[action]||'Operação concluída.'
    await load(true)
  }catch(exception){error.value=apiError(exception)}finally{actionBusy.value=''}
}

async function fullRetry(tenant:TenantProvisioning){
  const ok=await appConfirm({
    title:'Reprocessar provisionamento completo',
    message:`Reprocessar o provisionamento completo de ${tenant.tenant_name}? Use esta operação apenas para falhas de criação/provisionamento inicial. Para manutenção normal, prefira as ações específicas de banco, storage e domínio.`,
    confirmLabel:'Reprocessar',
    cancelLabel:'Cancelar',
    tone:'warning',
  })
  if(!ok)return
  const key=`${tenant.tenant_id}:FULL_RETRY`
  actionBusy.value=key;error.value='';success.value=''
  try{
    const response=await api.post<ApiResponse<{job_id:string;status:string}>>(`/control/v1/tenants/${tenant.tenant_id}/provision`)
    success.value='Nova execução de provisionamento criada.'
    const job=await api.get<ApiResponse<ProvisioningJob>>(`/control/v1/provisioning/${response.data.data.job_id}`)
    selectedJob.value=job.data.data
    await load(true)
  }catch(exception){error.value=apiError(exception)}finally{actionBusy.value=''}
}

function openTenant(item:TenantProvisioning){selectedTenant.value=item}
function openJob(item:ProvisioningJob){selectedJob.value=item}

onMounted(async()=>{
  await load()
  timer=setInterval(()=>{if(autoRefreshing.value)void load(true)},3000)
})
onBeforeUnmount(()=>{if(timer)clearInterval(timer)})
</script>

<template>
  <PageHeader title="Provisionamento dos clientes" subtitle="Administração completa de banco, storage, domínios, DNS, SSL, jobs e validação de cada tenant.">
    <div class="mr-1 hidden items-center gap-1.5 text-xs text-slate-400 sm:flex"><span class="h-1.5 w-1.5 rounded-full" :class="autoRefreshing?'bg-emerald-500 animate-pulse':'bg-slate-300'"/>{{autoRefreshing?'acompanhando execuções':'atualizado'}}</div>
    <button class="btn-primary" :disabled="loading" @click="load()"><RefreshCw :size="17" :class="loading&&'animate-spin'"/>Atualizar</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>

  <section class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <div class="card"><div class="flex items-start justify-between"><div><p class="text-xs uppercase text-slate-400">Clientes provisionados</p><p class="mt-2 text-2xl font-bold">{{overview.total}}</p></div><ServerCog :size="22" class="text-blue-600"/></div></div>
    <div class="card"><div class="flex items-start justify-between"><div><p class="text-xs uppercase text-slate-400">Operacionais</p><p class="mt-2 text-2xl font-bold text-emerald-700">{{overview.ready}}</p></div><CheckCircle2 :size="22" class="text-emerald-600"/></div></div>
    <div class="card"><div class="flex items-start justify-between"><div><p class="text-xs uppercase text-slate-400">Precisam de atenção</p><p class="mt-2 text-2xl font-bold" :class="overview.attention?'text-rose-700':'text-slate-900'">{{overview.attention}}</p></div><TriangleAlert :size="22" class="text-rose-600"/></div></div>
    <div class="card"><div class="flex items-start justify-between"><div><p class="text-xs uppercase text-slate-400">Em execução</p><p class="mt-2 text-2xl font-bold text-amber-700">{{overview.running}}</p></div><Clock3 :size="22" class="text-amber-600"/></div></div>
  </section>

  <section class="mb-7">
    <div class="mb-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div><h2 class="font-bold">Recursos por cliente</h2><p class="text-sm text-slate-500">O estado operacional é calculado a partir de banco, storage, domínio e SSL; não apenas do status cadastral do tenant.</p></div>
      <div class="relative w-full lg:w-96"><Search :size="17" class="absolute left-3 top-3 text-slate-400"/><input v-model="query" class="input pl-9" placeholder="Buscar cliente, slug, plano ou domínio..."/></div>
    </div>
    <div class="table-wrap">
      <table class="table">
        <thead><tr><th>Cliente</th><th>Banco</th><th>Storage</th><th>Domínio / SSL</th><th>Última execução</th><th class="text-right">Administração</th></tr></thead>
        <tbody>
          <tr v-for="item in visibleTenants" :key="item.tenant_id">
            <td><div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" :class="item.ready?'bg-emerald-500':'bg-rose-500'"/><div><p class="font-semibold">{{item.tenant_name}}</p><p class="text-xs text-slate-400">{{item.tenant_slug}} · {{item.plan_code}}</p></div></div></td>
            <td><StatusBadge :status="item.database.status"/><p v-if="item.database.migrated_revision" class="mt-1 text-[11px] text-slate-400">Migração: {{item.database.migrated_revision}}</p></td>
            <td><StatusBadge :status="item.storage.status"/><p class="mt-1 max-w-[180px] truncate text-[11px] text-slate-400">{{item.storage.provider||'—'}}</p></td>
            <td><p class="max-w-[230px] truncate font-medium">{{item.domain.hostname||'Sem domínio'}}</p><div class="mt-1 flex flex-wrap gap-1.5"><StatusBadge :status="item.domain.status"/><StatusBadge :status="item.domain.ssl_status"/></div></td>
            <td><template v-if="item.latest_job"><StatusBadge :status="item.latest_job.status"/><p class="mt-1 text-[11px] text-slate-400">{{stepLabel(item.latest_job.current_step)}} · {{item.latest_job.progress}}%</p></template><span v-else class="text-xs text-slate-400">Sem execução registrada</span></td>
            <td><div class="flex justify-end gap-2"><button class="btn-secondary !px-3 !py-2" @click="openTenant(item)"><ShieldCheck :size="15"/>Administrar</button><button v-if="item.latest_job" class="btn-secondary !px-3 !py-2" @click="jobs.find(job=>job.id===item.latest_job?.id)&&openJob(jobs.find(job=>job.id===item.latest_job?.id)!)"><PlayCircle :size="15"/>Eventos</button></div></td>
          </tr>
          <tr v-if="!visibleTenants.length"><td colspan="6" class="py-10 text-center text-slate-400">Nenhum cliente encontrado.</td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section>
    <div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div><h2 class="font-bold">Histórico de jobs</h2><p class="text-sm text-slate-500">Execuções completas de provisionamento e suas etapas.</p></div><select v-model="jobStatus" class="select w-full sm:w-56" @change="page=1;load()"><option value="">Todos os estados</option><option value="PENDING">Pendente</option><option value="RUNNING">Em execução</option><option value="SUCCEEDED">Concluído</option><option value="FAILED">Falhou</option></select></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Cliente</th><th>Operação</th><th>Etapa</th><th>Progresso</th><th>Estado</th><th>Início</th><th></th></tr></thead><tbody>
      <tr v-for="item in jobs" :key="item.id" :class="targetJobId===item.id?'bg-blue-50/70':''"><td><p class="font-semibold">{{tenantName(item.tenant_id)}}</p><p class="text-[11px] text-slate-400">{{item.tenant_id.slice(0,8)}}…</p></td><td>{{operationLabel(item.operation)}}</td><td>{{stepLabel(item.current_step)}}</td><td><div class="w-36"><div class="h-1.5 rounded-full bg-slate-100"><div class="h-1.5 rounded-full bg-blue-600" :style="{width:`${Math.min(100,item.progress||0)}%`}"/></div><p class="mt-1 text-[11px] text-slate-400">{{item.progress||0}}% · {{item.attempts}} tentativa(s)</p></div></td><td><StatusBadge :status="item.status"/></td><td>{{new Date(item.started_at||item.created_at).toLocaleString('pt-BR')}}</td><td><button class="btn-secondary !px-3 !py-2" @click="openJob(item)">Eventos</button></td></tr>
      <tr v-if="!jobs.length"><td colspan="7" class="py-10 text-center text-slate-400">Nenhuma execução encontrada.</td></tr>
    </tbody></table></div>
    <PaginationBar v-model="page" :pages="pages" :total="totalJobs" class="mt-4" @update:model-value="() => load()"/>
  </section>

  <DrawerPanel :open="Boolean(selectedTenant)" title="Administração do provisionamento" size="xl" @close="selectedTenant=null">
    <template v-if="selectedTenant">
      <div class="flex flex-wrap items-center justify-between gap-3"><div><h3 class="text-lg font-bold">{{selectedTenant.tenant_name}}</h3><p class="text-sm text-slate-500">{{selectedTenant.tenant_slug}} · {{selectedTenant.plan_code}}</p></div><StatusBadge :status="selectedTenant.ready?'ACTIVE':selectedTenant.tenant_status"/></div>
      <div v-if="selectedTenant.issues.length" class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p class="font-semibold text-amber-900">Pendências encontradas</p><ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800"><li v-for="issue in selectedTenant.issues" :key="issue">{{issue}}</li></ul></div>

      <div class="mt-5 grid gap-3 lg:grid-cols-3">
        <section class="rounded-xl border border-slate-200 p-4"><div class="flex items-center justify-between"><div class="flex items-center gap-2"><Database :size="18" class="text-blue-600"/><strong>Banco isolado</strong></div><StatusBadge :status="selectedTenant.database.status"/></div><dl class="mt-3 space-y-2 text-xs"><div><dt class="text-slate-400">Banco</dt><dd class="mt-1 font-medium">{{selectedTenant.database.database_name||'Não criado'}}</dd></div><div><dt class="text-slate-400">Revisão</dt><dd class="mt-1 font-medium">{{selectedTenant.database.migrated_revision||'Não aplicada'}}</dd></div><div><dt class="text-slate-400">Versão da credencial</dt><dd class="mt-1 font-medium">{{selectedTenant.database.credential_version||'—'}}</dd></div></dl><p v-if="selectedTenant.database.last_error" class="mt-3 text-xs text-rose-600">{{selectedTenant.database.last_error}}</p><button class="btn-secondary mt-4 w-full !py-2" :disabled="actionBusy===`${selectedTenant.tenant_id}:MIGRATE_DATABASE`" @click="runAction(selectedTenant,'MIGRATE_DATABASE','Reaplicar migrações neste banco usando a credencial já existente?')">Reaplicar migrações</button></section>
        <section class="rounded-xl border border-slate-200 p-4"><div class="flex items-center justify-between"><div class="flex items-center gap-2"><HardDrive :size="18" class="text-violet-600"/><strong>Armazenamento</strong></div><StatusBadge :status="selectedTenant.storage.status"/></div><dl class="mt-3 space-y-2 text-xs"><div><dt class="text-slate-400">Provedor</dt><dd class="mt-1 font-medium">{{selectedTenant.storage.provider||'—'}}</dd></div><div><dt class="text-slate-400">Namespace</dt><dd class="mt-1 break-all font-medium">{{selectedTenant.storage.bucket||'Não criado'}}</dd></div></dl><p v-if="selectedTenant.storage.last_error" class="mt-3 text-xs text-rose-600">{{selectedTenant.storage.last_error}}</p><button class="btn-secondary mt-4 w-full !py-2" :disabled="actionBusy===`${selectedTenant.tenant_id}:ENSURE_STORAGE`" @click="runAction(selectedTenant,'ENSURE_STORAGE')">Verificar armazenamento</button></section>
        <section class="rounded-xl border border-slate-200 p-4"><div class="flex items-center justify-between"><div class="flex items-center gap-2"><Globe2 :size="18" class="text-blue-600"/><strong>Domínio</strong></div><StatusBadge :status="selectedTenant.domain.status"/></div><p class="mt-3 truncate text-sm font-semibold">{{selectedTenant.domain.hostname||'Sem domínio'}}</p><p class="mt-1 text-xs text-slate-500">{{domainModeLabel(selectedTenant.domain.management_mode)}}</p><div class="mt-3 flex gap-2 text-xs"><span>DNS: {{selectedTenant.domain.dns_verified?'verificado':'pendente'}}</span><span>SSL: {{statusLabel(selectedTenant.domain.ssl_status)}}</span></div><p v-if="selectedTenant.domain.last_error" class="mt-3 text-xs text-rose-600">{{selectedTenant.domain.last_error}}</p><div class="mt-4 flex gap-2"><button class="btn-secondary flex-1 !py-2" :disabled="actionBusy===`${selectedTenant.tenant_id}:RECONCILE_DOMAIN`" @click="runAction(selectedTenant,'RECONCILE_DOMAIN')">Reconciliar</button><a v-if="selectedTenant.domain.hostname" :href="`https://${selectedTenant.domain.hostname}`" target="_blank" rel="noopener" class="btn-secondary !px-3 !py-2"><ExternalLink :size="15"/></a></div></section>
      </div>

      <div class="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4"><p class="font-semibold">Ações administrativas</p><p class="mt-1 text-sm text-slate-500">Use ações específicas para manutenção. O reprocessamento completo deve ficar restrito a falhas de criação/provisionamento inicial.</p><div class="mt-4 flex flex-wrap gap-2"><button class="btn-secondary" @click="runAction(selectedTenant,'VALIDATE')"><CheckCircle2 :size="16"/>Validar recursos</button><button class="btn-primary" :disabled="!selectedTenant.ready" @click="runAction(selectedTenant,'ACTIVATE_IF_READY')"><ShieldCheck :size="16"/>Ativar se estiver pronto</button><button class="btn-secondary text-amber-700" :disabled="actionBusy===`${selectedTenant.tenant_id}:FULL_RETRY`" @click="fullRetry(selectedTenant)"><RotateCcw :size="16"/>Reprocessamento completo</button></div></div>
    </template>
  </DrawerPanel>

  <DrawerPanel :open="Boolean(selectedJob)" title="Eventos do provisionamento" size="lg" @close="selectedJob=null">
    <template v-if="selectedJob">
      <div class="grid gap-2 sm:grid-cols-2"><div class="rounded-lg bg-slate-50 p-3"><p class="text-xs text-slate-400">Cliente</p><p class="mt-1 text-sm font-semibold">{{tenantName(selectedJob.tenant_id)}}</p></div><div class="rounded-lg bg-slate-50 p-3"><p class="text-xs text-slate-400">Estado</p><StatusBadge class="mt-1.5" :status="selectedJob.status"/></div></div>
      <div class="mt-3 rounded-lg bg-slate-50 p-3"><div class="mb-1.5 flex items-center justify-between text-xs"><span class="text-slate-500">{{stepLabel(selectedJob.current_step)}}</span><span class="font-semibold">{{selectedJob.progress||0}}%</span></div><div class="h-2 rounded-full bg-slate-200"><div class="h-2 rounded-full bg-blue-600" :style="{width:`${Math.min(100,selectedJob.progress||0)}%`}"/></div></div>
      <p v-if="selectedJob.last_error" class="mt-3 whitespace-pre-wrap rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{{selectedJob.last_error}}</p>
      <div class="mt-4 space-y-2.5"><article v-for="(event,index) in selectedJob.events||[]" :key="index" class="relative border-l-2 pl-3.5" :class="event.level==='ERROR'?'border-rose-300':'border-blue-200'"><span class="absolute -left-[5px] top-1 h-2 w-2 rounded-full" :class="event.level==='ERROR'?'bg-rose-500':'bg-blue-600'"/><p class="text-sm font-semibold">{{stepLabel(event.step)}}</p><p class="text-[13px] leading-5 text-slate-600">{{event.message}}</p><p class="text-[11px] text-slate-400">{{event.at?new Date(event.at).toLocaleString('pt-BR'):'—'}}</p></article></div>
    </template>
  </DrawerPanel>
</template>
