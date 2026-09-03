<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Banknote, Plus, RefreshCw, Repeat2, Search } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { fetchAllPages } from '../api/pagination'
import type { ApiResponse, Company, Customer, Receivable } from '../types'
import PageHeader from '../components/PageHeader.vue'
import ModalDialog from '../components/ModalDialog.vue'
import StatusBadge from '../components/StatusBadge.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'
import InlineAlert from '../components/InlineAlert.vue'

const items=ref<Receivable[]>([])
const companies=ref<Company[]>([])
const customers=ref<Customer[]>([])
const modal=ref(false)
const error=ref('')
const success=ref('')
const status=ref('')
const search=ref('')
const filterCompany=ref('')
const filterCustomer=ref('')
const today=new Date().toISOString().slice(0,10)
const competence=today.slice(0,7)
const form=reactive({company_id:'',customer_id:'',contract_id:null as string|null,competence,description:'Cobrança avulsa',issue_date:today,due_date:today,original_amount:'0.00',discount_amount:'0.00'})
const companyName=(id:string)=>companies.value.find(x=>x.id===id)?.trade_name||companies.value.find(x=>x.id===id)?.legal_name||id
const customerName=(id:string)=>customers.value.find(x=>x.id===id)?.name||id
const money=(v:string)=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const companyOptions=computed<SearchSelectOption[]>(()=>companies.value.map(item=>({value:item.id,label:item.trade_name||item.legal_name,description:item.tax_id,keywords:`${item.legal_name} ${item.trade_name||''} ${item.tax_id}`})))
const companyFilterOptions=computed<SearchSelectOption[]>(()=>[{value:'',label:'Todas as empresas'},...companyOptions.value])
const customerOptions=computed<SearchSelectOption[]>(()=>customers.value.map(item=>({value:item.id,label:item.name,description:item.tax_id||item.trade_name||'',keywords:`${item.name} ${item.trade_name||''} ${item.tax_id||''} ${item.email||''} ${item.whatsapp||''}`})))
const customerFilterOptions=computed<SearchSelectOption[]>(()=>[{value:'',label:'Todos os clientes'},...customerOptions.value])
const statusOptions:SearchSelectOption[]=[{value:'',label:'Todas as situações'},{value:'OPEN',label:'Em aberto'},{value:'REGISTERED',label:'Registrado'},{value:'PARTIALLY_PAID',label:'Pago parcialmente'},{value:'PAID',label:'Pago'},{value:'OVERDUE',label:'Vencido'},{value:'NEGOTIATED',label:'Negociado'},{value:'CANCELLED',label:'Cancelado'}]
const visibleItems=computed(()=>{
  const term=search.value.trim().toLowerCase()
  return items.value.filter(item=>{
    if(status.value&&item.status!==status.value)return false
    if(filterCompany.value&&item.company_id!==filterCompany.value)return false
    if(filterCustomer.value&&item.customer_id!==filterCustomer.value)return false
    if(!term)return true
    return [item.document_number,item.description,item.competence,companyName(item.company_id),customerName(item.customer_id)]
      .some(value=>String(value||'').toLowerCase().includes(term))
  })
})
async function load(){
  error.value=''
  try{
    const [a,b,c]=await Promise.all([
      fetchAllPages<Receivable>('/v1/receivables',{}, {perPage:100,maxPages:500}),
      api.get<ApiResponse<Company[]>>('/v1/companies'),
      fetchAllPages<Customer>('/v1/customers'),
    ])
    items.value=a;companies.value=b.data.data;customers.value=c
    if(!form.company_id&&companies.value[0])form.company_id=companies.value[0].id
  }catch(e){error.value=apiError(e)}
}
function open(){form.company_id=companies.value[0]?.id||'';form.customer_id='';form.competence=competence;form.description='Cobrança avulsa';form.issue_date=today;form.due_date=today;form.original_amount='0.00';form.discount_amount='0.00';modal.value=true}
async function create(){try{await api.post('/v1/receivables',form);modal.value=false;success.value='Conta a receber criada.';await load()}catch(e){error.value=apiError(e)}}
async function generate(){try{await api.post('/v1/recurrences/generate');success.value='Recorrências processadas.';await load()}catch(e){error.value=apiError(e)}}
async function charge(item:Receivable){try{await api.post('/v1/charges',{receivable_id:item.id,charge_type:'BOLETO_PIX',provider:'SANDBOX'});success.value='Cobrança gerada.';await load()}catch(e){error.value=apiError(e)}}
onMounted(load)
</script>
<template>
<PageHeader title="Contas a receber" subtitle="Títulos manuais e gerados por recorrência."><button class="btn-secondary" @click="generate"><Repeat2 :size="18"/>Gerar recorrências</button><button class="btn-primary" @click="open"><Plus :size="18"/>Nova conta a receber</button></PageHeader>
<InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>
<section class="mb-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-soft xl:grid-cols-[minmax(0,1.5fr)_1fr_1fr_1fr_auto]">
  <div class="relative"><Search :size="18" class="absolute left-3.5 top-3 text-slate-400"/><input v-model="search" class="input pl-10" placeholder="Título, descrição, competência, empresa ou cliente..."/></div>
  <SearchSelect v-model="filterCompany" :options="companyFilterOptions" search-placeholder="Pesquisar empresa…"/>
  <SearchSelect v-model="filterCustomer" :options="customerFilterOptions" search-placeholder="Pesquisar cliente…"/>
  <SearchSelect v-model="status" :options="statusOptions"/>
  <button class="btn-secondary" @click="load"><RefreshCw :size="18"/></button>
