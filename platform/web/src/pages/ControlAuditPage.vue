<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Download, Search, ShieldCheck } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { Paginated, Tenant } from '../types'
import PageHeader from '../components/PageHeader.vue'
import PaginationBar from '../components/PaginationBar.vue'
import InlineAlert from '../components/InlineAlert.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'
import { auditActionLabel, entityLabel, roleLabel } from '../utils/labels'

interface AuditItem {
  id:string
  actor_id?:string|null
  actor_name?:string|null
  actor_email?:string|null
  actor_role?:string|null
  tenant_id?:string|null
  tenant_name?:string|null
  tenant_slug?:string|null
  action:string
  action_label?:string|null
  entity_type:string
  entity_label?:string|null
  entity_id?:string|null
  before:Record<string,unknown>
  after:Record<string,unknown>
  context:Record<string,unknown>
  correlation_id?:string|null
  created_at:string
}

const items=ref<AuditItem[]>([])
const tenants=ref<Tenant[]>([])
const page=ref(1)
const pages=ref(1)
const total=ref(0)
const query=ref('')
const tenantId=ref('')
const error=ref('')
const loading=ref(false)

const tenantOptions=computed<SearchSelectOption[]>(()=>[
  {value:'',label:'Toda a plataforma'},
  ...tenants.value.map(item=>({value:item.id,label:item.name,description:item.slug,keywords:`${item.name} ${item.slug} ${item.legal_document||''}`})),
])
const actionText=(item:AuditItem)=>item.action_label||auditActionLabel(item.action)
const entityText=(item:AuditItem)=>item.entity_label||entityLabel(item.entity_type)

const fieldLabels:Record<string,string>={
  state:'Estado',status:'Situação',number:'Número',name:'Nome',plan_code:'Plano',hostname:'Domínio',
  management_mode:'Administração',dns_provider:'Provedor DNS',dns_proxied:'Proxy',dnssec_status:'DNSSEC',ssl_status:'SSL',
  synchronized_tenants:'Clientes sincronizados',retention_days:'Retenção em dias',removed:'Registros removidos',
  filename:'Arquivo',bytes:'Tamanho em bytes',reason:'Motivo',proxied:'Proxy habilitado',session_exists:'Sessão vinculada',
}
function keyLabel(key:string){return fieldLabels[key]||key.replaceAll('_',' ').replace(/^./,char=>char.toUpperCase())}
function simple(value:unknown){
  if(value===null||value===undefined||value==='')return'—'
  if(typeof value==='boolean')return value?'Sim':'Não'
  if(Array.isArray(value))return value.every(item=>typeof item!=='object')?value.join(', '):`${value.length} item(ns)`
  if(typeof value==='object')return'Informação estruturada'
  return String(value)
}
const entries=(value?:Record<string,unknown>)=>Object.entries(value||{})

async function loadTenants(){
  try{tenants.value=(await api.get<Paginated<Tenant>>('/control/v1/tenants',{params:{per_page:100}})).data.data}catch{/* filtro continua opcional */}
}
async function load(){
  loading.value=true
  error.value=''
  try{
    const response=await api.get<Paginated<AuditItem>>('/control/v1/audit-details',{params:{
      page:page.value,per_page:100,q:query.value||undefined,tenant_id:tenantId.value||undefined,
    }})
    items.value=response.data.data
    pages.value=Math.max(1,response.data.meta.pages)
    total.value=response.data.meta.total
  }catch(e){error.value=apiError(e)}finally{loading.value=false}
}
function apply(){page.value=1;void load()}
function exportCsv(){
  const quote=(value:unknown)=>`"${String(value??'').replaceAll('"','""')}"`
  const lines=['data;acao;entidade;usuario;email;perfil;cliente;slug;correlation_id',...items.value.map(item=>[
    item.created_at,actionText(item),entityText(item),item.actor_name,item.actor_email,roleLabel(item.actor_role),
    item.tenant_name,item.tenant_slug,item.correlation_id,
  ].map(quote).join(';'))]
  const blob=new Blob([`\uFEFF${lines.join('\n')}`],{type:'text/csv;charset=utf-8'})
  const anchor=document.createElement('a')
  anchor.href=URL.createObjectURL(blob)
  anchor.download='auditoria-control-plane.csv'
  anchor.click()
  URL.revokeObjectURL(anchor.href)
}

