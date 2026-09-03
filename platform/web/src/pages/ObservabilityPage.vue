<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Activity, Archive, BellRing, Database, Download, Eraser, Gauge, HardDrive,
  MessageSquare, Network, RefreshCw, Search, Server, ShieldCheck, Timer,
  TriangleAlert, Workflow
} from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse, Paginated, Tenant } from '../types'
import { useAuthStore } from '../stores/auth'
import { appConfirm, appPrompt } from '../composables/useAppDialog'
import PageHeader from '../components/PageHeader.vue'
import InlineAlert from '../components/InlineAlert.vue'
import PaginationBar from '../components/PaginationBar.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'
import SectionTabs from '../components/SectionTabs.vue'
import StatusBadge from '../components/StatusBadge.vue'
import { auditActionLabel, entityLabel, logLevelLabel, statusLabel } from '../utils/labels'

interface RuntimeLog {
  id:string
  tenant_id?:string|null
  actor_id?:string|null
  source:string
  service:string
  level:string
  event:string
  message:string
  request_id?:string|null
  correlation_id?:string|null
  method?:string|null
  path?:string|null
  status_code?:number|null
  duration_ms?:number|null
  details:Record<string,unknown>
  occurred_at:string
}
interface RuntimeSummary {
  period_hours:number
  levels:Record<string,number>
  services:Record<string,number>
  sources:Record<string,number>
  errors:number
  slow_requests:number
  events_24h:number
  warnings_24h:number
  audit_24h:number
  last_event_at?:string|null
  retention_days:number
  docker_available:boolean
  containers:{total:number;running:number;unhealthy:number;restarting:number;exited:number;oom_killed:number}
}
interface RuntimeService {
  id:string
  name:string
  service?:string|null
  image?:string
  state?:string
  status?:string
  health?:string|null
  restart_count:number
  started_at?:string|null
  finished_at?:string|null
  exit_code?:number|null
  oom_killed:boolean
  error?:string|null
}
interface AuditItem {
  id:string
  actor_id?:string
  actor_name?:string|null
  actor_email?:string|null
  tenant_id?:string
  tenant_name?:string|null
  tenant_slug?:string|null
  action:string
  entity_type:string
  entity_id?:string
  before?:Record<string,unknown>
  after?:Record<string,unknown>
  context?:Record<string,unknown>
  correlation_id?:string
  created_at:string
}
interface SourceDefinition {
  key:string
  label:string
  category:string
  icon:unknown
  matches:string[]
  structured:string[]
}
interface SourceCard extends SourceDefinition {
  related:RuntimeService[]
  events:number
  bad:number
  restarting:number
  available:boolean
  healthy:boolean
}

const auth=useAuthStore()
const tab=ref('center')
const logs=ref<RuntimeLog[]>([])
const summary=ref<RuntimeSummary|null>(null)
const services=ref<RuntimeService[]>([])
const tenants=ref<Tenant[]>([])
const audits=ref<AuditItem[]>([])
const error=ref('')
const success=ref('')
const loading=ref(false)
const page=ref(1)
const pages=ref(1)
const total=ref(0)
const auditPage=ref(1)
const auditPages=ref(1)
const auditTotal=ref(0)
const q=ref('')
const tenantId=ref('')
const level=ref('')
const source=ref('')
const service=ref('')
const selectedContainer=ref('')
const containerLines=ref<string[]>([])
const containerSearch=ref('')
const tail=ref('500')
const autoRefresh=ref(false)
const refreshSeconds=ref('10')
const auditAction=ref('')
let timer:number|undefined

