<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Activity, Link2, MessageCircle, Plus, Power, RefreshCw, RotateCw,
  Search, Send, Smartphone, Trash2, Unplug, X,
} from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse } from '../types'
import { appConfirm } from '../composables/useAppDialog'
import { statusLabel } from '../utils/labels'
import PageHeader from '../components/PageHeader.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'
import ModalDialog from '../components/ModalDialog.vue'

interface Connection {
  state:string
  session_exists?:boolean
  pairing_code?:string|null
  qr_base64?:string|null
  number?:string|null
  profile_name?:string|null
  message?:string|null
}
interface InstanceItem {
  tenant_id:string
  tenant_name:string
  tenant_slug:string
  instance?:string|null
  instance_mode:string
  operations_available:boolean
  connection:Connection
}
interface TestMessageResult {
  tenant_id:string
  tenant_name:string
  instance:string
  destination:string
  external_id?:string|null
  status:string
}

const items=ref<InstanceItem[]>([])
const error=ref('')
const success=ref('')
const loading=ref(false)
const q=ref('')
const selected=ref<InstanceItem|null>(null)
const modal=ref(false)
const busy=ref(false)
const phone=ref('')
const operationResult=ref<Connection|null>(null)
const pairMode=ref<'QR'|'CODE'>('QR')
const testModal=ref(false)
const testTarget=ref<InstanceItem|null>(null)
const testPhone=ref('')
const testMessage=ref('Mensagem de teste da Connect|API Platform.')
const testBusy=ref(false)
let refreshTimer:number|undefined

const filtered=computed(()=>{
  const term=q.value.trim().toLowerCase()
  if(!term)return items.value
  return items.value.filter(item=>`${item.tenant_name} ${item.tenant_slug} ${item.connection.number||''} ${item.connection.profile_name||''} ${item.connection.state}`.toLowerCase().includes(term))
})
const connectedCount=computed(()=>items.value.filter(item=>normalizeState(item.connection.state)==='CONNECTED').length)
const attentionCount=computed(()=>items.value.filter(item=>['UNAVAILABLE','NOT_CONFIGURED'].includes(normalizeState(item.connection.state))).length)
const connection=computed<Connection>(()=>operationResult.value||selected.value?.connection||{state:'UNKNOWN'})
const state=computed(()=>normalizeState(connection.value.state))
const connected=computed(()=>state.value==='CONNECTED')
const qrImage=computed(()=>{
  const raw=connection.value.qr_base64
  if(!raw)return''
  return raw.startsWith('data:')?raw:`data:image/png;base64,${raw}`
})

function normalizeState(value?:string|null){
  const current=String(value||'UNKNOWN').toUpperCase()
  return ({OPEN:'CONNECTED',ONLINE:'CONNECTED',CLOSE:'DISCONNECTED',CLOSED:'DISCONNECTED'} as Record<string,string>)[current]||current
}
function connectionLabel(value?:string|null){
  const current=normalizeState(value)
  const labels:Record<string,string>={
    CONNECTED:'Conectado',CONNECTING:'Conectando',RECONNECTING:'Reconectando',PAIRING:'Aguardando pareamento',
    DISCONNECTED:'Desconectado',NOT_CREATED:'Instância ainda não criada',NOT_CONFIGURED:'Serviço não configurado',
    UNAVAILABLE:'Serviço indisponível',UNKNOWN:'Estado em atualização',ERROR:'Erro de conexão',FAILED:'Falha de conexão',
  }
  return labels[current]||statusLabel(current)
}
function status(value:string){
  const current=normalizeState(value)
  if(current==='CONNECTED')return'ACTIVE'
  if(['NOT_CREATED','CONNECTING','PAIRING','PENDING','RECONNECTING'].includes(current))return'PENDING'
  if(['UNAVAILABLE','ERROR','FAILED'].includes(current))return'FAILED'
  return'INACTIVE'
}

async function load(silent=false){
  if(!silent){loading.value=true;error.value=''}
  try{items.value=(await api.get<ApiResponse<InstanceItem[]>>('/control/v1/whatsapp/instances')).data.data}
  catch(exception){if(!silent)error.value=apiError(exception)}
  finally{if(!silent)loading.value=false}
}

