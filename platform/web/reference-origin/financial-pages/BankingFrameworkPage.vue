<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Activity, BadgeCheck, Building2, Cable, CheckCircle2, CircleAlert, Database,
  FileKey2, Gauge, Landmark, Plus, RefreshCw, Save, ShieldCheck, Table2, Trash2, Upload,
} from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse, Company } from '../types'
import BankingPage from './BankingPage.vue'
import PageHeader from '../components/PageHeader.vue'
import InlineAlert from '../components/InlineAlert.vue'
import ModalDialog from '../components/ModalDialog.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'
import StatusBadge from '../components/StatusBadge.vue'

interface ProviderField {
  key:string
  label:string
  required:boolean
  secret:boolean
  field_type:string
  description?:string|null
  accepted_extensions:string[]
}
interface ProviderManifest {
  code:string
  name:string
  status:string
  implementation_available:boolean
  institution?:{name:string;bank_code?:string|null;ispb?:string|null}|null
  integration_modes:string[]
  environments:string[]
  capabilities:string[]
  authentication:{auth_type:string;certificate_required:boolean;notes?:string|null}
  credential_schema:ProviderField[]
  documentation:Array<{url:string;title:string;version?:string|null;checked_at?:string|null}>
  requires_homologation:boolean
  notes:string[]
  entitlement?:{
    allowed:boolean
    operationally_allowed?:boolean
    discoverable?:boolean
    tenant_visible?:boolean
  }
}
interface LifecycleBlocker {
  code:string
  count:number
  message:string
  operational:boolean
}
interface Lifecycle {
  can_delete:boolean
  used_operationally:boolean
  blockers:LifecycleBlocker[]
}
interface Account {
  id:string
  company_id:string
  bank_code:string
  bank_name:string
  branch:string
  account:string
  account_digit?:string|null
  is_active?:boolean
}
interface Connection {
  id:string
  company_id:string
  bank_account_id:string
  provider:string
  provider_name:string
  provider_status:string
  environment:string
  auth_type:string
  credential_version:number
  has_credentials:boolean
  certificate:{issuer?:string|null;serial?:string|null;subject?:string|null;not_before?:string|null;not_after?:string|null;fingerprint_sha256?:string|null}
  last_health_status?:string|null
  last_health_at?:string|null
  last_success_at?:string|null
  last_error?:string|null
  is_active:boolean
  lifecycle?:Lifecycle
}
interface ConnectionLifecycle {id:string;provider:string;is_active:boolean;lifecycle:Lifecycle}
interface MatrixItem {provider:string;name:string;status:string;implementation_available:boolean;capabilities:Record<string,boolean>}

const tab=ref<'LEGACY'|'CONNECTIONS'|'MATRIX'>('CONNECTIONS')
const providers=ref<ProviderManifest[]>([])
const discoverableProviders=ref<ProviderManifest[]>([])
const connections=ref<Connection[]>([])
const companies=ref<Company[]>([])
const accounts=ref<Account[]>([])
const matrix=ref<MatrixItem[]>([])
const error=ref('')
const success=ref('')
const loading=ref(false)
const modal=ref(false)
const editing=ref<Connection|null>(null)
const busy=ref('')
const deleting=ref('')
const form=reactive({
  company_id:'',bank_account_id:'',provider:'',environment:'SANDBOX',
  credentials:{} as Record<string,string>,settings:{} as Record<string,unknown>,is_active:true,
})

