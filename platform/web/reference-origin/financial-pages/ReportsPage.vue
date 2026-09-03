<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  AlertTriangle, Banknote, CircleDollarSign, Download, FileDown,
  FileSpreadsheet, HandCoins, Printer, RefreshCw, Search,
} from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { fetchAllPages } from '../api/pagination'
import type { ApiResponse, Company, Customer, Payment, Receivable } from '../types'
import PageHeader from '../components/PageHeader.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatCard from '../components/StatCard.vue'
import StatusBadge from '../components/StatusBadge.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'

interface Dashboard{open_amount:string;overdue_amount:string;received_month:string;receivables_count:number;overdue_count:number;active_contracts:number;customers:number}
interface ExportResult{id:string;status:string;sha256?:string;size_bytes?:number;download_url?:string}

const data=ref<Dashboard>({open_amount:'0',overdue_amount:'0',received_month:'0',receivables_count:0,overdue_count:0,active_contracts:0,customers:0})
const receivables=ref<Receivable[]>([])
const payments=ref<Payment[]>([])
const companies=ref<Company[]>([])
const customers=ref<Customer[]>([])
const error=ref('')
const success=ref('')
const loading=ref(false)
const exporting=ref('')
const search=ref('')
const companyId=ref('')
const customerId=ref('')
const status=ref('')
const dueFrom=ref('')
const dueTo=ref('')

const money=(v:string|number)=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const dateBR=(value:string)=>new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString('pt-BR')
const companyName=(id:string)=>companies.value.find(item=>item.id===id)?.trade_name||companies.value.find(item=>item.id===id)?.legal_name||'Empresa'
const customerName=(id:string)=>customers.value.find(item=>item.id===id)?.name||'Cliente'
const paymentMethodLabel=(value:string)=>({MANUAL:'Manual',PIX:'Pix',BANK_TRANSFER:'Transferência bancária',TRANSFER:'Transferência',CASH:'Dinheiro',CARD:'Cartão',CNAB:'Retorno CNAB',BANK_STATEMENT:'Extrato bancário'} as Record<string,string>)[String(value||'').toUpperCase()]||String(value||'—').replaceAll('_',' ')
const companyOptions=computed<SearchSelectOption[]>(()=>[{value:'',label:'Todas as empresas'},...companies.value.map(item=>({value:item.id,label:item.trade_name||item.legal_name,description:item.tax_id,keywords:`${item.legal_name} ${item.trade_name||''} ${item.tax_id}`}))])
const customerOptions=computed<SearchSelectOption[]>(()=>[{value:'',label:'Todos os clientes'},...customers.value.map(item=>({value:item.id,label:item.name,description:item.tax_id||item.trade_name||'',keywords:`${item.name} ${item.tax_id||''} ${item.trade_name||''}`}))])
const statusOptions:SearchSelectOption[]=[{value:'',label:'Todas as situações'},{value:'OPEN',label:'Em aberto'},{value:'REGISTERED',label:'Registrado'},{value:'OVERDUE',label:'Vencido'},{value:'PARTIALLY_PAID',label:'Pago parcialmente'},{value:'PAID',label:'Pago'},{value:'NEGOTIATED',label:'Negociado'},{value:'CANCELLED',label:'Cancelado'}]

const filteredReceivables=computed(()=>{
  const term=search.value.trim().toLowerCase()
  return receivables.value.filter(item=>{
    if(companyId.value&&item.company_id!==companyId.value)return false
    if(customerId.value&&item.customer_id!==customerId.value)return false
    if(status.value&&item.status!==status.value)return false
    if(dueFrom.value&&item.due_date<dueFrom.value)return false
    if(dueTo.value&&item.due_date>dueTo.value)return false
    if(!term)return true
    return [item.document_number,item.description,companyName(item.company_id),customerName(item.customer_id),item.competence]
      .some(value=>String(value||'').toLowerCase().includes(term))
  })
})
const filteredIds=computed(()=>new Set(filteredReceivables.value.map(item=>item.id)))
const reportPayments=computed(()=>payments.value.filter(item=>filteredIds.value.has(item.receivable_id)).slice(0,20))
const reportSummary=computed(()=>{
  let open=0,overdue=0,paid=0
  for(const item of filteredReceivables.value){
    const balance=Number(item.balance||0)
    if(['OPEN','REGISTERED','PARTIALLY_PAID'].includes(item.status))open+=balance
    if(item.status==='OVERDUE')overdue+=balance
    paid+=Number(item.paid_amount||0)
  }
  return{open,overdue,paid,count:filteredReceivables.value.length,customers:new Set(filteredReceivables.value.map(item=>item.customer_id)).size}
})
const byStatus=computed(()=>Object.entries(filteredReceivables.value.reduce<Record<string,{count:number;amount:number}>>((acc,item)=>{acc[item.status]??={count:0,amount:0};acc[item.status].count++;acc[item.status].amount+=Number(item.balance);return acc},{})).sort((a,b)=>b[1].amount-a[1].amount))