const sourceDefinitions:SourceDefinition[]=[
  {key:'api',label:'Connect API',category:'Aplicação',icon:Server,matches:['connect-api'],structured:['connect-api','api']},
  {key:'workers',label:'Workers Connect|API',category:'Processamento',icon:Workflow,matches:['connect-worker-'],structured:['worker','notifications','events','webhooks','automations','connect']},
  {key:'beat',label:'Agendador de tarefas',category:'Processamento',icon:Timer,matches:['connect-beat'],structured:['scheduler','beat']},
  {key:'gateway',label:'Gateway web',category:'Web',icon:Network,matches:['connect-gateway','connect-web'],structured:['frontend','control-web','tenant-web']},
  {key:'postgres',label:'PostgreSQL',category:'Dados',icon:Database,matches:['connect-postgres'],structured:['database','postgres']},
  {key:'redis',label:'Redis',category:'Dados',icon:Database,matches:['connect-redis'],structured:['redis']},
  {key:'rabbitmq',label:'RabbitMQ',category:'Mensageria',icon:MessageSquare,matches:['connect-rabbitmq'],structured:['rabbitmq','queue']},
  {key:'storage',label:'MinIO / documentos',category:'Armazenamento',icon:HardDrive,matches:['connect-minio'],structured:['storage','s3','minio']},
  {key:'monitoring',label:'Monitoramento',category:'Infraestrutura',icon:Activity,matches:['connect-prometheus','connect-grafana','connect-log-agent','connect-docker-proxy'],structured:['observability','system']},
]

const isSuperadmin=computed(()=>auth.user?.role==='PLATFORM_SUPERADMIN')
const tenantOptions=computed<SearchSelectOption[]>(()=>[
  {value:'',label:'Toda a plataforma'},
  ...tenants.value.map(item=>({value:item.id,label:item.name,description:item.slug,keywords:`${item.name} ${item.slug} ${item.legal_document||''}`}))
])
const levelOptions:SearchSelectOption[]=[
  {value:'',label:'Todos os níveis'},
  {value:'CRITICAL',label:'Crítico'},
  {value:'ERROR',label:'Erro'},
  {value:'WARNING',label:'Aviso'},
  {value:'INFO',label:'Informação'},
  {value:'DEBUG',label:'Depuração'}
]
const sourceOptions:SearchSelectOption[]=[
  {value:'',label:'Todas as origens'},
  {value:'backend',label:'Backend / API'},
  {value:'frontend',label:'Navegador'},
  {value:'control',label:'Control Plane'},
  {value:'worker',label:'Workers / tarefas'},
  {value:'integration',label:'Integrações'},
  {value:'system',label:'Sistema'}
]
const refreshOptions:SearchSelectOption[]=[
  {value:'5',label:'A cada 5 segundos'},
  {value:'10',label:'A cada 10 segundos'},
  {value:'30',label:'A cada 30 segundos'},
  {value:'60',label:'A cada 1 minuto'},
]
const runtimeServiceOptions=computed<SearchSelectOption[]>(()=>[
  {value:'',label:'Todos os serviços'},
  ...Array.from(new Set([...Object.keys(summary.value?.services||{}),...logs.value.map(item=>item.service)])).sort().map(value=>({value,label:serviceLabel(value)}))
])
const containerOptions=computed<SearchSelectOption[]>(()=>services.value.map(item=>({
  value:item.id,
  label:serviceLabel(item.service||item.name),
  description:`${statusLabel(item.health||item.state)} · ${item.image||'imagem não informada'}`,
  keywords:`${item.name} ${item.service||''} ${item.image||''} ${item.status||''}`
})))
const tailOptions:SearchSelectOption[]=[100,250,500,1000,2500,5000].map(value=>({value:String(value),label:`Últimas ${value.toLocaleString('pt-BR')} linhas`}))
const selectedService=computed(()=>services.value.find(item=>item.id===selectedContainer.value)||null)
const tenantName=(id?:string|null)=>tenants.value.find(item=>item.id===id)?.name||id||'Plataforma'
const levelStatus=(value:string)=>['CRITICAL','ERROR'].includes(value)?'ERROR':value==='WARNING'?'PENDING':'ACTIVE'
const stateStatus=(item:RuntimeService)=>item.health==='unhealthy'||item.state==='exited'||item.oom_killed?'ERROR':item.state==='running'?'ACTIVE':'PENDING'
const nice=(key:string)=>key.replace(/[_-]/g,' ').replace(/\b\w/g,char=>char.toUpperCase())
const objectEntries=(value?:Record<string,unknown>)=>Object.entries(value||{})
const simpleValue=(value:unknown)=>{
  if(value===null||value===undefined||value==='')return'—'
  if(typeof value==='boolean')return value?'Sim':'Não'
  if(Array.isArray(value))return value.map(item=>typeof item==='object'?'objeto estruturado':String(item)).join(', ')
  if(typeof value==='object')return'Objeto estruturado'
  return String(value)
}
function serviceLabel(value?:string|null):string{
  const key=String(value||'').toLowerCase()
  const labels:Record<string,string>={
    'connect-api':'Connect API','connect-web':'Interface web','connect-gateway':'Gateway web',
    'connect-postgres':'PostgreSQL','connect-redis':'Redis','connect-rabbitmq':'RabbitMQ',
    'connect-minio':'MinIO','connect-minio-init':'Inicialização MinIO','connect-beat':'Agendador',
    'connect-worker-default':'Worker principal','connect-worker-events':'Worker de eventos',
    'connect-worker-notifications':'Worker de comunicação','connect-worker-backups':'Worker de backup',
    'connect-prometheus':'Prometheus','connect-grafana':'Grafana','connect-log-agent':'Agente de logs',
    'connect-docker-proxy':'Proxy Docker somente leitura','control-web':'Control Plane web','tenant-web':'Tenant web',
  }
  return labels[key]||String(value||'Serviço')
}
const sourceCards=computed<SourceCard[]>(()=>sourceDefinitions.map(def=>{
  const related=services.value.filter(item=>def.matches.some(match=>String(item.service||item.name).includes(match)))
  const events=Object.entries(summary.value?.services||{}).filter(([key])=>def.structured.some(match=>key.toLowerCase().includes(match))).reduce((acc,[,count])=>acc+Number(count),0)
  const bad=related.filter(item=>stateStatus(item)==='ERROR').length
  const restarting=related.filter(item=>item.state==='restarting').length
  return {...def,related,events,bad,restarting,available:related.length>0,healthy:related.length>0&&bad===0&&restarting===0}
}))
const recentImportant=computed(()=>logs.value.filter(item=>['CRITICAL','ERROR','WARNING'].includes(item.level)).slice(0,8))

