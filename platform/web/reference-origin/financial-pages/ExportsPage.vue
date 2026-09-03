<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Download, FileSpreadsheet, Plus, RefreshCw } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse } from '../types'
import PageHeader from '../components/PageHeader.vue'
import DrawerPanel from '../components/DrawerPanel.vue'
import InlineAlert from '../components/InlineAlert.vue'
import JsonEditor from '../components/JsonEditor.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'

interface ExportJob{id:string;export_type:string;status:string;format:string;filters:Record<string,unknown>;size_bytes?:number;sha256?:string;created_at:string;finished_at?:string;last_error?:string;download_url?:string}
const items=ref<ExportJob[]>([])
const drawer=ref(false)
const error=ref('')
const success=ref('')
const busy=ref('')
const form=reactive({export_type:'RECEIVABLES',format:'XLSX',filters:'{}'})
const size=(v?:number)=>v?`${(v/1024).toFixed(1)} KB`:'—'
const typeLabels:Record<string,string>={RECEIVABLES:'Contas a receber',PAYMENTS:'Pagamentos',CUSTOMERS:'Clientes',CONTRACTS:'Contratos',CHARGES:'Cobranças',CNAB_EVENTS:'Eventos CNAB',AUDIT:'Auditoria'}
const typeLabel=(value:string)=>typeLabels[value]||value.replaceAll('_',' ')

async function load(){error.value='';try{items.value=(await api.get<ApiResponse<ExportJob[]>>('/v1/exports')).data.data}catch(e){error.value=apiError(e)}}
function filename(disposition:unknown,fallback:string){const value=String(disposition||'');const match=value.match(/filename="?([^";]+)"?/i);return match?.[1]||fallback}
function save(blob:Blob,name:string){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
async function download(item:ExportJob){busy.value=item.id;error.value='';try{const response=await api.get(`/v1/exports/${item.id}/download`,{responseType:'blob'});save(response.data,filename(response.headers['content-disposition'],`exportacao-${item.id}.${item.format.toLowerCase()}`))}catch(e){error.value=apiError(e)}finally{busy.value=''}}
async function create(){error.value='';try{const created=(await api.post<ApiResponse<ExportJob>>('/v1/exports',{export_type:form.export_type,format:form.format,filters:JSON.parse(form.filters)})).data.data;drawer.value=false;success.value='Exportação concluída.';await load();const item=items.value.find(current=>current.id===created.id)||created;if(item.status==='COMPLETED')await download(item)}catch(e){error.value=apiError(e)}}
onMounted(load)
</script>

<template>
  <PageHeader title="Exportações" subtitle="Relatórios de dados em Excel e CSV armazenados no namespace privado do cliente."><button class="btn-secondary" @click="load"><RefreshCw :size="18"/>Atualizar</button><button class="btn-primary" @click="drawer=true"><Plus :size="18"/>Nova exportação</button></PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>
  <div class="table-wrap"><table class="table"><thead><tr><th>Exportação</th><th>Formato</th><th>Filtros</th><th>Tamanho</th><th>Situação</th><th></th></tr></thead><tbody>
    <tr v-for="item in items" :key="item.id" class="border-t border-slate-100"><td><div class="flex items-center gap-2"><FileSpreadsheet :size="17" class="text-emerald-600"/><div><p class="font-semibold">{{typeLabel(item.export_type)}}</p><p class="text-xs text-slate-400">{{new Date(item.created_at).toLocaleString('pt-BR')}}</p></div></div></td><td>{{item.format==='XLSX'?'Excel':item.format}}</td><td><pre class="max-w-md truncate text-xs">{{JSON.stringify(item.filters)}}</pre></td><td>{{size(item.size_bytes)}}<p v-if="item.sha256" class="font-mono text-xs text-slate-400">{{item.sha256.slice(0,12)}}…</p></td><td><StatusBadge :status="item.status"/><p v-if="item.last_error" class="text-xs text-rose-600">{{item.last_error}}</p></td><td class="text-right"><button v-if="item.status==='COMPLETED'" class="btn-secondary px-3 py-2" :disabled="busy===item.id" @click="download(item)"><Download :size="16"/>{{busy===item.id?'Baixando…':'Baixar'}}</button></td></tr>
  </tbody></table><EmptyState v-if="!items.length" title="Nenhuma exportação"/></div>
  <DrawerPanel :open="drawer" title="Nova exportação" width="lg" @close="drawer=false"><form class="space-y-4" @submit.prevent="create"><div class="grid gap-4 sm:grid-cols-2"><div><label class="label">Tipo</label><select v-model="form.export_type" class="select"><option value="RECEIVABLES">Contas a receber</option><option value="PAYMENTS">Pagamentos</option><option value="CUSTOMERS">Clientes</option><option value="CONTRACTS">Contratos</option><option value="CHARGES">Cobranças</option><option value="CNAB_EVENTS">Eventos CNAB</option><option value="AUDIT">Auditoria</option></select></div><div><label class="label">Formato</label><select v-model="form.format" class="select"><option value="XLSX">Excel</option><option value="CSV">CSV</option></select></div></div><JsonEditor v-model="form.filters" label="Filtros avançados (JSON)"/><div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="drawer=false">Cancelar</button><button class="btn-primary">Gerar</button></div></form></DrawerPanel>
</template>
