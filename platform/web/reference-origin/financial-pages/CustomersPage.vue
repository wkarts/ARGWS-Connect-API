<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Pencil, Plus, Search, UserRound } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse, Customer, Paginated } from '../types'
import PageHeader from '../components/PageHeader.vue'
import ModalDialog from '../components/ModalDialog.vue'
import InlineAlert from '../components/InlineAlert.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'

interface RegistryData {
  tax_id:string;legal_name:string;trade_name?:string|null;state_registration?:string|null;email?:string|null;phone?:string|null
  address:{street?:string;number?:string;complement?:string;district?:string;city?:string;state?:string;zip_code?:string}
}

const items=ref<Customer[]>([])
const modal=ref(false)
const editing=ref<Customer|null>(null)
const error=ref('')
const success=ref('')
const q=ref('')
const loading=ref(false)
const consulting=ref(false)
const tagsText=ref('')
const form=reactive({person_type:'PJ',name:'',trade_name:'',tax_id:'',state_registration:'',municipal_registration:'',email:'',phone:'',whatsapp:'',address:{street:'',number:'',complement:'',district:'',city:'',state:'BA',zip_code:''},tags:[] as string[],notes:'',contacts:[] as unknown[],is_active:true})
const personTypeOptions:SearchSelectOption[]=[{value:'PJ',label:'Pessoa jurídica',description:'Empresa com CNPJ'},{value:'PF',label:'Pessoa física',description:'Pessoa com CPF'}]
const text=(value:unknown)=>typeof value==='string'?value:''
const normalizedTaxId=computed(()=>form.tax_id.replace(/\D/g,''))
const canConsult=computed(()=>form.person_type==='PJ'&&normalizedTaxId.value.length===14)

async function load(){loading.value=true;error.value='';try{items.value=(await api.get<Paginated<Customer>>('/v1/customers',{params:{q:q.value||undefined,per_page:100}})).data.data}catch(e){error.value=apiError(e)}finally{loading.value=false}}
function open(item?:Customer){editing.value=item||null;const address=item?.address||{};Object.assign(form,{person_type:item?.person_type||'PJ',name:item?.name||'',trade_name:item?.trade_name||'',tax_id:item?.tax_id||'',state_registration:'',municipal_registration:'',email:item?.email||'',phone:item?.phone||'',whatsapp:item?.whatsapp||'',address:{street:text(address.street),number:text(address.number),complement:text(address.complement),district:text(address.district),city:text(address.city),state:text(address.state)||'BA',zip_code:text(address.zip_code)},tags:[...(item?.tags||[])],notes:'',contacts:[],is_active:item?.is_active??true});tagsText.value=(item?.tags||[]).join(', ');modal.value=true}
async function consultCnpj(){
  if(!canConsult.value){error.value='Selecione Pessoa jurídica e informe um CNPJ com 14 dígitos.';return}
  consulting.value=true;error.value='';success.value=''
  try{
    const data=(await api.get<ApiResponse<RegistryData>>(`/v1/registry/cnpj/${normalizedTaxId.value}`)).data.data
    form.name=data.legal_name||form.name
    form.trade_name=data.trade_name||form.trade_name
    form.state_registration=data.state_registration||form.state_registration
    form.email=data.email||form.email
    form.phone=data.phone||form.phone
    form.whatsapp=data.phone||form.whatsapp
    Object.assign(form.address,{...form.address,...data.address,state:data.address.state||form.address.state})
    success.value='Dados do CNPJ preenchidos. Confira as informações antes de salvar.'
  }catch(e){error.value=apiError(e)}finally{consulting.value=false}
}
async function save(){error.value='';form.tags=tagsText.value.split(',').map(x=>x.trim()).filter(Boolean);try{if(editing.value){const payload:Record<string,unknown>={name:form.name,trade_name:form.trade_name||null,tax_id:form.tax_id||null,email:form.email||null,phone:form.phone||null,whatsapp:form.whatsapp||null,address:{...form.address},tags:[...form.tags],is_active:form.is_active};if(form.notes.trim())payload.notes=form.notes.trim();await api.patch(`/v1/customers/${editing.value.id}`,payload)}else await api.post('/v1/customers',{...form,state_registration:form.state_registration||null,municipal_registration:form.municipal_registration||null});modal.value=false;success.value=editing.value?'Cliente atualizado.':'Cliente cadastrado.';await load()}catch(e){error.value=apiError(e)}}
onMounted(load)
</script>