const connectableProviders=computed(()=>providers.value)
const selectedProvider=computed(()=>providers.value.find(item=>item.code===form.provider)||discoverableProviders.value.find(item=>item.code===form.provider)||null)
const providerOptions=computed<SearchSelectOption[]>(()=>{
  const options=connectableProviders.value.map(item=>({
    value:item.code,
    label:item.name,
    description:`${item.institution?.bank_code?item.institution.bank_code+' · ':''}${statusText(item.status)} · ${item.integration_modes.map(modeText).join(' + ')}`,
    keywords:`${item.code} ${item.name} ${item.institution?.name||''} ${item.institution?.bank_code||''}`,
  }))
  const current=editing.value?.provider
  const currentManifest=discoverableProviders.value.find(item=>item.code===current)
  if(current&&!options.some(item=>item.value===current)){
    options.push({value:current,label:`${currentManifest?.name||current} (existente)`,description:'Conexão existente preservada; novas conexões dependem do Control Plane.',keywords:current})
  }
  return options
})
const companyOptions=computed<SearchSelectOption[]>(()=>companies.value.map(item=>({value:item.id,label:item.trade_name||item.legal_name,description:item.tax_id})))
const accountOptions=computed<SearchSelectOption[]>(()=>{
  const providerBank=digits(selectedProvider.value?.institution?.bank_code||'').padStart(3,'0')
  return accounts.value
    .filter(item=>item.company_id===form.company_id&&((item.is_active??true)||item.id===editing.value?.bank_account_id))
    .filter(item=>!providerBank||digits(item.bank_code).padStart(3,'0')===providerBank)
    .map(item=>({
      value:item.id,
      label:`${item.bank_code} · ${item.bank_name}`,
      description:`Ag. ${item.branch} · Conta ${item.account}-${item.account_digit||''}`,
    }))
})
const environmentOptions=computed<SearchSelectOption[]>(()=>selectedProvider.value?.environments.map(value=>({value,label:environmentText(value)}))||[])
const capabilityColumns=['BALANCE','STATEMENT','BOLETO_CREATE','BOLETO_HYBRID','PIX_COB','PIX_COBV','PIX_PAYMENT','PIX_REFUND','PIX_AUTOMATIC','CNAB_240','CNAB_400','WEBHOOK']

function digits(value:string){return String(value||'').replace(/\D/g,'')}
function statusText(value:string){return({CATALOG_ONLY:'Somente catálogo',IMPLEMENTED:'Implementado',SANDBOX_VERIFIED:'Verificado em sandbox',PRODUCTION_READY:'Pronto para produção',HOMOLOGATION_REQUIRED:'Requer homologação',DISABLED:'Desativado',CONNECTED:'Conectado',DEGRADED:'Degradado',AUTH_ERROR:'Erro de autenticação',CERTIFICATE_EXPIRED:'Certificado expirado',CERTIFICATE_EXPIRING:'Certificado próximo do vencimento',INVALID_CONFIGURATION:'Configuração inválida',UNAVAILABLE:'Indisponível',DISCONNECTED:'Desconectado'} as Record<string,string>)[value]||value}
function environmentText(value:string){return({SANDBOX:'Sandbox',HOMOLOGATION:'Homologação',PRODUCTION:'Produção'} as Record<string,string>)[value]||value}
function modeText(value:string){return({DIRECT_API:'API direta',CNAB:'CNAB',OPEN_FINANCE:'Open Finance',FILE_IMPORT:'Importação de arquivo'} as Record<string,string>)[value]||value}
function capabilityText(value:string){return({BALANCE:'Saldo',STATEMENT:'Extrato',BOLETO_CREATE:'Boleto',BOLETO_HYBRID:'Boleto híbrido',PIX_COB:'Pix cobrança',PIX_COBV:'Pix vencimento',PIX_PAYMENT:'Pagamento Pix',PIX_REFUND:'Devolução Pix',PIX_AUTOMATIC:'Pix Automático',CNAB_240:'CNAB 240',CNAB_400:'CNAB 400',WEBHOOK:'Webhook'} as Record<string,string>)[value]||value.replaceAll('_',' ')}
function connectionTone(item:Connection){const status=String(item.last_health_status||'DISCONNECTED').toUpperCase();return status==='CONNECTED'?'ACTIVE':['AUTH_ERROR','CERTIFICATE_EXPIRED','INVALID_CONFIGURATION'].includes(status)?'ERROR':status==='DEGRADED'?'PENDING':'INACTIVE'}
function capability(item:Connection,value:string){return (providers.value.find(provider=>provider.code===item.provider)||discoverableProviders.value.find(provider=>provider.code===item.provider))?.capabilities.includes(value)||false}
function lifecycleTitle(item:Connection){if(item.lifecycle?.can_delete)return 'Conexão nunca utilizada: pode ser excluída definitivamente.';return item.lifecycle?.blockers.map(blocker=>blocker.message).join(' ')||'Conexão com histórico: desative em vez de excluir.'}

