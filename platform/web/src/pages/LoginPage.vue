<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Eye, EyeOff, LockKeyhole, Mail, Network, ShieldCheck, Webhook, Workflow } from 'lucide-vue-next'
import { useAuthStore } from '../stores/auth'
import { apiError } from '../api/client'
import { brand } from '../config/brand'
import { useAppStore } from '../stores/app'
const auth=useAuthStore(); const app=useAppStore(); const router=useRouter(); const email=ref(''); const password=ref(''); const showPassword=ref(false); const error=ref('')
const accessLabel=computed(()=>auth.isControlPlane?'Control Plane':auth.isPartnerPlane?'Partner Plane':'Tenant Plane')
const heading=computed(()=>auth.isControlPlane?'Acesse o Control Plane':auth.isPartnerPlane?'Acesse o Partner Plane':'Acesse seu ambiente Connect|API')
const loginLogo=computed(()=>auth.isControlPlane?brand.platformLogoLight:(app.branding?.logo_light_url||''))
const loginAlt=computed(()=>auth.isControlPlane?brand.productName:(app.branding?.name||'Portal'))
const description=computed(()=>auth.isControlPlane?'Administre tenants, infraestrutura, segurança, branding e operação.':auth.isPartnerPlane?'Gerencie sua carteira, planos, consumo e whitelabel dentro dos limites delegados pela plataforma.':'Gerencie canais, instâncias, eventos, automações e integrações em um ambiente isolado.')
async function submit(){ error.value=''; try{ await auth.login(email.value,password.value); await router.push('/') }catch(e){ error.value=apiError(e) } }
</script>
<template>
  <main class="min-h-screen bg-slate-50 px-5 py-8 sm:px-8">
    <div class="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50 lg:grid-cols-[1.05fr_.95fr]">
      <section class="relative hidden overflow-hidden bg-gradient-to-br from-blue-50 via-white to-cyan-50 p-12 lg:flex lg:flex-col">
        <img v-if="loginLogo" :src="loginLogo" :alt="loginAlt" class="max-h-12 w-auto max-w-[260px] self-start object-contain object-left" />
        <div class="my-auto max-w-xl py-12">
          <span class="inline-flex rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-[.14em] text-blue-700">{{ brand.tagline }}</span>
          <h1 class="mt-6 text-5xl font-semibold leading-tight tracking-[-.04em] text-slate-950">Conecte canais, eventos e sistemas em uma única plataforma.</h1>
          <p class="mt-6 text-base leading-7 text-slate-600">Foundation multitenant com Control Plane, isolamento por banco, filas, webhooks, observabilidade, PBX e VOIP preparados para evolução modular.</p>
          <div class="mt-8 grid gap-3 sm:grid-cols-3">
            <div class="rounded-2xl border border-slate-200 bg-white/80 p-4"><Network class="text-blue-600" :size="20"/><p class="mt-3 text-sm font-semibold">Canais</p></div>
            <div class="rounded-2xl border border-slate-200 bg-white/80 p-4"><Webhook class="text-cyan-600" :size="20"/><p class="mt-3 text-sm font-semibold">Eventos</p></div>
            <div class="rounded-2xl border border-slate-200 bg-white/80 p-4"><Workflow class="text-blue-600" :size="20"/><p class="mt-3 text-sm font-semibold">Automações</p></div>
          </div>
        </div>
        <p class="flex items-center gap-2 text-xs text-slate-500"><ShieldCheck :size="15"/> Ambiente protegido e segregado por tenant</p>
      </section>
      <section class="flex items-center justify-center p-6 sm:p-10 lg:p-14">
        <div class="w-full max-w-md">
          <img v-if="loginLogo" :src="loginLogo" :alt="loginAlt" class="mb-10 max-h-11 w-auto max-w-[240px] lg:hidden" />
          <div class="mb-8"><p class="text-xs font-bold uppercase tracking-[.16em] text-blue-600">{{ accessLabel }}</p><h2 class="mt-3 text-3xl font-semibold tracking-[-.03em] text-slate-950">{{ heading }}</h2><p class="mt-3 text-sm leading-6 text-slate-500">{{ description }}</p></div>
          <form class="space-y-5" @submit.prevent="submit">
            <div><label for="connect-login-email" class="label">E-mail</label><div class="relative mt-1.5"><Mail class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" :size="19"/><input id="connect-login-email" v-model.trim="email" type="email" required autocomplete="username" class="input h-12 pl-11" placeholder="seu@email.com"/></div></div>
            <div><label for="connect-login-password" class="label">Senha</label><div class="relative mt-1.5"><LockKeyhole class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" :size="19"/><input id="connect-login-password" v-model="password" :type="showPassword?'text':'password'" required autocomplete="current-password" class="input h-12 pl-11 pr-12" placeholder="Digite sua senha"/><button type="button" class="absolute right-2.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 hover:bg-slate-100" @click="showPassword=!showPassword"><EyeOff v-if="showPassword" :size="19"/><Eye v-else :size="19"/></button></div></div>
            <p v-if="error" role="alert" class="rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ error }}</p>
            <button class="btn-primary h-12 w-full text-sm font-semibold" :disabled="auth.loading">{{ auth.loading?'Validando acesso…':'Entrar' }}</button>
          </form>
        </div>
      </section>
    </div>
  </main>
</template>
