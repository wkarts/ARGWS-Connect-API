<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Ban, CheckCircle2, ChevronDown, Plus, RefreshCw, Search } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { fetchAllPages } from '../api/pagination'
import type { ApiResponse, Company, Customer, Receivable } from '../types'
import { appConfirm, appPrompt } from '../composables/useAppDialog'
import PageHeader from '../components/PageHeader.vue'
import DrawerPanel from '../components/DrawerPanel.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'

interface Negotiation{id:string;company_id:string;customer_id:string;code:string;original_amount:string;negotiated_amount:string;installment_count:number;first_due_date:string;status:string;terms:Record<string,unknown>;approved_at?:string;created_at:string}
interface NegotiationInstallment{id:string;document_number:string;description:string;installment:number;installment_count:number;due_date:string;original_amount:string;paid_amount:string;balance:string;status:string}
interface InstallmentResult{negotiation_id:string;code:string;expected_count:number;generated_count:number;complete:boolean;installments:NegotiationInstallment[]}

const items=ref<Negotiation[]>([])
const companies=ref<Company[]>([])
const customers=ref<Customer[]>([])
const receivables=ref<Receivable[]>([])
const installments=ref<Record<string,InstallmentResult>>({})
const expanded=ref<Record<string,boolean>>({})
const drawer=ref(false)
const error=ref('')
const success=ref('')
const titleSearch=ref('')
const form=reactive({company_id:'',customer_id:'',receivable_ids:[] as string[],negotiated_amount:'0',installment_count:1,first_due_date:new Date().toISOString().slice(0,10),notes:''})
const normalized=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const available=computed(()=>receivables.value.filter(x=>x.company_id===form.company_id&&x.customer_id===form.customer_id&&['OPEN','REGISTERED','OVERDUE','PARTIALLY_PAID'].includes(x.status)))
const visibleAvailable=computed(()=>{const term=normalized(titleSearch.value.trim());if(!term)return available.value;return available.value.filter(item=>normalized(`${item.document_number} ${item.description} ${item.balance} ${item.due_date}`).includes(term))})
const original=computed(()=>available.value.filter(x=>form.receivable_ids.includes(x.id)).reduce((sum,x)=>sum+Number(x.balance),0))
const money=(v:string|number)=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const negotiationNotes=(item:Negotiation)=>String(item.terms?.notes||item.terms?.note||'')
const companyOptions=computed<SearchSelectOption[]>(()=>companies.value.map(item=>({value:item.id,label:item.trade_name||item.legal_name,description:item.tax_id,keywords:`${item.legal_name} ${item.trade_name||''} ${item.tax_id}`})))
const customerOptions=computed<SearchSelectOption[]>(()=>customers.value.map(item=>({value:item.id,label:item.name,description:item.tax_id||item.trade_name||'',keywords:`${item.name} ${item.trade_name||''} ${item.tax_id||''} ${item.email||''} ${item.whatsapp||''}`})))

