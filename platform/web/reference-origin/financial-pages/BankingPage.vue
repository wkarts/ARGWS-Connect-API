<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Download, FileDown, FileUp, Landmark, Pencil, Plus, Search, Trash2 } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { fetchAllPages } from '../api/pagination'
import type { ApiResponse, Company, Customer, Receivable } from '../types'
import PageHeader from '../components/PageHeader.vue'
import ModalDialog from '../components/ModalDialog.vue'
import InlineAlert from '../components/InlineAlert.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'

interface LifecycleBlocker{code:string;count:number;message:string;operational:boolean}
interface Lifecycle{can_delete:boolean;used_operationally:boolean;blockers:LifecycleBlocker[]}
interface Account{id:string;company_id:string;bank_code:string;bank_name:string;branch:string;branch_digit?:string;account:string;account_digit?:string;account_type?:string;pix_key_type?:string;pix_key?:string;is_default:boolean;is_active:boolean;lifecycle:Lifecycle}
interface Agreement{id:string;company_id:string;bank_account_id:string;name:string;provider:string;environment:string;agreement_number?:string;wallet?:string;beneficiary_code?:string;cnab_layout:string;settings?:Record<string,unknown>;is_active:boolean;lifecycle:Lifecycle}
interface CNABSettingField{key:string;source?:string;allowed?:string[];type?:string;label?:string;description?:string}
interface ProviderManifest{code:string;name:string;status:string;implementation_available:boolean;integration_modes:string[];implemented_modes?:string[];environments:string[];capabilities:string[];metadata?:{cnab_settings_schema?:CNABSettingField[];[key:string]:unknown};entitlement?:{allowed:boolean;source:string;commercial_status:string}}
interface ProviderRemittanceResult{id:string;sequence:number;layout:string;provider:string;provider_mode:string}

const accounts=ref<Account[]>([])
const agreements=ref<Agreement[]>([])
const providers=ref<ProviderManifest[]>([])
const companies=ref<Company[]>([])
const customers=ref<Customer[]>([])
const receivables=ref<Receivable[]>([])
const returnCompanyId=ref('')
const error=ref('')
const success=ref('')
const accountModal=ref(false)
const agreementModal=ref(false)
const cnabModal=ref(false)
const editingAccount=ref<Account|null>(null)
const editingAgreement=ref<Agreement|null>(null)
const lastRemittance=ref<{id:string;sequence:number;layout:string}|null>(null)
const downloading=ref(false)
const deleting=ref('')
const titleSearch=ref('')

const accountForm=reactive({company_id:'',bank_code:'001',bank_name:'Banco do Brasil',branch:'',branch_digit:'',account:'',account_digit:'',account_type:'CHECKING',pix_key_type:'',pix_key:'',is_default:true,is_active:true})
const agreementForm=reactive({company_id:'',bank_account_id:'',name:'Convênio de cobrança',provider:'',environment:'HOMOLOGATION',agreement_number:'',wallet:'',beneficiary_code:'',cnab_layout:'240',settings:{} as Record<string,string>,is_active:true})
const cnabForm=reactive({bank_agreement_id:'',receivable_ids:[] as string[]})

const companyName=(id:string)=>companies.value.find(x=>x.id===id)?.trade_name||companies.value.find(x=>x.id===id)?.legal_name||'Empresa'
const customerName=(id:string)=>customers.value.find(x=>x.id===id)?.name||'Cliente'
const money=(v:string)=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const providerLabel=(value:string)=>providers.value.find(item=>item.code===value)?.name||agreements.value.find(item=>item.provider===value)?.provider||value||'Integração bancária'
const environmentLabel=(value:string)=>({SANDBOX:'Testes',HOMOLOGATION:'Homologação',PRODUCTION:'Produção'}[value]||value)
const modeLabel=(value:string)=>({DIRECT_API:'API direta',CNAB:'CNAB',OPEN_FINANCE:'Open Finance',FILE_IMPORT:'Importação'}[value]||value)
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const cnabSettingLabel=(key:string)=>({registration_mode:'Forma de cadastramento',document_type:'Tipo de documento',boleto_emission:'Emissão do boleto',boleto_distribution:'Distribuição do boleto',species_code:'Espécie do título',acceptance:'Aceite',protest_code:'Código de protesto',protest_days:'Prazo de protesto (dias)',writeoff_code:'Código de baixa/devolução',writeoff_days:'Prazo de baixa/devolução (dias)'} as Record<string,string>)[key]||key.replaceAll('_',' ')
const lifecycleTitle=(lifecycle:Lifecycle)=>lifecycle.can_delete?'Cadastro nunca utilizado: pode ser excluído.':lifecycle.blockers.map(item=>item.message).join(' ')

