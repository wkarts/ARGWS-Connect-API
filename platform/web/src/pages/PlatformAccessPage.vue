<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { KeyRound, LifeBuoy, Plus, RefreshCw, ShieldOff, X } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { appConfirm } from '../composables/useAppDialog'
import type { ApiResponse, Paginated, Tenant } from '../types'
import PageHeader from '../components/PageHeader.vue'
import SectionTabs from '../components/SectionTabs.vue'
import DrawerPanel from '../components/DrawerPanel.vue'
import InlineAlert from '../components/InlineAlert.vue'
import KeyReveal from '../components/KeyReveal.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect.vue'

interface ApiKey{id:string;name:string;key_prefix:string;permissions:string[];allowed_ips:string[];expires_at?:string;last_used_at?:string;is_active:boolean;created_at:string}
interface Support{id:string;tenant_id:string;platform_user_id:string;reason:string;status:string;expires_at:string;revoked_at?:string;created_at:string}

const permissionDefinitions = [
  { key: 'control.read', label: 'Consultar plataforma', description: 'Leitura de cadastros, planos, domínios e estado operacional.' },
  { key: 'control.manage', label: 'Administrar plataforma', description: 'Alterações administrativas no Control Plane.' },
  { key: 'control.tenants.read', label: 'Consultar empresas', description: 'Leitura dos ambientes provisionados.' },
  { key: 'control.tenants.manage', label: 'Administrar empresas', description: 'Provisionar, suspender e alterar empresas.' },
  { key: 'control.domains.manage', label: 'Administrar domínios e SSL', description: 'DNS, domínios personalizados e certificados.' },
  { key: 'control.support', label: 'Suporte técnico', description: 'Criar e revogar sessões temporárias de suporte.' },
  { key: 'control.audit.read', label: 'Consultar auditoria', description: 'Acesso aos registros de auditoria global.' },
  { key: 'control.settings.manage', label: 'Configurações globais', description: 'Parâmetros e integrações da plataforma.' },
  { key: 'control.backups.manage', label: 'Backup e restauração', description: 'Operações de backup, validação e restore.' },
] as const

const tab=ref('keys'),keys=ref<ApiKey[]>([]),sessions=ref<Support[]>([]),tenants=ref<Tenant[]>([]),drawer=ref(false),error=ref(''),success=ref(''),reveal=ref(''),ipDraft=ref('')
const form=reactive({name:'',permissions:['control.read','control.manage'] as string[],allowed_ips:[] as string[],expires_at:'',tenant_id:'',reason:'Suporte técnico autorizado pelo administrador.',duration_minutes:30})
const tenantOptions=computed<SearchSelectOption[]>(()=>tenants.value.map(item=>({value:item.id,label:item.name,description:item.slug,keywords:`${item.name} ${item.slug} ${item.legal_document||''}`})))
const permissionLabel=(value:string)=>permissionDefinitions.find(item=>item.key===value)?.label||value

async function load(){try{const [k,s,t]=await Promise.all([api.get<ApiResponse<ApiKey[]>>('/control/v1/api-keys'),api.get<ApiResponse<Support[]>>('/control/v1/support-sessions'),api.get<Paginated<Tenant>>('/control/v1/tenants',{params:{per_page:100}})]);keys.value=k.data.data;sessions.value=s.data.data;tenants.value=t.data.data}catch(e){error.value=apiError(e)}}
function open(){Object.assign(form,{name:'',permissions:['control.read','control.manage'],allowed_ips:[],expires_at:'',tenant_id:tenants.value[0]?.id||'',reason:'Suporte técnico autorizado pelo administrador.',duration_minutes:30});ipDraft.value='';drawer.value=true}
function addIp(){const value=ipDraft.value.trim();if(!value)return;if(!form.allowed_ips.includes(value))form.allowed_ips.push(value);ipDraft.value=''}
function removeIp(index:number){form.allowed_ips.splice(index,1)}
async function create(){try{if(tab.value==='keys'){const r=(await api.post<ApiResponse<{key:string}>>('/control/v1/api-keys',{name:form.name,permissions:form.permissions,allowed_ips:form.allowed_ips,expires_at:form.expires_at||null})).data.data;reveal.value=r.key}else{const r=(await api.post<ApiResponse<{access_token:string}>>('/control/v1/support-sessions',{tenant_id:form.tenant_id,reason:form.reason,duration_minutes:form.duration_minutes})).data.data;reveal.value=r.access_token}drawer.value=false;await load()}catch(e){error.value=apiError(e)}}
async function revokeKey(item:ApiKey){const ok=await appConfirm({title:'Revogar chave de API',message:`Revogar ${item.name}? Aplicações que usam essa chave perderão acesso imediatamente.`,confirmLabel:'Revogar chave',cancelLabel:'Cancelar',tone:'danger'});if(!ok)return;try{await api.delete(`/control/v1/api-keys/${item.id}`);await load()}catch(e){error.value=apiError(e)}}
async function revokeSession(item:Support){try{await api.post(`/control/v1/support-sessions/${item.id}/revoke`);await load()}catch(e){error.value=apiError(e)}}
onMounted(load)
</script>

