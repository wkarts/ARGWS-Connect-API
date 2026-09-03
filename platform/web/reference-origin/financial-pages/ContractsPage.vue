<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Pencil, Plus, Repeat2, Search, Trash2, Wrench } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { fetchAllPages } from '../api/pagination'
import type { ApiResponse, Company, Contract, Customer, ServiceItem } from '../types'
import { useAuthStore } from '../stores/auth'
import { appConfirm } from '../composables/useAppDialog'
import PageHeader from '../components/PageHeader.vue'
import ModalDialog from '../components/ModalDialog.vue'
import StatusBadge from '../components/StatusBadge.vue'
import InlineAlert from '../components/InlineAlert.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'

const auth=useAuthStore()
const contracts=ref<Contract[]>([])
const companies=ref<Company[]>([])
const customers=ref<Customer[]>([])
const services=ref<ServiceItem[]>([])
const error=ref('')
const success=ref('')
const contractModal=ref(false)
const serviceModal=ref(false)
const editing=ref<Contract|null>(null)
const search=ref('')
const filterCompany=ref('')
const filterCustomer=ref('')
const today=new Date().toISOString().slice(0,10)
const serviceForm=reactive({code:'HONORARIOS',name:'Honorários',description:'Serviço recorrente mensal',default_amount:'0.00',default_frequency:'MONTHLY'})
const form=reactive({company_id:'',customer_id:'',service_id:'',code:'',description:'',amount:'0.00',frequency:'MONTHLY',interval_count:1,billing_method:'BOLETO_PIX',due_day:10,start_date:today,end_date:'',issue_days_before_due:10,interest_percent_monthly:'0',fine_percent:'2',discount_amount:'0',fiscal_trigger:'ON_PAYMENT',status:'ACTIVE'})

const companyName=(id:string)=>companies.value.find(x=>x.id===id)?.trade_name||companies.value.find(x=>x.id===id)?.legal_name||'Empresa'
const customerName=(id:string)=>customers.value.find(x=>x.id===id)?.name||'Cliente'
const serviceName=(id:string)=>services.value.find(x=>x.id===id)?.name||'Serviço'
const money=(v:string)=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const frequencyLabel=(value:string)=>({WEEKLY:'Semanal',BIWEEKLY:'Quinzenal',MONTHLY:'Mensal',BIMONTHLY:'Bimestral',QUARTERLY:'Trimestral',SEMIANNUAL:'Semestral',ANNUAL:'Anual'} as Record<string,string>)[value]||value
const billingLabel=(value:string)=>({BOLETO_PIX:'Boleto + Pix',PIX:'Pix',BOLETO:'Boleto',RECEIPT:'Recibo',MANUAL:'Manual'} as Record<string,string>)[value]||value
const canDelete=computed(()=>Boolean(auth.user?.permissions?.includes('*')||auth.user?.permissions?.includes('contracts.delete')))
const visibleContracts=computed(()=>{
  const term=search.value.trim().toLowerCase()
  return contracts.value.filter(item=>{
    if(filterCompany.value&&item.company_id!==filterCompany.value)return false
    if(filterCustomer.value&&item.customer_id!==filterCustomer.value)return false
    if(!term)return true
    return [item.code,companyName(item.company_id),customerName(item.customer_id),serviceName(item.service_id),item.status]
      .some(value=>String(value||'').toLowerCase().includes(term))
  })
})
const companyOptions=computed<SearchSelectOption[]>(()=>companies.value.map(item=>({value:item.id,label:item.trade_name||item.legal_name,description:item.tax_id,keywords:`${item.legal_name} ${item.trade_name||''} ${item.tax_id}`})))
const companyFilterOptions=computed<SearchSelectOption[]>(()=>[{value:'',label:'Todas as empresas'},...companyOptions.value])
const customerOptions=computed<SearchSelectOption[]>(()=>customers.value.map(item=>({value:item.id,label:item.name,description:item.tax_id||item.trade_name||'',keywords:`${item.name} ${item.trade_name||''} ${item.tax_id||''} ${item.email||''} ${item.whatsapp||''}`})))
const customerFilterOptions=computed<SearchSelectOption[]>(()=>[{value:'',label:'Todos os clientes'},...customerOptions.value])
const serviceOptions=computed<SearchSelectOption[]>(()=>services.value.map(item=>({value:item.id,label:item.name,description:item.code,keywords:`${item.name} ${item.code} ${item.description||''}`})))
const frequencyOptions:SearchSelectOption[]=[{value:'WEEKLY',label:'Semanal'},{value:'BIWEEKLY',label:'Quinzenal'},{value:'MONTHLY',label:'Mensal'},{value:'BIMONTHLY',label:'Bimestral'},{value:'QUARTERLY',label:'Trimestral'},{value:'SEMIANNUAL',label:'Semestral'},{value:'ANNUAL',label:'Anual'}]
const billingOptions:SearchSelectOption[]=[{value:'BOLETO_PIX',label:'Boleto + Pix'},{value:'PIX',label:'Pix'},{value:'BOLETO',label:'Boleto'},{value:'RECEIPT',label:'Recibo'},{value:'MANUAL',label:'Manual'}]
const fiscalOptions:SearchSelectOption[]=[{value:'ON_PAYMENT',label:'Ao receber'},{value:'ON_CHARGE',label:'Ao cobrar'},{value:'MANUAL',label:'Manual'}]
const statusOptions:SearchSelectOption[]=[{value:'ACTIVE',label:'Ativo'},{value:'PAUSED',label:'Pausado'},{value:'CANCELLED',label:'Cancelado'}]
const serviceFrequencyOptions:SearchSelectOption[]=[{value:'MONTHLY',label:'Mensal'},{value:'QUARTERLY',label:'Trimestral'},{value:'SEMIANNUAL',label:'Semestral'},{value:'ANNUAL',label:'Anual'}]