const selectedProvider=computed(()=>providers.value.find(item=>item.code===agreementForm.provider)||null)
const cnabSettingFields=computed(()=>((selectedProvider.value?.metadata?.cnab_settings_schema||[]) as CNABSettingField[]).filter(field=>field.source!=='BankAgreement.wallet'&&field.key!=='wallet'))
const companyOptions=computed<SearchSelectOption[]>(()=>companies.value.map(item=>({value:item.id,label:item.trade_name||item.legal_name,description:item.tax_id,keywords:`${item.legal_name} ${item.trade_name||''} ${item.tax_id}`})))
const accountOptions=computed<SearchSelectOption[]>(()=>accounts.value.filter(item=>item.company_id===agreementForm.company_id&&item.is_active).map(item=>({value:item.id,label:`${item.bank_code} · ${item.bank_name}`,description:`Ag. ${item.branch} · Conta ${item.account}-${item.account_digit||''}`,keywords:`${item.bank_code} ${item.bank_name} ${item.branch} ${item.account}`})))
const agreementOptions=computed<SearchSelectOption[]>(()=>agreements.value.filter(item=>item.is_active).map(item=>({value:item.id,label:item.name,description:`${companyName(item.company_id)} · ${providerLabel(item.provider)} · CNAB ${item.cnab_layout}`,keywords:`${item.name} ${item.provider} ${companyName(item.company_id)} ${item.agreement_number||''} ${item.cnab_layout}`})))
const accountTypeOptions:SearchSelectOption[]=[{value:'CHECKING',label:'Conta corrente'},{value:'SAVINGS',label:'Conta poupança'},{value:'PAYMENT',label:'Conta de pagamento'}]
const pixKeyTypeOptions:SearchSelectOption[]=[{value:'',label:'Sem chave Pix'},{value:'CNPJ',label:'CNPJ'},{value:'CPF',label:'CPF'},{value:'EMAIL',label:'E-mail'},{value:'PHONE',label:'Telefone'},{value:'EVP',label:'Chave aleatória'}]
const providerOptions=computed<SearchSelectOption[]>(()=>{
  const options:SearchSelectOption[]=providers.value.filter(item=>item.implementation_available&&item.entitlement?.allowed!==false).map(item=>({value:item.code,label:item.name,description:`${(item.implemented_modes||item.integration_modes).map(modeLabel).join(' + ')} · ${item.status}`,keywords:`${item.code} ${item.name} ${(item.implemented_modes||[]).join(' ')}`}))
  const current=editingAgreement.value?.provider
  if(current&&!options.some(item=>item.value===current))options.push({value:current,label:`${providerLabel(current)} (bloqueado/legado)`,description:'Mantido apenas para visualizar o convênio existente.',keywords:current})
  return options
})
const environmentOptions=computed<SearchSelectOption[]>(()=>{const values=selectedProvider.value?.environments||['SANDBOX','HOMOLOGATION','PRODUCTION'];return values.map(value=>({value,label:environmentLabel(value)}))})
const cnabLayoutOptions=computed<SearchSelectOption[]>(()=>{const caps=selectedProvider.value?.capabilities||[];const options:SearchSelectOption[]=[];if(caps.includes('CNAB_240')||!selectedProvider.value)options.push({value:'240',label:'CNAB 240'});if(caps.includes('CNAB_400')||!selectedProvider.value)options.push({value:'400',label:'CNAB 400'});return options.length?options:[{value:agreementForm.cnab_layout||'240',label:`CNAB ${agreementForm.cnab_layout||'240'} (legado)`}]})
const selectedAgreement=computed(()=>agreements.value.find(item=>item.id===cnabForm.bank_agreement_id))
const eligibleTitles=computed(()=>receivables.value.filter(item=>['OPEN','REGISTERED'].includes(item.status)&&item.company_id===selectedAgreement.value?.company_id))
const visibleTitles=computed(()=>{const term=normalized(titleSearch.value.trim());if(!term)return eligibleTitles.value;return eligibleTitles.value.filter(item=>normalized(`${item.document_number} ${item.description} ${item.balance} ${customerName(item.customer_id)} ${customers.value.find(c=>c.id===item.customer_id)?.tax_id||''}`).includes(term))})

