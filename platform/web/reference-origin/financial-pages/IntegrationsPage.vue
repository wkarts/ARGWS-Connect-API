<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  CheckCircle2, Mail, MessageCircle, Plus, Power, RefreshCw, RotateCw,
  Save, ServerCog, Settings2, Smartphone, Trash2, Unplug
} from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse, Company } from '../types'
import { appConfirm } from '../composables/useAppDialog'
import PageHeader from '../components/PageHeader.vue'
import ModalDialog from '../components/ModalDialog.vue'
import StatusBadge from '../components/StatusBadge.vue'
import InlineAlert from '../components/InlineAlert.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'
import { statusLabel } from '../utils/labels'

interface Integration {
  id:string
  scope:string
  company_id?:string|null
  provider:string
  is_enabled:boolean
  public_config:Record<string,unknown>
  has_secrets:boolean
  last_health_status?:string|null
  last_health_at?:string|null
  last_error?:string|null
}
interface WhatsAppConnection {
  state:string
  pairing_code?:string|null
  qr_base64?:string|null
  number?:string|null
  profile_name?:string|null
  session_exists?:boolean
}
interface PlatformService {
  label:string
  managed:boolean
  available:boolean
  configured_by_platform:boolean
  included_in_plan?:boolean
  enabled_for_tenant?:boolean
  operations_available?:boolean
  connection?:WhatsAppConnection
  billing_mode?:string
  monthly_price?:unknown
}
interface PlatformServices {
  whatsapp:PlatformService
  email:PlatformService
  nfse:{label:string;managed:boolean;included_in_plan?:boolean;portal_nacional:boolean;webiss:boolean}
  custom_integrations_allowed:boolean
}
interface WhatsAppActionResponse {
  status:string
  connected:boolean
  session_preserved?:boolean
  normalized_phone?:string|null
  qr?:{image?:string|null;code?:string|null}
  connection?:WhatsAppConnection
}
type ProviderPreset={
  provider:string
  label:string
  description:string
  publicFields:Array<{key:string;label:string;placeholder?:string;type?:string}>
  secretFields:Array<{key:string;label:string;placeholder?:string}>
}

const presets:ProviderPreset[]=[
  {provider:'EVOLUTION',label:'WhatsApp externo',description:'Use somente quando a empresa optar por infraestrutura própria de WhatsApp.',publicFields:[{key:'base_url',label:'URL do serviço',placeholder:'https://whatsapp.exemplo.com.br'},{key:'instance',label:'Identificador da conexão',placeholder:'financeiro'}],secretFields:[{key:'api_key',label:'Chave de acesso',placeholder:'••••••••'},{key:'webhook_secret',label:'Segredo de validação',placeholder:'••••••••'}]},
  {provider:'SMTP',label:'E-mail externo',description:'Use um servidor de e-mail próprio em vez do serviço padrão da plataforma.',publicFields:[{key:'host',label:'Servidor',placeholder:'smtp.seudominio.com.br'},{key:'port',label:'Porta',placeholder:'587',type:'number'},{key:'security',label:'Segurança',placeholder:'starttls'},{key:'from_name',label:'Nome do remetente',placeholder:'Financeiro'},{key:'from_email',label:'E-mail remetente',placeholder:'financeiro@dominio.com.br'}],secretFields:[{key:'username',label:'Usuário',placeholder:'financeiro@dominio.com.br'},{key:'password',label:'Senha',placeholder:'••••••••'}]},
  {provider:'NFSE',label:'NFS-e externa',description:'Credenciais específicas de um emissor fiscal diferente dos serviços homologados da plataforma.',publicFields:[{key:'municipality_code',label:'Código IBGE',placeholder:'2928701'},{key:'environment',label:'Ambiente',placeholder:'Homologação'}],secretFields:[{key:'certificate_password',label:'Senha do certificado',placeholder:'••••••••'},{key:'api_token',label:'Token de acesso',placeholder:'••••••••'}]},
  {provider:'BACKUP',label:'Backup remoto externo',description:'Destino adicional de backup sob responsabilidade da empresa.',publicFields:[{key:'drive_remote',label:'Destino principal',placeholder:'remoto:financeiro'},{key:'dropbox_remote',label:'Destino secundário',placeholder:'remoto2:financeiro'}],secretFields:[]},
]

