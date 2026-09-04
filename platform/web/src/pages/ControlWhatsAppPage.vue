<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { MessageCircle, PlugZap, Power, RefreshCw, RotateCw, Send, Smartphone, Trash2, Unplug, X } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse } from '../types'
import { appConfirm } from '../composables/useAppDialog'
import PageHeader from '../components/PageHeader.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'
import ModalDialog from '../components/ModalDialog.vue'
import { statusLabel } from '../utils/labels'

interface Connection {
  state:string
  session_exists?:boolean
  number?:string|null
  profile_name?:string|null
  pairing_code?:string|null
  qr_base64?:string|null
  message?:string|null
}
interface InstanceRow {
  tenant_id:string
  tenant_name:string
  tenant_slug:string
  instance?:string|null
  instance_mode:string
  operations_available:boolean
  connection:Connection
}
interface OperateResponse {
  tenant_id:string
  tenant_name:string
  instance:string
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

const items=ref<InstanceRow[]>([])
const error=ref('')
const success=ref('')
const loading=ref(false)
const actionBusy=ref('')
const expanded=ref('')
const pairMode=ref<'QR'|'CODE'>('QR')
const phone=ref('')
const testModal=ref(false)
const testTarget=ref<InstanceRow|null>(null)
const testPhone=ref('')
const testMessage=ref('Mensagem de teste da Connect|API Platform.')
const testBusy=ref(false)
let timer:number|undefined

const connected=computed(()=>items.value.filter(item=>item.connection.state==='CONNECTED').length)
const configured=computed(()=>items.value.filter(item=>item.instance).length)
const unavailable=computed(()=>items.value.filter(item=>['UNAVAILABLE','NOT_CONFIGURED'].includes(item.connection.state)).length)
const stateTone=(state:string)=>state==='CONNECTED'?'ACTIVE':state==='UNAVAILABLE'?'ERROR':['CONNECTING','RECONNECTING'].includes(state)?'PENDING':'INACTIVE'
const qrSource=(value?:string|null)=>value?(value.startsWith('data:')?value:`data:image/png;base64,${value}`):''
const stateText=(value:string)=>({CONNECTED:'Conectado',CONNECTING:'Conectando',RECONNECTING:'Reconectando',DISCONNECTED:'Desconectado',NOT_CREATED:'Ainda não criado',NOT_CONFIGURED:'Não configurado',UNAVAILABLE:'Serviço indisponível',UNKNOWN:'Estado em atualização'} as Record<string,string>)[value]||statusLabel(value)

async function load(silent=false){
  if(!silent){loading.value=true;error.value=''}
  try{items.value=(await api.get<ApiResponse<InstanceRow[]>>('/control/v1/whatsapp/instances')).data.data}
  catch(e){if(!silent)error.value=apiError(e)}finally{if(!silent)loading.value=false}
}
function updateRow(result:OperateResponse){
  const index=items.value.findIndex(item=>item.tenant_id===result.tenant_id)
  if(index>=0)items.value[index]={...items.value[index],instance:result.instance,connection:result.connection}
}
async function operate(item:InstanceRow,action:string,phoneValue?:string){
  const key=`${item.tenant_id}:${action}`;actionBusy.value=key;error.value='';success.value=''
  try{
    const response=await api.post<ApiResponse<OperateResponse>>(`/control/v1/whatsapp/instances/${item.tenant_id}/${action}`,{phone:phoneValue||null})
    updateRow(response.data.data)
    const labels:Record<string,string>={create:'Conexão preparada.',connect:'Pareamento solicitado.',disconnect:'WhatsApp desconectado.',restart:'Reinicialização solicitada com preservação de sessão.',delete:'Conexão removida.'}
    success.value=`${item.tenant_name}: ${labels[action]||'Operação concluída.'}`
    if(action==='connect')expanded.value=item.tenant_id
    await load(true)
  }catch(e){error.value=apiError(e)}finally{actionBusy.value=''}
}
async function restart(item:InstanceRow){
  const ok=await appConfirm({title:'Reiniciar conexão',message:`Reiniciar a conexão de ${item.tenant_name} preservando a sessão vinculada? Não será solicitado novo QR enquanto a sessão continuar válida.`,confirmLabel:'Reiniciar',cancelLabel:'Cancelar',tone:'default'})
  if(ok)await operate(item,'restart')
}
async function disconnect(item:InstanceRow){
  const ok=await appConfirm({title:'Desconectar WhatsApp',message:`Desconectar o WhatsApp de ${item.tenant_name}? A sessão será encerrada, mas a instância permanecerá cadastrada.`,confirmLabel:'Desconectar',cancelLabel:'Manter conectado',tone:'warning'})
  if(ok)await operate(item,'disconnect')
}
async function remove(item:InstanceRow){
  const ok=await appConfirm({title:'Remover conexão',message:`Remover definitivamente a instância de ${item.tenant_name}? Um novo pareamento será obrigatório para voltar a usar o WhatsApp.`,confirmLabel:'Remover instância',cancelLabel:'Cancelar',tone:'danger'})
  if(ok)await operate(item,'delete')
}
function openPair(item:InstanceRow,mode:'QR'|'CODE'){
  expanded.value=item.tenant_id;pairMode.value=mode;phone.value=''
  if(mode==='QR')void operate(item,'connect')
}
function openTest(item:InstanceRow){testTarget.value=item;testPhone.value='';testMessage.value='Mensagem de teste da Connect|API Platform.';testModal.value=true;error.value='';success.value=''}
async function sendTest(){
  if(!testTarget.value||!testPhone.value.trim()||!testMessage.value.trim())return
  testBusy.value=true;error.value='';success.value=''
  try{
    const result=(await api.post<ApiResponse<TestMessageResult>>(`/control/v1/whatsapp/instances/${testTarget.value.tenant_id}/test-message`,{phone:testPhone.value,message:testMessage.value})).data.data
    success.value=`Mensagem de teste enviada para ${result.destination}${result.external_id?` · ID ${result.external_id}`:''}.`
    testModal.value=false
  }catch(e){error.value=apiError(e)}finally{testBusy.value=false}
}
onMounted(async()=>{await load();timer=window.setInterval(()=>void load(true),15000)})
onBeforeUnmount(()=>{if(timer)window.clearInterval(timer)})
</script>

<template>
  <PageHeader title="WhatsApp" subtitle="Administração central das conexões de cada cliente, com sessão isolada, diagnóstico e teste de envio.">
    <button class="btn-primary" :disabled="loading" @click="load()"><RefreshCw :size="18" :class="loading?'animate-spin':''"/>Atualizar</button>
  </PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>