async function load(){
  loading.value=true;error.value=''
  try{
    const [d,r,p,c,cu]=await Promise.all([
      api.get<ApiResponse<Dashboard>>('/v1/dashboard'),
      fetchAllPages<Receivable>('/v1/receivables',{}, {perPage:100,maxPages:500}),
      api.get<ApiResponse<Payment[]>>('/v1/payments'),
      api.get<ApiResponse<Company[]>>('/v1/companies'),
      fetchAllPages<Customer>('/v1/customers'),
    ])
    data.value=d.data.data;receivables.value=r;payments.value=p.data.data;companies.value=c.data.data;customers.value=cu
  }catch(e){error.value=apiError(e)}finally{loading.value=false}
}
function exportFilters(){return{company_id:companyId.value||null,customer_id:customerId.value||null,status:status.value||null,due_from:dueFrom.value||null,due_to:dueTo.value||null}}
function responseFilename(disposition:unknown,fallback:string){const value=String(disposition||'');const utf=value.match(/filename\*=UTF-8''([^;]+)/i);if(utf?.[1]){try{return decodeURIComponent(utf[1])}catch{/* fallback */}}const normal=value.match(/filename="?([^";]+)"?/i);return normal?.[1]||fallback}
function saveBlob(blob:Blob,filename:string){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
async function exportReport(format:'PDF'|'XLSX'|'CSV'){
  exporting.value=format;error.value='';success.value=''
  try{
    const result=(await api.post<ApiResponse<ExportResult>>('/v1/exports',{export_type:'RECEIVABLES',format,filters:exportFilters()})).data.data
    const response=await api.get(`/v1/exports/${result.id}/download`,{responseType:'blob'})
    saveBlob(response.data,responseFilename(response.headers['content-disposition'],`relatorio-financeiro.${format.toLowerCase()}`))
    success.value=`Relatório ${format==='XLSX'?'Excel':format} gerado e baixado com sucesso.`
  }catch(e){error.value=apiError(e)}finally{exporting.value=''}
}
function printReport(){window.print()}
function clearFilters(){search.value='';companyId.value='';customerId.value='';status.value='';dueFrom.value='';dueTo.value=''}
onMounted(load)
</script>

<template>
  <PageHeader title="Relatórios financeiros" subtitle="Carteira analítica com filtros por empresa, cliente, situação e vencimento; impressão e exportação em PDF, Excel e CSV.">
    <button class="btn-secondary no-print" :disabled="loading" @click="load"><RefreshCw :size="18" :class="loading?'animate-spin':''"/>Atualizar</button>
    <button class="btn-secondary no-print" @click="printReport"><Printer :size="18"/>Imprimir</button>
    <button class="btn-secondary no-print" :disabled="Boolean(exporting)" @click="exportReport('PDF')"><FileDown :size="18"/>{{exporting==='PDF'?'Gerando…':'PDF'}}</button>
    <button class="btn-primary no-print" :disabled="Boolean(exporting)" @click="exportReport('XLSX')"><FileSpreadsheet :size="18"/>{{exporting==='XLSX'?'Gerando…':'Excel'}}</button>
  </PageHeader>
  <InlineAlert :message="error" class="no-print" @dismiss="error=''"/><InlineAlert :message="success" type="success" class="no-print" @dismiss="success=''"/>

  <section class="report-filters no-print mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
    <div class="grid gap-3 xl:grid-cols-[minmax(0,1.3fr)_1fr_1fr_1fr]">
      <div class="relative"><Search :size="18" class="absolute left-3.5 top-3 text-slate-400"/><input v-model="search" class="input pl-10" placeholder="Documento, descrição, empresa, cliente ou competência..."/></div>
      <SearchSelect v-model="companyId" :options="companyOptions" search-placeholder="Pesquisar empresa…"/>
      <SearchSelect v-model="customerId" :options="customerOptions" search-placeholder="Pesquisar cliente…"/>
      <SearchSelect v-model="status" :options="statusOptions"/>
    </div>
    <div class="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto]"><div><label class="label">Vencimento de</label><input v-model="dueFrom" type="date" class="input"/></div><div><label class="label">Vencimento até</label><input v-model="dueTo" type="date" class="input"/></div><button class="btn-secondary self-end" @click="clearFilters">Limpar filtros</button><button class="btn-secondary self-end" :disabled="Boolean(exporting)" @click="exportReport('CSV')"><Download :size="17"/>CSV</button></div>
  </section>

  <section id="printable-report">
    <div class="print-title hidden"><h1>Relatório financeiro</h1><p>Emitido em {{new Date().toLocaleString('pt-BR')}} · {{filteredReceivables.length}} registro(s)</p></div>
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Em aberto" :value="money(reportSummary.open)" :hint="`${reportSummary.count} títulos no filtro`" :icon="CircleDollarSign" tone="blue"/><StatCard label="Vencido" :value="money(reportSummary.overdue)" :icon="AlertTriangle" tone="rose"/><StatCard label="Recebido" :value="money(reportSummary.paid)" :icon="HandCoins" tone="teal"/><StatCard label="Clientes" :value="reportSummary.customers" :icon="Banknote" tone="amber"/></div>

    <div class="mt-6 grid gap-6 xl:grid-cols-2">
      <section class="card">
        <h2 class="font-bold">Carteira por situação</h2>
        <div class="mt-4 space-y-3">
          <div v-for="[currentStatus,group] in byStatus" :key="currentStatus" class="flex items-center gap-3 rounded-xl border border-slate-100 p-3">
            <div class="min-w-[110px]"><StatusBadge :status="currentStatus"/></div>
            <div class="flex-1"><div class="h-2 overflow-hidden rounded-full bg-slate-100"><div class="h-full rounded-full bg-teal-500" :style="{width:`${Math.min(100,(group.amount/Math.max(1,reportSummary.open+reportSummary.overdue))*100)}%`}"/></div></div>
            <div class="text-right"><p class="font-bold">{{money(group.amount)}}</p><p class="text-xs text-slate-400">{{group.count}} títulos</p></div>
          </div>
          <p v-if="!byStatus.length" class="py-8 text-center text-sm text-slate-400">Nenhum título com os filtros informados.</p>
        </div>
      </section>
      <section class="card"><h2 class="font-bold">Pagamentos relacionados</h2><div class="mt-4 divide-y divide-slate-100"><div v-for="item in reportPayments" :key="item.id" class="flex items-center gap-3 py-3"><div class="rounded-xl bg-emerald-50 p-2 text-emerald-700"><HandCoins :size="18"/></div><div class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">{{item.external_id||'Pagamento registrado'}}</p><p class="text-xs text-slate-400">{{new Date(item.paid_at).toLocaleString('pt-BR')}} · {{paymentMethodLabel(item.payment_method)}}</p></div><strong class="text-emerald-700">{{money(item.amount)}}</strong></div><p v-if="!reportPayments.length" class="py-10 text-center text-sm text-slate-400">Nenhum pagamento relacionado aos títulos filtrados.</p></div></section>
    </div>

    <section class="card mt-6 overflow-hidden !p-0"><div class="border-b border-slate-200 px-5 py-4"><h2 class="font-bold">Carteira detalhada</h2><p class="text-sm text-slate-500">{{filteredReceivables.length}} registro(s)</p></div><div class="overflow-auto"><table class="table min-w-[1100px]"><thead><tr><th>Documento</th><th>Empresa</th><th>Cliente</th><th>Descrição</th><th>Vencimento</th><th>Original</th><th>Pago</th><th>Saldo</th><th>Situação</th></tr></thead><tbody><tr v-for="item in filteredReceivables" :key="item.id"><td class="font-semibold">{{item.document_number}}</td><td>{{companyName(item.company_id)}}</td><td>{{customerName(item.customer_id)}}</td><td>{{item.description}}</td><td>{{dateBR(item.due_date)}}</td><td>{{money(item.original_amount)}}</td><td>{{money(item.paid_amount)}}</td><td class="font-semibold">{{money(item.balance)}}</td><td><StatusBadge :status="item.status"/></td></tr><tr v-if="!filteredReceivables.length"><td colspan="9" class="py-12 text-center text-slate-400">Nenhum título encontrado.</td></tr></tbody></table></div></section>
  </section>
</template>

<style scoped>
@media print {
  :global(body){background:#fff!important;color:#000!important}
  :global(aside),:global(header),:global(nav),.no-print{display:none!important}
  :global(main){margin:0!important;padding:0!important;width:100%!important}
  .print-title{display:block!important;margin-bottom:16px}
  .print-title h1{font-size:20px;font-weight:700}.print-title p{font-size:11px;color:#475569}
  #printable-report{font-size:10px}
  #printable-report :deep(.card){box-shadow:none!important;break-inside:avoid;border:1px solid #cbd5e1!important}
  table{min-width:0!important;width:100%!important;font-size:8px}th,td{padding:5px!important}
}
</style>
