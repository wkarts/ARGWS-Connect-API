<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Building2, MessageCircle, Pencil, Plus, Search, ShieldCheck } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse, Company } from '../types'
import PageHeader from '../components/PageHeader.vue'
import ModalDialog from '../components/ModalDialog.vue'
import InlineAlert from '../components/InlineAlert.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'

interface RegistryData {
  tax_id:string;legal_name:string;trade_name?:string|null;state_registration?:string|null;email?:string|null;phone?:string|null
  address:{street?:string;number?:string;complement?:string;district?:string;city?:string;state?:string;zip_code?:string}
}
interface CompanyProfile { company_id:string;state_registration?:string|null;municipal_registration?:string|null;tax_regime?:string|null;settings:Record<string,unknown>;require_2fa:boolean }

const items=ref<Company[]>([])
const profiles=ref<Record<string,CompanyProfile>>({})
const modal=ref(false)
const editing=ref<Company|null>(null)
const error=ref('')
const success=ref('')
const consulting=ref(false)
const form=reactive({
  legal_name:'',trade_name:'',tax_id:'',state_registration:'',municipal_registration:'',tax_regime:'',email:'',phone:'',
  address:{street:'',number:'',complement:'',district:'',city:'',state:'BA',zip_code:''},
  branding:{name:'',primary_color:'#0f766e',secondary_color:'#0f172a'},
  communication:{default_ddd:''},is_active:true,require_2fa:true
})
const taxRegimeOptions:SearchSelectOption[]=[
  {value:'',label:'Não informado'},
  {value:'SIMPLES_NACIONAL',label:'Simples Nacional'},
  {value:'LUCRO_PRESUMIDO',label:'Lucro Presumido'},
  {value:'LUCRO_REAL',label:'Lucro Real'},
]
const text=(value:unknown)=>typeof value==='string'?value:''
const normalizedTaxId=computed(()=>form.tax_id.replace(/\D/g,''))
const policy=(id:string)=>profiles.value[id]?.require_2fa!==false
const companyDDD=(item:Company)=>{
  const settings=item.settings||{}
  const communication=settings.communication&&typeof settings.communication==='object'?settings.communication as Record<string,unknown>:{}
  const value=String(communication.default_ddd||settings.default_ddd||'').replace(/\D/g,'')
  if(value.length===2)return value
  const phone=String(item.phone||'').replace(/\D/g,'')
  if(phone.startsWith('55')&&[12,13].includes(phone.length))return phone.slice(2,4)
  if([10,11].includes(phone.length))return phone.slice(0,2)
  return''
}