  <div class="mb-6 grid gap-4 sm:grid-cols-3">
    <div class="card"><p class="text-xs uppercase text-slate-400">Clientes monitorados</p><p class="mt-2 text-3xl font-bold">{{items.length}}</p></div>
    <div class="card"><p class="text-xs uppercase text-slate-400">Conectados</p><p class="mt-2 text-3xl font-bold text-emerald-700">{{connected}}</p><p class="mt-1 text-xs text-slate-400">{{configured}} instância(s) identificada(s)</p></div>
    <div class="card"><p class="text-xs uppercase text-slate-400">Precisam de atenção</p><p class="mt-2 text-3xl font-bold" :class="unavailable?'text-rose-700':'text-slate-900'">{{unavailable}}</p><p class="mt-1 text-xs text-slate-400">não configurado ou indisponível</p></div>
  </div>

  <div class="space-y-4">
    <article v-for="item in items" :key="item.tenant_id" class="card">
      <div class="flex flex-wrap items-start gap-4">
        <div class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><MessageCircle :size="24"/></div>
        <div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h2 class="font-bold">{{item.tenant_name}}</h2><StatusBadge :status="stateTone(item.connection.state)"/></div><p class="mt-1 text-xs text-slate-400">{{item.tenant_slug}} · {{item.instance||'instância ainda não criada'}}</p><p class="mt-2 text-sm font-semibold" :class="item.connection.state==='CONNECTED'?'text-emerald-700':['CONNECTING','RECONNECTING'].includes(item.connection.state)?'text-amber-700':'text-slate-600'">{{stateText(item.connection.state)}}</p><p v-if="item.connection.profile_name||item.connection.number" class="mt-1 text-xs text-slate-500">{{item.connection.profile_name||'WhatsApp'}} · {{item.connection.number||'número não identificado'}}</p><p v-if="item.connection.message" class="mt-2 text-xs text-amber-700">{{item.connection.message}}</p></div>
        <div class="flex flex-wrap justify-end gap-2">
          <template v-if="item.operations_available">
            <button v-if="item.connection.state==='NOT_CREATED'" class="btn-secondary !px-3 !py-2" :disabled="Boolean(actionBusy)" @click="operate(item,'create')"><PlugZap :size="15"/>Preparar</button>
            <button v-if="!item.connection.session_exists&&item.connection.state!=='CONNECTED'" class="btn-primary !px-3 !py-2" :disabled="Boolean(actionBusy)" @click="openPair(item,'QR')"><Smartphone :size="15"/>QR Code</button>
            <button v-if="!item.connection.session_exists&&item.connection.state!=='CONNECTED'" class="btn-secondary !px-3 !py-2" :disabled="Boolean(actionBusy)" @click="openPair(item,'CODE')"><Power :size="15"/>Código</button>
            <button v-if="item.connection.state==='CONNECTED'" class="btn-secondary !px-3 !py-2 text-blue-700" @click="openTest(item)"><Send :size="15"/>Testar envio</button>
            <button v-if="item.connection.session_exists" class="btn-secondary !px-3 !py-2" :disabled="Boolean(actionBusy)" @click="restart(item)"><RotateCw :size="15"/>Reiniciar</button>
            <button v-if="item.connection.state==='CONNECTED'" class="btn-secondary !px-3 !py-2" :disabled="Boolean(actionBusy)" @click="disconnect(item)"><Unplug :size="15"/>Desconectar</button>
            <button v-if="item.connection.state!=='NOT_CREATED'" class="btn-secondary !px-3 !py-2 text-rose-600" :disabled="Boolean(actionBusy)" @click="remove(item)"><Trash2 :size="15"/>Remover</button>
          </template>
          <span v-else class="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-500">Conexão compartilhada</span>
        </div>
      </div>