async function loadTenants(){
  try{tenants.value=(await api.get<Paginated<Tenant>>('/control/v1/tenants',{params:{per_page:100}})).data.data}
  catch{/* a central continua funcional sem o nome do cliente */}
}
async function loadRuntime(){
  loading.value=true;error.value=''
  try{
    const [logResponse,summaryResponse,serviceResponse]=await Promise.all([
      api.get<Paginated<RuntimeLog>>('/control/v1/observability/logs',{params:{page:page.value,per_page:100,q:q.value||undefined,tenant_id:tenantId.value||undefined,level:level.value||undefined,source:source.value||undefined,service:service.value||undefined}}),
      api.get<ApiResponse<RuntimeSummary>>('/control/v1/observability/summary',{params:{tenant_id:tenantId.value||undefined}}),
      api.get<ApiResponse<RuntimeService[]>>('/control/v1/observability/services').catch(()=>null),
    ])
    logs.value=logResponse.data.data;pages.value=Math.max(logResponse.data.meta.pages,1);total.value=logResponse.data.meta.total
    summary.value=summaryResponse.data.data;services.value=serviceResponse?.data.data||[]
    if(!selectedContainer.value&&services.value.length)selectedContainer.value=services.value.find(item=>item.service==='connect-api')?.id||services.value[0].id
  }catch(exception){error.value=apiError(exception)}finally{loading.value=false}
}
async function loadAudit(){
  error.value=''
  try{
    const response=await api.get<Paginated<AuditItem>>('/control/v1/audit',{params:{page:auditPage.value,per_page:100,tenant_id:tenantId.value||undefined,action:auditAction.value||undefined}})
    audits.value=response.data.data;auditPages.value=Math.max(response.data.meta.pages,1);auditTotal.value=response.data.meta.total
  }catch(exception){error.value=apiError(exception)}
}
async function loadContainerLogs(){
  if(!selectedContainer.value){containerLines.value=[];return}
  error.value=''
  try{containerLines.value=(await api.get<ApiResponse<{lines:string[]}>>(`/control/v1/observability/services/${encodeURIComponent(selectedContainer.value)}/logs`,{params:{tail:Number(tail.value)||500,q:containerSearch.value||undefined}})).data.data.lines||[]}
  catch(exception){error.value=apiError(exception);containerLines.value=[]}
}
async function refresh(){
  if(tab.value==='audit')await loadAudit()
  else if(tab.value==='console'){await loadRuntime();await loadContainerLogs()}
  else await loadRuntime()
}
function applyFilters(){page.value=1;auditPage.value=1;void refresh()}
function setAutoRefresh(){
  if(timer)window.clearInterval(timer)
  timer=undefined
  if(autoRefresh.value)timer=window.setInterval(()=>void refresh(),Math.max(5,Number(refreshSeconds.value)||10)*1000)
}
function changeTab(value:string){tab.value=value;if(value==='console'&&!selectedContainer.value&&services.value.length)selectedContainer.value=services.value[0].id;void refresh()}
function openSource(card:SourceCard){
  if(card.related.length){selectedContainer.value=card.related[0].id;tab.value='console';void loadContainerLogs();return}
  const structured=Object.keys(summary.value?.services||{}).find(key=>card.structured.some(match=>key.toLowerCase().includes(match)))
  if(structured){service.value=structured;tab.value='runtime';page.value=1;void loadRuntime()}
}
async function downloadBlob(path:string,filenameFallback:string){
  error.value=''
  try{
    const response=await api.get(path,{params:{tenant_id:tenantId.value||undefined,level:level.value||undefined,source:source.value||undefined,service:service.value||undefined,q:q.value||undefined},responseType:'blob'})
    const disposition=String(response.headers['content-disposition']||'');const match=disposition.match(/filename="?([^";]+)"?/i);const filename=match?.[1]||filenameFallback
    const url=URL.createObjectURL(response.data);const anchor=document.createElement('a');anchor.href=url;anchor.download=filename;document.body.appendChild(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)
  }catch(exception){error.value=apiError(exception)}
}
async function purge(){
  if(!isSuperadmin.value)return
  const raw=await appPrompt({
    title:'Gerenciar retenção dos logs',
    message:'Defina quantos dias de logs operacionais devem permanecer. A auditoria imutável não será apagada.',
    inputLabel:'Dias de retenção',
    placeholder:'30',
    initialValue:String(summary.value?.retention_days||30),
    required:true,
    confirmLabel:'Continuar',
    cancelLabel:'Cancelar',
    tone:'warning',
  })
  if(!raw)return
  const retention=Number(raw)
  if(!Number.isInteger(retention)||retention<7){error.value='A retenção mínima é de 7 dias.';return}
  const confirmed=await appConfirm({
    title:'Aplicar retenção de logs',
    message:`Excluir logs operacionais anteriores a ${retention} dias? A trilha de auditoria será preservada integralmente e esta própria operação ficará auditada.`,
    confirmLabel:'Aplicar retenção',
    cancelLabel:'Cancelar',
    tone:'danger',
  })
  if(!confirmed)return
  try{const response=await api.post<ApiResponse<{removed:number}>>('/control/v1/observability/purge',{retention_days:retention});success.value=`${response.data.data.removed} registros operacionais removidos. A auditoria foi preservada.`;await loadRuntime()}
  catch(exception){error.value=apiError(exception)}
}

