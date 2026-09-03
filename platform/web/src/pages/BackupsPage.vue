<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { DatabaseBackup, Download, HardDrive, Play, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse } from '../types'
import PageHeader from '../components/PageHeader.vue'
import ModalDialog from '../components/ModalDialog.vue'
import StatusBadge from '../components/StatusBadge.vue'
import InlineAlert from '../components/InlineAlert.vue'
import { formatBytes } from '../utils/format'

interface BackupRun { id:string; scope:string; tenant_id?:string; status:string; path?:string; checksum?:string; size_bytes?:number; manifest:Record<string,unknown>; destinations:Record<string,unknown>; started_at?:string; finished_at?:string; last_error?:string; created_at:string; download_url?:string }
interface RestoreRun { id:string; backup_run_id?:string; scope:string; tenant_id?:string; status:string; source_path:string; validation:Record<string,unknown>; started_at?:string; finished_at?:string; last_error?:string; created_at:string }
interface BackupPolicy { enabled:boolean; cron:string; retention:{daily:number;weekly:number;monthly:number}; encryption_enabled:boolean; destinations:Record<string,boolean> }

const backups=ref<BackupRun[]>([])
const restores=ref<RestoreRun[]>([])
const policy=ref<BackupPolicy|null>(null)
const error=ref('')
const message=ref('')
const loading=ref(false)
const runningBackup=ref(false)
const restoreModal=ref(false)
const restoreForm=reactive({backup_run_id:'',source_path:'',scope:'FULL',tenant_id:'',validate_only:true})
const validBackups=computed(()=>backups.value.filter(item=>item.status==='SUCCEEDED').length)
let timer:number|undefined

const scopeLabel=(scope?:string)=>({FULL:'Completo',TENANT:'Cliente específico',PLATFORM:'Plataforma'} as Record<string,string>)[String(scope||'').toUpperCase()]||String(scope||'—')
const destinationLabel=(value:string)=>({local:'Local',s3:'S3',google_drive:'Google Drive',dropbox:'Dropbox'} as Record<string,string>)[value.toLowerCase()]||value

async function load(silent=false){
  if(!silent)loading.value=true
  if(!silent)error.value=''
  try{
    const [a,b,c]=await Promise.all([
      api.get<ApiResponse<BackupRun[]>>('/control/v1/backups'),
      api.get<ApiResponse<RestoreRun[]>>('/control/v1/restore-runs'),
      api.get<ApiResponse<BackupPolicy>>('/control/v1/backup-policy'),
    ])
    backups.value=a.data.data;restores.value=b.data.data;policy.value=c.data.data
  }catch(e){if(!silent)error.value=apiError(e)}finally{if(!silent)loading.value=false}
}
async function waitForNewBackup(previousIds:Set<string>){
  for(let attempt=0;attempt<20;attempt++){
    await new Promise(resolve=>window.setTimeout(resolve,1000))
    await load(true)
    const created=backups.value.find(item=>!previousIds.has(item.id))
    if(created&&['SUCCEEDED','FAILED'].includes(created.status))return
    if(created)message.value='Backup em execução. A grade será atualizada automaticamente.'
  }
}
async function runBackup(){
  if(runningBackup.value)return
  runningBackup.value=true;error.value='';message.value=''
  const previousIds=new Set(backups.value.map(item=>item.id))
  try{
    const r=await api.post<ApiResponse<{task_id:string}>>('/control/v1/backups')
    message.value=`Backup solicitado com sucesso. Tarefa ${r.data.data.task_id}. Acompanhando a execução…`
    await waitForNewBackup(previousIds)
  }catch(e){error.value=apiError(e)}finally{runningBackup.value=false;await load(true)}
}
function openRestore(item?:BackupRun){
  Object.assign(restoreForm,{backup_run_id:item?.id||'',source_path:item?.path||'',scope:item?.tenant_id?'TENANT':'FULL',tenant_id:item?.tenant_id||'',validate_only:true})
  restoreModal.value=true
}
async function requestRestore(){
  error.value=''
  try{
    const payload={backup_run_id:restoreForm.backup_run_id||null,source_path:restoreForm.source_path||null,scope:restoreForm.scope,tenant_id:restoreForm.tenant_id||null,validate_only:restoreForm.validate_only}
    const r=await api.post<ApiResponse<{id:string;status:string}>>('/control/v1/restore-runs',payload)
    restoreModal.value=false;message.value=`Restauração solicitada: ${r.data.data.id}.`;await load()
  }catch(e){error.value=apiError(e)}
}
onMounted(async()=>{await load();timer=window.setInterval(()=>void load(true),10000)})
onBeforeUnmount(()=>{if(timer)window.clearInterval(timer)})
</script>