function open(item:InstanceItem){
  selected.value=item
  phone.value=''
  pairMode.value='QR'
  operationResult.value=null
  modal.value=true
}

async function action(value:'create'|'connect'|'disconnect'|'restart'|'delete'){
  if(!selected.value)return
  if(value==='delete'){
    const ok=await appConfirm({title:'Remover conexão do WhatsApp',message:`Remover definitivamente a instância de ${selected.value.tenant_name}? O cliente precisará fazer um novo pareamento para voltar a utilizar o WhatsApp.`,confirmLabel:'Remover instância',cancelLabel:'Cancelar',tone:'danger'})
    if(!ok)return
  }
  if(value==='disconnect'){
    const ok=await appConfirm({title:'Desconectar WhatsApp',message:`Desconectar o WhatsApp de ${selected.value.tenant_name}? A instância permanece cadastrada, mas a sessão será encerrada.`,confirmLabel:'Desconectar',cancelLabel:'Manter conectado',tone:'warning'})
    if(!ok)return
  }
  if(value==='restart'){
    const ok=await appConfirm({title:'Reiniciar conexão',message:`Reiniciar a conexão de ${selected.value.tenant_name} preservando a sessão vinculada? Um novo QR Code não deve ser solicitado enquanto a sessão continuar válida.`,confirmLabel:'Reiniciar',cancelLabel:'Cancelar'})
    if(!ok)return
  }
  busy.value=true
  error.value=''
  success.value=''
  try{
    const response=await api.post<ApiResponse<{connection:Connection}>>(`/control/v1/whatsapp/instances/${selected.value.tenant_id}/actions/${value}`,{phone:value==='connect'&&pairMode.value==='CODE'?phone.value||null:null})
    operationResult.value=response.data.data.connection
    success.value=value==='create'?'Instância preparada.':value==='connect'?'Pareamento solicitado.':value==='disconnect'?'WhatsApp desconectado.':value==='restart'?'Conexão reiniciada preservando a sessão quando disponível.':'Conexão removida.'
    await load(true)
    const refreshed=items.value.find(item=>item.tenant_id===selected.value?.tenant_id)
    if(refreshed)selected.value=refreshed
  }catch(exception){error.value=apiError(exception)}
  finally{busy.value=false}
}

function openTest(item:InstanceItem){
  testTarget.value=item
  testPhone.value=''
  testMessage.value='Mensagem de teste da Connect|API Platform.'
  testModal.value=true
  error.value=''
  success.value=''
}
async function sendTest(){
  if(!testTarget.value||!testPhone.value.trim()||!testMessage.value.trim())return
  testBusy.value=true
  error.value=''
  success.value=''
  try{
    const response=await api.post<ApiResponse<TestMessageResult>>(`/control/v1/whatsapp/instances/${testTarget.value.tenant_id}/test-message`,{phone:testPhone.value,message:testMessage.value})
    const result=response.data.data
    success.value=`Mensagem de teste enviada para ${result.destination}${result.external_id?` · identificador ${result.external_id}`:''}.`
    testModal.value=false
  }catch(exception){error.value=apiError(exception)}
  finally{testBusy.value=false}
}

onMounted(async()=>{
  await load()
  refreshTimer=window.setInterval(()=>void load(true),15000)
})
onBeforeUnmount(()=>{if(refreshTimer)window.clearInterval(refreshTimer)})
</script>

