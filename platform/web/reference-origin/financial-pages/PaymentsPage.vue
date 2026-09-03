<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Ban, Plus, RefreshCw } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { fetchAllPages } from '../api/pagination'
import type { ApiResponse, Customer, Payment, Receivable } from '../types'
import PageHeader from '../components/PageHeader.vue'
import DrawerPanel from '../components/DrawerPanel.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'

const items=ref<Payment[]>([]),receivables=ref<Receivable[]>([]),customers=ref<Customer[]>([]),drawer=ref(false),error=ref(''),success=ref('')
const form=reactive({customer_id:'',receivable_id:'',external_id:'',amount:'0',paid_at:new Date().toISOString().slice(0,16),payment_method:'TRANSFER',provider:'MANUAL'})
const money=(v:string)=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const customer=(id:string)=>customers.value.find(item=>item.id===id)
const receivable=(id:string)=>receivables.value.find(item=>item.id===id)
const eligibleReceivables=computed(()=>receivables.value.filter(item=>!['PAID','CANCELLED','REVERSED'].includes(item.status)&&Number(item.balance)>0))
const customerOptions=computed<SearchSelectOption[]>(()=>{
  const ids=[...new Set(eligibleReceivables.value.map(item=>item.customer_id))]
  return ids.map(id=>{const item=customer(id);return{value:id,label:item?.name||'Cliente',description:item?.tax_id||item?.trade_name||'',keywords:`${item?.name||''} ${item?.trade_name||''} ${item?.tax_id||''} ${item?.email||''} ${item?.whatsapp||''}`}})
})
const receivableOptions=computed<SearchSelectOption[]>(()=>eligibleReceivables.value.filter(item=>!form.customer_id||item.customer_id===form.customer_id).map(item=>{const owner=customer(item.customer_id);return{value:item.id,label:`${owner?.name||'Cliente'} · ${money(item.balance)}`,description:`${item.document_number} · vence ${new Date(item.due_date+'T00:00:00').toLocaleDateString('pt-BR')}`,keywords:`${item.document_number} ${owner?.name||''} ${owner?.tax_id||''} ${item.description} ${item.balance}`}}))
const paymentMethodOptions:SearchSelectOption[]=[
  {value:'TRANSFER',label:'Transferência'}, {value:'PIX',label:'Pix'}, {value:'CASH',label:'Dinheiro'},
  {value:'CARD',label:'Cartão'}, {value:'CNAB',label:'Retorno bancário'}, {value:'OTHER',label:'Outro'},
]

async function load(){error.value='';try{const [p,r,c]=await Promise.all([api.get<ApiResponse<Payment[]>>('/v1/payments'),fetchAllPages<Receivable>('/v1/receivables'),fetchAllPages<Customer>('/v1/customers')]);items.value=p.data.data;receivables.value=r;customers.value=c}catch(e){error.value=apiError(e)}}
function open(){const r=eligibleReceivables.value[0];Object.assign(form,{customer_id:r?.customer_id||'',receivable_id:r?.id||'',external_id:`MANUAL-${Date.now()}`,amount:r?.balance||'0',paid_at:new Date().toISOString().slice(0,16),payment_method:'TRANSFER',provider:'MANUAL'});drawer.value=true}
async function save(){error.value='';try{await api.post('/v1/payments',{receivable_id:form.receivable_id,external_id:form.external_id,amount:Number(form.amount),paid_at:new Date(form.paid_at).toISOString(),payment_method:form.payment_method,provider:'MANUAL'});drawer.value=false;success.value='Pagamento registrado.';await load()}catch(e){error.value=apiError(e)}}
async function reverse(item:Payment){const reason=prompt('Motivo do estorno:');if(!reason)return;try{await api.post(`/v1/payments/${item.id}/reverse`,{reason});success.value='Pagamento estornado.';await load()}catch(e){error.value=apiError(e)}}
watch(()=>form.customer_id,()=>{if(form.receivable_id&&!receivableOptions.value.some(option=>option.value===form.receivable_id))form.receivable_id=receivableOptions.value[0]?.value||''})
watch(()=>form.receivable_id,(id)=>{const item=receivable(id);if(item){form.customer_id=item.customer_id;form.amount=item.balance}})
onMounted(load)
</script>
<template>
<PageHeader title="Pagamentos" subtitle="Liquidações recebidas por Pix, CNAB, conciliação ou lançamento manual."><button class="btn-secondary" @click="load"><RefreshCw :size="18"/>Atualizar</button><button class="btn-primary" @click="open"><Plus :size="18"/>Registrar pagamento</button></PageHeader>
<InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>
<div class="table-wrap"><table class="table"><thead><tr><th>Data</th><th>Cliente / título</th><th>Origem</th><th>Identificador</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody><tr v-for="item in items" :key="item.id" class="border-t border-slate-100"><td>{{new Date(item.paid_at).toLocaleString('pt-BR')}}</td><td><p class="font-semibold">{{customer(receivable(item.receivable_id)?.customer_id||'')?.name||'Cliente'}}</p><RouterLink :to="`/receivables?id=${item.receivable_id}`" class="text-xs text-teal-700">{{receivable(item.receivable_id)?.document_number||'Ver título'}}</RouterLink></td><td>{{item.payment_method}}</td><td><p class="max-w-xs truncate text-xs">{{item.external_id}}</p><p v-if="item.end_to_end_id" class="max-w-xs truncate text-xs text-slate-400">E2E {{item.end_to_end_id}}</p></td><td class="font-bold">{{money(item.amount)}}</td><td><StatusBadge :status="item.status"/></td><td class="text-right"><button v-if="item.status==='CONFIRMED'" class="btn-secondary px-3 py-2 text-rose-600" @click="reverse(item)"><Ban :size="16"/>Estornar</button></td></tr></tbody></table><EmptyState v-if="!items.length" title="Nenhum pagamento registrado"/></div>
<DrawerPanel :open="drawer" title="Registrar pagamento manual" width="lg" @close="drawer=false"><form class="grid gap-4 md:grid-cols-2" @submit.prevent="save"><div class="md:col-span-2"><label class="label">Cliente</label><SearchSelect v-model="form.customer_id" :options="customerOptions" placeholder="Pesquisar cliente" search-placeholder="Nome, CNPJ/CPF, e-mail ou WhatsApp…"/></div><div class="md:col-span-2"><label class="label">Conta a receber</label><SearchSelect v-model="form.receivable_id" :options="receivableOptions" placeholder="Selecione o título" search-placeholder="Documento, descrição, cliente ou valor…"/></div><div><label class="label">Valor</label><input v-model="form.amount" type="number" step="0.01" min="0.01" class="input" required/></div><div><label class="label">Pago em</label><input v-model="form.paid_at" type="datetime-local" class="input" required/></div><div><label class="label">Método</label><SearchSelect v-model="form.payment_method" :options="paymentMethodOptions"/></div><div><label class="label">Identificação</label><input v-model="form.external_id" class="input" required/></div><div class="md:col-span-2 flex justify-end gap-2 border-t pt-4"><button type="button" class="btn-secondary" @click="drawer=false">Cancelar</button><button class="btn-primary" :disabled="!form.receivable_id">Registrar</button></div></form></DrawerPanel>
</template>
