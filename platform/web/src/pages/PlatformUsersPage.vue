<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Edit3, KeyRound, Plus, RefreshCw, Save, ShieldCheck, UserCheck, UserX } from 'lucide-vue-next'
import { api } from '../api/client'
import type { ApiResponse, PlatformUser } from '../types'
import { dateTimeBR } from '../utils/format'
import { useFeedback } from '../composables/useFeedback'
import PageHeader from '../components/PageHeader.vue'
import ModalDialog from '../components/ModalDialog.vue'
import InlineAlert from '../components/InlineAlert.vue'
import StatusBadge from '../components/StatusBadge.vue'

const users = ref<PlatformUser[]>([])
const modal = ref<'create'|'edit'|'password'|''>('')
const selected = ref<PlatformUser | null>(null)
const { error, success, loading, clear, fail, done } = useFeedback()
const form = reactive({ name: '', email: '', password: '', role: 'PLATFORM_ADMIN', is_active: true })
const roles = ['PLATFORM_SUPERADMIN','PLATFORM_ADMIN','PLATFORM_SUPPORT','PLATFORM_AUDITOR']
const activeCount = computed(() => users.value.filter(item => item.is_active).length)
function roleLabel(role: string) { return ({ PLATFORM_SUPERADMIN:'Superadministrador', PLATFORM_ADMIN:'Administrador', PLATFORM_SUPPORT:'Suporte', PLATFORM_AUDITOR:'Auditor' } as Record<string,string>)[role] || role }
async function load() { loading.value=true; clear(); try { users.value=(await api.get<ApiResponse<PlatformUser[]>>('/control/v1/platform-users')).data.data } catch(reason){fail(reason)} finally{loading.value=false} }
function openCreate(){clear();selected.value=null;Object.assign(form,{name:'',email:'',password:'',role:'PLATFORM_ADMIN',is_active:true});modal.value='create'}
function openEdit(item:PlatformUser){clear();selected.value=item;Object.assign(form,{name:item.name,email:item.email,password:'',role:item.role,is_active:item.is_active});modal.value='edit'}
function openPassword(item:PlatformUser){clear();selected.value=item;form.password='';modal.value='password'}
async function save(){clear();loading.value=true;try{if(modal.value==='create'){await api.post('/control/v1/platform-users',form);done('Usuário do Control Plane criado.')}else if(selected.value){await api.patch(`/control/v1/platform-users/${selected.value.id}`,{name:form.name,role:form.role,is_active:form.is_active});done('Usuário atualizado.')}modal.value='';await load()}catch(reason){fail(reason)}finally{loading.value=false}}
async function resetPassword(){if(!selected.value)return;clear();loading.value=true;try{await api.post(`/control/v1/platform-users/${selected.value.id}/password`,{password:form.password});done('Senha redefinida e bloqueios removidos.');modal.value=''}catch(reason){fail(reason)}finally{loading.value=false}}
onMounted(load)
</script>
<template>
<PageHeader title="Equipe da plataforma" subtitle="Acessos administrativos independentes dos usuários de cada tenant."><button class="btn-secondary" @click="load"><RefreshCw :size="18" :class="loading&&'animate-spin'"/> Atualizar</button><button class="btn-primary" @click="openCreate"><Plus :size="18"/> Novo usuário</button></PageHeader>
<InlineAlert :message="error" @dismiss="error=''"/><InlineAlert :message="success" type="success" @dismiss="success=''"/>
<div class="mb-6 grid gap-4 sm:grid-cols-3"><div class="card"><p class="text-xs uppercase text-slate-400">Usuários</p><p class="mt-2 text-3xl font-bold">{{users.length}}</p></div><div class="card"><p class="text-xs uppercase text-slate-400">Ativos</p><p class="mt-2 text-3xl font-bold text-emerald-700">{{activeCount}}</p></div><div class="card"><p class="text-xs uppercase text-slate-400">Separação</p><p class="mt-2 flex items-center gap-2 font-semibold"><ShieldCheck :size="20" class="text-teal-700"/> Control Plane IAM</p></div></div>
<div class="table-wrap"><table class="table"><thead><tr><th>Usuário</th><th>Papel</th><th>Status</th><th>Último acesso</th><th>Criado</th><th></th></tr></thead><tbody><tr v-for="item in users" :key="item.id" class="border-t border-slate-100"><td><p class="font-semibold">{{item.name}}</p><p class="text-xs text-slate-400">{{item.email}}</p></td><td><span class="badge bg-indigo-50 text-indigo-700">{{roleLabel(item.role)}}</span></td><td><StatusBadge :status="item.is_active?'ACTIVE':'INACTIVE'"/></td><td>{{dateTimeBR(item.last_login_at)}}</td><td>{{dateTimeBR(item.created_at)}}</td><td><div class="flex justify-end gap-2"><button class="btn-secondary !px-3 !py-2" @click="openEdit(item)"><Edit3 :size="15"/> Editar</button><button class="btn-secondary !px-3 !py-2" @click="openPassword(item)"><KeyRound :size="15"/> Senha</button></div></td></tr></tbody></table></div>
<ModalDialog :open="modal==='create'||modal==='edit'" :title="modal==='create'?'Novo usuário da plataforma':'Editar usuário'" size="lg" @close="modal=''">
<form class="space-y-5" @submit.prevent="save"><div class="grid gap-4 md:grid-cols-2"><div><label class="label">Nome</label><input v-model="form.name" class="input" required/></div><div><label class="label">E-mail</label><input v-model="form.email" class="input" type="email" :disabled="modal==='edit'" required/></div><div v-if="modal==='create'"><label class="label">Senha inicial</label><input v-model="form.password" class="input" type="password" minlength="12" required/></div><div><label class="label">Papel</label><select v-model="form.role" class="select"><option v-for="role in roles" :key="role" :value="role">{{roleLabel(role)}}</option></select></div></div><label class="flex items-center gap-2 text-sm"><input v-model="form.is_active" type="checkbox"/><component :is="form.is_active?UserCheck:UserX" :size="18"/> Usuário ativo</label><div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="modal=''">Cancelar</button><button class="btn-primary"><Save :size="18"/> Salvar</button></div></form>
</ModalDialog>
<ModalDialog :open="modal==='password'" title="Redefinir senha" @close="modal=''">
<form class="space-y-4" @submit.prevent="resetPassword"><p class="text-sm text-slate-500">Defina uma nova senha para <strong>{{selected?.name}}</strong>. Tentativas falhas e bloqueios serão zerados.</p><div><label class="label">Nova senha</label><input v-model="form.password" class="input" type="password" minlength="12" required/></div><div class="flex justify-end gap-2"><button type="button" class="btn-secondary" @click="modal=''">Cancelar</button><button class="btn-primary"><KeyRound :size="18"/> Redefinir</button></div></form>
</ModalDialog>
</template>