const integrations=ref<Integration[]>([])
const companies=ref<Company[]>([])
const services=ref<PlatformServices|null>(null)
const modal=ref(false)
const pairModal=ref(false)
const busyWhatsapp=ref(false)
const error=ref('')
const success=ref('')
const selectedProvider=ref('EVOLUTION')
const pairMode=ref<'QR'|'CODE'>('QR')
const pairPhone=ref('')
const pairCompany=ref('')
const whatsapp=reactive<WhatsAppConnection>({state:'DISCONNECTED',pairing_code:null,qr_base64:null,number:null,profile_name:null,session_exists:false})
const form=reactive({scope:'TENANT',company_id:'',is_enabled:true,public_config:{} as Record<string,unknown>,secrets:{} as Record<string,string>})

const selected=computed(()=>presets.find(item=>item.provider===selectedProvider.value)||presets[0])
const providerOptions=computed<SearchSelectOption[]>(()=>presets.map(item=>({value:item.provider,label:item.label,description:item.description})))
const scopeOptions:SearchSelectOption[]=[{value:'TENANT',label:'Todas as empresas',description:'Usar a mesma configuração em toda a conta.'},{value:'COMPANY',label:'Empresa específica',description:'Aplicar somente a uma empresa emissora.'}]
const companyOptions=computed<SearchSelectOption[]>(()=>[
  {value:'',label:'Todas as empresas',description:'Configuração compartilhada'},
  ...companies.value.map(company=>({value:company.id,label:company.trade_name||company.legal_name,description:company.tax_id,keywords:`${company.legal_name} ${company.trade_name||''} ${company.tax_id}`}))
])
const pairCompanyOptions=computed<SearchSelectOption[]>(()=>companies.value.map(company=>({
  value:company.id,
  label:company.trade_name||company.legal_name,
  description:`DDD padrão ${companyDdd(company)||'não parametrizado'} · ${company.tax_id}`,
  keywords:`${company.legal_name} ${company.trade_name||''} ${company.tax_id}`,
})))
const visibleIntegrations=computed(()=>integrations.value.filter(item=>item.scope!=='PLATFORM'))
const companyName=(id?:string|null)=>{if(!id)return'Todas as empresas';const item=companies.value.find(company=>company.id===id);return item?.trade_name||item?.legal_name||'Empresa'}
const presetFor=(provider:string)=>presets.find(item=>item.provider===provider)||{provider,label:'Integração personalizada',description:'Configuração personalizada.',publicFields:[],secretFields:[]}
const whatsappState=computed(()=>String(whatsapp.state||'DISCONNECTED').toUpperCase())
const whatsappConnected=computed(()=>whatsappState.value==='CONNECTED')
const whatsappSessionExists=computed(()=>Boolean(whatsapp.session_exists)||whatsappConnected.value)
const whatsappReconnecting=computed(()=>whatsappState.value==='RECONNECTING')
const operationsAvailable=computed(()=>Boolean(services.value?.whatsapp.operations_available))
const qrImage=computed(()=>{const raw=whatsapp.qr_base64;if(!raw)return'';return raw.startsWith('data:')?raw:`data:image/png;base64,${raw}`})
const selectedPairCompany=computed(()=>companies.value.find(company=>company.id===pairCompany.value)||companies.value[0]||null)
const whatsappStatusLabel=computed(()=>({
  CONNECTED:'Conectado',RECONNECTING:'Reconectando a sessão existente',CONNECTING:'Conectando',
  DISCONNECTED:'Desconectado',NOT_CREATED:'Conexão ainda não criada',UNAVAILABLE:'Serviço temporariamente indisponível',
  NOT_CONFIGURED:'Serviço ainda não configurado pela plataforma',UNKNOWN:'Estado em atualização',
} as Record<string,string>)[whatsappState.value]||statusLabel(whatsappState.value))

