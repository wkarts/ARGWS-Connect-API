<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Download, RefreshCw, Search, ShieldCheck } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse } from '../types'
import PageHeader from '../components/PageHeader.vue'
import InlineAlert from '../components/InlineAlert.vue'
import { auditActionLabel, entityLabel, roleLabel } from '../utils/labels'

interface AuditItem {
  id:string
  action:string
  action_label?:string
  entity_type:string
  entity_label?:string
  entity_id?:string|null
  actor_id?:string|null
  actor_name?:string|null
  actor_email?:string|null
  actor_role?:string|null
  company_id?:string|null
  company_name?:string|null
  company_tax_id?:string|null
  before?:Record<string,unknown>|null
  after?:Record<string,unknown>|null
  context:Record<string,unknown>
  correlation_id?:string|null
  created_at:string
}

const items=ref<AuditItem[]>([])
const error=ref('')
const loading=ref(false)
const search=ref('')

const fieldLabels:Record<string,string>={
  state:'Estado',status:'Situação',number:'Número',name:'Nome',email:'E-mail',role:'Perfil',
  provider:'Serviço',environment:'Ambiente',cnab_layout:'Layout CNAB',require_2fa:'Exigir 2FA',
  connected_number:'Número conectado',profile_name:'Nome do perfil',session_exists:'Sessão vinculada',
  is_enabled:'Habilitado',is_active:'Ativo',plan_code:'Plano',hostname:'Domínio',management_mode:'Administração do domínio',
  dns_provider:'Provedor de DNS',dns_proxied:'Proxy habilitado',dnssec_status:'DNSSEC',ssl_status:'SSL',
  monthly_price:'Valor mensal',annual_price:'Valor anual',reason:'Motivo',queued:'Itens enfileirados',
  created:'Criados',removed:'Removidos',retention_days:'Retenção em dias',bytes:'Tamanho em bytes',filename:'Arquivo',
}

const actionText=(item:AuditItem)=>item.action_label||auditActionLabel(item.action)
const entityText=(item:AuditItem)=>item.entity_label||entityLabel(item.entity_type)

const visible=computed(()=>{
  const value=search.value.trim().toLowerCase()
  if(!value)return items.value
  return items.value.filter(item=>[
    actionText(item),entityText(item),item.actor_name,item.actor_email,item.company_name,item.company_tax_id,item.entity_id,
  ].some(field=>String(field||'').toLowerCase().includes(value)))
})

function humanizeKey(key:string){
  if(fieldLabels[key])return fieldLabels[key]
  const normalized=key.replaceAll('-','_').toLowerCase()
  if(fieldLabels[normalized])return fieldLabels[normalized]
  const tokens:Record<string,string>={
    id:'identificador',created:'criado',updated:'atualizado',at:'em',date:'data',mode:'modo',enabled:'habilitado',
    active:'ativo',code:'código',type:'tipo',value:'valor',amount:'valor',count:'quantidade',company:'empresa',tenant:'conta',
    user:'usuário',domain:'domínio',connection:'conexão',whatsapp:'WhatsApp',before:'anterior',after:'posterior',
  }
  return normalized.split('_').map(token=>tokens[token]||token).join(' ').replace(/^./,char=>char.toUpperCase())
}

function formatScalar(value:unknown):string{
  if(value===null||value===undefined||value==='')return'—'
  if(typeof value==='boolean')return value?'Sim':'Não'
  if(typeof value==='number')return value.toLocaleString('pt-BR')
  return String(value)
}

function readable(value?:Record<string,unknown>|null){
  const output:Array<{key:string;value:string}>=[]
  const walk=(source:unknown,prefix='')=>{
    if(!source||typeof source!=='object'||Array.isArray(source))return
    for(const [key,val] of Object.entries(source as Record<string,unknown>)){
      const label=prefix?`${prefix} · ${humanizeKey(key)}`:humanizeKey(key)
      if(val&&typeof val==='object'&&!Array.isArray(val))walk(val,label)
      else if(Array.isArray(val)){
        const primitives=val.every(item=>item===null||['string','number','boolean'].includes(typeof item))
        output.push({key:label,value:primitives?val.map(formatScalar).join(', '):`${val.length} item(ns)`})
      }else output.push({key:label,value:formatScalar(val)})
    }
  }
  walk(value)
  return output
}

async function load(){
  loading.value=true
  error.value=''
  try{items.value=(await api.get<ApiResponse<AuditItem[]>>('/v1/audit-details',{params:{limit:500}})).data.data}
  catch(e){error.value=apiError(e)}finally{loading.value=false}
}

