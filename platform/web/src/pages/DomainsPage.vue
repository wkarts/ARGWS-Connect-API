<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  CheckCircle2, CloudCog, Copy, ExternalLink, Globe2, KeyRound, Network,
  RefreshCw, Search, ShieldCheck, Star, Trash2, TriangleAlert, Unplug, Zap
} from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { appConfirm } from '../composables/useAppDialog'
import type { ApiResponse } from '../types'
import PageHeader from '../components/PageHeader.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import ModalDialog from '../components/ModalDialog.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'
import { domainModeLabel, statusLabel } from '../utils/labels'

interface Domain {
  id:string
  tenant_id:string
  tenant_name?:string|null
  tenant_slug?:string|null
  hostname:string
  domain_type:string
  management_mode:string
  dns_provider:string
  status:string
  is_primary:boolean
  is_temporary:boolean
  redirect_to_primary:boolean
  zone_name?:string|null
  zone_id?:string|null
  dns_record_type:string
  dns_target?:string|null
  dns_proxied:boolean
  nameservers:string[]
  provider_metadata:Record<string,unknown>
  dns_verified_at?:string|null
  ownership_verified_at?:string|null
  last_reconciled_at?:string|null
  dnssec_status:string
  ssl_status:string
  ssl_issued_at?:string|null
  last_checked_at?:string|null
  last_error?:string|null
}
interface DomainInstruction {
  kind:string
  type?:string
  name?:string
  value?:string
  values?:string[]
  required?:boolean
  message?:string
}
interface Management {
  mode:string
  provider:string
  hostname:string
  zone_name?:string|null
  zone_id?:string|null
  status:string
  ssl_status:string
  dnssec_status:string
  dns_target?:string|null
  dns_proxied:boolean
  nameservers:string[]
  last_checked_at?:string|null
  last_reconciled_at?:string|null
  last_error?:string|null
  instructions:DomainInstruction[]
  cloudflare?:Record<string,unknown>|null
}

const items=ref<Domain[]>([])
const loading=ref(false)
const busy=ref(false)
const error=ref('')
const success=ref('')
const q=ref('')
const status=ref('')
const mode=ref('')
const selected=ref<Domain|null>(null)
const management=ref<Management|null>(null)
const modal=ref(false)

const statusOptions:SearchSelectOption[]=[
  {value:'',label:'Todos os estados'},
  {value:'ACTIVE',label:'Ativos'},
  {value:'VERIFYING',label:'Aguardando verificação'},
  {value:'WAITING_NAMESERVERS',label:'Aguardando nameservers'},
  {value:'WAITING_SSL',label:'Aguardando SSL'},
  {value:'PROVISIONING',label:'Provisionando'},
  {value:'ERROR',label:'Com erro'},
]
const modeOptions:SearchSelectOption[]=[
  {value:'',label:'Todos os modos'},
  {value:'PLATFORM_SUBDOMAIN',label:'Subdomínio Connect|API'},
  {value:'PLATFORM_MANAGED',label:'Domínio gerenciado pela Connect|API Platform'},
  {value:'EXTERNAL_DNS',label:'DNS administrado pelo cliente'},
]
const filtered=computed(()=>{
  const term=q.value.trim().toLowerCase()
  if(!term)return items.value
  return items.value.filter(item=>`${item.hostname} ${item.tenant_name||''} ${item.tenant_slug||''} ${item.zone_name||''}`.toLowerCase().includes(term))
})
const summary=computed(()=>({
  total:items.value.length,
  active:items.value.filter(item=>item.status==='ACTIVE').length,
  attention:items.value.filter(item=>['VERIFYING','WAITING_NAMESERVERS','WAITING_SSL','PROVISIONING','PENDING'].includes(item.status)).length,
  errors:items.value.filter(item=>item.status==='ERROR'||Boolean(item.last_error)).length,
  managed:items.value.filter(item=>item.management_mode==='PLATFORM_MANAGED').length,
}))

const statusTone=(item:Domain)=>item.status==='ACTIVE'?'ACTIVE':item.status==='ERROR'||item.last_error?'ERROR':'PENDING'
const fmt=(value?:string|null)=>value?new Date(value).toLocaleString('pt-BR'):'—'
const modeDescription=(item:Domain)=>item.management_mode==='PLATFORM_SUBDOMAIN'
  ?'DNS e SSL do subdomínio são operados integralmente pela plataforma.'
  :item.management_mode==='PLATFORM_MANAGED'
    ?'Zona Cloudflare, DNS, proxy e DNSSEC são orquestrados pelo Control Plane.'
    :'O cliente mantém o provedor DNS; a plataforma valida apontamento e certificado.'