function normalizeSettings(value:Record<string,unknown>|undefined):Record<string,string>{return Object.fromEntries(Object.entries(value||{}).map(([key,item])=>[key,item==null?'':String(item)]))}
function cleanSettings():Record<string,unknown>{const allowed=new Set(cnabSettingFields.value.map(field=>field.key));return Object.fromEntries(Object.entries(agreementForm.settings).filter(([key,value])=>(allowed.has(key)||!selectedProvider.value?.metadata?.cnab_settings_schema)&&String(value).trim()!=='').map(([key,value])=>{const field=cnabSettingFields.value.find(item=>item.key===key);return[key,field?.type==='integer'?Number(value):value]}))}
function settingOptions(field:CNABSettingField):SearchSelectOption[]{return(field.allowed||[]).map(value=>({value,label:value}))}

async function load(){error.value='';try{const [a,b,p,c,d,e]=await Promise.all([api.get<ApiResponse<Account[]>>('/v1/banking/lifecycle/accounts'),api.get<ApiResponse<Agreement[]>>('/v1/banking/lifecycle/agreements'),api.get<ApiResponse<ProviderManifest[]>>('/v1/banking/providers'),api.get<ApiResponse<Company[]>>('/v1/companies'),fetchAllPages<Customer>('/v1/customers'),fetchAllPages<Receivable>('/v1/receivables')]);accounts.value=a.data.data;agreements.value=b.data.data;providers.value=p.data.data;companies.value=c.data.data;customers.value=d;receivables.value=e;if(!returnCompanyId.value&&companies.value[0])returnCompanyId.value=companies.value[0].id}catch(e){error.value=apiError(e)}}

function openAccount(item?:Account){editingAccount.value=item||null;Object.assign(accountForm,item?{company_id:item.company_id,bank_code:item.bank_code,bank_name:item.bank_name,branch:item.branch,branch_digit:item.branch_digit||'',account:item.account,account_digit:item.account_digit||'',account_type:item.account_type||'CHECKING',pix_key_type:item.pix_key_type||'',pix_key:item.pix_key||'',is_default:item.is_default,is_active:item.is_active}:{company_id:companies.value[0]?.id||'',bank_code:'001',bank_name:'Banco do Brasil',branch:'',branch_digit:'',account:'',account_digit:'',account_type:'CHECKING',pix_key_type:'',pix_key:'',is_default:true,is_active:true});accountModal.value=true}
async function saveAccount(){error.value='';try{if(editingAccount.value){await api.patch(`/v1/bank-accounts/${editingAccount.value.id}`,{bank_name:accountForm.bank_name,branch:accountForm.branch,branch_digit:accountForm.branch_digit||null,account:accountForm.account,account_digit:accountForm.account_digit||null,account_type:accountForm.account_type,pix_key_type:accountForm.pix_key_type||null,pix_key:accountForm.pix_key||null,is_default:accountForm.is_default,is_active:accountForm.is_active});success.value='Conta bancária atualizada.'}else{await api.post('/v1/bank-accounts',accountForm);success.value='Conta bancária cadastrada.'}accountModal.value=false;await load()}catch(e){error.value=apiError(e)}}
async function deleteAccount(item:Account){if(!item.lifecycle.can_delete){error.value=lifecycleTitle(item.lifecycle);return}if(!window.confirm(`Excluir definitivamente a conta ${item.bank_name} ${item.account}-${item.account_digit||''}? Esta ação só é permitida porque ela nunca foi utilizada.`))return;deleting.value=`account:${item.id}`;try{await api.delete(`/v1/banking/lifecycle/accounts/${item.id}`);success.value='Conta bancária excluída definitivamente.';await load()}catch(e){error.value=apiError(e)}finally{deleting.value=''}}