onMounted(async()=>{await loadTenants();await load()})
</script>

<template>
  <PageHeader title="Auditoria global" subtitle="Trilha imutável das operações do Control Plane, provisionamento, domínios, suporte e administração dos clientes.">
    <button class="btn-secondary" @click="exportCsv"><Download :size="18"/>Exportar</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/>

  <div class="mb-5 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,.8fr)_auto]">
    <div class="relative"><Search class="absolute left-3 top-3 text-slate-400" :size="18"/><input v-model="query" class="input pl-10" placeholder="Pesquisar ação, operador, cliente ou registro..." @keyup.enter="apply"/></div>
    <SearchSelect v-model="tenantId" :options="tenantOptions" placeholder="Toda a plataforma" @update:model-value="apply"/>
    <button class="btn-primary" :disabled="loading" @click="apply">Pesquisar</button>
  </div>

  <div class="mb-3 text-xs text-slate-400">{{total.toLocaleString('pt-BR')}} evento(s) encontrado(s)</div>
  <div class="space-y-3">
    <article v-for="item in items" :key="item.id" class="card !p-0 overflow-visible">
      <div class="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-center">
        <div>
          <div class="flex items-center gap-2"><ShieldCheck :size="17" class="text-teal-700"/><strong>{{actionText(item)}}</strong></div>
          <p class="mt-1 text-xs text-slate-400">{{new Date(item.created_at).toLocaleString('pt-BR')}} · {{entityText(item)}}</p>
        </div>
        <div>
          <p class="text-xs text-slate-400">Operador</p>
          <p class="mt-1 text-sm font-semibold">{{item.actor_name||'Sistema'}}</p>
          <p class="text-xs text-slate-500">{{item.actor_email||roleLabel(item.actor_role)}}</p>
        </div>
        <div>
          <p class="text-xs text-slate-400">Cliente afetado</p>
          <p class="mt-1 text-sm font-semibold">{{item.tenant_name||'Plataforma'}}</p>
          <p class="text-xs text-slate-500">{{item.tenant_slug||'Escopo global'}}</p>
        </div>
        <details class="relative">
          <summary class="cursor-pointer text-sm font-semibold text-teal-700">Ver alterações</summary>
          <div class="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xl lg:absolute lg:right-0 lg:z-20 lg:w-[720px] lg:grid-cols-2">
            <div><p class="mb-2 text-xs font-bold uppercase text-rose-600">Estado anterior</p><dl class="space-y-1 text-xs"><div v-for="[key,value] in entries(item.before)" :key="`b-${key}`" class="grid grid-cols-[150px_1fr] gap-2"><dt class="text-slate-500">{{keyLabel(key)}}</dt><dd class="break-all">{{simple(value)}}</dd></div><p v-if="!entries(item.before).length" class="text-slate-400">Sem estado anterior.</p></dl></div>
            <div><p class="mb-2 text-xs font-bold uppercase text-emerald-700">Estado posterior</p><dl class="space-y-1 text-xs"><div v-for="[key,value] in entries(item.after)" :key="`a-${key}`" class="grid grid-cols-[150px_1fr] gap-2"><dt class="text-slate-500">{{keyLabel(key)}}</dt><dd class="break-all">{{simple(value)}}</dd></div><p v-if="!entries(item.after).length" class="text-slate-400">Sem estado posterior.</p></dl></div>
            <p v-if="item.correlation_id" class="col-span-full border-t pt-2 text-[11px] text-slate-400">Referência técnica: {{item.correlation_id}}</p>
          </div>
        </details>
      </div>
    </article>
    <div v-if="!items.length&&!loading" class="card py-12 text-center text-slate-400">Nenhum evento encontrado.</div>
  </div>
  <PaginationBar v-model="page" :pages="pages" :total="total" class="mt-5" @update:model-value="load"/>
</template>