onMounted(async()=>{await loadTenants();await loadRuntime()})
onBeforeUnmount(()=>{if(timer)window.clearInterval(timer)})
</script>

<template>
  <PageHeader title="Central operacional e logs" subtitle="Saúde da plataforma, serviços Docker, eventos estruturados, console e auditoria em um único centro de controle.">
    <button class="btn-secondary" :disabled="loading" @click="refresh"><RefreshCw :size="18" :class="loading?'animate-spin':''"/>Atualizar</button>
    <button class="btn-secondary" @click="downloadBlob('/control/v1/observability/logs.csv','multitenant-app-logs.csv')"><Download :size="18"/>Exportar eventos</button>
    <button class="btn-primary" @click="downloadBlob('/control/v1/observability/export','multitenant-app-diagnostics.zip')"><Archive :size="18"/>Baixar diagnóstico</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>

  <section v-if="summary" class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    <div class="card"><div class="flex items-start justify-between"><div><p class="text-xs font-semibold uppercase text-slate-400">Eventos / 24h</p><p class="mt-2 text-2xl font-bold">{{summary.events_24h.toLocaleString('pt-BR')}}</p><p class="mt-1 text-xs text-slate-400">último: {{summary.last_event_at?new Date(summary.last_event_at).toLocaleTimeString('pt-BR'):'sem eventos'}}</p></div><Activity :size="22" class="text-blue-600"/></div></div>
    <div class="card"><div class="flex items-start justify-between"><div><p class="text-xs font-semibold uppercase text-slate-400">Erros / 24h</p><p class="mt-2 text-2xl font-bold" :class="summary.errors?'text-rose-700':'text-emerald-700'">{{summary.errors}}</p><p class="mt-1 text-xs text-slate-400">{{summary.warnings_24h}} avisos</p></div><TriangleAlert :size="22" class="text-rose-600"/></div></div>
    <div class="card"><div class="flex items-start justify-between"><div><p class="text-xs font-semibold uppercase text-slate-400">Stack</p><p class="mt-2 text-2xl font-bold">{{summary.containers.running}} / {{summary.containers.total}}</p><p class="mt-1 text-xs text-slate-400">serviços em execução</p></div><Server :size="22" class="text-teal-600"/></div></div>
    <div class="card"><div class="flex items-start justify-between"><div><p class="text-xs font-semibold uppercase text-slate-400">Auditoria / 24h</p><p class="mt-2 text-2xl font-bold">{{summary.audit_24h}}</p><p class="mt-1 text-xs text-slate-400">eventos imutáveis</p></div><ShieldCheck :size="22" class="text-violet-600"/></div></div>
    <div class="card"><div class="flex items-start justify-between"><div><p class="text-xs font-semibold uppercase text-slate-400">Retenção técnica</p><p class="mt-2 text-2xl font-bold">{{summary.retention_days}} dias</p><p class="mt-1 text-xs text-slate-400">auditoria não é apagada</p></div><HardDrive :size="22" class="text-amber-600"/></div></div>
  </section>

  <section class="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
    <div class="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_1fr_1fr_1fr_auto]"><div class="relative"><Search class="absolute left-3.5 top-3 text-slate-400" :size="18"/><input v-model="q" class="input pl-10" placeholder="Mensagem, erro, rota, request ID, correlação..." @keyup.enter="applyFilters"/></div><SearchSelect v-model="tenantId" :options="tenantOptions" @update:model-value="applyFilters"/><SearchSelect v-model="level" :options="levelOptions" @update:model-value="applyFilters"/><SearchSelect v-model="source" :options="sourceOptions" @update:model-value="applyFilters"/><button class="btn-secondary" @click="applyFilters">Aplicar</button></div>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3"><label class="inline-flex items-center gap-2 text-sm text-slate-600"><input v-model="autoRefresh" type="checkbox" @change="setAutoRefresh"/>Atualização automática</label><div class="w-52"><SearchSelect v-model="refreshSeconds" :options="refreshOptions" @update:model-value="setAutoRefresh"/></div></div>
  </section>

  <SectionTabs :model-value="tab" :items="[{key:'center',label:'Centro operacional'},{key:'runtime',label:'Eventos estruturados',count:total},{key:'console',label:'Console da stack',count:services.length},{key:'audit',label:'Auditoria',count:auditTotal}]" @update:model-value="changeTab"/>

  <template v-if="tab==='center'">
    <div class="mb-4 flex items-center justify-between"><div><h2 class="font-bold">Fontes monitoradas</h2><p class="text-sm text-slate-500">Selecione uma fonte para abrir o console ou os eventos relacionados.</p></div><div v-if="summary" class="flex items-center gap-2 text-xs"><span class="h-2.5 w-2.5 rounded-full" :class="summary.docker_available?'bg-emerald-500':'bg-rose-500'"/><span>{{summary.docker_available?'Agente da stack disponível':'Agente da stack indisponível'}}</span></div></div>
    <div class="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <button v-for="card in sourceCards" :key="card.key" class="card text-left transition hover:-translate-y-0.5 hover:shadow-lg" @click="openSource(card)"><div class="flex items-start gap-3"><div class="rounded-xl bg-slate-50 p-2.5 text-slate-600"><component :is="card.icon" :size="20"/></div><div class="min-w-0 flex-1"><div class="flex items-center justify-between gap-2"><p class="font-semibold">{{card.label}}</p><span class="h-2.5 w-2.5 rounded-full" :class="card.healthy?'bg-emerald-500':card.available?'bg-rose-500':'bg-slate-300'"/></div><p class="mt-1 text-xs text-slate-400">{{card.category}} · {{card.related.length}} serviço(s)</p><div class="mt-3 flex gap-3 text-xs text-slate-500"><span>{{card.events}} eventos / 24h</span><span v-if="card.bad" class="font-semibold text-rose-600">{{card.bad}} com falha</span><span v-if="card.restarting" class="font-semibold text-amber-600">{{card.restarting}} reiniciando</span></div></div></div></button>
    </div>
    <div class="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <section class="card"><div class="mb-3 flex items-center justify-between"><div><h2 class="font-bold">Ocorrências que exigem atenção</h2><p class="text-sm text-slate-500">Erros e avisos mais recentes dentro dos filtros atuais.</p></div><BellRing :size="20" class="text-amber-600"/></div><div class="divide-y divide-slate-100"><button v-for="item in recentImportant" :key="item.id" class="flex w-full items-start gap-3 py-3 text-left" @click="tab='runtime';level=item.level;page=1;loadRuntime()"><span class="mt-1 h-2.5 w-2.5 rounded-full" :class="['ERROR','CRITICAL'].includes(item.level)?'bg-rose-500':'bg-amber-500'"/><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><strong class="text-sm">{{logLevelLabel(item.level)}}</strong><span class="text-xs text-slate-400">{{serviceLabel(item.service)}} · {{new Date(item.occurred_at).toLocaleString('pt-BR')}}</span></div><p class="mt-1 line-clamp-2 text-sm text-slate-600">{{item.message}}</p></div></button><p v-if="!recentImportant.length" class="py-8 text-center text-sm text-emerald-700">Nenhum erro ou aviso recente com os filtros atuais.</p></div></section>
      <section class="card"><div class="mb-3 flex items-center gap-2"><Gauge :size="20" class="text-teal-700"/><h2 class="font-bold">Saúde consolidada</h2></div><dl v-if="summary" class="space-y-3 text-sm"><div class="flex justify-between"><dt class="text-slate-500">Serviços não saudáveis</dt><dd class="font-semibold">{{summary.containers.unhealthy}}</dd></div><div class="flex justify-between"><dt class="text-slate-500">Serviços reiniciando</dt><dd class="font-semibold">{{summary.containers.restarting}}</dd></div><div class="flex justify-between"><dt class="text-slate-500">Serviços encerrados</dt><dd class="font-semibold">{{summary.containers.exited}}</dd></div><div class="flex justify-between"><dt class="text-slate-500">Encerrados por memória</dt><dd class="font-semibold">{{summary.containers.oom_killed}}</dd></div><div class="flex justify-between"><dt class="text-slate-500">Requisições lentas / 24h</dt><dd class="font-semibold">{{summary.slow_requests}}</dd></div></dl><button class="btn-secondary mt-5 w-full" :disabled="!summary?.docker_available" @click="tab='console';loadContainerLogs()"><Server :size="16"/>{{summary?.docker_available?'Abrir console da stack':'Agente da stack indisponível'}}</button></section>
    </div>
  </template>

  <template v-else-if="tab==='runtime'">
    <div class="mb-4 flex flex-wrap items-end justify-between gap-3"><div class="w-full max-w-sm"><SearchSelect v-model="service" :options="runtimeServiceOptions" @update:model-value="applyFilters"/></div><button v-if="isSuperadmin" class="btn-secondary text-rose-600" @click="purge"><Eraser :size="16"/>Gerenciar retenção</button></div>
    <div class="space-y-2"><article v-for="item in logs" :key="item.id" class="card !p-4"><div class="flex flex-wrap items-start gap-3"><StatusBadge :status="levelStatus(item.level)"/><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-x-3 gap-y-1"><p class="font-semibold">{{logLevelLabel(item.level)}} · {{item.event}}</p><span class="text-xs text-slate-400">{{serviceLabel(item.service)}} · {{new Date(item.occurred_at).toLocaleString('pt-BR')}}</span></div><p class="mt-1 whitespace-pre-wrap text-sm text-slate-700">{{item.message}}</p><div class="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400"><span v-if="item.method">{{item.method}} {{item.path}}</span><span v-if="item.status_code">HTTP {{item.status_code}}</span><span v-if="item.duration_ms!==null&&item.duration_ms!==undefined">{{item.duration_ms}} ms</span><span v-if="item.tenant_id">{{tenantName(item.tenant_id)}}</span><span v-if="item.request_id">Requisição: {{item.request_id}}</span></div><details v-if="objectEntries(item.details).length" class="mt-3 rounded-xl bg-slate-50 p-3"><summary class="cursor-pointer text-xs font-semibold text-slate-600">Detalhes técnicos</summary><dl class="mt-3 grid gap-2 md:grid-cols-2"><div v-for="([key,value]) in objectEntries(item.details)" :key="key" class="rounded-lg bg-white p-2"><dt class="text-[10px] font-bold uppercase text-slate-400">{{nice(key)}}</dt><dd class="mt-1 break-all text-xs text-slate-700">{{simpleValue(value)}}</dd></div></dl></details></div></div></article><div v-if="!logs.length" class="card py-12 text-center text-slate-400">Nenhum evento operacional com os filtros informados.</div></div>
    <PaginationBar v-model="page" :pages="pages" :total="total" class="mt-5" @update:model-value="loadRuntime"/>
  </template>

  <template v-else-if="tab==='console'">
    <div v-if="!summary?.docker_available" class="card py-12 text-center"><Server :size="34" class="mx-auto text-slate-300"/><h2 class="mt-3 font-bold">Agente da stack indisponível</h2><p class="mx-auto mt-2 max-w-xl text-sm text-slate-500">Os eventos estruturados e a auditoria continuam disponíveis. Atualize a stack com o bundle completo da release para disponibilizar o inventário e o stdout/stderr dos serviços Docker.</p></div>
    <template v-else>
      <div class="mb-4 grid gap-3 lg:grid-cols-[1fr_220px_1fr_auto]"><SearchSelect v-model="selectedContainer" :options="containerOptions" @update:model-value="loadContainerLogs"/><SearchSelect v-model="tail" :options="tailOptions" @update:model-value="loadContainerLogs"/><input v-model="containerSearch" class="input" placeholder="Pesquisar no stdout/stderr deste serviço" @keyup.enter="loadContainerLogs"/><button class="btn-primary" @click="loadContainerLogs"><Search :size="16"/>Consultar</button></div>
      <div class="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]"><aside class="space-y-2"><button v-for="item in services" :key="item.id" class="w-full rounded-xl border bg-white p-3 text-left transition" :class="selectedContainer===item.id?'border-teal-400 ring-1 ring-teal-300':'border-slate-200 hover:border-slate-300'" @click="selectedContainer=item.id;loadContainerLogs()"><div class="flex items-center justify-between gap-2"><span class="truncate text-sm font-semibold">{{serviceLabel(item.service||item.name)}}</span><span class="h-2.5 w-2.5 shrink-0 rounded-full" :class="stateStatus(item)==='ACTIVE'?'bg-emerald-500':stateStatus(item)==='ERROR'?'bg-rose-500':'bg-amber-500'"/></div><p class="mt-1 truncate text-xs text-slate-400">{{statusLabel(item.health||item.state)}} · {{item.restart_count}} reinício(s)</p></button></aside><section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-soft"><div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4"><div><p class="text-xs font-bold uppercase tracking-wide text-teal-700">Console somente leitura</p><h2 class="mt-1 font-bold">{{selectedService?serviceLabel(selectedService.service||selectedService.name):'Selecione um serviço'}}</h2><p v-if="selectedService" class="mt-1 text-xs text-slate-400">{{statusLabel(selectedService.health||selectedService.state)}} · {{selectedService.image}}</p></div><StatusBadge v-if="selectedService" :status="stateStatus(selectedService)"/></div><pre class="scroll-clean max-h-[68vh] min-h-[520px] overflow-auto whitespace-pre-wrap break-all bg-slate-950 p-4 font-mono text-[11px] leading-5 text-slate-200">{{containerLines.length?containerLines.join('\n'):'Nenhuma linha retornada para esta consulta.'}}</pre></section></div>
    </template>
  </template>

  <template v-else>
    <div class="mb-4 grid gap-3 md:grid-cols-[1fr_auto]"><input v-model="auditAction" class="input" placeholder="Pesquisar ação auditada" @keyup.enter="auditPage=1;loadAudit()"/><button class="btn-secondary" @click="auditPage=1;loadAudit()"><ShieldCheck :size="17"/>Pesquisar auditoria</button></div>
    <div class="space-y-3"><article v-for="item in audits" :key="item.id" class="card !p-4"><div class="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_1fr_auto]"><div><div class="flex items-center gap-2"><ShieldCheck :size="18" class="text-teal-700"/><strong>{{auditActionLabel(item.action)}}</strong></div><p class="mt-1 text-sm text-slate-500">{{entityLabel(item.entity_type)}} · {{item.entity_id||'sem identificador'}}</p><p class="mt-1 text-xs text-slate-400">{{new Date(item.created_at).toLocaleString('pt-BR')}} · {{item.tenant_name||tenantName(item.tenant_id)}}</p></div><div><p class="text-xs text-slate-400">Operador</p><p class="mt-1 text-sm font-semibold">{{item.actor_name||'Sistema'}}</p><p class="text-xs text-slate-500">{{item.actor_email||'Ação automática'}}</p></div><details><summary class="cursor-pointer text-sm font-semibold text-teal-700">Alterações</summary><div class="mt-3 grid gap-3 lg:grid-cols-2"><div v-if="objectEntries(item.before).length" class="rounded-xl border border-rose-100 bg-rose-50/40 p-3"><p class="text-xs font-semibold text-rose-700">Estado anterior</p><dl class="mt-2 space-y-1"><div v-for="([key,value]) in objectEntries(item.before)" :key="key" class="flex gap-2 text-xs"><dt class="min-w-28 font-semibold text-slate-500">{{nice(key)}}</dt><dd class="break-all">{{simpleValue(value)}}</dd></div></dl></div><div v-if="objectEntries(item.after).length" class="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3"><p class="text-xs font-semibold text-emerald-700">Estado posterior</p><dl class="mt-2 space-y-1"><div v-for="([key,value]) in objectEntries(item.after)" :key="key" class="flex gap-2 text-xs"><dt class="min-w-28 font-semibold text-slate-500">{{nice(key)}}</dt><dd class="break-all">{{simpleValue(value)}}</dd></div></dl></div></div></details></div></article><div v-if="!audits.length" class="card py-12 text-center text-slate-400">Nenhum evento de auditoria encontrado.</div></div>
    <PaginationBar v-model="auditPage" :pages="auditPages" :total="auditTotal" class="mt-5" @update:model-value="loadAudit"/>
  </template>
</template>
