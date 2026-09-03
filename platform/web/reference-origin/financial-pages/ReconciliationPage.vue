<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CheckCircle2, Landmark, RefreshCw, Search, Sparkles, WandSparkles } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { fetchAllPages } from '../api/pagination'
import type { ApiResponse, Customer, Payment, Receivable } from '../types'
import { appConfirm } from '../composables/useAppDialog'
import PageHeader from '../components/PageHeader.vue'
import StatusBadge from '../components/StatusBadge.vue'
import InlineAlert from '../components/InlineAlert.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'

interface Reconciliation {
  id:string
  receivable_id?:string|null
  payment_id?:string|null
  bank_transaction_id?:string|null
  status:string
  score:string
  criteria:Record<string,unknown>
  reconciled_at?:string|null
  created_at:string
}
interface BankTransaction {
  id:string
  bank_account_id:string
  external_id:string
  transaction_date:string
  posted_at?:string|null
  amount:string
  transaction_type:string
  description:string
  document_number?:string|null
  end_to_end_id?:string|null
  reconciliation_status:string
  created_at:string
}
interface SmartMatchResult{matched:number;suggested:number;skipped:number}

const items=ref<Reconciliation[]>([])
const receivables=ref<Receivable[]>([])
const payments=ref<Payment[]>([])
const customers=ref<Customer[]>([])
const transactions=ref<BankTransaction[]>([])
const error=ref('')
const message=ref('')
const loading=ref(false)
const processing=ref(false)
const search=ref('')
const status=ref('')

const money=(value:string|number)=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const receivableById=computed(()=>new Map(receivables.value.map(item=>[item.id,item])))
const paymentById=computed(()=>new Map(payments.value.map(item=>[item.id,item])))
const customerById=computed(()=>new Map(customers.value.map(item=>[item.id,item])))
const transactionById=computed(()=>new Map(transactions.value.map(item=>[item.id,item])))
const statusOptions:SearchSelectOption[]=[{value:'',label:'Todas as situações'},{value:'SUGGESTED',label:'Sugestões pendentes'},{value:'MATCHED',label:'Conciliados'},{value:'REJECTED',label:'Rejeitados'}]
const unmatchedTransactions=computed(()=>transactions.value.filter(item=>item.transaction_type==='CREDIT'&&item.reconciliation_status==='UNMATCHED'))
const suggestedCount=computed(()=>items.value.filter(item=>item.status==='SUGGESTED').length)
const matchedCount=computed(()=>items.value.filter(item=>item.status==='MATCHED').length)
const visibleItems=computed(()=>{
  const term=search.value.trim().toLowerCase()
  return items.value.filter(item=>{
    if(status.value&&item.status!==status.value)return false
    if(!term)return true
    const receivable=receivableById.value.get(item.receivable_id||'')
    const customer=customerById.value.get(receivable?.customer_id||'')
    const transaction=resolveTransaction(item)
    return [customer?.name,receivable?.document_number,receivable?.description,transaction?.description,transaction?.external_id,transaction?.end_to_end_id]
      .some(value=>String(value||'').toLowerCase().includes(term))
  })
})
const criteriaLabel=(key:string)=>({
  receivable_relation:'Relação com o título',provider:'Origem do pagamento',amount:'Valor',
  amount_match:'Valor compatível',date_match:'Data compatível',date_proximity:'Proximidade da data',
  end_to_end_match:'Identificador Pix compatível',document_match:'Documento compatível',
  bank_transaction:'Transação bancária localizada',existing_payment:'Pagamento já registrado',
  requires_confirmation:'Exige confirmação',confirmed_by_operator:'Confirmado pelo operador',
} as Record<string,string>)[key]||key.replaceAll('_',' ')
const criteriaValue=(value:unknown)=>typeof value==='boolean'?(value?'Sim':'Não'):String(value??'—')

function resolveTransaction(item:Reconciliation):BankTransaction|undefined{
  if(!item.bank_transaction_id)return undefined
  return transactionById.value.get(item.bank_transaction_id)
    ||transactions.value.find(tx=>[tx.external_id,tx.end_to_end_id,tx.document_number].includes(item.bank_transaction_id||''))
}
async function load(){
  loading.value=true;error.value=''
  try{
    const [r,rec,pay,customer,tx]=await Promise.all([
      api.get<ApiResponse<Reconciliation[]>>('/v1/reconciliations'),
      fetchAllPages<Receivable>('/v1/receivables'),
      api.get<ApiResponse<Payment[]>>('/v1/payments'),
      fetchAllPages<Customer>('/v1/customers'),
      fetchAllPages<BankTransaction>('/v1/bank-transactions',{}, {perPage:100,maxPages:100}),
    ])
    items.value=r.data.data;receivables.value=rec;payments.value=pay.data.data;customers.value=customer;transactions.value=tx
  }catch(exception){error.value=apiError(exception)}finally{loading.value=false}
}
async function autoMatch(){
  processing.value=true;error.value='';message.value=''
  try{
    const response=await api.post<ApiResponse<SmartMatchResult>>('/v1/reconciliations/auto-match-smart')
    const result=response.data.data
    message.value=`Processamento concluído: ${result.matched} conciliado(s), ${result.suggested} sugestão(ões) para conferência e ${result.skipped} transação(ões) mantida(s) sem vínculo por segurança.`
    await load()
  }catch(exception){error.value=apiError(exception)}finally{processing.value=false}
}
async function confirmSuggestion(item:Reconciliation){
  const receivable=receivableById.value.get(item.receivable_id||'')
  const transaction=resolveTransaction(item)
  if(!receivable||!transaction)return
  const ok=await appConfirm({
    title:'Confirmar conciliação',
    message:`Confirmar o crédito de ${money(transaction.amount)} para o título ${receivable.document_number}? A plataforma registrará o pagamento e atualizará o saldo do título de forma auditada.`,
    confirmLabel:'Confirmar e baixar',cancelLabel:'Revisar depois',tone:'warning',
  })
  if(!ok)return
  processing.value=true;error.value='';message.value=''
  try{
    await api.post(`/v1/reconciliations/${item.id}/confirm`)
    message.value='Conciliação confirmada. O pagamento e o saldo do título foram atualizados.'
    await load()
  }catch(exception){error.value=apiError(exception)}finally{processing.value=false}
}
onMounted(load)
</script>

