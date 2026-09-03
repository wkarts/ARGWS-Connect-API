<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { CheckSquare2, Edit3, Plus, RefreshCw, Trash2 } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { appConfirm } from '../composables/useAppDialog'
import type { ApiResponse } from '../types'
import PageHeader from '../components/PageHeader.vue'
import DrawerPanel from '../components/DrawerPanel.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
import { permissionGroup, permissionLabel, roleLabel } from '../utils/labels'

interface Role{id:string;code:string;name:string;description?:string;permissions:string[];is_system:boolean;is_active:boolean;created_at:string}
const items=ref<Role[]>([]),presets=ref<Record<string,string[]>>({}),drawer=ref(false),editing=ref<Role|null>(null),error=ref(''),success=ref('')
const form=reactive({code:'',name:'',description:'',permissions:[] as string[],is_active:true})
const allPermissions=computed(()=>Array.from(new Set([...Object.values(presets.value).flat(),...items.value.flatMap(x=>x.permissions)])).sort())
const permissionGroups=computed(()=>{const groups:Record<string,string[]>={};for(const permission of allPermissions.value){const group=permissionGroup(permission);(groups[group]??=[]).push(permission)}return groups})
const makeCode=(name:string)=>name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,64)||`PERFIL_${Date.now()}`
const roleGroups=(item:Role)=>Array.from(new Set(item.permissions.map(permissionGroup)))
const selectedInGroup=(permissions:string[])=>permissions.filter(permission=>form.permissions.includes(permission)).length
function toggleGroup(permissions:string[]){const allSelected=permissions.every(permission=>form.permissions.includes(permission));if(allSelected)form.permissions=form.permissions.filter(permission=>!permissions.includes(permission));else form.permissions=Array.from(new Set([...form.permissions,...permissions]))}

async function load(){error.value='';try{const [r,p]=await Promise.all([api.get<ApiResponse<Role[]>>('/v1/roles'),api.get<ApiResponse<Record<string,string[]>>>('/v1/role-presets')]);items.value=r.data.data;presets.value=p.data.data}catch(e){error.value=apiError(e)}}
function open(item?:Role){editing.value=item||null;Object.assign(form,item?{code:item.code,name:item.name,description:item.description||'',permissions:[...item.permissions],is_active:item.is_active}:{code:'',name:'',description:'',permissions:[],is_active:true});drawer.value=true}
function applyPreset(code:string){form.permissions=[...(presets.value[code]||[])];if(!editing.value){form.name=roleLabel(code);form.code=code}}
async function save(){error.value='';try{if(!form.code)form.code=makeCode(form.name);const payload={code:form.code,name:form.name,description:form.description||null,permissions:[...form.permissions],is_active:form.is_active};if(editing.value)await api.patch(`/v1/roles/${editing.value.id}`,payload);else await api.post('/v1/roles',payload);drawer.value=false;success.value='Perfil salvo.';await load()}catch(e){error.value=apiError(e)}}
async function remove(item:Role){const action=item.is_system?'Desativar':'Excluir';const ok=await appConfirm({title:`${action} perfil`,message:`${action} ${item.name}?`,confirmLabel:action,cancelLabel:'Cancelar',tone:item.is_system?'warning':'danger'});if(!ok)return;try{await api.delete(`/v1/roles/${item.id}`);await load()}catch(e){error.value=apiError(e)}}
onMounted(load)
</script>
<template>
<PageHeader title="Perfis e permissões" subtitle="Defina com clareza o que cada perfil pode consultar, cadastrar, editar e administrar."><button class="btn-secondary" @click="load"><RefreshCw :size="18"/>Atualizar</button><button class="btn-primary" @click="open()"><Plus :size="18"/>Novo perfil</button></PageHeader>
<InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>
<div class="grid gap-4 xl:grid-cols-2">
  <article v-for="item in items" :key="item.id" class="card">
    <div class="flex items-start gap-3"><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><h2 class="font-bold">{{item.name}}</h2><span v-if="item.is_system" class="badge bg-violet-50 text-violet-700">Perfil padrão</span><StatusBadge :status="item.is_active?'ACTIVE':'INACTIVE'"/></div><p class="mt-2 text-sm leading-6 text-slate-500">{{item.description||'Perfil de acesso configurado para esta operação.'}}</p></div><button class="btn-secondary px-3 py-2" title="Editar perfil" @click="open(item)"><Edit3 :size="16"/></button><button class="btn-secondary px-3 py-2 text-rose-600" :title="item.is_system?'Desativar perfil':'Excluir perfil'" @click="remove(item)"><Trash2 :size="16"/></button></div>
    <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4"><span class="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{{item.permissions.includes('*')?'Acesso completo':`${item.permissions.length} permissões`}}</span><template v-if="!item.permissions.includes('*')"><span v-for="group in roleGroups(item).slice(0,4)" :key="group" class="badge bg-teal-50 text-teal-700">{{group}}</span><span v-if="roleGroups(item).length>4" class="text-xs font-medium text-slate-400">+{{roleGroups(item).length-4}} áreas</span></template><span v-else class="badge bg-teal-50 text-teal-700">Administração completa</span></div>
  </article>
  <EmptyState v-if="!items.length" title="Nenhum perfil cadastrado"/>