async function load(){
  loading.value=true;error.value=''
  try{
    const [connectableResponse,discoverableResponse,connectionResponse,lifecycleResponse,companyResponse,accountResponse,matrixResponse]=await Promise.all([
      api.get<ApiResponse<ProviderManifest[]>>('/v1/banking/providers',{params:{connectable_only:true}}),
      api.get<ApiResponse<ProviderManifest[]>>('/v1/banking/providers'),
      api.get<ApiResponse<Connection[]>>('/v1/banking/connections'),
      api.get<ApiResponse<ConnectionLifecycle[]>>('/v1/banking/lifecycle/connections'),
      api.get<ApiResponse<Company[]>>('/v1/companies'),
      api.get<ApiResponse<Account[]>>('/v1/banking/lifecycle/accounts'),
      api.get<ApiResponse<MatrixItem[]>>('/v1/banking/support-matrix'),
    ])
    providers.value=connectableResponse.data.data
    discoverableProviders.value=discoverableResponse.data.data
    const lifecycleById=new Map(lifecycleResponse.data.data.map(item=>[item.id,item.lifecycle]))
    connections.value=connectionResponse.data.data.map(item=>({...item,lifecycle:lifecycleById.get(item.id)}))
    companies.value=companyResponse.data.data
    accounts.value=accountResponse.data.data
    const visibleCodes=new Set(discoverableProviders.value.map(item=>item.code))
    matrix.value=matrixResponse.data.data.filter(item=>visibleCodes.has(item.provider))
  }catch(e){error.value=apiError(e)}finally{loading.value=false}
}
function resetForm(){
  editing.value=null
  const provider=connectableProviders.value.find(item=>item.code!=='SANDBOX')||connectableProviders.value[0]
  Object.assign(form,{company_id:companies.value[0]?.id||'',bank_account_id:'',provider:provider?.code||'',environment:provider?.environments[0]||'SANDBOX',credentials:{},settings:{},is_active:true})
}
function openCreate(){resetForm();modal.value=true}
function openEdit(item:Connection){
  editing.value=item
  Object.assign(form,{company_id:item.company_id,bank_account_id:item.bank_account_id,provider:item.provider,environment:item.environment,credentials:{},settings:{},is_active:item.is_active})
  modal.value=true
}
function changeProvider(){
  form.credentials={}
  form.bank_account_id=''
  const provider=selectedProvider.value
  form.environment=provider?.environments.includes('SANDBOX')?'SANDBOX':provider?.environments[0]||'PRODUCTION'
}
async function fileCredential(field:ProviderField,event:Event){
  const input=event.target as HTMLInputElement
  const file=input.files?.[0];if(!file)return
  const binary=field.accepted_extensions.some(ext=>['.pfx','.p12'].includes(ext.toLowerCase()))&&/\.(pfx|p12)$/i.test(file.name)
  form.credentials[field.key]=binary?await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(reader.error);reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');reader.readAsDataURL(file)}):await file.text()
}
async function save(){
  error.value='';success.value=''
  try{
    if(editing.value){
      await api.patch(`/v1/banking/connections/${editing.value.id}`,{environment:form.environment,credentials:form.credentials,settings:form.settings,is_active:form.is_active})
      success.value='Conexão bancária atualizada. Execute a validação antes de operar.'
    }else{
      await api.post('/v1/banking/connections',{company_id:form.company_id,bank_account_id:form.bank_account_id,provider:form.provider,environment:form.environment,credentials:form.credentials,settings:form.settings,is_active:form.is_active})
      success.value='Conexão bancária cadastrada. Valide a conexão antes de utilizá-la.'
    }
    modal.value=false;await load()
  }catch(e){error.value=apiError(e)}
}
async function deleteConnection(item:Connection){
  if(!item.lifecycle?.can_delete){error.value=lifecycleTitle(item);return}
  if(!window.confirm(`Excluir definitivamente a conexão ${item.provider_name}? Esta ação só é permitida porque a conexão nunca foi utilizada.`))return
  deleting.value=item.id;error.value='';success.value=''
  try{await api.delete(`/v1/banking/lifecycle/connections/${item.id}`);success.value='Conexão bancária excluída definitivamente.';await load()}catch(e){error.value=apiError(e)}finally{deleting.value=''}
}
async function validateConnection(item:Connection){
  busy.value=`validate:${item.id}`;error.value='';success.value=''
  try{const response=await api.post<ApiResponse<{status:string}>>(`/v1/banking/connections/${item.id}/validate`);success.value=`${item.provider_name}: ${statusText(response.data.data.status)}.`;await load()}catch(e){error.value=apiError(e)}finally{busy.value=''}
}
async function sync(item:Connection){
  busy.value=`sync:${item.id}`;error.value='';success.value=''
  try{await api.post(`/v1/banking/connections/${item.id}/sync`,{resources:['STATEMENT']});success.value='Sincronização bancária concluída e transações submetidas ao motor de conciliação.';await load()}catch(e){error.value=apiError(e)}finally{busy.value=''}
}
async function balance(item:Connection){
  busy.value=`balance:${item.id}`;error.value='';success.value=''
  try{const response=await api.get<ApiResponse<{available:string;currency:string}>>(`/v1/banking/connections/${item.id}/balance`);success.value=`Saldo disponível: ${Number(response.data.data.available).toLocaleString('pt-BR',{style:'currency',currency:response.data.data.currency||'BRL'})}.`}catch(e){error.value=apiError(e)}finally{busy.value=''}
}
onMounted(load)
</script>