async function loadInstallments(item:Negotiation){
  if(item.status==='DRAFT')return
  const response=await api.get<ApiResponse<InstallmentResult>>(`/v1/negotiations/${item.id}/installments`)
  installments.value={...installments.value,[item.id]:response.data.data}
}
async function load(){
  error.value=''
  try{
    const [n,c,cu,r]=await Promise.all([
      api.get<ApiResponse<Negotiation[]>>('/v1/negotiations'),
      api.get<ApiResponse<Company[]>>('/v1/companies'),
      fetchAllPages<Customer>('/v1/customers'),
      fetchAllPages<Receivable>('/v1/receivables'),
    ])
    items.value=n.data.data;companies.value=c.data.data;customers.value=cu;receivables.value=r
    await Promise.all(items.value.filter(item=>item.status!=='DRAFT').map(async item=>{try{await loadInstallments(item)}catch{/* carregamento sob demanda permanece disponível */}}))
  }catch(e){error.value=apiError(e)}
}
function open(){Object.assign(form,{company_id:companies.value[0]?.id||'',customer_id:'',receivable_ids:[],negotiated_amount:'0',installment_count:1,first_due_date:new Date().toISOString().slice(0,10),notes:''});titleSearch.value='';drawer.value=true}
async function create(){
  error.value=''
  try{await api.post('/v1/negotiations',{company_id:form.company_id,customer_id:form.customer_id,receivable_ids:form.receivable_ids,negotiated_amount:Number(form.negotiated_amount),installment_count:form.installment_count,first_due_date:form.first_due_date,terms:form.notes.trim()?{notes:form.notes.trim()}:{}});drawer.value=false;success.value='Negociação criada em rascunho.';await load()}catch(e){error.value=apiError(e)}
}
async function approve(item:Negotiation){
  const ok=await appConfirm({title:'Aprovar negociação',message:`A negociação ${item.code} substituirá os títulos selecionados por ${item.installment_count} parcelas. Os títulos originais permanecerão vinculados ao acordo para auditoria.`,confirmLabel:'Aprovar e gerar parcelas',cancelLabel:'Voltar',tone:'warning'})
  if(!ok)return
  error.value='';success.value=''
  try{
    const response=(await api.post<ApiResponse<Negotiation&{generated_receivable_ids:string[]}>>(`/v1/negotiations/${item.id}/approve`)).data.data
    success.value=`Negociação aprovada. ${response.generated_receivable_ids?.length||item.installment_count} parcela(s) gerada(s).`
    expanded.value={...expanded.value,[item.id]:true};await load()
  }catch(e){error.value=apiError(e)}
}
async function cancel(item:Negotiation){
  const reason=await appPrompt({title:'Cancelar negociação',message:`Informe o motivo do cancelamento de ${item.code}. Esta informação ficará registrada na auditoria.`,inputLabel:'Motivo',placeholder:'Descreva o motivo do cancelamento',required:true,confirmLabel:'Cancelar negociação',cancelLabel:'Voltar',tone:'danger'})
  if(!reason?.trim())return
  error.value='';success.value=''
  try{await api.post(`/v1/negotiations/${item.id}/cancel`,null,{params:{reason:reason.trim()}});success.value='Negociação cancelada.';await load()}catch(e){error.value=apiError(e)}
}
async function toggleInstallments(item:Negotiation){
  expanded.value={...expanded.value,[item.id]:!expanded.value[item.id]}
  if(expanded.value[item.id]&&!installments.value[item.id]){
    try{await loadInstallments(item)}catch(e){error.value=apiError(e)}
  }
}
onMounted(load)
</script>