</div>

<DrawerPanel :open="drawer" :title="editing?'Editar perfil':'Novo perfil'" width="xl" @close="drawer=false">
<form class="space-y-5" @submit.prevent="save">
  <div class="grid gap-4 md:grid-cols-2"><div><label class="label">Nome do perfil</label><input v-model="form.name" class="input" placeholder="Ex.: Operador de integrações" required/></div><label class="flex items-center gap-2 pt-8 text-sm"><input v-model="form.is_active" type="checkbox"/> Perfil ativo</label></div>
  <div><label class="label">Descrição</label><textarea v-model="form.description" class="input" rows="2" placeholder="Explique em linguagem simples para que este perfil será usado."/></div>
  <div v-if="!editing" class="rounded-xl border border-slate-200 p-4"><p class="font-semibold text-slate-700">Começar por um perfil sugerido</p><p class="mt-1 text-sm text-slate-500">Escolha uma base e depois ajuste somente o necessário.</p><div class="mt-3 flex flex-wrap gap-2"><button v-for="(_,code) in presets" :key="String(code)" type="button" class="btn-secondary px-3 py-2" @click="applyPreset(String(code))">{{roleLabel(String(code))}}</button></div></div>
  <div><div class="mb-3 flex items-center justify-between"><div><p class="font-semibold text-slate-700">Permissões do perfil</p><p class="text-sm text-slate-500">Organizadas por área para facilitar a administração.</p></div><span class="badge bg-slate-100 text-slate-600">{{form.permissions.includes('*')?'Acesso completo':`${form.permissions.length} selecionadas`}}</span></div>
    <div v-if="form.permissions.includes('*')" class="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p class="flex items-center gap-2 font-semibold text-emerald-800"><CheckSquare2 :size="18"/>Acesso administrativo completo</p><p class="mt-1 text-sm text-emerald-700">Este perfil possui acesso integral. Não é necessário marcar permissões individualmente.</p></div>
    <div v-else class="scroll-clean max-h-[34rem] space-y-3 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-3"><section v-for="(permissions,group) in permissionGroups" :key="group" class="rounded-xl border border-slate-200 bg-white p-3"><div class="mb-2 flex items-center justify-between gap-3"><div><h3 class="text-sm font-bold text-slate-800">{{group}}</h3><p class="text-xs text-slate-400">{{selectedInGroup(permissions)}} de {{permissions.length}} selecionadas</p></div><button type="button" class="text-xs font-semibold text-teal-700 hover:underline" @click="toggleGroup(permissions)">{{permissions.every(permission=>form.permissions.includes(permission))?'Desmarcar área':'Selecionar área'}}</button></div><div class="grid gap-1 sm:grid-cols-2 lg:grid-cols-3"><label v-for="permission in permissions" :key="permission" class="flex items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-slate-50"><input v-model="form.permissions" class="mt-0.5" type="checkbox" :value="permission"/><span>{{permissionLabel(permission)}}</span></label></div></section></div>
  </div>
  <details v-if="!editing?.is_system" class="rounded-xl border border-slate-200 p-4"><summary class="cursor-pointer text-sm font-semibold text-slate-600">Opções avançadas</summary><div class="mt-3"><label class="label">Identificador interno do perfil</label><input v-model="form.code" class="input uppercase" placeholder="Gerado automaticamente"/></div></details>
  <div class="flex justify-end gap-2 border-t pt-4"><button type="button" class="btn-secondary" @click="drawer=false">Cancelar</button><button class="btn-primary">Salvar perfil</button></div>
</form>
</DrawerPanel>
</template>