<template>
  <PageHeader title="Backup e recuperação" subtitle="Cópias de segurança, integridade, retenção e recuperação dos dados da plataforma.">
    <button class="btn-secondary" :disabled="loading" @click="load()"><RefreshCw :size="18" :class="loading&&'animate-spin'"/>Atualizar</button>
    <button class="btn-primary" :disabled="runningBackup" @click="runBackup"><Play :size="18"/>{{runningBackup?'Acompanhando…':'Executar backup'}}</button>
  </PageHeader>
  <InlineAlert v-if="error" tone="error" :message="error" class="mb-5"/>
  <InlineAlert v-if="message" tone="success" :message="message" class="mb-5"/>

  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <div class="card"><p class="text-xs uppercase text-slate-400">Backups válidos</p><p class="mt-2 text-2xl font-bold">{{validBackups}}</p></div>
    <div class="card"><p class="text-xs uppercase text-slate-400">Agenda</p><p class="mt-2 font-bold">{{policy?.cron||'Desabilitada'}}</p></div>
    <div class="card"><p class="text-xs uppercase text-slate-400">Retenção</p><p class="mt-2 text-sm font-semibold">{{policy?.retention.daily||0}} diários · {{policy?.retention.weekly||0}} semanais · {{policy?.retention.monthly||0}} mensais</p></div>
    <div class="card"><p class="text-xs uppercase text-slate-400">Criptografia</p><p class="mt-2 font-bold">{{policy?.encryption_enabled?'Ativa':'Não configurada'}}</p></div>
  </div>

  <section class="mt-7">
    <div class="mb-4 flex items-center gap-2"><DatabaseBackup :size="21" class="text-teal-700"/><h2 class="text-lg font-semibold">Execuções</h2></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Execução</th><th>Escopo</th><th>Tamanho / checksum</th><th>Destinos</th><th>Estado</th><th></th></tr></thead><tbody>
      <tr v-for="item in backups" :key="item.id">
        <td><p class="font-semibold">{{new Date(item.created_at).toLocaleString('pt-BR')}}</p><p class="max-w-xs truncate text-xs text-slate-400">{{item.path||item.id}}</p></td>
        <td>{{scopeLabel(item.scope)}}<p v-if="item.tenant_id" class="text-xs text-slate-400">{{item.tenant_id}}</p></td>
        <td><p>{{formatBytes(item.size_bytes||0)}}</p><p class="max-w-[230px] truncate font-mono text-[10px] text-slate-400">{{item.checksum||'—'}}</p></td>
        <td><div class="flex max-w-xs flex-wrap gap-1"><span v-for="(_,key) in item.destinations||{}" :key="String(key)" class="badge bg-slate-100 text-slate-700">{{destinationLabel(String(key))}}</span></div></td>
        <td><StatusBadge :status="item.status"/><p v-if="item.last_error" class="mt-1 max-w-xs text-xs text-rose-600">{{item.last_error}}</p></td>
        <td><div class="flex gap-2"><a v-if="item.download_url" :href="item.download_url" class="btn-secondary !px-3 !py-2"><Download :size="15"/></a><button class="btn-secondary !px-3 !py-2" :disabled="item.status!=='SUCCEEDED'" @click="openRestore(item)"><RotateCcw :size="15"/>Restaurar</button></div></td>
      </tr>
      <tr v-if="!backups.length"><td colspan="6" class="py-12 text-center text-slate-400">Nenhuma execução registrada.</td></tr>
    </tbody></table></div>
  </section>

  <section class="mt-7">
    <div class="mb-4 flex items-center gap-2"><ShieldCheck :size="21" class="text-teal-700"/><h2 class="text-lg font-semibold">Solicitações de restauração</h2></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Solicitação</th><th>Escopo</th><th>Validação</th><th>Estado</th><th>Erro</th></tr></thead><tbody>
      <tr v-for="item in restores" :key="item.id"><td>{{new Date(item.created_at).toLocaleString('pt-BR')}}<p class="font-mono text-[10px] text-slate-400">{{item.id}}</p></td><td>{{scopeLabel(item.scope)}}<p class="text-xs text-slate-400">{{item.tenant_id||'Plataforma inteira'}}</p></td><td><pre class="max-w-sm whitespace-pre-wrap text-[10px]">{{JSON.stringify(item.validation||{},null,2)}}</pre></td><td><StatusBadge :status="item.status"/></td><td class="text-xs text-rose-600">{{item.last_error||'—'}}</td></tr>
      <tr v-if="!restores.length"><td colspan="5" class="py-12 text-center text-slate-400">Nenhuma restauração solicitada.</td></tr>
    </tbody></table></div>
  </section>

  <ModalDialog :open="restoreModal" title="Solicitar restauração" size="lg" @close="restoreModal=false">
    <form class="space-y-4" @submit.prevent="requestRestore">
      <div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"><strong>Operação crítica.</strong> A execução real exige modo de manutenção. Use primeiro a validação sem aplicar.</div>
      <div><label class="label">Backup</label><select v-model="restoreForm.backup_run_id" class="select"><option value="">Selecionar por caminho</option><option v-for="item in backups.filter(v=>v.status==='SUCCEEDED')" :key="item.id" :value="item.id">{{new Date(item.created_at).toLocaleString('pt-BR')}} · {{scopeLabel(item.scope)}}</option></select></div>
      <div><label class="label">Caminho alternativo</label><input v-model="restoreForm.source_path" class="input"/></div>
      <div class="grid gap-4 md:grid-cols-2"><div><label class="label">Escopo</label><select v-model="restoreForm.scope" class="select"><option value="FULL">Completo</option><option value="TENANT">Cliente específico</option></select></div><div><label class="label">Identificador do cliente</label><input v-model="restoreForm.tenant_id" class="input" :disabled="restoreForm.scope!=='TENANT'"/></div></div>
      <label class="flex items-center gap-2 text-sm"><input v-model="restoreForm.validate_only" type="checkbox"/>Apenas validar integridade e compatibilidade</label>
      <div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="restoreModal=false">Cancelar</button><button class="btn-primary"><HardDrive :size="18"/>Solicitar</button></div>
    </form>
  </ModalDialog>
</template>
