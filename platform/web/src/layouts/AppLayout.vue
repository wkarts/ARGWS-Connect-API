<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router'
import {
  Activity, AppWindow, Bell, Braces, Building2, Cable, ChevronDown, CircleHelp, CloudCog, DatabaseBackup,
  FileCode2, Gauge, Globe2, KeyRound, LogOut, Menu, MessageSquare, Network, RefreshCw, Search, ScrollText,
  ServerCog, Settings, ShieldCheck, Sparkles, UserCog, Users, WalletCards, Workflow, X
} from 'lucide-vue-next'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { roleLabel } from '../utils/labels'
import { brand } from '../config/brand'

interface MenuItem { to: string; label: string; icon: unknown; badge?: string }
interface MenuGroup { label?: string; items: MenuItem[] }

const auth = useAuthStore()
const app = useAppStore()
const route = useRoute()
const router = useRouter()
const notificationsOpen = ref(false)

const controlMenu: MenuGroup[] = [
  { items: [
    { to: '/', label: 'Dashboard', icon: Gauge },
    { to: '/tenants', label: 'Tenants', icon: Building2 },
    { to: '/partners', label: 'Partners', icon: Users },
    { to: '/plans', label: 'Planos', icon: WalletCards },
    { to: '/domains', label: 'Domínios', icon: Globe2 },
  ]},
  { label: 'Operação', items: [
    { to: '/provisioning', label: 'Provisionamento', icon: CloudCog },
    { to: '/platform-whatsapp', label: 'Canais globais', icon: MessageSquare },
    { to: '/resources', label: 'Recursos', icon: ServerCog },
    { to: '/platform-health', label: 'Saúde e filas', icon: Activity },
    { to: '/observability', label: 'Observabilidade', icon: ScrollText },
    { to: '/backups', label: 'Backups', icon: DatabaseBackup },
  ]},
  { label: 'Governança', items: [
    { to: '/platform-users', label: 'Equipe', icon: Users },
    { to: '/platform-access', label: 'API e suporte', icon: KeyRound },
    { to: '/control-audit', label: 'Auditoria', icon: ShieldCheck },
    { to: '/landing-builder', label: 'Landing / Whitelabel', icon: Sparkles },
    { to: '/control-settings', label: 'Configurações', icon: Settings },
  ]},
]

const partnerMenu: MenuGroup[] = [
  { items: [
    { to: '/', label: 'Dashboard', icon: Gauge },
    { to: '/partner-tenants', label: 'Meus tenants', icon: Building2 },
    { to: '/partner-plans', label: 'Planos comerciais', icon: WalletCards },
    { to: '/partner-domains', label: 'Domínios', icon: Globe2 },
  ]},
  { label: 'Operação', items: [
    { to: '/partner-usage', label: 'Consumo', icon: Activity },
    { to: '/partner-api', label: 'API Keys', icon: KeyRound },
    { to: '/partner-branding', label: 'Whitelabel', icon: Sparkles },
  ]},
  { label: 'Conta', items: [
    { to: '/partner-support', label: 'Suporte', icon: CircleHelp },
    { to: '/partner-settings', label: 'Configurações', icon: Settings },
  ]},
]

const tenantMenu: MenuGroup[] = [
  { items: [
    { to: '/', label: 'Dashboard', icon: Gauge },
    { to: '/channels', label: 'Canais', icon: Cable },
    { to: '/instances', label: 'Instâncias', icon: Network },
    { to: '/messages', label: 'Mensagens', icon: MessageSquare },
  ]},
  { label: 'Operação', items: [
    { to: '/events', label: 'Eventos', icon: Activity },
    { to: '/pbx', label: 'PBX', icon: ServerCog },
    { to: '/voip', label: 'VOIP', icon: Cable },
  ]},
  { label: 'Studios', items: [
    { to: '/templates', label: 'Template Studio', icon: FileCode2 },
    { to: '/integrations', label: 'Integration Studio', icon: Braces },
    { to: '/micro-apps', label: 'Micro App Studio', icon: AppWindow },
    { to: '/automations', label: 'Automation Studio', icon: Workflow },
  ]},
  { label: 'Administração', items: [
    { to: '/roles', label: 'Perfis e permissões', icon: UserCog },
    { to: '/users', label: 'Usuários', icon: Users },
    { to: '/audit', label: 'Auditoria', icon: ShieldCheck },
  ]},
]

const groups = computed(() => auth.isControlPlane ? controlMenu : auth.isPartnerPlane ? partnerMenu : tenantMenu)
const planeName = computed(() => auth.isControlPlane ? 'Control Plane' : auth.isPartnerPlane ? 'Partner Plane' : 'Tenant Plane')
const contextName = computed(() => {
  if (auth.isControlPlane) return 'Todos os tenants'
  if (auth.isPartnerPlane) return 'Minha carteira'
  return app.tenant?.branding.name || auth.session?.tenant?.slug || 'Meu ambiente'
})
const searchPlaceholder = computed(() => {
  if (auth.isControlPlane) return 'Buscar tenants, domínios, instâncias...'
  if (auth.isPartnerPlane) return 'Buscar tenants, planos, domínios...'
  return 'Buscar canais, instâncias, eventos...'
})
const sidebarLogo = computed(() => {
  if (auth.isControlPlane) return brand.platformLogoLight
  return app.branding?.logo_light_url || ''
})
const sidebarAlt = computed(() => auth.isControlPlane ? brand.productName : app.branding?.name || '')

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path === to || route.path.startsWith(`${to}/`)
}