async function load(){
  error.value=''
  try{
    const [a,b,c,d]=await Promise.all([
      fetchAllPages<Contract>('/v1/contracts'),
      api.get<ApiResponse<Company[]>>('/v1/companies'),
      fetchAllPages<Customer>('/v1/customers'),
      api.get<ApiResponse<ServiceItem[]>>('/v1/services'),
    ])
    contracts.value=a;companies.value=b.data.data;customers.value=c;services.value=d.data.data
  }catch(e){error.value=apiError(e)}
}
async function createService(){
  error.value=''
  try{await api.post('/v1/services',serviceForm);serviceModal.value=false;success.value='Serviço cadastrado.';await load()}catch(e){error.value=apiError(e)}
}
function openContract(item?:Contract&{description?:string;interval_count?:number;issue_days_before_due?:number;interest_percent_monthly?:string;fine_percent?:string;discount_amount?:string;fiscal_trigger?:string}){
  editing.value=item||null
  Object.assign(form,item?{company_id:item.company_id,customer_id:item.customer_id,service_id:item.service_id,code:item.code,description:item.description||'',amount:item.amount,frequency:item.frequency,interval_count:item.interval_count||1,billing_method:item.billing_method,due_day:item.due_day,start_date:item.start_date,end_date:item.end_date||'',issue_days_before_due:item.issue_days_before_due||10,interest_percent_monthly:item.interest_percent_monthly||'0',fine_percent:item.fine_percent||'2',discount_amount:item.discount_amount||'0',fiscal_trigger:item.fiscal_trigger||'ON_PAYMENT',status:item.status}:{company_id:companies.value[0]?.id||'',customer_id:'',service_id:services.value[0]?.id||'',code:'',description:'',amount:'0.00',frequency:'MONTHLY',interval_count:1,billing_method:'BOLETO_PIX',due_day:10,start_date:today,end_date:'',issue_days_before_due:10,interest_percent_monthly:'0',fine_percent:'2',discount_amount:'0',fiscal_trigger:'ON_PAYMENT',status:'ACTIVE'})
  contractModal.value=true
}
async function saveContract(){
  error.value=''
  try{
    if(editing.value){
      await api.patch(`/v1/contracts/${editing.value.id}`,{description:form.description||null,amount:Number(form.amount),frequency:form.frequency,interval_count:form.interval_count,billing_method:form.billing_method,due_day:form.due_day,end_date:form.end_date||null,issue_days_before_due:form.issue_days_before_due,interest_percent_monthly:Number(form.interest_percent_monthly),fine_percent:Number(form.fine_percent),discount_amount:Number(form.discount_amount),fiscal_trigger:form.fiscal_trigger,status:form.status})
    }else{
      await api.post('/v1/contracts',{company_id:form.company_id,customer_id:form.customer_id,service_id:form.service_id,code:form.code,description:form.description||null,amount:Number(form.amount),frequency:form.frequency,interval_count:form.interval_count,billing_method:form.billing_method,due_day:form.due_day,start_date:form.start_date,end_date:form.end_date||null,issue_days_before_due:form.issue_days_before_due,interest_percent_monthly:Number(form.interest_percent_monthly),fine_percent:Number(form.fine_percent),discount_amount:Number(form.discount_amount),fiscal_trigger:form.fiscal_trigger,status:form.status,settings:{}})
    }
    contractModal.value=false;success.value=editing.value?'Contrato atualizado.':'Contrato cadastrado.';await load()
  }catch(e){error.value=apiError(e)}
}
async function deleteContract(item:Contract){
  if(!canDelete.value)return
  const confirmed=await appConfirm({
    title:'Excluir contrato',
    message:`O contrato ${item.code} será encerrado e não gerará novas recorrências. Recebíveis já existentes serão preservados para manter a rastreabilidade financeira.`,
    confirmLabel:'Excluir contrato',cancelLabel:'Manter contrato',tone:'danger',
  })
  if(!confirmed)return
  error.value='';success.value=''
  try{await api.delete(`/v1/contracts/${item.id}`);success.value=`Contrato ${item.code} excluído/encerrado com sucesso.`;await load()}catch(e){error.value=apiError(e)}
}
onMounted(load)
</script>