function applyProviderDefaults(resetSettings=true){const provider=selectedProvider.value;if(!provider)return;if(!provider.environments.includes(agreementForm.environment))agreementForm.environment=provider.environments.includes('HOMOLOGATION')?'HOMOLOGATION':provider.environments[0]||'PRODUCTION';if(provider.capabilities.includes('CNAB_240'))agreementForm.cnab_layout='240';else if(provider.capabilities.includes('CNAB_400'))agreementForm.cnab_layout='400';if(resetSettings)agreementForm.settings={}}
function openAgreement(item?:Agreement){editingAgreement.value=item||null;const defaultProvider=providers.value.find(value=>value.code==='SANDBOX')||providers.value[0];Object.assign(agreementForm,item?{company_id:item.company_id,bank_account_id:item.bank_account_id,name:item.name,provider:item.provider,environment:item.environment,agreement_number:item.agreement_number||'',wallet:item.wallet||'',beneficiary_code:item.beneficiary_code||'',cnab_layout:item.cnab_layout,settings:normalizeSettings(item.settings),is_active:item.is_active}:{company_id:companies.value[0]?.id||'',bank_account_id:'',name:'Convênio de cobrança',provider:defaultProvider?.code||'',environment:defaultProvider?.environments.includes('HOMOLOGATION')?'HOMOLOGATION':defaultProvider?.environments[0]||'SANDBOX',agreement_number:'',wallet:'',beneficiary_code:'',cnab_layout:defaultProvider?.capabilities.includes('CNAB_400')&&!defaultProvider?.capabilities.includes('CNAB_240')?'400':'240',settings:{},is_active:true});agreementModal.value=true}
function changeAgreementProvider(){applyProviderDefaults(true)}
async function saveAgreement(){error.value='';try{const settings=cleanSettings();if(editingAgreement.value){await api.patch(`/v1/bank-agreements/${editingAgreement.value.id}`,{name:agreementForm.name,provider:agreementForm.provider,environment:agreementForm.environment,agreement_number:agreementForm.agreement_number||null,wallet:agreementForm.wallet||null,beneficiary_code:agreementForm.beneficiary_code||null,cnab_layout:agreementForm.cnab_layout,settings,is_active:agreementForm.is_active});success.value='Convênio atualizado.'}else{await api.post('/v1/bank-agreements',{...agreementForm,settings,credentials:{}});success.value='Convênio cadastrado.'}agreementModal.value=false;await load()}catch(e){error.value=apiError(e)}}
async function deleteAgreement(item:Agreement){if(!item.lifecycle.can_delete){error.value=lifecycleTitle(item.lifecycle);return}if(!window.confirm(`Excluir definitivamente o convênio “${item.name}”? Esta ação só é permitida porque ele nunca foi utilizado.`))return;deleting.value=`agreement:${item.id}`;try{await api.delete(`/v1/banking/lifecycle/agreements/${item.id}`);success.value='Convênio bancário excluído definitivamente.';await load()}catch(e){error.value=apiError(e)}finally{deleting.value=''}}

function openCnab(){cnabForm.bank_agreement_id=agreements.value.find(item=>item.is_active)?.id||'';cnabForm.receivable_ids=[];titleSearch.value='';cnabModal.value=true}
async function downloadRemittance(){if(!lastRemittance.value)return;downloading.value=true;try{const item=lastRemittance.value;const response=await api.get(`/v1/cnab/remittances/${item.id}/download`,{responseType:'blob'});const href=URL.createObjectURL(response.data);const anchor=document.createElement('a');anchor.href=href;anchor.download=`REM-${String(item.sequence).padStart(6,'0')}-CNAB${item.layout}.REM`;document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(href)}catch(e){error.value=apiError(e)}finally{downloading.value=false}}
async function generateCnab(){error.value='';try{const r=await api.post<ApiResponse<ProviderRemittanceResult>>('/v1/cnab/provider-remittances',cnabForm);lastRemittance.value={id:r.data.data.id,sequence:r.data.data.sequence,layout:r.data.data.layout};success.value=`Remessa ${providerLabel(r.data.data.provider)} gerada pelo driver CNAB específico.`;cnabModal.value=false;await downloadRemittance()}catch(e){error.value=apiError(e)}}
async function importReturn(event:Event){const input=event.target as HTMLInputElement;if(!input.files?.[0])return;const data=new FormData();data.append('file',input.files[0]);error.value='';try{await api.post(`/v1/cnab/returns?company_id=${encodeURIComponent(returnCompanyId.value)}`,data,{headers:{'Content-Type':'multipart/form-data'}});success.value='Retorno bancário processado com sucesso.';await load()}catch(e){error.value=apiError(e)}finally{input.value=''}}
watch(()=>agreementForm.company_id,()=>{if(agreementForm.bank_account_id&&!accountOptions.value.some(option=>option.value===agreementForm.bank_account_id))agreementForm.bank_account_id=''})
onMounted(load)
</script>