function companyDdd(company:Company):string{
  const settings=company.settings||{}
  const communication=settings.communication&&typeof settings.communication==='object'?settings.communication as Record<string,unknown>:{}
  const configured=String(communication.default_ddd||settings.default_ddd||'').replace(/\D/g,'')
  if(configured.length===2)return configured
  const phone=String(company.phone||'').replace(/\D/g,'')
  if(phone.startsWith('55')&&[12,13].includes(phone.length))return phone.slice(2,4)
  if([10,11].includes(phone.length))return phone.slice(0,2)
  return''
}
function billingText(service?:PlatformService){
  if(service?.included_in_plan===false)return'Não incluído no plano atual'
  if(service?.billing_mode==='ADDON'&&service.monthly_price)return`Adicional · R$ ${Number(service.monthly_price).toLocaleString('pt-BR',{minimumFractionDigits:2})}/mês`
  if(service?.billing_mode==='ADDON')return'Disponível como adicional'
  return'Incluído no plano'
}
function serviceAvailability(service?:PlatformService):string{
  if(service?.included_in_plan===false)return'Recurso não incluído no plano'
  if(service?.available)return'Operacional pela plataforma'
  if(service?.configured_by_platform===false)return'Incluído no plano · aguardando configuração da plataforma'
  return'Temporariamente indisponível'
}
function applyWhatsappResponse(response:WhatsAppActionResponse){
  if(response.connection)Object.assign(whatsapp,response.connection)
  else{
    whatsapp.state=response.status||whatsapp.state
    if(response.qr?.image)whatsapp.qr_base64=response.qr.image
    if(response.qr?.code)whatsapp.pairing_code=response.qr.code
    if(response.session_preserved)whatsapp.session_exists=true
  }
  if(response.session_preserved||whatsapp.session_exists){whatsapp.qr_base64=null;whatsapp.pairing_code=null}
}