async function load(){
  loading.value=true;error.value=''
  try{
    items.value=(await api.get<ApiResponse<Domain[]>>('/control/v1/domains',{params:{status:status.value||undefined,management_mode:mode.value||undefined}})).data.data
  }catch(e){error.value=apiError(e)}finally{loading.value=false}
}
async function update(item:Domain,payload:Record<string,unknown>){
  busy.value=true;error.value=''
  try{await api.patch(`/control/v1/domains/${item.id}`,payload);success.value='Domínio atualizado.';await load()}
  catch(e){error.value=apiError(e)}finally{busy.value=false}
}
async function verify(item:Domain){
  busy.value=true;error.value=''
  try{await api.post(`/control/v1/domains/${item.id}/verify`);success.value='Validação de DNS executada.';await load();await refreshSelected(item.id)}
  catch(e){error.value=apiError(e)}finally{busy.value=false}
}
async function reconcile(item:Domain){
  busy.value=true;error.value=''
  try{await api.post(`/control/v1/domains/${item.id}/reconcile`);success.value='Reconciliação concluída.';await load();await refreshSelected(item.id)}
  catch(e){error.value=apiError(e)}finally{busy.value=false}
}
async function setProxy(item:Domain,enabled:boolean){
  busy.value=true;error.value=''
  try{await api.post(`/control/v1/domains/${item.id}/proxy`,{enabled});success.value=`Proxy Cloudflare ${enabled?'ativado':'desativado'}.`;await load();await refreshSelected(item.id)}
  catch(e){error.value=apiError(e)}finally{busy.value=false}
}
async function setDnssec(item:Domain,enabled:boolean){
  busy.value=true;error.value=''
  try{await api.post(`/control/v1/domains/${item.id}/dnssec`,{enabled});success.value=`DNSSEC ${enabled?'ativado':'desativado'}.`;await load();await refreshSelected(item.id)}
  catch(e){error.value=apiError(e)}finally{busy.value=false}
}
async function remove(item:Domain){
  const ok=await appConfirm({title:'Remover domínio',message:`Remover o domínio ${item.hostname}? Os registros gerenciados pela plataforma também serão reconciliados.`,confirmLabel:'Remover domínio',cancelLabel:'Cancelar',tone:'danger'});if(!ok)return
  busy.value=true;error.value=''
  try{await api.delete(`/control/v1/domains/${item.id}`);modal.value=false;success.value='Domínio removido.';await load()}
  catch(e){error.value=apiError(e)}finally{busy.value=false}
}
async function refreshSelected(id:string){
  const fresh=items.value.find(item=>item.id===id)
  if(fresh)selected.value=fresh
  if(!modal.value)return
  try{management.value=(await api.get<ApiResponse<Management>>(`/control/v1/domains/${id}/management`)).data.data}
  catch(e){error.value=apiError(e)}
}
async function openManagement(item:Domain){
  selected.value=item;management.value=null;modal.value=true
  await refreshSelected(item.id)
}
async function copy(value?:string|null){
  if(!value)return
  try{await navigator.clipboard.writeText(value);success.value='Valor copiado.'}
  catch{error.value='Não foi possível copiar automaticamente.'}
}
function filter(){void load()}

onMounted(load)
</script>