async function load(){
  error.value=''
  try{
    const [companies,profileResponse]=await Promise.all([
      api.get<ApiResponse<Company[]>>('/v1/companies'),
      api.get<ApiResponse<CompanyProfile[]>>('/v1/security/company-profiles')
    ])
    items.value=companies.data.data
    profiles.value=Object.fromEntries(profileResponse.data.data.map(item=>[item.company_id,item]))
  }catch(e){error.value=apiError(e)}
}
function open(item?:Company){
  editing.value=item||null
  const address=item?.address||{}
  const branding=item?.branding||{}
  const profile=item?profiles.value[item.id]:undefined
  Object.assign(form,{
    legal_name:item?.legal_name||'',trade_name:item?.trade_name||'',tax_id:item?.tax_id||'',
    state_registration:profile?.state_registration||'',municipal_registration:profile?.municipal_registration||'',tax_regime:profile?.tax_regime||'',
    email:item?.email||'',phone:item?.phone||'',
    address:{street:text(address.street),number:text(address.number),complement:text(address.complement),district:text(address.district),city:text(address.city),state:text(address.state)||'BA',zip_code:text(address.zip_code)},
    branding:{name:text(branding.name)||item?.trade_name||item?.legal_name||'',primary_color:text(branding.primary_color)||'#0f766e',secondary_color:text(branding.secondary_color)||'#0f172a'},
    communication:{default_ddd:item?companyDDD(item):''},
    is_active:item?.is_active??true,require_2fa:item?policy(item.id):true
  })
  modal.value=true
}
async function consultCnpj(){
  if(normalizedTaxId.value.length!==14){error.value='Informe um CNPJ com 14 dígitos para consultar.';return}
  consulting.value=true;error.value='';success.value=''
  try{
    const data=(await api.get<ApiResponse<RegistryData>>(`/v1/registry/cnpj/${normalizedTaxId.value}`)).data.data
    form.legal_name=data.legal_name||form.legal_name
    form.trade_name=data.trade_name||form.trade_name
    form.state_registration=data.state_registration||form.state_registration
    form.email=data.email||form.email
    form.phone=data.phone||form.phone
    Object.assign(form.address,{...form.address,...data.address,state:data.address.state||form.address.state})
    if(!form.branding.name)form.branding.name=data.trade_name||data.legal_name
    const phone=String(data.phone||'').replace(/\D/g,'')
    if(!form.communication.default_ddd){
      if(phone.startsWith('55')&&[12,13].includes(phone.length))form.communication.default_ddd=phone.slice(2,4)
      else if([10,11].includes(phone.length))form.communication.default_ddd=phone.slice(0,2)
    }
    success.value='Dados cadastrais localizados e preenchidos. Confira antes de salvar.'
  }catch(e){error.value=apiError(e)}finally{consulting.value=false}
}
async function save(){
  error.value=''
  const ddd=form.communication.default_ddd.replace(/\D/g,'')
  if(ddd&&ddd.length!==2){error.value='O DDD padrão deve possuir exatamente 2 dígitos.';return}
  try{
    const currentSettings=editing.value?.settings||{}
    const editable={
      legal_name:form.legal_name,trade_name:form.trade_name||null,state_registration:form.state_registration||null,
      municipal_registration:form.municipal_registration||null,tax_regime:form.tax_regime||null,email:form.email||null,phone:form.phone||null,
      address:{...form.address},branding:{...form.branding},
      settings:{...currentSettings,communication:{...(typeof currentSettings.communication==='object'&&currentSettings.communication?currentSettings.communication as Record<string,unknown>:{}),country_code:'55',default_ddd:ddd||null}},
      is_active:form.is_active
    }
    let companyId=''
    if(editing.value){
      await api.patch(`/v1/companies/${editing.value.id}`,editable)
      companyId=editing.value.id
    }else{
      const response=await api.post<ApiResponse<Company>>('/v1/companies',{...editable,tax_id:form.tax_id})
      companyId=response.data.data.id
    }
    await api.put(`/v1/security/company-policies/${companyId}`,{require_2fa:form.require_2fa})
    modal.value=false
    success.value=editing.value?'Empresa atualizada.':'Empresa cadastrada.'
    await load()
  }catch(e){error.value=apiError(e)}
}
onMounted(load)
</script>