<template>
  <PageHeader title="Bancos e CNAB" subtitle="Contas, convênios, remessas e retornos bancários. Cadastros nunca utilizados podem ser excluídos; cadastros com histórico devem apenas ser desativados.">
    <div class="w-64"><SearchSelect v-model="returnCompanyId" :options="companyOptions" placeholder="Empresa do retorno" search-placeholder="Pesquisar empresa ou CNPJ…"/></div>
    <label class="btn-secondary cursor-pointer" :class="!returnCompanyId&&'pointer-events-none opacity-50'"><FileUp :size="18"/> Importar retorno<input type="file" class="hidden" accept=".ret,.txt" :disabled="!returnCompanyId" @change="importReturn"/></label>
    <button class="btn-secondary" @click="openCnab"><FileDown :size="18"/> Gerar remessa</button>
    <button class="btn-secondary" @click="openAgreement()"><Plus :size="18"/> Convênio</button>
    <button class="btn-primary" @click="openAccount()"><Plus :size="18"/> Conta bancária</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/>
  <div v-if="success" class="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800"><span class="flex-1">{{success}}</span><button v-if="lastRemittance" class="btn-secondary" :disabled="downloading" @click="downloadRemittance"><Download :size="16"/>{{downloading?'Baixando…':'Baixar novamente'}}</button></div>

  <div class="grid gap-6 lg:grid-cols-2">
    <section><h2 class="mb-3 text-lg font-semibold">Contas bancárias</h2><div class="space-y-3"><article v-for="item in accounts" :key="item.id" class="card flex items-center gap-3" :class="!item.is_active&&'opacity-70'"><div class="rounded-xl bg-blue-50 p-3 text-blue-700"><Landmark :size="22"/></div><div class="min-w-0 flex-1"><p class="font-semibold">{{item.bank_code}} · {{item.bank_name}}</p><p class="text-sm text-slate-500">Ag. {{item.branch}} · Conta {{item.account}}-{{item.account_digit}}</p><p class="text-xs text-slate-400">{{companyName(item.company_id)}}</p><p v-if="!item.lifecycle.can_delete" class="mt-1 text-[11px] text-amber-700">Possui histórico/vínculo: desative em vez de excluir.</p></div><span v-if="item.is_default" class="badge bg-teal-100 text-teal-700">Padrão</span><span class="badge" :class="item.is_active?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-500'">{{item.is_active?'Ativa':'Inativa'}}</span><button class="btn-secondary px-3 py-2" title="Editar conta" @click="openAccount(item)"><Pencil :size="15"/></button><button class="btn-secondary px-3 py-2" :class="item.lifecycle.can_delete?'text-rose-600':'opacity-40'" :disabled="!item.lifecycle.can_delete||deleting===`account:${item.id}`" :title="lifecycleTitle(item.lifecycle)" @click="deleteAccount(item)"><Trash2 :size="15"/></button></article><p v-if="!accounts.length" class="card text-center text-slate-400">Nenhuma conta.</p></div></section>
    <section><h2 class="mb-3 text-lg font-semibold">Convênios</h2><div class="space-y-3"><article v-for="item in agreements" :key="item.id" class="card" :class="!item.is_active&&'opacity-70'"><div class="flex items-start gap-3"><div class="min-w-0 flex-1"><p class="font-semibold">{{item.name}}</p><p class="text-sm text-slate-500">{{providerLabel(item.provider)}} · {{environmentLabel(item.environment)}}</p><p class="mt-2 text-xs text-slate-400">Convênio {{item.agreement_number||'—'}} · Carteira {{item.wallet||'—'}} · CNAB {{item.cnab_layout}}</p><p v-if="!item.lifecycle.can_delete" class="mt-1 text-[11px] text-amber-700">Já utilizado: preserve o histórico e apenas desative.</p></div><span class="badge" :class="item.is_active?'bg-emerald-100 text-emerald-700':'bg-slate-100 text-slate-500'">{{item.is_active?'Ativo':'Inativo'}}</span><button class="btn-secondary px-3 py-2" title="Editar convênio" @click="openAgreement(item)"><Pencil :size="15"/></button><button class="btn-secondary px-3 py-2" :class="item.lifecycle.can_delete?'text-rose-600':'opacity-40'" :disabled="!item.lifecycle.can_delete||deleting===`agreement:${item.id}`" :title="lifecycleTitle(item.lifecycle)" @click="deleteAgreement(item)"><Trash2 :size="15"/></button></div></article><p v-if="!agreements.length" class="card text-center text-slate-400">Nenhum convênio.</p></div></section>
  </div>

  <ModalDialog :open="accountModal" :title="editingAccount?'Editar conta bancária':'Cadastrar conta bancária'" size="lg" @close="accountModal=false">
    <form class="grid gap-4 md:grid-cols-2" @submit.prevent="saveAccount">
      <div class="md:col-span-2"><label class="label">Empresa</label><SearchSelect v-model="accountForm.company_id" :options="companyOptions" :disabled="!!editingAccount" search-placeholder="Pesquisar empresa ou CNPJ…"/></div>
      <div><label class="label">Código banco</label><input v-model="accountForm.bank_code" maxlength="3" class="input" :disabled="!!editingAccount" required/></div><div><label class="label">Nome banco</label><input v-model="accountForm.bank_name" class="input" required/></div>
      <div><label class="label">Agência</label><input v-model="accountForm.branch" class="input" required/></div><div><label class="label">Dígito agência</label><input v-model="accountForm.branch_digit" class="input"/></div>
      <div><label class="label">Conta</label><input v-model="accountForm.account" class="input" required/></div><div><label class="label">Dígito conta</label><input v-model="accountForm.account_digit" class="input"/></div>
      <div><label class="label">Tipo de conta</label><SearchSelect v-model="accountForm.account_type" :options="accountTypeOptions"/></div><div><label class="label">Tipo chave Pix</label><SearchSelect v-model="accountForm.pix_key_type" :options="pixKeyTypeOptions"/></div>
      <div class="md:col-span-2"><label class="label">Chave Pix</label><input v-model="accountForm.pix_key" class="input"/></div>
      <label class="flex gap-2 text-sm"><input v-model="accountForm.is_default" type="checkbox"/> Conta padrão da empresa</label><label v-if="editingAccount" class="flex gap-2 text-sm"><input v-model="accountForm.is_active" type="checkbox"/> Conta ativa</label>
      <div v-if="editingAccount&&!editingAccount.lifecycle.can_delete" class="md:col-span-2 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">Esta conta possui histórico ou vínculos. Quando não for mais utilizada, desmarque <strong>Conta ativa</strong>; a exclusão definitiva permanece bloqueada para preservar auditoria.</div>
      <div class="md:col-span-2 flex justify-end gap-2"><button type="button" class="btn-secondary" @click="accountModal=false">Cancelar</button><button class="btn-primary">Salvar</button></div>
    </form>
  </ModalDialog>

  <ModalDialog :open="agreementModal" :title="editingAgreement?'Editar convênio bancário':'Cadastrar convênio bancário'" size="lg" @close="agreementModal=false">
    <form class="grid gap-4 md:grid-cols-2" @submit.prevent="saveAgreement">
      <div><label class="label">Empresa</label><SearchSelect v-model="agreementForm.company_id" :options="companyOptions" :disabled="!!editingAgreement" search-placeholder="Pesquisar empresa ou CNPJ…"/></div>
      <div><label class="label">Conta</label><SearchSelect v-model="agreementForm.bank_account_id" :options="accountOptions" :disabled="!!editingAgreement" placeholder="Pesquisar conta" search-placeholder="Banco, agência ou conta…"/></div>
      <div><label class="label">Nome</label><input v-model="agreementForm.name" class="input" required/></div><div><label class="label">Provider bancário</label><SearchSelect v-model="agreementForm.provider" :options="providerOptions" search-placeholder="Provider liberado pelo Control Plane…" @update:model-value="changeAgreementProvider"/></div>
      <div><label class="label">Ambiente</label><SearchSelect v-model="agreementForm.environment" :options="environmentOptions"/></div><div><label class="label">Layout</label><SearchSelect v-model="agreementForm.cnab_layout" :options="cnabLayoutOptions"/></div>
      <div><label class="label">Número convênio</label><input v-model="agreementForm.agreement_number" class="input"/></div><div><label class="label">Carteira</label><input v-model="agreementForm.wallet" class="input"/></div>
      <div><label class="label">Código beneficiário</label><input v-model="agreementForm.beneficiary_code" class="input"/></div><label v-if="editingAgreement" class="flex items-center gap-2 pt-8 text-sm"><input v-model="agreementForm.is_active" type="checkbox"/> Convênio ativo</label>
      <template v-if="cnabSettingFields.length"><div class="md:col-span-2 rounded-xl border border-sky-100 bg-sky-50 p-3 text-xs text-sky-800"><strong>{{selectedProvider?.name}}</strong> possui parâmetros CNAB específicos. Eles são gravados no convênio e validados pelo driver antes de gerar qualquer arquivo.</div><div v-for="field in cnabSettingFields" :key="field.key"><label class="label">{{field.label||cnabSettingLabel(field.key)}}</label><SearchSelect v-if="field.allowed?.length" v-model="agreementForm.settings[field.key]" :options="settingOptions(field)"/><input v-else v-model="agreementForm.settings[field.key]" class="input" :type="field.type==='integer'?'number':'text'"/><p v-if="field.description" class="mt-1 text-xs text-slate-400">{{field.description}}</p></div></template>
      <div v-if="editingAgreement&&!editingAgreement.lifecycle.can_delete" class="md:col-span-2 rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">Este convênio já foi utilizado. Para encerrar seu uso, desmarque <strong>Convênio ativo</strong>; cobranças, remessas e numeração bancária permanecem preservadas.</div>
      <div class="md:col-span-2 rounded-xl bg-sky-50 p-3 text-xs text-sky-800">A lista de providers vem do framework e dos entitlements do Control Plane. Providers bloqueados pelo plano/tenant não ficam disponíveis para novo convênio. Credenciais de API continuam protegidas no servidor.</div>
      <div class="md:col-span-2 flex justify-end gap-2"><button type="button" class="btn-secondary" @click="agreementModal=false">Cancelar</button><button class="btn-primary" :disabled="!agreementForm.provider||!agreementForm.bank_account_id">Salvar</button></div>
    </form>
  </ModalDialog>

  <ModalDialog :open="cnabModal" title="Gerar remessa CNAB" size="lg" @close="cnabModal=false">
    <form class="space-y-4" @submit.prevent="generateCnab">
      <div><label class="label">Convênio</label><SearchSelect v-model="cnabForm.bank_agreement_id" :options="agreementOptions" placeholder="Pesquisar convênio" search-placeholder="Convênio, provider, empresa ou layout…"/></div>
      <div v-if="selectedAgreement" class="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{{providerLabel(selectedAgreement.provider)}} · CNAB {{selectedAgreement.cnab_layout}}. O sistema usa o driver CNAB específico do provider.</div>
      <div><div class="mb-2 flex flex-wrap items-end justify-between gap-2"><label class="label !mb-0">Títulos</label><div class="relative w-full sm:w-72"><Search :size="15" class="absolute left-3 top-2.5 text-slate-400"/><input v-model="titleSearch" class="input !py-2 pl-9" placeholder="Cliente, CNPJ, título ou valor…"/></div></div><div class="scroll-clean max-h-72 space-y-1 overflow-auto rounded-xl border border-slate-200 p-2"><label v-for="r in visibleTitles" :key="r.id" class="flex items-center gap-3 rounded-lg p-2 hover:bg-slate-50"><input v-model="cnabForm.receivable_ids" type="checkbox" :value="r.id"/><span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">{{customerName(r.customer_id)}} · {{r.document_number}}</span><span class="text-xs text-slate-400">{{r.description}} · vence {{new Date(r.due_date+'T00:00:00').toLocaleDateString('pt-BR')}}</span></span><strong>{{money(r.balance)}}</strong></label><p v-if="!visibleTitles.length" class="p-5 text-center text-sm text-slate-400">Nenhum título elegível.</p></div></div>
      <div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="cnabModal=false">Cancelar</button><button class="btn-primary" :disabled="!cnabForm.bank_agreement_id||!cnabForm.receivable_ids.length"><FileDown :size="16"/>Gerar e baixar</button></div>
    </form>
  </ModalDialog>
</template>