<template>
  <PageHeader title="Domínios, DNS e certificados" subtitle="Centro operacional de domínios provisórios, zonas Cloudflare, apontamentos externos, DNSSEC e SSL dos clientes.">
    <button class="btn-secondary" :disabled="loading" @click="load"><RefreshCw :size="18" :class="loading?'animate-spin':''"/>Atualizar</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/>
  <InlineAlert :message="success" type="success" @dismiss="success=''"/>

  <div class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    <div class="card"><p class="text-xs font-semibold uppercase text-slate-400">Domínios</p><p class="mt-2 text-2xl font-bold">{{summary.total}}</p><p class="mt-1 text-xs text-slate-400">registro central</p></div>
    <div class="card"><p class="text-xs font-semibold uppercase text-slate-400">Operacionais</p><p class="mt-2 text-2xl font-bold text-emerald-700">{{summary.active}}</p><p class="mt-1 text-xs text-slate-400">DNS e SSL ativos</p></div>
    <div class="card"><p class="text-xs font-semibold uppercase text-slate-400">Aguardando ação</p><p class="mt-2 text-2xl font-bold text-amber-700">{{summary.attention}}</p><p class="mt-1 text-xs text-slate-400">DNS, nameserver ou SSL</p></div>
    <div class="card"><p class="text-xs font-semibold uppercase text-slate-400">Com falha</p><p class="mt-2 text-2xl font-bold text-rose-700">{{summary.errors}}</p><p class="mt-1 text-xs text-slate-400">requer intervenção</p></div>
    <div class="card"><p class="text-xs font-semibold uppercase text-slate-400">Cloudflare gerenciado</p><p class="mt-2 text-2xl font-bold">{{summary.managed}}</p><p class="mt-1 text-xs text-slate-400">zonas próprias dos clientes</p></div>
  </div>

  <div class="mb-5 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_1fr_1fr_auto]">
    <div class="relative"><Search class="absolute left-3 top-3 text-slate-400" :size="18"/><input v-model="q" class="input pl-10" placeholder="Domínio, cliente, slug ou zona..."/></div>
    <SearchSelect v-model="status" :options="statusOptions" @update:model-value="filter"/>
    <SearchSelect v-model="mode" :options="modeOptions" @update:model-value="filter"/>
    <button class="btn-secondary" @click="load">Filtrar</button>
  </div>

  <div class="space-y-3">
    <article v-for="item in filtered" :key="item.id" class="card !p-0 overflow-hidden">
      <div class="grid gap-4 p-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-center">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <Globe2 :size="19" class="text-teal-700"/><strong class="truncate">{{item.hostname}}</strong>
            <Star v-if="item.is_primary" :size="15" class="fill-amber-400 text-amber-400"/>
            <StatusBadge :status="statusTone(item)"/>
          </div>
          <RouterLink :to="`/tenants/${item.tenant_id}`" class="mt-1 inline-block text-sm font-semibold text-teal-700 hover:underline">{{item.tenant_name||item.tenant_slug||'Cliente'}}</RouterLink>
          <p class="mt-1 text-xs text-slate-500">{{domainModeLabel(item.management_mode)}}</p>
        </div>
        <div class="text-sm">
          <p class="font-semibold text-slate-700">DNS</p>
          <p class="mt-1 text-xs" :class="item.dns_verified_at?'text-emerald-700':'text-amber-700'">{{item.dns_verified_at?'Verificado':'Pendente'}} · {{item.dns_provider}}</p>
          <p v-if="item.dns_target" class="mt-1 truncate text-xs text-slate-400">{{item.dns_record_type}} → {{item.dns_target}}</p>
        </div>
        <div class="text-sm">
          <p class="font-semibold text-slate-700">Segurança</p>
          <p class="mt-1 text-xs">SSL: <span :class="item.ssl_status==='ACTIVE'?'text-emerald-700':'text-amber-700'">{{statusLabel(item.ssl_status)}}</span></p>
          <p class="mt-1 text-xs">DNSSEC: <span class="text-slate-500">{{statusLabel(item.dnssec_status)}}</span></p>
        </div>
        <div class="flex flex-wrap justify-end gap-2">
          <button class="btn-secondary !px-3 !py-2" :disabled="busy" @click="reconcile(item)"><RefreshCw :size="16"/>Reconciliar</button>
          <button class="btn-primary !px-3 !py-2" @click="openManagement(item)"><CloudCog :size="16"/>Administrar</button>
        </div>
      </div>
      <div v-if="item.last_error" class="flex items-start gap-2 border-t border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700"><TriangleAlert :size="17" class="mt-0.5 shrink-0"/><span>{{item.last_error}}</span></div>
    </article>
    <EmptyState v-if="!filtered.length&&!loading" title="Nenhum domínio encontrado" description="Ajuste os filtros ou provisione um novo cliente."/>
  </div>

  <ModalDialog :open="modal" :title="selected?`Administração · ${selected.hostname}`:'Administração do domínio'" size="xl" @close="modal=false">
    <div v-if="selected" class="space-y-5">
      <div class="grid gap-3 md:grid-cols-3">
        <div class="rounded-xl border border-slate-200 p-4"><p class="text-xs text-slate-400">Cliente</p><p class="mt-1 font-semibold">{{selected.tenant_name||selected.tenant_slug}}</p><p class="text-xs text-slate-500">{{selected.tenant_slug}}</p></div>
        <div class="rounded-xl border border-slate-200 p-4"><p class="text-xs text-slate-400">Administração</p><p class="mt-1 font-semibold">{{domainModeLabel(selected.management_mode)}}</p><p class="text-xs text-slate-500">{{selected.dns_provider}}</p></div>
        <div class="rounded-xl border border-slate-200 p-4"><p class="text-xs text-slate-400">Estado</p><p class="mt-1 font-semibold">{{statusLabel(selected.status)}}</p><p class="text-xs text-slate-500">última reconciliação: {{fmt(selected.last_reconciled_at)}}</p></div>
      </div>

      <div class="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{{modeDescription(selected)}}</div>

      <section v-if="management?.instructions?.length" class="space-y-3">
        <div><h3 class="font-bold">Ação necessária / configuração DNS</h3><p class="text-sm text-slate-500">Somente as informações abaixo devem ser entregues ao cliente quando o DNS não for administrado pela Connect|API Platform.</p></div>
        <div v-for="(instruction,index) in management.instructions" :key="index" class="rounded-xl border p-4" :class="instruction.required?'border-amber-200 bg-amber-50':'border-slate-200 bg-white'">
          <div class="flex items-start gap-3"><Network :size="19" class="mt-0.5 text-teal-700"/><div class="min-w-0 flex-1"><p class="font-semibold">{{instruction.message||instruction.kind}}</p>
            <template v-if="instruction.values?.length"><div v-for="value in instruction.values" :key="value" class="mt-2 flex items-center gap-2 rounded-lg bg-white px-3 py-2 font-mono text-sm"><span class="min-w-0 flex-1 break-all">{{value}}</span><button class="p-1 text-slate-500" @click="copy(value)"><Copy :size="15"/></button></div></template>
            <div v-else-if="instruction.name||instruction.value" class="mt-3 grid gap-2 md:grid-cols-[100px_1fr_1fr]"><div class="rounded-lg bg-white p-2 text-xs font-bold">{{instruction.type||instruction.kind}}</div><div class="flex items-center gap-2 rounded-lg bg-white p-2 font-mono text-xs"><span class="min-w-0 flex-1 break-all">{{instruction.name}}</span><button @click="copy(instruction.name)"><Copy :size="14"/></button></div><div class="flex items-center gap-2 rounded-lg bg-white p-2 font-mono text-xs"><span class="min-w-0 flex-1 break-all">{{instruction.value}}</span><button @click="copy(instruction.value)"><Copy :size="14"/></button></div></div>
          </div></div>
        </div>
      </section>

      <section v-if="selected.management_mode==='PLATFORM_MANAGED'" class="rounded-2xl border border-sky-200 bg-sky-50 p-4">
        <div class="flex items-start gap-3"><CloudCog :size="22" class="text-sky-700"/><div class="min-w-0 flex-1"><h3 class="font-bold text-sky-950">Cloudflare administrado pela plataforma</h3><p class="mt-1 text-sm text-sky-800">Zona {{selected.zone_name||'—'}} · {{selected.nameservers.length}} nameserver(s) · proxy {{selected.dns_proxied?'ativo':'desativado'}} · DNSSEC {{statusLabel(selected.dnssec_status)}}.</p></div></div>
        <div class="mt-4 flex flex-wrap gap-2"><button class="btn-secondary" :disabled="busy||!selected.zone_id" @click="setProxy(selected,!selected.dns_proxied)"><Zap :size="16"/>{{selected.dns_proxied?'Desativar proxy':'Ativar proxy'}}</button><button class="btn-secondary" :disabled="busy||!selected.zone_id" @click="setDnssec(selected,selected.dnssec_status!=='ACTIVE')"><KeyRound :size="16"/>{{selected.dnssec_status==='ACTIVE'?'Desativar DNSSEC':'Ativar DNSSEC'}}</button></div>
      </section>

      <section class="grid gap-3 md:grid-cols-2">
        <div class="rounded-xl border border-slate-200 p-4"><div class="flex items-center gap-2"><CheckCircle2 :size="18" :class="selected.dns_verified_at?'text-emerald-600':'text-amber-500'"/><h3 class="font-semibold">DNS</h3></div><p class="mt-2 text-sm">{{selected.dns_verified_at?'Apontamento validado':'Ainda não validado'}}</p><p class="mt-1 text-xs text-slate-400">{{fmt(selected.dns_verified_at)}}</p></div>
        <div class="rounded-xl border border-slate-200 p-4"><div class="flex items-center gap-2"><ShieldCheck :size="18" :class="selected.ssl_status==='ACTIVE'?'text-emerald-600':'text-amber-500'"/><h3 class="font-semibold">Certificado SSL</h3></div><p class="mt-2 text-sm">{{statusLabel(selected.ssl_status)}}</p><p class="mt-1 text-xs text-slate-400">{{fmt(selected.ssl_issued_at)}}</p></div>
      </section>

      <div class="flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-4">
        <div class="flex flex-wrap gap-2"><button class="btn-secondary" :disabled="busy" @click="verify(selected)"><ShieldCheck :size="16"/>Verificar DNS</button><button class="btn-secondary" :disabled="busy" @click="reconcile(selected)"><RefreshCw :size="16"/>Reconciliar agora</button><button v-if="!selected.is_primary" class="btn-secondary" :disabled="busy" @click="update(selected,{is_primary:true})"><Star :size="16"/>Definir principal</button></div>
        <div class="flex gap-2"><a :href="`https://${selected.hostname}`" target="_blank" rel="noopener" class="btn-secondary"><ExternalLink :size="16"/>Abrir</a><button v-if="!selected.is_temporary&&selected.domain_type!=='PROVISIONED'&&!selected.is_primary" class="btn-secondary text-rose-600" :disabled="busy" @click="remove(selected)"><Trash2 :size="16"/>Remover</button></div>
      </div>
    </div>
  </ModalDialog>
</template>