<template>
  <div class="mb-5 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-soft">
    <button class="rounded-xl px-4 py-2.5 text-sm font-semibold" :class="tab==='CONNECTIONS'?'bg-slate-900 text-white':'text-slate-600 hover:bg-slate-50'" @click="tab='CONNECTIONS'"><Cable :size="16" class="mr-1 inline"/>Conexões bancárias</button>
    <button class="rounded-xl px-4 py-2.5 text-sm font-semibold" :class="tab==='LEGACY'?'bg-slate-900 text-white':'text-slate-600 hover:bg-slate-50'" @click="tab='LEGACY'"><Landmark :size="16" class="mr-1 inline"/>Contas, convênios e CNAB</button>
    <button class="rounded-xl px-4 py-2.5 text-sm font-semibold" :class="tab==='MATRIX'?'bg-slate-900 text-white':'text-slate-600 hover:bg-slate-50'" @click="tab='MATRIX'"><Table2 :size="16" class="mr-1 inline"/>Matriz de suporte</button>
  </div>

  <BankingPage v-if="tab==='LEGACY'"/>

  <template v-else-if="tab==='CONNECTIONS'">
    <PageHeader title="Conexões bancárias" subtitle="Crie e edite integrações DIRECT_API. Conexões nunca utilizadas podem ser excluídas; após uso operacional, apenas desative para preservar histórico e auditoria.">
      <button class="btn-secondary" :disabled="loading" @click="load"><RefreshCw :size="18" :class="loading?'animate-spin':''"/>Atualizar</button>
      <button class="btn-primary" @click="openCreate"><Plus :size="18"/>Nova conexão</button>
    </PageHeader>
    <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>

    <div class="grid gap-4 xl:grid-cols-2">
      <article v-for="item in connections" :key="item.id" class="card" :class="!item.is_active&&'opacity-70'">
        <div class="flex items-start gap-3"><div class="rounded-xl bg-blue-50 p-2.5 text-blue-700"><Building2 :size="21"/></div><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h2 class="font-bold">{{item.provider_name}}</h2><StatusBadge :status="connectionTone(item)"/><span class="badge" :class="item.is_active?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-500'">{{item.is_active?'Ativa':'Inativa'}}</span></div><p class="mt-1 text-xs text-slate-400">{{item.provider}} · {{environmentText(item.environment)}} · credencial v{{item.credential_version}}</p><p class="mt-2 text-sm font-semibold">{{statusText(item.last_health_status||'DISCONNECTED')}}</p><p v-if="item.last_health_at" class="mt-1 text-xs text-slate-400">Último teste: {{new Date(item.last_health_at).toLocaleString('pt-BR')}}</p><p v-if="item.last_error" class="mt-2 line-clamp-2 text-xs text-rose-600">{{item.last_error}}</p><p v-if="item.lifecycle&&!item.lifecycle.can_delete" class="mt-2 text-[11px] text-amber-700">Possui histórico operacional: quando não usar mais, desative em Editar.</p></div></div>
        <div v-if="item.certificate.not_after" class="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3"><div class="flex items-center gap-2"><FileKey2 :size="16" class="text-violet-600"/><strong class="text-sm">Certificado bancário</strong></div><p class="mt-1 text-xs text-slate-500">Validade: {{new Date(item.certificate.not_after).toLocaleDateString('pt-BR')}} · fingerprint {{item.certificate.fingerprint_sha256?.slice(0,16)}}…</p></div>
        <div class="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4"><button class="btn-primary !px-3 !py-2" :disabled="Boolean(busy)||!item.is_active" @click="validateConnection(item)"><ShieldCheck :size="15"/>Testar conexão</button><button v-if="capability(item,'BALANCE')" class="btn-secondary !px-3 !py-2" :disabled="Boolean(busy)||!item.is_active" @click="balance(item)"><Gauge :size="15"/>Saldo</button><button v-if="capability(item,'STATEMENT')" class="btn-secondary !px-3 !py-2" :disabled="Boolean(busy)||!item.is_active" @click="sync(item)"><Database :size="15"/>Sincronizar extrato</button><button class="btn-secondary !px-3 !py-2" @click="openEdit(item)">Editar</button><button class="btn-secondary !px-3 !py-2" :class="item.lifecycle?.can_delete?'text-rose-600':'opacity-40'" :disabled="!item.lifecycle?.can_delete||deleting===item.id" :title="lifecycleTitle(item)" @click="deleteConnection(item)"><Trash2 :size="15"/>Excluir</button></div>
      </article>
      <div v-if="!connections.length" class="card col-span-full py-12 text-center"><Cable :size="32" class="mx-auto text-slate-300"/><p class="mt-3 font-semibold">Nenhuma conexão bancária cadastrada</p><p class="mt-1 text-sm text-slate-500">Contas e convênios CNAB existentes continuam funcionando normalmente.</p></div>
    </div>
  </template>

  <template v-else>
    <PageHeader title="Matriz de suporte bancário" subtitle="Exibe somente providers que o Control Plane deixou descobríveis para este tenant. API e CNAB continuam sendo modos independentes."/>
    <InlineAlert :message="error" @dismiss="error=''"/>
    <div class="table-wrap"><table class="table min-w-[1500px]"><thead><tr><th>Provider</th><th>Estado</th><th>Executor</th><th v-for="cap in capabilityColumns" :key="cap">{{capabilityText(cap)}}</th></tr></thead><tbody><tr v-for="item in matrix" :key="item.provider"><td><p class="font-semibold">{{item.name}}</p><p class="font-mono text-xs text-slate-400">{{item.provider}}</p></td><td>{{statusText(item.status)}}</td><td><span class="inline-flex items-center gap-1 text-xs font-semibold" :class="item.implementation_available?'text-emerald-700':'text-slate-400'"><component :is="item.implementation_available?BadgeCheck:CircleAlert" :size="15"/>{{item.implementation_available?'Instalado':'Não instalado'}}</span></td><td v-for="cap in capabilityColumns" :key="cap" class="text-center"><CheckCircle2 v-if="item.capabilities[cap]" :size="17" class="mx-auto text-emerald-600"/><span v-else class="text-slate-300">—</span></td></tr></tbody></table></div>
  </template>

  <ModalDialog :open="modal" :title="editing?'Editar conexão bancária':'Nova conexão bancária'" size="xl" @close="modal=false">
    <form class="space-y-5" @submit.prevent="save">
      <div class="grid gap-4 md:grid-cols-2">
        <div><label class="label">Empresa</label><SearchSelect v-model="form.company_id" :options="companyOptions" :disabled="Boolean(editing)"/></div>
        <div><label class="label">Driver / provider</label><SearchSelect v-model="form.provider" :options="providerOptions" :disabled="Boolean(editing)" @update:model-value="changeProvider"/></div>
        <div><label class="label">Conta bancária da mesma instituição</label><SearchSelect v-model="form.bank_account_id" :options="accountOptions" :disabled="Boolean(editing)" placeholder="Selecione uma conta compatível com o provider"/><p class="mt-1 text-xs text-slate-500">A lista é filtrada pelo código bancário da instituição do provider.</p></div>
        <div><label class="label">Ambiente</label><SearchSelect v-model="form.environment" :options="environmentOptions"/></div>
        <div v-if="selectedProvider?.institution" class="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Instituição determinada pelo provider</p>
          <p class="mt-1 text-sm font-semibold text-slate-800">{{ selectedProvider.institution.name }}</p>
          <p class="mt-1 text-xs text-slate-500">Código {{ selectedProvider.institution.bank_code || '—' }} · ISPB {{ selectedProvider.institution.ispb || '—' }}</p>
          <p class="mt-1 text-[11px] text-slate-500">Esta instituição não pode ser trocada independentemente do provider.</p>
        </div>
      </div>

      <section v-if="selectedProvider" class="rounded-2xl border border-slate-200 p-4"><div class="flex items-start gap-3"><Activity :size="20" class="mt-0.5 text-teal-700"/><div><h3 class="font-semibold">{{selectedProvider.name}}</h3><p class="mt-1 text-sm text-slate-500">Autenticação: {{selectedProvider.authentication.auth_type}} · {{selectedProvider.capabilities.length}} capability(s)</p><p v-if="selectedProvider.authentication.notes" class="mt-1 text-xs text-slate-400">{{selectedProvider.authentication.notes}}</p></div></div><div class="mt-3 flex flex-wrap gap-1.5"><span v-for="cap in selectedProvider.capabilities" :key="cap" class="badge bg-teal-50 text-teal-700">{{capabilityText(cap)}}</span></div></section>

      <section v-if="selectedProvider?.credential_schema.length"><h3 class="mb-3 font-semibold">Credenciais exigidas pelo driver</h3><div class="grid gap-4 md:grid-cols-2"><div v-for="field in selectedProvider.credential_schema" :key="field.key"><label class="label">{{field.label}} <span v-if="field.required" class="text-rose-500">*</span></label><label v-if="field.field_type==='file'" class="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 text-sm text-slate-600 hover:bg-slate-50"><Upload :size="16"/>Selecionar {{field.label.toLowerCase()}}<input type="file" class="hidden" :accept="field.accepted_extensions.join(',')" @change="fileCredential(field,$event)"/></label><input v-else v-model="form.credentials[field.key]" :type="field.secret?'password':'text'" class="input" :required="field.required&&!editing" autocomplete="new-password" :placeholder="editing&&field.secret?'Deixe vazio para preservar o valor atual':''"/><p v-if="field.description" class="mt-1 text-xs text-slate-400">{{field.description}}</p><p v-if="field.field_type==='file'&&form.credentials[field.key]" class="mt-1 text-xs font-semibold text-emerald-700">Arquivo carregado e pronto para criptografia.</p></div></div></section>
      <label class="flex items-center gap-2 text-sm"><input v-model="form.is_active" type="checkbox"/>Conexão ativa</label>
      <div v-if="editing&&editing.lifecycle&&!editing.lifecycle.can_delete" class="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">Esta conexão já possui operação ou sincronização bancária. Ela não pode ser apagada; quando deixar de ser usada, desmarque <strong>Conexão ativa</strong>.</div>
      <div class="flex justify-end gap-2 border-t pt-4"><button type="button" class="btn-secondary" @click="modal=false">Cancelar</button><button class="btn-primary"><Save :size="17"/>Salvar conexão</button></div>
    </form>
  </ModalDialog>
</template>
