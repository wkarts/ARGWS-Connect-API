<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Cable, Network, ShieldCheck, Webhook } from 'lucide-vue-next'
import { api, apiError } from '../api/client'
import type { ApiResponse } from '../types'
import { brand } from '../config/brand'
import { useAppStore } from '../stores/app'
import { useAuthStore } from '../stores/auth'

interface PublicSite {
  name: string
  hostname: string
  demo_mode: boolean
  landing: { mode: 'DISABLED' | 'PLATFORM' | 'EXTERNAL'; url: string; title: string; subtitle: string; cta_label: string; cta_url: string }
}
const router=useRouter(); const app=useAppStore(); const auth=useAuthStore(); const site=ref<PublicSite|null>(null); const error=ref('')
function safeLocalTarget(value:string){ const target=String(value||'').trim(); return !target||!target.startsWith('/')||target.startsWith('//')?'/login':target }
async function openCta(){ await router.push(safeLocalTarget(site.value?.landing.cta_url||'/login')) }
onMounted(async()=>{ if(!auth.isTenantPlane){await router.replace('/login');return} try{ const response=await api.get<ApiResponse<PublicSite>>('/v1/public/site'); site.value=response.data.data; if(site.value.landing.mode==='DISABLED'){await router.replace('/login');return} if(site.value.landing.mode==='EXTERNAL'){ if(site.value.landing.url)window.location.replace(site.value.landing.url); else await router.replace('/login') } }catch(exception){ error.value=apiError(exception) } })
</script>

<template>
  <main class="min-h-screen bg-slate-50 text-slate-950">
    <div class="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-7 sm:px-8 lg:px-12">
      <header class="flex items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div class="flex min-w-0 items-center gap-4">
          <img v-if="app.branding?.logo_light_url" :src="app.branding.logo_light_url" :alt="app.branding.name" class="h-9 w-auto"/>
          <div class="hidden min-w-0 border-l border-slate-200 pl-4 sm:block"><p class="truncate text-sm font-semibold">{{ site?.name || app.branding?.name || brand.productName }}</p><p class="truncate text-xs text-slate-400">{{ brand.tagline }}</p></div>
        </div>
        <button class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50" @click="router.push('/login')">Entrar</button>
      </header>

      <section v-if="error" class="my-auto rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-700">
        <p class="font-semibold">Não foi possível carregar esta página.</p><p class="mt-2 text-sm">{{ error }}</p><button class="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white" @click="router.push('/login')">Acessar ambiente</button>
      </section>

      <section v-else-if="site" class="my-auto grid items-center gap-12 py-16 lg:grid-cols-[1.05fr_.95fr] lg:py-24">
        <div>
          <div v-if="site.demo_mode" class="mb-6 inline-flex rounded-full border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm font-semibold text-amber-700">Ambiente de demonstração</div>
          <h1 class="max-w-4xl text-4xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl lg:text-6xl">{{ site.landing.title || 'Comunicação e integração em uma plataforma única.' }}</h1>
          <p class="mt-6 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">{{ site.landing.subtitle || 'Conecte canais, eventos, webhooks, automações e telefonia com isolamento multitenant.' }}</p>
          <div class="mt-8 flex flex-wrap gap-3">
            <button class="inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700" @click="openCta">{{ site.landing.cta_label || 'Acessar plataforma' }}<ArrowRight :size="18"/></button>
            <button class="min-h-12 rounded-xl border border-slate-200 bg-white px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50" @click="router.push('/login')">Já tenho acesso</button>
          </div>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><Cable :size="23" class="text-blue-600"/><h2 class="mt-4 font-semibold">Canais e instâncias</h2><p class="mt-2 text-sm leading-6 text-slate-500">Organização de conexões e providers por tenant.</p></article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><Webhook :size="23" class="text-cyan-600"/><h2 class="mt-4 font-semibold">Eventos e webhooks</h2><p class="mt-2 text-sm leading-6 text-slate-500">Ingestão idempotente, correlação e entrega auditável.</p></article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><Network :size="23" class="text-blue-600"/><h2 class="mt-4 font-semibold">PBX e VOIP</h2><p class="mt-2 text-sm leading-6 text-slate-500">Extensões de telefonia preparadas para evolução modular.</p></article>
          <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><ShieldCheck :size="23" class="text-blue-600"/><h2 class="mt-4 font-semibold">Isolamento por tenant</h2><p class="mt-2 text-sm leading-6 text-slate-500">Banco, storage, permissões e auditoria segregados.</p></article>
        </div>
      </section>
      <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5 text-xs text-slate-400"><span>{{ site?.hostname }}</span><span>{{ app.branding?.name || brand.productName }}</span></footer>
    </div>
  </main>
</template>
