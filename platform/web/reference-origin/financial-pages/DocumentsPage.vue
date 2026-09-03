<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Download, Eye, FileSpreadsheet, FileText, Plus, Printer, RefreshCw } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse } from '../types'
import PageHeader from '../components/PageHeader.vue'
import SectionTabs from '../components/SectionTabs.vue'
import DrawerPanel from '../components/DrawerPanel.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import { dateTimeBR, formatBytes } from '../utils/format'
import { statusLabel } from '../utils/labels'

interface DocumentItem { id:string;company_id?:string;entity_type:string;entity_id?:string;document_type:string;filename:string;mime_type:string;size_bytes:number;sha256:string;version:number;created_at:string;download_url:string }
interface ExportJob { id:string;export_type:string;status:string;format:string;filters:Record<string,unknown>;size_bytes?:number;sha256?:string;created_at:string;finished_at?:string;last_error?:string;download_url?:string }
const tab=ref('documents');const documents=ref<DocumentItem[]>([]);const exports=ref<ExportJob[]>([]);const drawer=ref(false);const error=ref('');const success=ref('');const type=ref('');const busy=ref('');const form=reactive({export_type:'RECEIVABLES',format:'XLSX',filters:'{}'})

const entityLabels:Record<string,string>={Charge:'Cobrança',Payment:'Pagamento',Receipt:'Recibo',FiscalDocument:'Documento fiscal',CNABRemittance:'Remessa CNAB',CNABReturn:'Retorno CNAB',Receivable:'Conta a receber'}
const documentLabels:Record<string,string>={RECEIPT_PDF:'Recibo (PDF)',NFSE_PDF:'NFS-e (PDF)',NFSE_XML:'NFS-e (XML)',PAYMENT_PROOF:'Comprovante de pagamento',BOLETO_PDF:'Boleto (PDF)',CNAB_REM:'Remessa CNAB',CNAB_RET:'Retorno CNAB'}
const exportLabels:Record<string,string>={RECEIVABLES:'Contas a receber',PAYMENTS:'Pagamentos',CUSTOMERS:'Clientes',CONTRACTS:'Contratos',CHARGES:'Cobranças',AUDIT:'Auditoria'}
const formatLabels:Record<string,string>={PDF:'PDF',XLSX:'Excel',CSV:'CSV',JSON:'JSON'}

const entityLabel=(value:string)=>entityLabels[value]||value.replaceAll('_',' ')
const documentLabel=(value:string)=>documentLabels[value]||value.replaceAll('_',' ')
const exportLabel=(value:string)=>exportLabels[value]||value.replaceAll('_',' ')
const formatLabel=(value:string)=>formatLabels[value]||value

async function load(){error.value='';try{const [d,e]=await Promise.all([api.get<ApiResponse<DocumentItem[]>>('/v1/documents',{params:{entity_type:type.value||undefined}}),api.get<ApiResponse<ExportJob[]>>('/v1/exports')]);documents.value=d.data.data;exports.value=e.data.data}catch(exception){error.value=apiError(exception)}}

function blobFilename(disposition:unknown,fallback:string){const value=String(disposition||'');const utf=value.match(/filename\*=UTF-8''([^;]+)/i);if(utf?.[1]){try{return decodeURIComponent(utf[1])}catch{/* usa fallback */}}const normal=value.match(/filename="?([^";]+)"?/i);return normal?.[1]||fallback}
function saveBlob(blob:Blob,filename:string){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}

async function downloadDocument(item:DocumentItem){busy.value=`doc:${item.id}`;error.value='';try{const response=await api.get(`/v1/documents/${item.id}/download`,{responseType:'blob'});saveBlob(response.data,blobFilename(response.headers['content-disposition'],item.filename))}catch(exception){error.value=apiError(exception)}finally{busy.value=''}}
async function viewDocument(item:DocumentItem){busy.value=`view:${item.id}`;error.value='';try{const response=await api.get(`/v1/documents/${item.id}/download`,{params:{inline:true},responseType:'blob'});const url=URL.createObjectURL(response.data);window.open(url,'_blank','noopener,noreferrer');setTimeout(()=>URL.revokeObjectURL(url),120000)}catch(exception){error.value=apiError(exception)}finally{busy.value=''}}
async function printDocument(item:DocumentItem){busy.value=`print:${item.id}`;error.value='';try{const response=await api.get(`/v1/documents/${item.id}/download`,{params:{inline:true},responseType:'blob'});const url=URL.createObjectURL(response.data);const iframe=document.createElement('iframe');iframe.style.position='fixed';iframe.style.right='0';iframe.style.bottom='0';iframe.style.width='1px';iframe.style.height='1px';iframe.style.border='0';iframe.src=url;iframe.onload=()=>{setTimeout(()=>iframe.contentWindow?.print(),150);setTimeout(()=>{iframe.remove();URL.revokeObjectURL(url)},60000)};document.body.appendChild(iframe)}catch(exception){error.value=apiError(exception)}finally{busy.value=''}}
async function downloadExport(item:ExportJob){busy.value=`exp:${item.id}`;error.value='';try{const response=await api.get(`/v1/exports/${item.id}/download`,{responseType:'blob'});saveBlob(response.data,blobFilename(response.headers['content-disposition'],`exportacao-${item.id}.${item.format.toLowerCase()}`))}catch(exception){error.value=apiError(exception)}finally{busy.value=''}}