</section>
<div class="table-wrap"><table class="table"><thead><tr><th>Título</th><th>Empresa / Cliente</th><th>Vencimento</th><th>Valor</th><th>Saldo</th><th>Situação</th><th></th></tr></thead><tbody><tr v-for="item in visibleItems" :key="item.id"><td><p class="font-semibold">{{item.document_number}}</p><p class="text-xs text-slate-400">{{item.description}} · {{item.competence}}</p></td><td><p>{{companyName(item.company_id)}}</p><p class="text-xs text-slate-400">{{customerName(item.customer_id)}}</p></td><td>{{new Date(item.due_date+'T12:00:00').toLocaleDateString('pt-BR')}}</td><td>{{money(item.original_amount)}}</td><td class="font-semibold">{{money(item.balance)}}</td><td><StatusBadge :status="item.status"/></td><td><button v-if="['OPEN','OVERDUE','PARTIALLY_PAID'].includes(item.status)" class="btn-secondary py-1.5" @click="charge(item)"><Banknote :size="15"/>Cobrar</button></td></tr><tr v-if="!visibleItems.length"><td colspan="7" class="py-12 text-center text-slate-400">Nenhuma conta a receber encontrada com os filtros informados.</td></tr></tbody></table></div>
<ModalDialog :open="modal" title="Criar conta a receber" size="lg" @close="modal=false"><form class="grid gap-4 md:grid-cols-2" @submit.prevent="create"><div><label class="label">Empresa emissora</label><SearchSelect v-model="form.company_id" :options="companyOptions" search-placeholder="Pesquisar empresa ou CNPJ…"/></div><div><label class="label">Cliente</label><SearchSelect v-model="form.customer_id" :options="customerOptions" placeholder="Pesquisar cliente" search-placeholder="Nome, CNPJ/CPF, e-mail ou WhatsApp…"/></div><div><label class="label">Competência</label><input v-model="form.competence" type="month" class="input" required/></div><div><label class="label">Descrição</label><input v-model="form.description" class="input" required/></div><div><label class="label">Emissão</label><input v-model="form.issue_date" type="date" class="input" required/></div><div><label class="label">Vencimento</label><input v-model="form.due_date" type="date" class="input" required/></div><div><label class="label">Valor original</label><input v-model="form.original_amount" type="number" min="0.01" step="0.01" class="input" required/></div><div><label class="label">Desconto</label><input v-model="form.discount_amount" type="number" min="0" step="0.01" class="input"/></div><div class="md:col-span-2 flex justify-end gap-2"><button type="button" class="btn-secondary" @click="modal=false">Cancelar</button><button class="btn-primary" :disabled="!form.company_id||!form.customer_id">Criar conta a receber</button></div></form></ModalDialog>
</template>