<template>
  <PageHeader title="Acesso técnico" subtitle="API do Control Plane e sessões temporárias de suporte auditado."><button class="btn-secondary" @click="load"><RefreshCw :size="18"/>Atualizar</button><button class="btn-primary" @click="open"><Plus :size="18"/>{{tab==='keys'?'Nova chave':'Nova sessão'}}</button></PageHeader>
  <InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>
  <SectionTabs v-model="tab" :items="[{key:'keys',label:'API Keys',count:keys.length},{key:'support',label:'Sessões de suporte',count:sessions.length}]"/>

  <div v-if="tab==='keys'" class="table-wrap"><table class="table"><thead><tr><th>Chave</th><th>Permissões</th><th>Uso</th><th>Status</th><th></th></tr></thead><tbody><tr v-for="item in keys" :key="item.id" class="border-t border-slate-100"><td><p class="font-semibold">{{item.name}}</p><p class="font-mono text-xs text-slate-400">{{item.key_prefix}}…</p></td><td><p class="text-sm font-semibold text-slate-700">{{item.permissions.length}} permissão(ões)</p><p class="mt-1 max-w-lg truncate text-xs text-slate-400">{{item.permissions.map(permissionLabel).join(' · ')}}</p></td><td class="text-xs">{{item.last_used_at?new Date(item.last_used_at).toLocaleString('pt-BR'):'Nunca'}}<p class="text-slate-400">Expira: {{item.expires_at?new Date(item.expires_at).toLocaleDateString('pt-BR'):'não'}}</p></td><td><StatusBadge :status="item.is_active?'ACTIVE':'REVOKED'"/></td><td class="text-right"><button v-if="item.is_active" class="btn-secondary px-3 py-2 text-rose-600" @click="revokeKey(item)"><ShieldOff :size="16"/>Revogar</button></td></tr></tbody></table><EmptyState v-if="!keys.length" title="Nenhuma chave da plataforma"/></div>
  <div v-else class="table-wrap"><table class="table"><thead><tr><th>Empresa</th><th>Motivo</th><th>Validade</th><th>Status</th><th></th></tr></thead><tbody><tr v-for="item in sessions" :key="item.id" class="border-t border-slate-100"><td><RouterLink :to="`/tenants/${item.tenant_id}`" class="font-semibold text-teal-700">{{tenants.find(t=>t.id===item.tenant_id)?.name||item.tenant_id}}</RouterLink></td><td class="max-w-lg">{{item.reason}}</td><td>{{new Date(item.expires_at).toLocaleString('pt-BR')}}</td><td><StatusBadge :status="item.status"/></td><td class="text-right"><button v-if="item.status==='ACTIVE'" class="btn-secondary px-3 py-2" @click="revokeSession(item)"><ShieldOff :size="16"/>Revogar</button></td></tr></tbody></table><EmptyState v-if="!sessions.length" title="Nenhuma sessão de suporte"/></div>

  <DrawerPanel :open="drawer" :title="tab==='keys'?'Nova API Key do Control Plane':'Nova sessão de suporte'" width="lg" @close="drawer=false">
    <form class="space-y-5" @submit.prevent="create">
      <template v-if="tab==='keys'">
        <div><label class="label">Nome</label><input v-model="form.name" class="input" required/></div>
        <div><div class="mb-2"><p class="label !mb-0">Permissões</p><p class="text-xs text-slate-500">Selecione somente as operações realmente necessárias para esta chave.</p></div><div class="grid gap-2 sm:grid-cols-2"><label v-for="permission in permissionDefinitions" :key="permission.key" class="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><input v-model="form.permissions" type="checkbox" :value="permission.key" class="mt-1"/><span><span class="block text-sm font-semibold">{{permission.label}}</span><span class="block text-xs leading-5 text-slate-500">{{permission.description}}</span></span></label></div></div>
        <div><label class="label">IPs permitidos</label><div class="flex gap-2"><input v-model="ipDraft" class="input" placeholder="Ex.: 203.0.113.10 ou 10.0.0.0/24" @keyup.enter.prevent="addIp"/><button type="button" class="btn-secondary" @click="addIp">Adicionar</button></div><div v-if="form.allowed_ips.length" class="mt-2 flex flex-wrap gap-2"><span v-for="(ip,index) in form.allowed_ips" :key="ip" class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">{{ip}}<button type="button" class="rounded p-0.5 hover:bg-slate-200" @click="removeIp(index)"><X :size="13"/></button></span></div><p v-else class="mt-2 text-xs text-amber-700">Sem IP informado: a chave poderá ser usada a partir de qualquer endereço permitido pela infraestrutura.</p></div>
        <div><label class="label">Expiração</label><input v-model="form.expires_at" type="datetime-local" class="input"/></div>
      </template>
      <template v-else>
        <div><label class="label">Empresa / ambiente</label><SearchSelect v-model="form.tenant_id" :options="tenantOptions" placeholder="Selecione uma empresa" search-placeholder="Pesquisar por nome, slug ou documento…"/></div>
        <div><label class="label">Motivo obrigatório</label><textarea v-model="form.reason" class="input" rows="4" required/></div>
        <div><label class="label">Duração em minutos</label><input v-model.number="form.duration_minutes" type="number" min="5" max="240" class="input"/></div>
      </template>
      <div class="flex justify-end gap-2 border-t pt-4"><button type="button" class="btn-secondary" @click="drawer=false">Cancelar</button><button class="btn-primary"><component :is="tab==='keys'?KeyRound:LifeBuoy" :size="16"/>Criar</button></div>
    </form>
  </DrawerPanel>
  <KeyReveal :open="!!reveal" :value="reveal" :title="tab==='keys'?'API Key criada':'Token temporário de suporte'" @close="reveal=''"/>
</template>