<template>
  <PageHeader title="Clientes" subtitle="Pessoas físicas, pessoas jurídicas, responsáveis financeiros e contatos de cobrança."><button class="btn-primary" @click="open()"><Plus :size="18"/> Novo cliente</button></PageHeader>
  <div class="mb-5 max-w-md"><div class="relative"><Search class="absolute left-3.5 top-3 text-slate-400" :size="18"/><input v-model="q" class="input pl-10" placeholder="Nome, fantasia, CPF ou CNPJ" @keyup.enter="load"/></div></div>
  <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>
  <div class="table-wrap"><table class="table"><thead><tr><th>Cliente</th><th>Tipo / Documento</th><th>Contato</th><th>Tags</th><th>Status</th><th>Ações</th></tr></thead><tbody><tr v-for="item in items" :key="item.id"><td><div class="flex items-center gap-3"><div class="rounded-xl bg-slate-100 p-2 text-slate-500"><UserRound :size="18"/></div><div><p class="font-semibold">{{item.name}}</p><p class="text-xs text-slate-400">{{item.trade_name}}</p></div></div></td><td><p class="text-xs font-semibold text-slate-500">{{item.person_type==='PJ'?'Pessoa jurídica':'Pessoa física'}}</p><p>{{item.tax_id||'—'}}</p></td><td><p>{{item.email||'—'}}</p><p class="text-xs text-slate-400">{{item.whatsapp||item.phone||'—'}}</p></td><td><span v-for="tag in item.tags" :key="tag" class="badge mr-1 bg-slate-100 text-slate-600">{{tag}}</span><span v-if="!item.tags.length">—</span></td><td><span class="badge" :class="item.is_active?'bg-emerald-100 text-emerald-700':'bg-slate-200 text-slate-600'">{{item.is_active?'Ativo':'Inativo'}}</span></td><td><button class="btn-secondary px-3 py-2" @click="open(item)"><Pencil :size="15"/>Editar</button></td></tr><tr v-if="!items.length"><td colspan="6" class="py-12 text-center text-slate-400">Nenhum cliente encontrado.</td></tr></tbody></table></div>

  <ModalDialog :open="modal" :title="editing?'Editar cliente':'Cadastrar cliente'" size="xl" @close="modal=false">
    <form class="grid gap-4 md:grid-cols-2" @submit.prevent="save">
      <div><label class="label">Tipo de pessoa</label><SearchSelect v-model="form.person_type" :options="personTypeOptions" :disabled="!!editing" search-placeholder="Pesquisar tipo…"/></div>
      <div><label class="label">{{form.person_type==='PJ'?'CNPJ':'CPF'}}</label><div class="flex gap-2"><input v-model="form.tax_id" class="input"/><button v-if="form.person_type==='PJ'" type="button" class="btn-secondary shrink-0" :disabled="consulting||!canConsult" @click="consultCnpj"><Search :size="16"/>{{consulting?'Consultando…':'Consultar CNPJ'}}</button></div></div>
      <div><label class="label">{{form.person_type==='PJ'?'Razão social':'Nome completo'}}</label><input v-model="form.name" class="input" required/></div>
      <div v-if="form.person_type==='PJ'"><label class="label">Nome fantasia</label><input v-model="form.trade_name" class="input"/></div>
      <div v-if="form.person_type==='PJ'"><label class="label">Inscrição estadual</label><input v-model="form.state_registration" class="input"/></div>
      <div v-if="form.person_type==='PJ'"><label class="label">Inscrição municipal</label><input v-model="form.municipal_registration" class="input"/></div>
      <div><label class="label">E-mail financeiro</label><input v-model="form.email" type="email" class="input"/></div><div><label class="label">WhatsApp</label><input v-model="form.whatsapp" class="input" placeholder="5575999999999"/></div>
      <div><label class="label">Telefone</label><input v-model="form.phone" class="input"/></div><div><label class="label">Tags</label><input v-model="tagsText" class="input" placeholder="vip, mensalista, cobrança"/></div>
      <div class="md:col-span-2 border-t pt-4 font-semibold">Endereço</div><div><label class="label">Logradouro</label><input v-model="form.address.street" class="input"/></div><div><label class="label">Número</label><input v-model="form.address.number" class="input"/></div><div><label class="label">Complemento</label><input v-model="form.address.complement" class="input"/></div><div><label class="label">Bairro</label><input v-model="form.address.district" class="input"/></div><div><label class="label">Cidade</label><input v-model="form.address.city" class="input"/></div><div class="grid grid-cols-[1fr_2fr] gap-2"><div><label class="label">UF</label><input v-model="form.address.state" maxlength="2" class="input uppercase"/></div><div><label class="label">CEP</label><input v-model="form.address.zip_code" class="input"/></div></div>
      <div class="md:col-span-2"><label class="label">Observações</label><textarea v-model="form.notes" class="input min-h-24" :placeholder="editing?'Preencha somente para atualizar as observações.':''"></textarea></div><label v-if="editing" class="md:col-span-2 flex items-center gap-2 text-sm"><input v-model="form.is_active" type="checkbox"/> Cliente ativo</label>
      <div class="md:col-span-2 flex justify-end gap-2"><button type="button" class="btn-secondary" @click="modal=false">Cancelar</button><button class="btn-primary">{{editing?'Salvar alterações':'Salvar cliente'}}</button></div>
    </form>
  </ModalDialog>
</template>