      <div v-if="expanded===item.tenant_id&&item.operations_available&&!item.connection.session_exists" class="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div class="mb-3 flex items-center justify-between"><p class="font-semibold">Pareamento</p><button class="rounded-lg p-1.5 text-slate-400 hover:bg-white" @click="expanded=''"><X :size="17"/></button></div>
        <div class="grid gap-4 lg:grid-cols-2">
          <div><div class="mb-2 grid grid-cols-2 gap-2"><button class="rounded-xl border p-2.5 text-sm font-semibold" :class="pairMode==='QR'?'border-blue-400 bg-blue-50 text-blue-800':'border-slate-200 bg-white'" @click="pairMode='QR';operate(item,'connect')">QR Code</button><button class="rounded-xl border p-2.5 text-sm font-semibold" :class="pairMode==='CODE'?'border-blue-400 bg-blue-50 text-blue-800':'border-slate-200 bg-white'" @click="pairMode='CODE'">Código de pareamento</button></div><div v-if="pairMode==='CODE'" class="flex gap-2"><input v-model="phone" class="input" inputmode="tel" placeholder="99999-9999 ou 5575999999999"/><button class="btn-primary shrink-0" :disabled="!phone||Boolean(actionBusy)" @click="operate(item,'connect',phone)">Gerar</button></div><p v-if="pairMode==='CODE'" class="mt-2 text-xs text-slate-500">O DDI 55 é incluído automaticamente quando ausente. Sem DDD, a plataforma usa o DDD padrão da empresa emissora.</p></div>
          <div class="grid min-h-44 place-items-center rounded-xl bg-white p-4"><img v-if="qrSource(item.connection.qr_base64)&&pairMode==='QR'" :src="qrSource(item.connection.qr_base64)" alt="QR Code do WhatsApp" class="h-56 w-56 rounded-xl"/><div v-else-if="item.connection.pairing_code&&pairMode==='CODE'" class="text-center"><p class="text-xs uppercase tracking-wide text-slate-400">Código de pareamento</p><p class="mt-3 font-mono text-3xl font-black tracking-widest text-slate-900">{{item.connection.pairing_code}}</p></div><p v-else class="text-center text-sm text-slate-400">{{actionBusy?'Consultando o serviço…':'Solicite o pareamento para visualizar o código.'}}</p></div>
        </div>
      </div>
      <div v-if="item.connection.session_exists&&['CONNECTING','RECONNECTING','DISCONNECTED'].includes(item.connection.state)" class="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">A sessão continua vinculada. A plataforma não solicitará um novo QR Code enquanto a identidade da conexão continuar presente.</div>
    </article>
    <div v-if="!items.length&&!loading" class="card py-12 text-center text-slate-400">Nenhum cliente encontrado.</div>
  </div>

  <ModalDialog :open="testModal" :title="`Testar WhatsApp · ${testTarget?.tenant_name||''}`" size="lg" @close="testModal=false">
    <form class="space-y-4" @submit.prevent="sendTest">
      <div class="rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">O teste usa a instância exclusiva deste cliente e não expõe a chave administrativa da infraestrutura.</div>
      <div><label class="label">Número de destino</label><input v-model="testPhone" class="input" inputmode="tel" placeholder="99999-9999, 75999999999 ou 5575999999999" required/><p class="mt-1 text-xs text-slate-500">O país 55 é normalizado automaticamente; DDD ausente usa a empresa padrão do cliente.</p></div>
      <div><label class="label">Mensagem</label><textarea v-model="testMessage" class="input min-h-28" maxlength="4096" required/></div>
      <div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="testModal=false">Cancelar</button><button class="btn-primary" :disabled="testBusy"><Send :size="17"/>{{testBusy?'Enviando…':'Enviar teste'}}</button></div>
    </form>
  </ModalDialog>
</template>