<template>
  <PageHeader title="Conciliação bancária" subtitle="Cruze créditos do extrato, pagamentos e títulos com confirmação auditável quando houver dúvida.">
    <button class="btn-secondary" :disabled="loading" @click="load"><RefreshCw :size="18" :class="loading?'animate-spin':''"/>Atualizar</button>
    <button class="btn-primary" :disabled="processing" @click="autoMatch"><WandSparkles :size="18"/>{{processing?'Analisando…':'Analisar extrato'}}</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="message" type="success" @dismiss="message=''"/>

  <section class="mb-5 grid gap-3 sm:grid-cols-3">
    <div class="card"><div class="flex items-start justify-between"><div><p class="text-xs uppercase text-slate-400">Créditos sem conciliar</p><p class="mt-2 text-2xl font-bold">{{unmatchedTransactions.length}}</p></div><Landmark :size="22" class="text-blue-600"/></div></div>
    <div class="card"><div class="flex items-start justify-between"><div><p class="text-xs uppercase text-slate-400">Sugestões para revisar</p><p class="mt-2 text-2xl font-bold text-amber-700">{{suggestedCount}}</p></div><Sparkles :size="22" class="text-amber-600"/></div></div>
    <div class="card"><div class="flex items-start justify-between"><div><p class="text-xs uppercase text-slate-400">Conciliados</p><p class="mt-2 text-2xl font-bold text-emerald-700">{{matchedCount}}</p></div><CheckCircle2 :size="22" class="text-emerald-600"/></div></div>
  </section>

  <section class="mb-5 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-soft md:grid-cols-[1fr_260px]">
    <div class="relative"><Search :size="18" class="absolute left-3.5 top-3 text-slate-400"/><input v-model="search" class="input pl-10" placeholder="Cliente, título, descrição, documento ou identificador bancário..."/></div>
    <SearchSelect v-model="status" :options="statusOptions"/>
  </section>

  <div class="table-wrap">
    <table class="table min-w-[1180px]">
      <thead><tr><th>Cliente / título</th><th>Crédito bancário</th><th>Pagamento</th><th>Critérios</th><th>Confiança</th><th>Situação</th><th></th></tr></thead>
      <tbody>
        <tr v-for="item in visibleItems" :key="item.id">
          <td><p class="font-semibold">{{customerById.get(receivableById.get(item.receivable_id||'')?.customer_id||'')?.name||'Cliente não identificado'}}</p><p class="text-xs text-slate-500">{{receivableById.get(item.receivable_id||'')?.document_number||'Título não associado'}} · {{receivableById.get(item.receivable_id||'')?.description||''}}</p><p v-if="receivableById.get(item.receivable_id||'')" class="mt-1 text-xs font-semibold text-slate-700">Saldo {{money(receivableById.get(item.receivable_id||'')!.balance)}}</p></td>
          <td><template v-if="resolveTransaction(item)"><p class="font-semibold text-emerald-700">{{money(resolveTransaction(item)!.amount)}}</p><p class="max-w-xs text-xs text-slate-500">{{resolveTransaction(item)!.description}}</p><p class="mt-1 text-[11px] text-slate-400">{{new Date(resolveTransaction(item)!.transaction_date+'T12:00:00').toLocaleDateString('pt-BR')}} · {{resolveTransaction(item)!.external_id}}</p></template><span v-else class="text-xs text-slate-400">Referência bancária legada ou não localizada</span></td>
          <td><p class="font-semibold">{{paymentById.get(item.payment_id||'')?money(paymentById.get(item.payment_id||'')!.amount):'Ainda não registrado'}}</p><p v-if="paymentById.get(item.payment_id||'')" class="text-xs text-slate-400">{{paymentById.get(item.payment_id||'')!.payment_method}}</p></td>
          <td><details><summary class="cursor-pointer text-xs font-semibold text-teal-700">Ver critérios</summary><div class="mt-2 min-w-64 space-y-1 rounded-lg border border-slate-100 bg-slate-50 p-2"><div v-for="(value,key) in item.criteria" :key="String(key)" class="flex items-center justify-between gap-3 rounded-md bg-white px-2 py-1.5 text-xs"><span class="text-slate-500">{{criteriaLabel(String(key))}}</span><strong class="text-slate-700">{{criteriaValue(value)}}</strong></div></div></details></td>
          <td><span class="inline-flex items-center gap-1 font-semibold"><CheckCircle2 :size="16" :class="Number(item.score)>=95?'text-emerald-600':'text-amber-600'"/>{{Number(item.score).toFixed(0)}}%</span></td>
          <td><StatusBadge :status="item.status"/></td>
          <td><button v-if="item.status==='SUGGESTED'&&resolveTransaction(item)" class="btn-primary !px-3 !py-2" :disabled="processing" @click="confirmSuggestion(item)"><CheckCircle2 :size="15"/>Confirmar</button></td>
        </tr>
        <tr v-if="!visibleItems.length"><td colspan="7" class="py-12 text-center text-slate-400">Nenhuma conciliação encontrada com os filtros informados.</td></tr>
      </tbody>
    </table>
  </div>
</template>
