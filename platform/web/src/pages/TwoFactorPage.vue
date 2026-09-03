<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { BadgeDollarSign, CheckCircle2, Copy, KeyRound, LogOut, RefreshCw, ShieldCheck, Smartphone } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import { useAuthStore } from '../stores/auth'
import type { ApiResponse, AuthSession } from '../types'
import { useAppStore } from '../stores/app'

interface SetupData { secret:string;otpauth_uri:string;qr_data_uri:string }

const auth=useAuthStore()
const app=useAppStore()
const route=useRoute()
const router=useRouter()
const setup=ref<SetupData|null>(null)
const code=ref('')
const error=ref('')
const loading=ref(false)
const copied=ref(false)
const mode=computed(()=>auth.session?.security?.mode||'VERIFY')
const setupMode=computed(()=>mode.value==='SETUP')
const isControl=computed(()=>auth.isControlPlane)
const authPrefix=computed(()=>isControl.value?'/control/v1/auth':'/v1/auth')
const productName=computed(()=>isControl.value?'Connect|API Control Plane':(app.branding?.name||'Portal'))
const contextLabel=computed(()=>isControl.value?'Proteção administrativa da plataforma':'Proteção da conta')
const securityText=computed(()=>isControl.value
  ?'O Control Plane exige autenticação em duas etapas para todos os usuários humanos. Enquanto esta etapa não for concluída, nenhum recurso administrativo da plataforma será liberado.'
  :'Sua empresa exige uma segunda confirmação de identidade. Enquanto esta etapa não for concluída, os recursos protegidos permanecem bloqueados.')
const footerText=computed(()=>isControl.value
  ?'A sessão administrativa só será liberada após a validação do segundo fator.'
  :'A sessão só será liberada após a validação.')

async function beginSetup(){
  if(!setupMode.value)return
  loading.value=true;error.value=''
  try{setup.value=(await api.post<ApiResponse<SetupData>>(`${authPrefix.value}/mfa/setup`)).data.data}
  catch(exception){error.value=apiError(exception)}finally{loading.value=false}
}
async function submit(){
  if(code.value.replace(/\D/g,'').length!==6)return
  loading.value=true;error.value=''
  try{
    const endpoint=setupMode.value?`${authPrefix.value}/mfa/confirm`:`${authPrefix.value}/mfa/verify`
    const response=await api.post<ApiResponse<AuthSession>>(endpoint,{code:code.value})
    auth.replaceSession(response.data.data)
    await router.replace(String(route.query.redirect||'/'))
  }catch(exception){error.value=apiError(exception)}finally{loading.value=false}
}
async function copySecret(){if(!setup.value?.secret)return;await navigator.clipboard.writeText(setup.value.secret);copied.value=true;setTimeout(()=>copied.value=false,1500)}
async function logout(){await auth.logout();await router.replace('/login')}
onMounted(beginSetup)
</script>

<template>
  <main class="min-h-screen bg-slate-950 px-4 py-10 sm:px-6">
    <div class="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
      <section class="w-full overflow-hidden rounded-3xl bg-white shadow-2xl shadow-black/20 lg:grid lg:grid-cols-[.82fr_1.18fr]">
        <aside class="bg-slate-900 p-8 text-white sm:p-10 lg:p-12">
          <div class="flex items-center gap-3"><div class="grid h-11 w-11 place-items-center rounded-xl bg-teal-500/15 text-teal-300"><BadgeDollarSign :size="24"/></div><div><p class="font-bold">{{productName}}</p><p class="text-xs text-slate-400">{{contextLabel}}</p></div></div>
          <ShieldCheck :size="44" class="mt-14 text-teal-300"/>
          <h1 class="mt-5 text-3xl font-semibold tracking-tight">Autenticação em duas etapas</h1>
          <p class="mt-4 text-sm leading-7 text-slate-300">{{securityText}}</p>
          <div class="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300"><p class="font-semibold text-white">Aplicativos compatíveis</p><p class="mt-2 leading-6">Google Authenticator, Microsoft Authenticator, 1Password, Authy e outros autenticadores TOTP.</p></div>
          <div v-if="isControl" class="mt-4 rounded-2xl border border-amber-400/20 bg-amber-300/10 p-4 text-xs leading-6 text-amber-100">No Control Plane o 2FA é obrigatório e não pode ser desativado por configuração de plano, tenant ou perfil administrativo.</div>
        </aside>

        <div class="p-7 sm:p-10 lg:p-12">
          <div v-if="setupMode">
            <div class="flex items-center gap-3"><div class="rounded-xl bg-teal-50 p-3 text-teal-700"><Smartphone :size="24"/></div><div><h2 class="text-xl font-bold text-slate-950">Configure seu autenticador</h2><p class="text-sm text-slate-500">Esta configuração é obrigatória após o primeiro acesso.</p></div></div>
            <div v-if="loading&&!setup" class="mt-10 flex items-center justify-center gap-2 py-16 text-slate-500"><RefreshCw class="animate-spin" :size="20"/>Preparando QR Code…</div>
            <template v-else-if="setup">
              <div class="mt-7 grid gap-6 sm:grid-cols-[auto_1fr] sm:items-center"><img :src="setup.qr_data_uri" alt="QR Code para autenticação em duas etapas" class="mx-auto h-56 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"/><div><p class="text-sm font-semibold text-slate-800">1. Leia o QR Code</p><p class="mt-2 text-sm leading-6 text-slate-500">No aplicativo autenticador, adicione uma nova conta e leia este código.</p><p class="mt-5 text-sm font-semibold text-slate-800">Alternativa: chave manual</p><button class="mt-2 flex max-w-full items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 font-mono text-xs text-slate-700" @click="copySecret"><span class="truncate">{{setup.secret}}</span><Copy :size="15"/><span class="font-sans">{{copied?'Copiada':''}}</span></button></div></div>
            </template>
          </div>
          <div v-else>
            <div class="flex items-center gap-3"><div class="rounded-xl bg-blue-50 p-3 text-blue-700"><KeyRound :size="24"/></div><div><h2 class="text-xl font-bold text-slate-950">Confirme o acesso</h2><p class="text-sm text-slate-500">Abra seu aplicativo autenticador e informe o código atual.</p></div></div>
          </div>

          <form class="mt-8" @submit.prevent="submit">
            <label class="label">Código de 6 dígitos</label>
            <input v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" class="input h-14 text-center font-mono text-2xl tracking-[.35em]" placeholder="000000" @input="code=code.replace(/\D/g,'').slice(0,6)"/>
            <p v-if="error" class="mt-4 rounded-xl border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">{{error}}</p>
            <button class="btn-primary mt-5 h-12 w-full" :disabled="loading||code.length!==6"><CheckCircle2 :size="18"/>{{loading?'Validando…':setupMode?'Ativar e continuar':'Confirmar e continuar'}}</button>
          </form>
          <div class="mt-6 flex items-center justify-between border-t border-slate-100 pt-5"><p class="text-xs text-slate-400">{{footerText}}</p><button class="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900" @click="logout"><LogOut :size="14"/>Sair</button></div>
        </div>
      </section>
    </div>
  </main>
</template>