async function logout() {
  await auth.logout()
  await router.push('/login')
}

async function refreshContext() {
  if (auth.isTenantPlane) await app.loadTenantContext()
}

onMounted(refreshContext)
</script>

<template>
  <div class="app-shell">
    <div v-if="app.sidebarOpen" class="fixed inset-0 z-30 bg-slate-950/30 backdrop-blur-[1px] lg:hidden" @click="app.sidebarOpen=false" />

    <aside
      class="app-sidebar fixed inset-y-0 left-0 z-40 flex w-[258px] max-w-[86vw] flex-col transition-transform duration-200 lg:translate-x-0"
      :class="app.sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex h-[66px] items-center border-b border-[#e8edf5] px-5">
        <img v-if="sidebarLogo" :src="sidebarLogo" :alt="sidebarAlt" class="max-h-10 w-auto max-w-[200px] object-contain object-left" /><span v-else class="text-sm font-semibold text-slate-500">{{ sidebarAlt || 'Portal' }}</span>
        <button class="ml-auto rounded-lg p-2 text-slate-400 hover:bg-slate-100 lg:hidden" @click="app.sidebarOpen=false">
          <X :size="18" />
        </button>
      </div>

      <nav class="scroll-clean flex-1 overflow-y-auto px-3 py-5">
        <section v-for="(group, index) in groups" :key="group.label || index" :class="index ? 'mt-5' : ''">
          <p v-if="group.label" class="mb-1.5 px-3 text-[9px] font-bold uppercase tracking-[.16em] text-slate-400">{{ group.label }}</p>
          <div class="space-y-0.5">
            <RouterLink
              v-for="item in group.items"
              :key="item.to"
              :to="item.to"
              class="nav-item"
              :class="isActive(item.to) ? 'nav-item-active' : ''"
              @click="app.sidebarOpen=false"
            >
              <component :is="item.icon" :size="17" :stroke-width="1.9" />
              <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
              <span v-if="item.badge" class="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">{{ item.badge }}</span>
            </RouterLink>
          </div>
        </section>
      </nav>

      <div class="p-3">
        <div class="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div class="flex items-center gap-3">
            <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white">
              {{ (auth.user?.name || 'U').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() }}
            </div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-[13px] font-semibold text-slate-900">{{ auth.user?.name }}</p>
              <p class="truncate text-[11px] text-slate-500">{{ roleLabel(auth.user?.role) }}</p>
            </div>
            <ChevronDown :size="15" class="text-slate-400" />
          </div>
          <div class="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5">
            <span class="text-[10px] font-medium uppercase tracking-[.08em] text-slate-400">{{ planeName }}</span>
            <button class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Sair" @click="logout">
              <LogOut :size="16" />
            </button>
          </div>
        </div>
      </div>
    </aside>

    <div class="min-w-0 lg:pl-[258px]">
      <header class="app-topbar sticky top-0 z-20 flex h-[66px] items-center px-3 sm:px-4 lg:px-5">
        <button class="mr-2 rounded-lg p-2 text-slate-600 hover:bg-slate-50 lg:hidden" @click="app.sidebarOpen=true">
          <Menu :size="20" />
        </button>

        <button class="context-button">
          <span class="grid h-6 w-6 place-items-center rounded-md bg-blue-50 text-blue-600">
            <Building2 v-if="auth.isControlPlane || auth.isPartnerPlane" :size="14" />
            <Network v-else :size="14" />
          </span>
          <span class="min-w-0 flex-1 truncate text-left">{{ contextName }}</span>
          <ChevronDown :size="14" class="text-slate-400" />
        </button>

        <div class="ml-auto flex items-center gap-1 sm:gap-2">
          <div class="relative hidden lg:block">
            <Search class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" :size="15" />
            <input class="topbar-search" :placeholder="searchPlaceholder" aria-label="Busca global" />
          </div>

          <button v-if="auth.isTenantPlane" class="topbar-icon" title="Atualizar contexto" @click="refreshContext">
            <RefreshCw :size="17" />
          </button>

          <div class="relative">
            <button class="topbar-icon" title="Notificações" @click="notificationsOpen=!notificationsOpen">
              <Bell :size="18" />
              <span class="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-blue-600 ring-2 ring-white" />
            </button>
            <div v-if="notificationsOpen" class="absolute right-0 mt-2 w-[min(21rem,calc(100vw-1.5rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
              <div class="flex items-center justify-between">
                <p class="text-sm font-semibold text-slate-950">Central operacional</p>
                <span class="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600">{{ planeName }}</span>
              </div>
              <p class="mt-2 text-[12px] leading-5 text-slate-500">Eventos relevantes de infraestrutura, canais, instâncias, webhooks, PBX e VOIP serão consolidados aqui.</p>
            </div>
          </div>

          <button class="topbar-icon hidden sm:grid" title="Ajuda"><CircleHelp :size="18" /></button>

          <div class="ml-1 grid h-8 w-8 place-items-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
            {{ (auth.user?.name || 'U').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() }}
          </div>
          <ChevronDown :size="14" class="hidden text-slate-400 sm:block" />
        </div>
      </header>

      <main class="min-w-0 p-4 sm:p-5 lg:p-6 xl:p-7">
        <RouterView />
      </main>
    </div>
  </div>
</template>