<template>
  <PageHeader title="Empresas" subtitle="Emitentes de cobranças e documentos financeiros."><button class="btn-primary" @click="open()"><Plus :size="18"/> Nova empresa</button></PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>
  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <article v-for="item in items" :key="item.id" class="card"><div class="flex items-start gap-3"><div class="rounded-xl bg-teal-50 p-3 text-teal-700"><Building2 :size="22"/></div><div class="min-w-0 flex-1"><h2 class="truncate font-semibold">{{item.trade_name||item.legal_name}}</h2><p class="mt-1 truncate text-sm text-slate-500">{{item.legal_name}}</p><p class="mt-3 text-xs text-slate-400">{{item.tax_id}}</p><p class="mt-1 text-xs text-slate-400">{{item.email||'Sem e-mail'}}</p><p class="mt-3 inline-flex items-center gap-1 text-xs font-semibold" :class="policy(item.id)?'text-emerald-700':'text-amber-700'"><ShieldCheck :size="14"/>2FA {{policy(item.id)?'obrigatório':'opcional'}}</p><p class="mt-1 inline-flex items-center gap-1 text-xs text-slate-500"><MessageCircle :size="14"/>WhatsApp: país 55 · DDD {{companyDDD(item)||'não parametrizado'}}</p></div><button class="btn-secondary px-3 py-2" title="Editar empresa" @click="open(item)"><Pencil :size="16"/></button></div></article>
    <div v-if="!items.length" class="card md:col-span-2 xl:col-span-3 text-center text-slate-400">Nenhuma empresa cadastrada.</div>
  </div>

  <ModalDialog :open="modal" :title="editing?'Editar empresa emissora':'Cadastrar empresa emissora'" size="xl" @close="modal=false">
    <form class="grid gap-4 md:grid-cols-2" @submit.prevent="save">
      <div class="md:col-span-2"><label class="label">CNPJ/CPF</label><div class="flex gap-2"><input v-model="form.tax_id" class="input" :disabled="!!editing" required/><button type="button" class="btn-secondary shrink-0" :disabled="consulting||normalizedTaxId.length!==14" @click="consultCnpj"><Search :size="17"/>{{consulting?'Consultando…':'Consultar CNPJ'}}</button></div><p v-if="editing" class="mt-1 text-xs text-slate-400">O documento identifica a empresa e não é alterado nesta tela.</p></div>
      <div><label class="label">Razão social / nome</label><input v-model="form.legal_name" class="input" required/></div>
      <div><label class="label">Nome fantasia</label><input v-model="form.trade_name" class="input"/></div>
      <div><label class="label">Inscrição estadual</label><input v-model="form.state_registration" class="input"/></div>
      <div><label class="label">Inscrição municipal</label><input v-model="form.municipal_registration" class="input"/></div>
      <div><label class="label">Regime tributário</label><SearchSelect v-model="form.tax_regime" :options="taxRegimeOptions"/></div>
      <div><label class="label">E-mail</label><input v-model="form.email" type="email" class="input"/></div>
      <div><label class="label">Telefone</label><input v-model="form.phone" class="input"/></div>
      <div><label class="label">DDD padrão de comunicação</label><div class="flex"><span class="grid w-14 place-items-center rounded-l-xl border border-r-0 border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">+55</span><input v-model="form.communication.default_ddd" inputmode="numeric" maxlength="2" class="input rounded-l-none" placeholder="75"/></div><p class="mt-1 text-xs text-slate-500">Usado quando um WhatsApp for informado sem DDD. Se o número já vier com DDD, ele é preservado.</p></div>
      <div class="md:col-span-2 border-t pt-4 font-semibold">Endereço</div>
      <div><label class="label">Logradouro</label><input v-model="form.address.street" class="input"/></div><div><label class="label">Número</label><input v-model="form.address.number" class="input"/></div>
      <div><label class="label">Complemento</label><input v-model="form.address.complement" class="input"/></div><div><label class="label">Bairro</label><input v-model="form.address.district" class="input"/></div>
      <div><label class="label">Cidade</label><input v-model="form.address.city" class="input"/></div><div class="grid grid-cols-[1fr_2fr] gap-2"><div><label class="label">UF</label><input v-model="form.address.state" maxlength="2" class="input uppercase"/></div><div><label class="label">CEP</label><input v-model="form.address.zip_code" class="input"/></div></div>
      <div class="md:col-span-2 border-t pt-4 font-semibold">Segurança</div>
      <label class="md:col-span-2 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><input v-model="form.require_2fa" type="checkbox" class="mt-1"/><span><span class="block font-semibold text-slate-800">Exigir autenticação em duas etapas (2FA)</span><span class="mt-1 block text-sm leading-6 text-slate-500">Quando habilitado, cada usuário precisa configurar um aplicativo autenticador após o primeiro login.</span></span></label>
      <div class="md:col-span-2 border-t pt-4 font-semibold">Identidade visual</div>
      <div><label class="label">Nome exibido</label><input v-model="form.branding.name" class="input"/></div><div class="grid grid-cols-2 gap-2"><div><label class="label">Cor principal</label><input v-model="form.branding.primary_color" type="color" class="input h-11 p-1"/></div><div><label class="label">Cor secundária</label><input v-model="form.branding.secondary_color" type="color" class="input h-11 p-1"/></div></div>
      <label v-if="editing" class="md:col-span-2 flex items-center gap-2 text-sm"><input v-model="form.is_active" type="checkbox"/> Empresa ativa</label>
      <div class="md:col-span-2 flex justify-end gap-2"><button type="button" class="btn-secondary" @click="modal=false">Cancelar</button><button class="btn-primary">{{editing?'Salvar alterações':'Salvar empresa'}}</button></div>
    </form>
  </ModalDialog>
</template>