async function createExport(){error.value='';try{const response=await api.post<ApiResponse<{id:string;download_url?:string}>>('/v1/exports',{export_type:form.export_type,format:form.format,filters:JSON.parse(form.filters||'{}')});drawer.value=false;success.value='Exportação concluída.';await load();const created=exports.value.find(item=>item.id===response.data.data.id);if(created)await downloadExport(created)}catch(exception){error.value=apiError(exception)}}
onMounted(load)
</script>

<template>
  <PageHeader title="Documentos e exportações" subtitle="Arquivos financeiros imutáveis, versões, SHA-256 e relatórios sob demanda.">
    <button class="btn-secondary" @click="load"><RefreshCw :size="18"/>Atualizar</button>
    <button class="btn-primary" @click="drawer=true"><Plus :size="18"/>Nova exportação</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>
  <SectionTabs v-model="tab" :items="[{key:'documents',label:'Documentos',count:documents.length},{key:'exports',label:'Exportações',count:exports.length}]"/>

  <div v-if="tab==='documents'">
    <div class="mb-4 max-w-xs"><select v-model="type" class="select" @change="load"><option value="">Todos os tipos de entidade</option><option value="Charge">Cobrança</option><option value="Payment">Pagamento</option><option value="Receipt">Recibo</option><option value="FiscalDocument">Documento fiscal</option><option value="CNABRemittance">Remessa CNAB</option><option value="CNABReturn">Retorno CNAB</option></select></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Arquivo</th><th>Tipo / entidade</th><th>Versão</th><th>Tamanho</th><th>Integridade</th><th>Data</th><th class="text-right">Ações</th></tr></thead><tbody>
      <tr v-for="item in documents" :key="item.id"><td><p class="inline-flex items-center gap-2 font-semibold"><FileText :size="17" class="text-teal-700"/>{{item.filename}}</p><p class="text-xs text-slate-400">{{item.mime_type}}</p></td><td>{{documentLabel(item.document_type)}}<p class="text-xs text-slate-400">{{entityLabel(item.entity_type)}} · {{item.entity_id||'—'}}</p></td><td>v{{item.version}}</td><td>{{formatBytes(item.size_bytes)}}</td><td><p class="max-w-[220px] truncate font-mono text-[10px]">{{item.sha256}}</p></td><td>{{dateTimeBR(item.created_at)}}</td><td><div class="flex justify-end gap-1.5"><button v-if="item.mime_type==='application/pdf'" class="btn-secondary !px-3 !py-2" :disabled="Boolean(busy)" title="Visualizar" @click="viewDocument(item)"><Eye :size="15"/></button><button v-if="item.mime_type==='application/pdf'" class="btn-secondary !px-3 !py-2" :disabled="Boolean(busy)" title="Imprimir" @click="printDocument(item)"><Printer :size="15"/></button><button class="btn-secondary !px-3 !py-2" :disabled="Boolean(busy)" title="Baixar" @click="downloadDocument(item)"><Download :size="15"/></button></div></td></tr>
    </tbody></table><EmptyState v-if="!documents.length" title="Nenhum documento armazenado"/></div>
  </div>

  <div v-else class="table-wrap"><table class="table"><thead><tr><th>Exportação</th><th>Formato</th><th>Filtros</th><th>Tamanho / SHA</th><th>Situação</th><th>Data</th><th></th></tr></thead><tbody>
    <tr v-for="item in exports" :key="item.id"><td><p class="inline-flex items-center gap-2 font-semibold"><FileSpreadsheet :size="17" class="text-teal-700"/>{{exportLabel(item.export_type)}}</p></td><td>{{formatLabel(item.format)}}</td><td><pre class="max-w-sm whitespace-pre-wrap text-[10px]">{{JSON.stringify(item.filters,null,1)}}</pre></td><td>{{formatBytes(item.size_bytes||0)}}<p class="max-w-[220px] truncate font-mono text-[10px] text-slate-400">{{item.sha256||'—'}}</p></td><td><StatusBadge :status="item.status"/><p v-if="item.last_error" class="mt-1 text-xs text-rose-600">{{item.last_error}}</p></td><td>{{dateTimeBR(item.created_at)}}</td><td><button v-if="item.status==='COMPLETED'" class="btn-secondary !px-3 !py-2" :disabled="Boolean(busy)" title="Baixar exportação" @click="downloadExport(item)"><Download :size="15"/></button></td></tr>
  </tbody></table><EmptyState v-if="!exports.length" title="Nenhuma exportação solicitada"/></div>

  <DrawerPanel :open="drawer" title="Gerar exportação" width="lg" @close="drawer=false"><form class="space-y-4" @submit.prevent="createExport"><div class="grid gap-4 md:grid-cols-2"><div><label class="label">Tipo</label><select v-model="form.export_type" class="select"><option value="RECEIVABLES">Contas a receber</option><option value="PAYMENTS">Pagamentos</option><option value="CUSTOMERS">Clientes</option><option value="CONTRACTS">Contratos</option><option value="CHARGES">Cobranças</option><option value="AUDIT">Auditoria</option></select></div><div><label class="label">Formato</label><select v-model="form.format" class="select"><option value="XLSX">Excel</option><option value="CSV">CSV</option><option value="JSON">JSON</option></select></div></div><div><label class="label">Filtros avançados (JSON)</label><textarea v-model="form.filters" class="input min-h-40 font-mono text-xs"/></div><div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="drawer=false">Cancelar</button><button class="btn-primary">Gerar arquivo</button></div></form></DrawerPanel>
</template>