async function load(){
  error.value=''
  try{
    const [items,companyResponse,platformResponse]=await Promise.all([
      api.get<ApiResponse<Integration[]>>('/v1/integrations'),
      api.get<ApiResponse<Company[]>>('/v1/companies'),
      api.get<ApiResponse<PlatformServices>>('/v1/platform-services'),
    ])
    integrations.value=items.data.data.filter(item=>item.scope!=='PLATFORM')
    companies.value=companyResponse.data.data
    services.value=platformResponse.data.data
    if(!pairCompany.value&&companies.value.length)pairCompany.value=companies.value[0].id
    Object.assign(whatsapp,platformResponse.data.data.whatsapp.connection||{state:platformResponse.data.data.whatsapp.available?'DISCONNECTED':'NOT_CONFIGURED'})
    if(whatsapp.session_exists){whatsapp.qr_base64=null;whatsapp.pairing_code=null}
  }catch(exception){error.value=apiError(exception)}
}
async function refreshWhatsapp(){
  if(!services.value?.whatsapp.available)return
  busyWhatsapp.value=true;error.value=''
  try{applyWhatsappResponse((await api.get<ApiResponse<WhatsAppActionResponse>>('/v1/platform-services/whatsapp/status')).data.data)}
  catch(exception){error.value=apiError(exception)}finally{busyWhatsapp.value=false}
}
async function createWhatsapp(){
  busyWhatsapp.value=true;error.value='';success.value=''
  try{
    const response=(await api.post<ApiResponse<WhatsAppActionResponse>>('/v1/platform-services/whatsapp/create')).data.data
    applyWhatsappResponse(response)
    if(whatsappSessionExists.value){success.value='A sessão existente foi preservada. Não é necessário parear novamente.';return}
    success.value='Conexão preparada. Escolha QR Code ou código de pareamento.';pairModal.value=true
  }catch(exception){error.value=apiError(exception)}finally{busyWhatsapp.value=false}
}
function openPair(mode:'QR'|'CODE'){
  if(whatsappSessionExists.value){success.value='Já existe uma sessão vinculada. Aguarde a reconexão ou use Reiniciar.';void refreshWhatsapp();return}
  pairMode.value=mode
  if(mode==='QR'){pairPhone.value='';pairModal.value=true;void connectWhatsapp();return}
  pairModal.value=true
}
async function connectWhatsapp(){
  if(whatsappSessionExists.value){pairModal.value=false;success.value='A sessão vinculada foi preservada; nenhum novo pareamento é necessário.';return}
  if(pairMode.value==='CODE'&&!pairPhone.value.trim())return
  busyWhatsapp.value=true;error.value='';success.value=''
  try{
    const body={
      phone:pairMode.value==='CODE'?pairPhone.value||null:null,
      company_id:pairMode.value==='CODE'?(pairCompany.value||null):null,
    }
    const response=(await api.post<ApiResponse<WhatsAppActionResponse>>('/v1/platform-services/whatsapp/connect',body)).data.data
    applyWhatsappResponse(response)
    if(response.connected){success.value='WhatsApp conectado com sucesso.';pairModal.value=false}
    else if(response.session_preserved||whatsappSessionExists.value){success.value='Sessão existente localizada e preservada. A plataforma está reconectando o WhatsApp.';pairModal.value=false}
    else pairModal.value=true
  }catch(exception){error.value=apiError(exception)}finally{busyWhatsapp.value=false}
}
async function disconnectWhatsapp(){
  const ok=await appConfirm({
    title:'Desconectar WhatsApp',
    message:'A sessão será encerrada e será necessário parear novamente para voltar a usar este canal. A instância continuará cadastrada.',
    confirmLabel:'Desconectar',cancelLabel:'Manter conectado',tone:'warning',
  })
  if(!ok)return
  busyWhatsapp.value=true;error.value=''
  try{applyWhatsappResponse((await api.post<ApiResponse<WhatsAppActionResponse>>('/v1/platform-services/whatsapp/disconnect')).data.data);whatsapp.session_exists=false;success.value='WhatsApp desconectado.'}
  catch(exception){error.value=apiError(exception)}finally{busyWhatsapp.value=false}
}
async function restartWhatsapp(){
  const ok=await appConfirm({
    title:'Reiniciar conexão do WhatsApp',
    message:'A plataforma reiniciará a conexão preservando a sessão vinculada. Não será solicitado novo QR Code enquanto a sessão continuar válida.',
    confirmLabel:'Reiniciar conexão',cancelLabel:'Cancelar',tone:'default',
  })
  if(!ok)return
  busyWhatsapp.value=true;error.value=''
  try{
    const response=(await api.post<ApiResponse<WhatsAppActionResponse>>('/v1/platform-services/whatsapp/restart')).data.data
    applyWhatsappResponse(response)
    success.value=whatsappSessionExists.value?'Reinicialização solicitada. A sessão foi preservada e será reconectada automaticamente.':'Conexão reiniciada.'
  }catch(exception){error.value=apiError(exception)}finally{busyWhatsapp.value=false}
}
async function removeWhatsapp(){
  const ok=await appConfirm({
    title:'Remover conexão do WhatsApp',
    message:'A instância será removida definitivamente deste cliente. Para voltar a usar o canal será obrigatório criar a conexão e parear o telefone novamente.',
    confirmLabel:'Remover instância',cancelLabel:'Cancelar',tone:'danger',
  })
  if(!ok)return
  busyWhatsapp.value=true;error.value=''
  try{applyWhatsappResponse((await api.delete<ApiResponse<WhatsAppActionResponse>>('/v1/platform-services/whatsapp')).data.data);Object.assign(whatsapp,{state:'NOT_CREATED',qr_base64:null,pairing_code:null,number:null,profile_name:null,session_exists:false});success.value='Conexão removida.'}
  catch(exception){error.value=apiError(exception)}finally{busyWhatsapp.value=false}
}

function openEditor(preset:ProviderPreset,current?:Integration){selectedProvider.value=preset.provider;form.scope=current?.scope==='COMPANY'?'COMPANY':'TENANT';form.company_id=current?.company_id||'';form.is_enabled=current?.is_enabled??true;form.public_config={...(current?.public_config||{})};form.secrets={};modal.value=true;error.value='';success.value=''}
function editIntegration(item:Integration){openEditor(presetFor(item.provider),item)}
function changeProvider(){form.public_config={};form.secrets={}}
async function save(){
  error.value=''
  try{
    const body={scope:form.company_id?'COMPANY':form.scope,company_id:form.company_id||null,is_enabled:form.is_enabled,public_config:form.public_config,secrets:Object.fromEntries(Object.entries(form.secrets).filter(([,value])=>String(value).trim()!==''))}
    await api.put(`/v1/integrations/${selected.value.provider}`,body)
    success.value=`${selected.value.label} configurado com sucesso.`;modal.value=false;await load()
  }catch(exception){error.value=apiError(exception)}
}
onMounted(async()=>{await load();if(services.value?.whatsapp.available)await refreshWhatsapp()})
</script>