<template>
  <PageHeader title="Renegociação e acordos" subtitle="Consolide débitos, gere parcelas e preserve a rastreabilidade dos títulos originais."><button class="btn-secondary" @click="load"><RefreshCw :size="18"/>Atualizar</button><button class="btn-primary" @click="open"><Plus :size="18"/>Nova negociação</button></PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>
  <div class="grid gap-5 xl:grid-cols-2">
    <article v-for="item in items" :key="item.id" class="card">
      <div class="flex items-start gap-3"><div class="flex-1"><div class="flex items-center gap-2"><h2 class="font-bold">{{item.code}}</h2><StatusBadge :status="item.status"/></div><p class="mt-1 text-xs text-slate-400">Cliente {{customers.find(x=>x.id===item.customer_id)?.name||'Não localizado'}}</p></div><button v-if="item.status==='DRAFT'" class="btn-primary px-3 py-2" @click="approve(item)"><CheckCircle2 :size="16"/>Aprovar</button><button v-if="!['CANCELLED','COMPLETED'].includes(item.status)" class="btn-secondary px-3 py-2 text-rose-600" @click="cancel(item)"><Ban :size="16"/></button></div>
      <div class="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><div class="rounded-xl bg-slate-50 p-3"><p class="text-xs text-slate-400">Original</p><p class="font-bold">{{money(item.original_amount)}}</p></div><div class="rounded-xl bg-emerald-50 p-3"><p class="text-xs text-emerald-600">Negociado</p><p class="font-bold text-emerald-800">{{money(item.negotiated_amount)}}</p></div><div class="rounded-xl bg-slate-50 p-3"><p class="text-xs text-slate-400">Parcelas</p><p class="font-bold">{{item.installment_count}}</p></div><div class="rounded-xl bg-slate-50 p-3"><p class="text-xs text-slate-400">Primeiro vencimento</p><p class="font-bold">{{new Date(item.first_due_date+'T00:00:00').toLocaleDateString('pt-BR')}}</p></div></div>
      <p v-if="negotiationNotes(item)" class="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{{negotiationNotes(item)}}</p>
      <div v-if="item.status!=='DRAFT'" class="mt-4 border-t border-slate-100 pt-4">
        <button class="flex w-full items-center justify-between text-left text-sm font-semibold text-teal-700" @click="toggleInstallments(item)"><span>Parcelas geradas <template v-if="installments[item.id]">({{installments[item.id].generated_count}}/{{installments[item.id].expected_count}})</template></span><ChevronDown :size="18" :class="expanded[item.id]?'rotate-180':''"/></button>
        <div v-if="expanded[item.id]" class="mt-3 space-y-2">
          <div v-if="installments[item.id]&&!installments[item.id].complete" class="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">Foram encontradas {{installments[item.id].generated_count}} de {{installments[item.id].expected_count}} parcelas. Esta divergência precisa ser corrigida antes de novas ações financeiras no acordo.</div>
          <div v-for="part in installments[item.id]?.installments||[]" :key="part.id" class="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[70px_1fr_auto_auto] sm:items-center"><strong>{{part.installment}}/{{part.installment_count}}</strong><div><p class="text-sm font-semibold">{{part.document_number}}</p><p class="text-xs text-slate-400">Vence {{new Date(part.due_date+'T00:00:00').toLocaleDateString('pt-BR')}}</p></div><p class="font-semibold">{{money(part.original_amount)}}</p><StatusBadge :status="part.status"/></div>
          <p v-if="installments[item.id]&&!installments[item.id].installments.length" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Nenhuma parcela foi localizada para esta negociação.</p>
        </div>
      </div>
    </article>
    <EmptyState v-if="!items.length" title="Nenhuma negociação"/>
  </div>
  <DrawerPanel :open="drawer" title="Nova negociação" width="xl" @close="drawer=false"><form class="grid gap-4 md:grid-cols-2" @submit.prevent="create"><div><label class="label">Empresa</label><SearchSelect v-model="form.company_id" :options="companyOptions" search-placeholder="Pesquisar empresa ou CNPJ…"/></div><div><label class="label">Cliente</label><SearchSelect v-model="form.customer_id" :options="customerOptions" placeholder="Pesquisar cliente" search-placeholder="Nome, CNPJ/CPF, e-mail ou WhatsApp…"/></div><div class="md:col-span-2"><div class="mb-2 flex flex-wrap items-end justify-between gap-2"><label class="label !mb-0">Títulos de origem</label><div class="relative w-full sm:w-72"><Search :size="15" class="absolute left-3 top-2.5 text-slate-400"/><input v-model="titleSearch" class="input !py-2 pl-9" placeholder="Pesquisar título ou valor…"/></div></div><div class="scroll-clean max-h-72 space-y-1 overflow-auto rounded-xl border border-slate-200 p-2"><label v-for="r in visibleAvailable" :key="r.id" class="flex items-center gap-3 rounded-lg p-2 hover:bg-slate-50"><input v-model="form.receivable_ids" type="checkbox" :value="r.id"/><span class="flex-1"><span class="block text-sm font-medium">{{r.document_number}} · {{r.description}}</span><span class="text-xs text-slate-400">Vence {{new Date(r.due_date+'T00:00:00').toLocaleDateString('pt-BR')}}</span></span><strong>{{money(r.balance)}}</strong></label><p v-if="!visibleAvailable.length" class="p-4 text-center text-sm text-slate-400">Nenhum título elegível para a pesquisa atual.</p></div><p class="mt-2 text-right text-sm">Saldo selecionado: <strong>{{money(original)}}</strong></p></div><div><label class="label">Valor negociado</label><input v-model="form.negotiated_amount" type="number" min="0.01" step="0.01" class="input" required/></div><div><label class="label">Quantidade de parcelas</label><input v-model.number="form.installment_count" type="number" min="1" max="120" class="input" required/></div><div><label class="label">Primeiro vencimento</label><input v-model="form.first_due_date" type="date" class="input" required/></div><div class="rounded-xl bg-sky-50 p-3 text-sm text-sky-800">Parcela estimada: <strong>{{money(Number(form.negotiated_amount||0)/Math.max(1,form.installment_count))}}</strong></div><div class="md:col-span-2"><label class="label">Observações do acordo</label><textarea v-model="form.notes" class="input min-h-24" placeholder="Condições comerciais, observações e informações relevantes para o acordo."/></div><div class="md:col-span-2 flex justify-end gap-2 border-t pt-4"><button type="button" class="btn-secondary" @click="drawer=false">Cancelar</button><button class="btn-primary" :disabled="!form.company_id||!form.customer_id||!form.receivable_ids.length">Criar rascunho</button></div></form></DrawerPanel>
</template>
