<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ExternalLink, Plus, RefreshCw, ShieldOff } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { fetchAllPages } from '../api/pagination'
import type { ApiResponse, Customer, Receivable } from '../types'
import PageHeader from '../components/PageHeader.vue'
import DrawerPanel from '../components/DrawerPanel.vue'
import InlineAlert from '../components/InlineAlert.vue'
import KeyReveal from '../components/KeyReveal.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'

interface Link{id:string;receivable_id:string;token_prefix:string;expires_at?:string;max_views?:number;view_count:number;last_viewed_at?:string;is_active:boolean;created_at:string}
const items=ref<Link[]>([]),receivables=ref<Receivable[]>([]),customers=ref<Customer[]>([]),drawer=ref(false),error=ref(''),success=ref(''),reveal=ref('')
const form=reactive({customer_id:'',receivable_id:'',expires_at:'',max_views:''})
const money=(v:string)=>Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const customer=(id:string)=>customers.value.find(item=>item.id===id)
const receivable=(id:string)=>receivables.value.find(item=>item.id===id)
const eligibleReceivables=computed(()=>receivables.value.filter(item=>!['PAID','CANCELLED','REVERSED'].includes(item.status)&&Number(item.balance)>0))
const customerOptions=computed<SearchSelectOption[]>(()=>[...new Set(eligibleReceivables.value.map(item=>item.customer_id))].map(id=>{const item=customer(id);return{value:id,label:item?.name||'Cliente',description:item?.tax_id||item?.trade_name||'',keywords:`${item?.name||''} ${item?.trade_name||''} ${item?.tax_id||''} ${item?.email||''} ${item?.whatsapp||''}`}}))
const receivableOptions=computed<SearchSelectOption[]>(()=>eligibleReceivables.value.filter(item=>!form.customer_id||item.customer_id===form.customer_id).map(item=>{const owner=customer(item.customer_id);return{value:item.id,label:`${owner?.name||'Cliente'} · ${money(item.balance)}`,description:`${item.document_number} · vence ${new Date(item.due_date+'T00:00:00').toLocaleDateString('pt-BR')}`,keywords:`${owner?.name||''} ${owner?.tax_id||''} ${item.document_number} ${item.description} ${item.balance}`}}))

async function load(){error.value='';try{const [l,r,c]=await Promise.all([api.get<ApiResponse<Link[]>>('/v1/payment-links'),fetchAllPages<Receivable>('/v1/receivables'),fetchAllPages<Customer>('/v1/customers')]);items.value=l.data.data;receivables.value=r;customers.value=c}catch(e){error.value=apiError(e)}}
function open(){const first=eligibleReceivables.value[0];form.customer_id=first?.customer_id||'';form.receivable_id=first?.id||'';form.expires_at='';form.max_views='';drawer.value=true}
async function create(){try{const r=(await api.post<ApiResponse<{url:string}>>('/v1/payment-links',{receivable_id:form.receivable_id,expires_at:form.expires_at||null,max_views:form.max_views?Number(form.max_views):null})).data.data;drawer.value=false;reveal.value=r.url;success.value='Link criado com sucesso.';await load()}catch(e){error.value=apiError(e)}}
async function deactivate(item:Link){if(!confirm('Desativar este link?'))return;try{await api.delete(`/v1/payment-links/${item.id}`);success.value='Link desativado.';await load()}catch(e){error.value=apiError(e)}}
watch(()=>form.customer_id,()=>{if(form.receivable_id&&!receivableOptions.value.some(option=>option.value===form.receivable_id))form.receivable_id=receivableOptions.value[0]?.value||''})
watch(()=>form.receivable_id,(id)=>{const item=receivable(id);if(item)form.customer_id=item.customer_id})
onMounted(load)
</script>
<template>
<PageHeader title="Links de pagamento" subtitle="Portal público para segunda via, boleto e Pix sem exigir login do pagador."><button class="btn-secondary" @click="load"><RefreshCw :size="18"/>Atualizar</button><button class="btn-primary" @click="open"><Plus :size="18"/>Novo link</button></PageHeader>
<InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>
<div class="table-wrap"><table class="table"><thead><tr><th>Cliente / título</th><th>Referência</th><th>Acessos</th><th>Expiração</th><th>Status</th><th></th></tr></thead><tbody><tr v-for="item in items" :key="item.id" class="border-t border-slate-100"><td><p class="font-semibold">{{customer(receivable(item.receivable_id)?.customer_id||'')?.name||'Cliente'}}</p><p class="text-xs text-slate-400">{{receivable(item.receivable_id)?.document_number||item.receivable_id}} · {{receivable(item.receivable_id)?money(receivable(item.receivable_id)!.balance):''}}</p></td><td class="font-mono text-xs">{{item.token_prefix}}…</td><td>{{item.view_count}} / {{item.max_views||'∞'}}<p class="text-xs text-slate-400">{{item.last_viewed_at?new Date(item.last_viewed_at).toLocaleString('pt-BR'):'Nunca acessado'}}</p></td><td>{{item.expires_at?new Date(item.expires_at).toLocaleString('pt-BR'):'Sem expiração'}}</td><td><StatusBadge :status="item.is_active?'ACTIVE':'INACTIVE'"/></td><td><div class="flex justify-end gap-1"><button class="btn-secondary px-3 py-2" disabled title="Por segurança, o token completo só é exibido na criação"><ExternalLink :size="16"/></button><button v-if="item.is_active" class="btn-secondary px-3 py-2 text-rose-600" @click="deactivate(item)"><ShieldOff :size="16"/></button></div></td></tr></tbody></table><EmptyState v-if="!items.length" title="Nenhum link público"/></div>
<DrawerPanel :open="drawer" title="Novo link de pagamento" width="lg" @close="drawer=false"><form class="space-y-4" @submit.prevent="create"><div><label class="label">Cliente</label><SearchSelect v-model="form.customer_id" :options="customerOptions" placeholder="Pesquisar cliente" search-placeholder="Nome, CNPJ/CPF, e-mail ou WhatsApp…"/></div><div><label class="label">Conta a receber</label><SearchSelect v-model="form.receivable_id" :options="receivableOptions" placeholder="Selecione o título" search-placeholder="Documento, descrição ou valor…"/></div><div class="grid gap-4 sm:grid-cols-2"><div><label class="label">Expiração</label><input v-model="form.expires_at" type="datetime-local" class="input"/></div><div><label class="label">Máximo de acessos</label><input v-model="form.max_views" type="number" min="1" class="input" placeholder="Ilimitado"/></div></div><div class="rounded-xl bg-sky-50 p-3 text-xs text-sky-800">O link completo será exibido uma única vez. O portal público mascara dados sensíveis do pagador.</div><div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="drawer=false">Cancelar</button><button class="btn-primary" :disabled="!form.receivable_id">Criar link</button></div></form></DrawerPanel>
<KeyReveal :open="!!reveal" :value="reveal" title="Link de pagamento criado" description="Copie e envie ao cliente. O endereço completo não poderá ser recuperado depois." @close="reveal=''"/>
</template>