<template>
  <PageHeader title="Integrações" subtitle="Serviços contratados, conexões da conta e integrações externas opcionais."/>
  <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>

  <section class="mb-8">
    <div class="mb-3"><h2 class="text-lg font-semibold">Serviços da plataforma</h2><p class="text-sm text-slate-500">A infraestrutura técnica é administrada pela plataforma; cada cliente controla apenas suas próprias conexões.</p></div>
    <div class="grid gap-4 xl:grid-cols-3">
      <article class="card">
        <div class="flex items-start gap-4"><div class="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><MessageCircle :size="25"/></div><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h3 class="font-bold">WhatsApp</h3><StatusBadge :status="whatsappConnected?'ACTIVE':whatsappState==='UNAVAILABLE'?'ERROR':services?.whatsapp.included_in_plan===false?'INACTIVE':'PENDING'"/></div><p class="mt-2 text-sm leading-6 text-slate-500">Cobranças, lembretes, documentos e confirmações pela conexão exclusiva da conta.</p><p class="mt-2 text-sm font-semibold" :class="whatsappConnected?'text-emerald-700':whatsappReconnecting?'text-amber-700':'text-slate-600'">{{whatsappStatusLabel}}</p><p v-if="whatsapp.profile_name||whatsapp.number" class="mt-1 text-xs text-slate-500">{{whatsapp.profile_name||'WhatsApp'}} · {{whatsapp.number||'número não identificado'}}</p><p class="mt-2 text-xs font-semibold text-slate-500">{{billingText(services?.whatsapp)}}</p></div></div>
        <div v-if="services?.whatsapp.available" class="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button v-if="operationsAvailable&&whatsappState==='NOT_CREATED'" class="btn-secondary !px-3 !py-2" :disabled="busyWhatsapp" @click="createWhatsapp"><Plus :size="16"/>Preparar conexão</button>
          <button v-if="operationsAvailable&&!whatsappSessionExists&&!whatsappConnected" class="btn-primary !px-3 !py-2" :disabled="busyWhatsapp" @click="openPair('QR')"><Smartphone :size="16"/>Conectar</button>
          <button class="btn-secondary !px-3 !py-2" :disabled="busyWhatsapp" @click="refreshWhatsapp"><RefreshCw :size="16" :class="busyWhatsapp?'animate-spin':''"/>Atualizar estado</button>
          <button v-if="operationsAvailable&&whatsappSessionExists" class="btn-secondary !px-3 !py-2" :disabled="busyWhatsapp" @click="restartWhatsapp"><RotateCw :size="16"/>Reiniciar preservando sessão</button>
          <button v-if="operationsAvailable&&whatsappConnected" class="btn-secondary !px-3 !py-2" :disabled="busyWhatsapp" @click="disconnectWhatsapp"><Unplug :size="16"/>Desconectar</button>
          <button v-if="operationsAvailable&&whatsappState!=='NOT_CREATED'" class="btn-secondary !px-3 !py-2 text-rose-600" :disabled="busyWhatsapp" @click="removeWhatsapp"><Trash2 :size="16"/>Remover instância</button>
        </div>
        <div v-if="whatsappReconnecting&&whatsappSessionExists" class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">A sessão continua vinculada ao telefone. A plataforma está restabelecendo a conexão e não solicitará um novo QR Code durante esse processo.</div>
        <p v-if="services?.whatsapp.available&&!operationsAvailable" class="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Esta conta usa uma conexão compartilhada administrada pela plataforma. O gerenciamento individual está bloqueado para proteger os demais clientes.</p>
      </article>

      <article class="card flex items-start gap-4"><div class="rounded-2xl bg-blue-50 p-3 text-blue-700"><Mail :size="25"/></div><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h3 class="font-bold">E-mail</h3><StatusBadge :status="services?.email.available?'ACTIVE':services?.email.included_in_plan===false?'INACTIVE':'PENDING'"/></div><p class="mt-2 text-sm leading-6 text-slate-500">Documentos e comunicações financeiras pelo serviço de e-mail da plataforma.</p><p class="mt-3 text-xs font-semibold" :class="services?.email.available?'text-emerald-700':'text-amber-700'">{{serviceAvailability(services?.email)}}</p></div></article>

      <article class="card flex items-start gap-4"><div class="rounded-2xl bg-violet-50 p-3 text-violet-700"><ServerCog :size="25"/></div><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h3 class="font-bold">NFS-e</h3><StatusBadge :status="services?.nfse.portal_nacional||services?.nfse.webiss?'ACTIVE':services?.nfse.included_in_plan===false?'INACTIVE':'PENDING'"/></div><p class="mt-2 text-sm leading-6 text-slate-500">Emissão fiscal pelos conectores homologados e administrados pela plataforma.</p><p v-if="services?.nfse.included_in_plan&&!services?.nfse.portal_nacional&&!services?.nfse.webiss" class="mt-3 text-xs font-semibold text-amber-700">Incluído no plano · aguardando habilitação do conector fiscal</p><div class="mt-3 flex flex-wrap gap-2"><span class="badge" :class="services?.nfse.portal_nacional?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-500'">Portal Nacional</span><span class="badge" :class="services?.nfse.webiss?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-500'">WebISS</span></div></div></article>
    </div>
  </section>

  <section v-if="services?.custom_integrations_allowed">
    <div class="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h2 class="text-lg font-semibold">Integrações externas</h2><p class="text-sm text-slate-500">Disponível no plano. Use somente quando a empresa precisar operar infraestrutura própria.</p></div><button class="btn-secondary" @click="openEditor(presets[0])"><Plus :size="18"/>Adicionar integração externa</button></div>
    <div v-if="visibleIntegrations.length" class="grid gap-4 xl:grid-cols-2"><article v-for="item in visibleIntegrations" :key="item.id" class="card"><div class="flex items-start gap-4"><div class="rounded-2xl bg-violet-50 p-3 text-violet-700"><ServerCog :size="23"/></div><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h3 class="font-bold">{{presetFor(item.provider).label}}</h3><StatusBadge :status="item.is_enabled?'ACTIVE':'DISABLED'"/></div><p class="mt-1 text-sm text-slate-500">{{companyName(item.company_id)}}</p><p class="mt-2 text-xs text-slate-400">Credenciais {{item.has_secrets?'protegidas e configuradas':'ainda não informadas'}}</p><button class="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-teal-700" @click="editIntegration(item)"><Settings2 :size="15"/>Editar configuração</button></div></div></article></div>
    <div v-else class="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center"><CheckCircle2 class="mx-auto text-emerald-600" :size="28"/><p class="mt-3 font-semibold">Nenhuma integração externa configurada</p><p class="mt-1 text-sm text-slate-500">Os serviços gerenciados da plataforma continuam disponíveis normalmente.</p></div>
  </section>
  <section v-else class="rounded-xl border border-slate-200 bg-slate-50 p-5"><p class="font-semibold">Integrações externas não fazem parte deste plano</p><p class="mt-1 text-sm text-slate-500">Os serviços gerenciados contratados continuam disponíveis sem expor credenciais técnicas.</p></section>

  <ModalDialog :open="pairModal" title="Conectar WhatsApp" size="lg" @close="pairModal=false">
    <div class="space-y-5">
      <div class="grid grid-cols-2 gap-2"><button type="button" class="rounded-xl border p-3 text-sm font-semibold" :class="pairMode==='QR'?'border-teal-400 bg-teal-50 text-teal-800':'border-slate-200'" @click="pairMode='QR';pairPhone='';connectWhatsapp()">Ler QR Code</button><button type="button" class="rounded-xl border p-3 text-sm font-semibold" :class="pairMode==='CODE'?'border-teal-400 bg-teal-50 text-teal-800':'border-slate-200'" @click="pairMode='CODE'">Código de pareamento</button></div>
      <template v-if="pairMode==='CODE'">
        <div v-if="companies.length>1"><label class="label">Empresa de referência para o DDD</label><SearchSelect v-model="pairCompany" :options="pairCompanyOptions"/></div>
        <div><label class="label">Número do WhatsApp</label><div class="flex gap-2"><input v-model="pairPhone" class="input" inputmode="tel" placeholder="99999-9999, 75999999999 ou 5575999999999"/><button class="btn-primary shrink-0" :disabled="busyWhatsapp||!pairPhone" @click="connectWhatsapp"><Power :size="16"/>Gerar código</button></div><p class="mt-2 text-xs text-slate-500">O país <strong>55</strong> é incluído automaticamente quando ausente. Se o DDD também não for informado, será usado o DDD padrão {{selectedPairCompany?`(${companyDdd(selectedPairCompany)||'não configurado'}) da empresa ${selectedPairCompany.trade_name||selectedPairCompany.legal_name}`:'da empresa emissora'}}.</p></div>
      </template>
      <div v-if="qrImage||whatsapp.pairing_code" class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div class="flex flex-wrap items-start gap-5"><img v-if="pairMode==='QR'&&qrImage" :src="qrImage" alt="QR Code do WhatsApp" class="h-60 w-60 rounded-xl bg-white p-2"/><div v-if="whatsapp.pairing_code"><p class="text-xs font-semibold uppercase tracking-wide text-emerald-700">Código de pareamento</p><p class="mt-2 font-mono text-2xl font-bold tracking-widest text-emerald-950">{{whatsapp.pairing_code}}</p><p class="mt-2 max-w-sm text-xs text-emerald-800">No WhatsApp do telefone, escolha vincular dispositivo usando número/código.</p></div></div></div>
      <div v-else class="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">{{busyWhatsapp?'Preparando o pareamento...':pairMode==='CODE'?'Informe o número e gere o código.':'Solicitando QR Code...'}}</div>
      <div class="flex justify-end"><button type="button" class="btn-secondary" @click="pairModal=false">Fechar</button></div>
    </div>
  </ModalDialog>

  <ModalDialog :open="modal" title="Integração externa" size="lg" @close="modal=false">
    <form class="space-y-5" @submit.prevent="save">
      <div><label class="label">Tipo de integração</label><SearchSelect v-model="selectedProvider" :options="providerOptions" @update:model-value="changeProvider"/><p class="mt-2 text-sm text-slate-500">{{selected.description}}</p></div>
      <div class="grid gap-4 md:grid-cols-2"><div><label class="label">Aplicar em</label><SearchSelect v-model="form.scope" :options="scopeOptions"/></div><div><label class="label">Empresa</label><SearchSelect v-model="form.company_id" :options="companyOptions"/></div></div>
      <div class="grid gap-4 md:grid-cols-2"><div v-for="field in selected.publicFields" :key="field.key"><label class="label">{{field.label}}</label><input v-model="form.public_config[field.key]" :type="field.type||'text'" :placeholder="field.placeholder" class="input"/></div></div>
      <div v-if="selected.secretFields.length" class="rounded-2xl border border-amber-200 bg-amber-50 p-4"><p class="mb-1 text-sm font-semibold text-amber-900">Credenciais da integração externa</p><p class="mb-3 text-xs text-amber-800">Os valores são criptografados no servidor e não são exibidos novamente.</p><div class="grid gap-4 md:grid-cols-2"><div v-for="field in selected.secretFields" :key="field.key"><label class="label">{{field.label}}</label><input v-model="form.secrets[field.key]" type="password" :placeholder="field.placeholder" class="input" autocomplete="new-password"/></div></div></div>
      <label class="flex items-center gap-2 text-sm font-medium text-slate-700"><input v-model="form.is_enabled" type="checkbox"/>Integração habilitada</label>
      <div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="modal=false">Cancelar</button><button class="btn-primary"><Save :size="18"/>Salvar</button></div>
    </form>
  </ModalDialog>
</template>