function exportCsv(){
  const quote=(v:unknown)=>`"${String(v??'').replaceAll('"','""')}"`
  const lines=[
    'data;acao;entidade;usuario;email;perfil;empresa;cnpj_cpf;correlation_id',
    ...visible.value.map(item=>[
      item.created_at,actionText(item),entityText(item),item.actor_name,item.actor_email,roleLabel(item.actor_role),
      item.company_name,item.company_tax_id,item.correlation_id,
    ].map(quote).join(';')),
  ]
  const blob=new Blob([`\uFEFF${lines.join('\n')}`],{type:'text/csv;charset=utf-8'})
  const anchor=document.createElement('a')
  anchor.href=URL.createObjectURL(blob)
  anchor.download=`auditoria-${new Date().toISOString().slice(0,10)}.csv`
  anchor.click()
  URL.revokeObjectURL(anchor.href)
}

onMounted(load)
</script>

<template>
  <PageHeader title="Auditoria" subtitle="Histórico imutável das operações administrativas e operacionais, identificando quem fez, quando fez e em qual tenant.">
    <button class="btn-secondary" @click="exportCsv"><Download :size="18"/>Exportar CSV</button>
    <button class="btn-primary" :disabled="loading" @click="load"><RefreshCw :size="18" :class="loading?'animate-spin':''"/>Atualizar</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/>

  <div class="mb-5 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-soft">
    <Search :size="19" class="text-slate-400"/>
    <input v-model="search" class="w-full bg-transparent text-sm outline-none" placeholder="Pesquisar ação, usuário, empresa ou registro..."/>
  </div>

  <div class="space-y-3">
    <article v-for="item in visible" :key="item.id" class="card !p-0 overflow-visible">
      <div class="grid gap-4 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center">
        <div>
          <div class="flex items-center gap-2"><ShieldCheck :size="17" class="text-teal-700"/><strong>{{actionText(item)}}</strong></div>
          <p class="mt-1 text-xs text-slate-400">{{new Date(item.created_at).toLocaleString('pt-BR')}} · {{entityText(item)}}</p>
        </div>
        <div>
          <p class="text-xs text-slate-400">Usuário responsável</p>
          <p class="mt-1 text-sm font-semibold">{{item.actor_name||'Sistema'}}</p>
          <p class="text-xs text-slate-500">{{item.actor_email||roleLabel(item.actor_role)}}</p>
        </div>
        <div>
          <p class="text-xs text-slate-400">Empresa</p>
          <p class="mt-1 text-sm font-semibold">{{item.company_name||'Escopo geral da conta'}}</p>
          <p class="text-xs text-slate-500">{{item.company_tax_id||'Todas as empresas'}}</p>
        </div>
        <details class="relative lg:text-right">
          <summary class="cursor-pointer text-sm font-semibold text-teal-700">Detalhes</summary>
          <div class="mt-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-lg lg:absolute lg:right-0 lg:z-20 lg:w-[680px]">
            <div v-if="readable(item.before).length" class="mb-4">
              <p class="text-xs font-bold uppercase text-rose-600">Estado anterior</p>
              <dl class="mt-2 grid gap-1 text-xs"><div v-for="entry in readable(item.before)" :key="`b-${entry.key}`" class="grid grid-cols-[180px_1fr] gap-2"><dt class="text-slate-500">{{entry.key}}</dt><dd class="break-all text-slate-800">{{entry.value}}</dd></div></dl>
            </div>
            <div v-if="readable(item.after).length">
              <p class="text-xs font-bold uppercase text-emerald-700">Estado posterior</p>
              <dl class="mt-2 grid gap-1 text-xs"><div v-for="entry in readable(item.after)" :key="`a-${entry.key}`" class="grid grid-cols-[180px_1fr] gap-2"><dt class="text-slate-500">{{entry.key}}</dt><dd class="break-all text-slate-800">{{entry.value}}</dd></div></dl>
            </div>
            <p v-if="!readable(item.before).length&&!readable(item.after).length" class="text-sm text-slate-500">Este evento não possui alterações de campos para exibir.</p>
            <div v-if="item.correlation_id" class="mt-4 border-t pt-3 text-[11px] text-slate-400">Referência técnica: {{item.correlation_id}}</div>
          </div>
        </details>
      </div>
    </article>
    <div v-if="!visible.length&&!loading" class="card py-12 text-center text-slate-400">Nenhum evento de auditoria encontrado.</div>
  </div>
</template>