<template>
  <PageHeader title="WhatsApp da plataforma" subtitle="Administração central das conexões exclusivas dos clientes, com pareamento, sessão, diagnóstico e teste de envio.">
    <button class="btn-secondary" :disabled="loading" @click="load()"><RefreshCw :size="18" :class="loading?'animate-spin':''"/>Atualizar</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/>
  <InlineAlert :message="success" type="success" @dismiss="success=''"/>

  <section class="mb-5 grid gap-3 sm:grid-cols-3">
    <div class="card"><p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Clientes monitorados</p><p class="mt-2 text-3xl font-bold">{{items.length}}</p></div>
    <div class="card"><p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Conectados</p><p class="mt-2 text-3xl font-bold text-emerald-700">{{connectedCount}}</p></div>
    <div class="card"><p class="text-xs font-semibold uppercase tracking-wide text-slate-400">Precisam de atenção</p><p class="mt-2 text-3xl font-bold" :class="attentionCount?'text-rose-700':'text-slate-900'">{{attentionCount}}</p></div>
  </section>

  <div class="mb-5 max-w-xl">
    <div class="relative"><Search class="absolute left-3 top-3 text-slate-400" :size="17"/><input v-model="q" class="input pl-9" placeholder="Cliente, slug, número ou nome do WhatsApp"/></div>
  </div>

  <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
    <article v-for="item in filtered" :key="item.tenant_id" class="card">
      <div class="flex items-start gap-3">
        <div class="rounded-2xl bg-emerald-50 p-3 text-emerald-700"><MessageCircle :size="23"/></div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0"><p class="truncate font-semibold">{{item.tenant_name}}</p><p class="truncate text-xs text-slate-400">{{item.tenant_slug}}</p></div>
            <StatusBadge :status="status(item.connection.state)"/>
          </div>
          <p class="mt-3 text-sm font-medium">{{item.connection.profile_name||'WhatsApp ainda não identificado'}}</p>
          <p class="mt-1 text-xs text-slate-500">{{item.connection.number||'Nenhum número conectado'}}</p>
          <p class="mt-2 text-xs text-slate-500">{{connectionLabel(item.connection.state)}} · conexão {{item.instance_mode==='TENANT'?'exclusiva':'compartilhada'}}</p>
          <div class="mt-4 grid gap-2 sm:grid-cols-2">
            <button class="btn-secondary !py-2 sm:col-span-2" @click="open(item)"><Link2 :size="16"/>Gerenciar conexão</button>
            <button v-if="normalizeState(item.connection.state)==='CONNECTED'&&item.operations_available" class="btn-secondary !py-2 text-teal-700 sm:col-span-2" @click="openTest(item)"><Send :size="16"/>Testar envio real</button>
          </div>
        </div>
      </div>
    </article>
    <div v-if="!filtered.length" class="card text-center text-sm text-slate-400 md:col-span-2 xl:col-span-3">{{loading?'Consultando conexões…':'Nenhuma conexão encontrada.'}}</div>
  </div>

  <ModalDialog :open="modal" :title="selected?`WhatsApp · ${selected.tenant_name}`:'WhatsApp'" size="xl" @close="modal=false">
    <div v-if="selected" class="space-y-5">
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-xl border border-slate-200 p-3"><p class="text-xs text-slate-400">Cliente</p><p class="font-semibold">{{selected.tenant_name}}</p><p class="text-xs text-slate-500">{{selected.tenant_slug}}</p></div>
        <div class="rounded-xl border border-slate-200 p-3"><p class="text-xs text-slate-400">WhatsApp identificado</p><p class="font-semibold">{{connection.profile_name||'Não identificado'}}</p><p class="text-xs text-slate-500">{{connection.number||'Nenhum número'}}</p></div>
        <div class="rounded-xl border border-slate-200 p-3"><p class="text-xs text-slate-400">Situação</p><p class="mt-1 font-semibold">{{connectionLabel(state)}}</p><p class="text-xs text-slate-500">{{connection.session_exists?'Sessão vinculada':'Sem sessão vinculada'}}</p></div>
      </div>

      <div v-if="selected.operations_available" class="rounded-2xl border border-slate-200 p-4">
        <div class="mb-4 flex items-center gap-2"><Activity :size="18" class="text-teal-700"/><div><p class="font-semibold">Operações da conexão</p><p class="text-xs text-slate-500">As ações abaixo afetam somente a instância deste cliente.</p></div></div>
        <div class="flex flex-wrap gap-2">
          <button v-if="['NOT_CREATED','UNKNOWN','NOT_CONFIGURED'].includes(state)" class="btn-secondary" :disabled="busy" @click="action('create')"><Plus :size="16"/>Preparar instância</button>
          <button v-if="!connected&&!connection.session_exists" class="btn-primary" :disabled="busy" @click="pairMode='QR';action('connect')"><Smartphone :size="16"/>Gerar QR Code</button>
          <button v-if="connection.session_exists" class="btn-secondary" :disabled="busy" @click="action('restart')"><RotateCw :size="16"/>Reiniciar preservando sessão</button>
          <button v-if="connected" class="btn-secondary" :disabled="busy" @click="action('disconnect')"><Unplug :size="16"/>Desconectar</button>
          <button v-if="state!=='NOT_CREATED'" class="btn-secondary text-rose-600" :disabled="busy" @click="action('delete')"><Trash2 :size="16"/>Remover instância</button>
        </div>
      </div>
      <div v-else class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Esta conexão usa uma instância compartilhada. A operação individual permanece bloqueada para evitar impacto em outros clientes.</div>

      <div v-if="selected.operations_available&&!connected&&!connection.session_exists" class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div class="mb-3 flex items-center justify-between"><p class="font-semibold">Pareamento</p><button class="rounded-lg p-1.5 text-slate-400 hover:bg-white" @click="operationResult=null"><X :size="17"/></button></div>
        <div class="mb-3 grid grid-cols-2 gap-2"><button class="rounded-xl border p-2.5 text-sm font-semibold" :class="pairMode==='QR'?'border-teal-400 bg-teal-50 text-teal-800':'border-slate-200 bg-white'" @click="pairMode='QR';action('connect')">QR Code</button><button class="rounded-xl border p-2.5 text-sm font-semibold" :class="pairMode==='CODE'?'border-teal-400 bg-teal-50 text-teal-800':'border-slate-200 bg-white'" @click="pairMode='CODE'">Código de pareamento</button></div>
        <div v-if="pairMode==='CODE'" class="mb-4"><label class="label">Número do WhatsApp</label><div class="flex gap-2"><input v-model="phone" class="input" inputmode="tel" placeholder="99999-9999, 75999999999 ou 5575999999999"/><button class="btn-primary shrink-0" :disabled="busy||!phone.trim()" @click="action('connect')"><Power :size="16"/>Gerar código</button></div><p class="mt-1 text-xs text-slate-500">O DDI 55 é incluído quando ausente. Sem DDD, a plataforma usa o DDD padrão da empresa emissora.</p></div>
        <div v-if="qrImage||connection.pairing_code" class="grid place-items-center rounded-xl bg-white p-4"><img v-if="qrImage&&pairMode==='QR'" :src="qrImage" alt="QR Code da conexão WhatsApp" class="h-56 w-56 rounded-xl bg-white p-2"/><div v-else-if="connection.pairing_code&&pairMode==='CODE'" class="text-center"><p class="text-xs font-semibold uppercase tracking-wide text-teal-700">Código de pareamento</p><p class="mt-3 font-mono text-3xl font-black tracking-widest">{{connection.pairing_code}}</p></div></div>
      </div>

      <div v-if="connection.session_exists&&['CONNECTING','RECONNECTING','DISCONNECTED'].includes(state)" class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">A identidade da sessão continua vinculada. A plataforma tentará recuperar essa sessão e não deve solicitar um novo QR Code enquanto ela permanecer válida.</div>
    </div>
  </ModalDialog>

  <ModalDialog :open="testModal" :title="`Testar WhatsApp · ${testTarget?.tenant_name||''}`" size="lg" @close="testModal=false">
    <form class="space-y-4" @submit.prevent="sendTest">
      <div class="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">Este teste envia uma mensagem real usando exatamente a instância exclusiva mostrada como conectada no Control Plane.</div>
      <div><label class="label">Número de destino</label><input v-model="testPhone" class="input" inputmode="tel" placeholder="99999-9999, 75999999999 ou 5575999999999" required/><p class="mt-1 text-xs text-slate-500">A normalização brasileira de DDI e DDD é aplicada antes do envio.</p></div>
      <div><label class="label">Mensagem</label><textarea v-model="testMessage" class="input min-h-28" maxlength="4096" required/></div>
      <div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="testModal=false">Cancelar</button><button class="btn-primary" :disabled="testBusy"><Send :size="17"/>{{testBusy?'Enviando…':'Enviar teste real'}}</button></div>
    </form>
  </ModalDialog>
</template>