<template>
  <PageHeader title="Contratos e recorrências" subtitle="Regras que geram automaticamente os recebíveis de cada cliente.">
    <button class="btn-secondary" @click="serviceModal=true"><Wrench :size="18"/>Serviço</button>
    <button class="btn-primary" @click="openContract()"><Plus :size="18"/>Novo contrato</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>

  <section class="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-soft lg:grid-cols-[minmax(0,1.4fr)_1fr_1fr]">
    <div class="relative"><Search :size="18" class="absolute left-3.5 top-3 text-slate-400"/><input v-model="search" class="input pl-10" placeholder="Pesquisar contrato, cliente, empresa ou serviço..."/></div>
    <SearchSelect v-model="filterCompany" :options="companyFilterOptions" search-placeholder="Pesquisar empresa…"/>
    <SearchSelect v-model="filterCustomer" :options="customerFilterOptions" search-placeholder="Pesquisar cliente…"/>
  </section>

  <div class="table-wrap"><table class="table"><thead><tr><th>Contrato</th><th>Empresa / Cliente</th><th>Serviço</th><th>Recorrência</th><th>Valor</th><th>Estado</th><th>Ações</th></tr></thead><tbody>
    <tr v-for="item in visibleContracts" :key="item.id">
      <td><p class="font-semibold">{{item.code}}</p><p class="text-xs text-slate-400">Próxima geração: {{new Date(item.next_generation_date+'T12:00:00').toLocaleDateString('pt-BR')}}</p></td>
      <td><p>{{companyName(item.company_id)}}</p><p class="text-xs text-slate-400">{{customerName(item.customer_id)}}</p></td>
      <td>{{serviceName(item.service_id)}}</td>
      <td><div class="flex items-center gap-2"><Repeat2 :size="16" class="text-teal-600"/>{{frequencyLabel(item.frequency)}} · dia {{item.due_day}}</div><p class="text-xs text-slate-400">{{billingLabel(item.billing_method)}}</p></td>
      <td class="font-semibold">{{money(item.amount)}}</td><td><StatusBadge :status="item.status"/></td>
      <td><div class="flex flex-wrap gap-2"><button class="btn-secondary px-3 py-2" @click="openContract(item)"><Pencil :size="15"/>Editar</button><button v-if="canDelete&&item.status!=='CANCELLED'" class="btn-secondary px-3 py-2 text-rose-600" @click="deleteContract(item)"><Trash2 :size="15"/>Excluir</button></div></td>
    </tr>
    <tr v-if="!visibleContracts.length"><td colspan="7" class="py-12 text-center text-slate-400">Nenhum contrato encontrado com os filtros informados.</td></tr>
  </tbody></table></div>

  <ModalDialog :open="serviceModal" title="Cadastrar serviço" @close="serviceModal=false"><form class="space-y-4" @submit.prevent="createService"><div><label class="label">Código</label><input v-model="serviceForm.code" class="input" required/></div><div><label class="label">Nome</label><input v-model="serviceForm.name" class="input" required/></div><div><label class="label">Descrição</label><textarea v-model="serviceForm.description" class="input min-h-20"></textarea></div><div class="grid grid-cols-2 gap-3"><div><label class="label">Valor padrão</label><input v-model="serviceForm.default_amount" type="number" step="0.01" class="input"/></div><div><label class="label">Periodicidade</label><SearchSelect v-model="serviceForm.default_frequency" :options="serviceFrequencyOptions"/></div></div><div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="serviceModal=false">Cancelar</button><button class="btn-primary">Salvar</button></div></form></ModalDialog>

  <ModalDialog :open="contractModal" :title="editing?'Editar contrato recorrente':'Cadastrar contrato recorrente'" size="xl" @close="contractModal=false">
    <form class="grid gap-4 md:grid-cols-2" @submit.prevent="saveContract">
      <div><label class="label">Empresa emissora</label><SearchSelect v-model="form.company_id" :options="companyOptions" :disabled="!!editing" search-placeholder="Pesquisar empresa ou CNPJ…"/></div>
      <div><label class="label">Cliente</label><SearchSelect v-model="form.customer_id" :options="customerOptions" :disabled="!!editing" placeholder="Pesquisar cliente" search-placeholder="Nome, CNPJ/CPF, e-mail ou WhatsApp…"/></div>
      <div><label class="label">Serviço</label><SearchSelect v-model="form.service_id" :options="serviceOptions" :disabled="!!editing" search-placeholder="Pesquisar serviço…"/></div>
      <div><label class="label">Código do contrato</label><input v-model="form.code" class="input" :disabled="!!editing" placeholder="CTR-0001" required/></div>
      <div><label class="label">Valor</label><input v-model="form.amount" type="number" min="0.01" step="0.01" class="input" required/></div>
      <div><label class="label">Forma de cobrança</label><SearchSelect v-model="form.billing_method" :options="billingOptions"/></div>
      <div><label class="label">Periodicidade</label><SearchSelect v-model="form.frequency" :options="frequencyOptions"/></div>
      <div class="grid grid-cols-2 gap-2"><div><label class="label">Dia vencimento</label><input v-model.number="form.due_day" type="number" min="1" max="31" class="input"/></div><div><label class="label">Emitir antes</label><input v-model.number="form.issue_days_before_due" type="number" min="0" class="input"/></div></div>
      <div><label class="label">Primeiro vencimento</label><input v-model="form.start_date" type="date" class="input" :disabled="!!editing" required/><p v-if="editing" class="mt-1 text-xs text-slate-400">A data inicial pertence à origem do contrato e não é alterada nesta tela.</p></div>
      <div><label class="label">Término opcional</label><input v-model="form.end_date" type="date" class="input"/></div>
      <div class="grid grid-cols-2 gap-2"><div><label class="label">Multa %</label><input v-model="form.fine_percent" type="number" step="0.01" class="input"/></div><div><label class="label">Juros % a.m.</label><input v-model="form.interest_percent_monthly" type="number" step="0.0001" class="input"/></div></div>
      <div><label class="label">Emissão fiscal</label><SearchSelect v-model="form.fiscal_trigger" :options="fiscalOptions"/></div>
      <div v-if="editing"><label class="label">Situação</label><SearchSelect v-model="form.status" :options="statusOptions"/></div>
      <div class="md:col-span-2"><label class="label">Descrição</label><textarea v-model="form.description" class="input min-h-20"></textarea></div>
      <div v-if="editing" class="md:col-span-2 rounded-xl bg-sky-50 p-3 text-xs text-sky-800">Empresa, cliente, serviço, código e primeiro vencimento identificam a origem do contrato. Para trocar esses vínculos, crie um novo contrato e encerre o atual.</div>
      <div class="md:col-span-2 flex justify-end gap-2"><button type="button" class="btn-secondary" @click="contractModal=false">Cancelar</button><button class="btn-primary">{{editing?'Salvar alterações':'Salvar contrato'}}</button></div>
    </form>
  </ModalDialog>
</template>
