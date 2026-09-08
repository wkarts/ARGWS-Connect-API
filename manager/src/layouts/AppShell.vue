<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrandMark from '@/components/BrandMark.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useSessionStore } from '@/stores/session'
import { useUiStore } from '@/stores/ui'
import { featureEnabled } from '@/config/runtime'

const route = useRoute(), router = useRouter(), session = useSessionStore(), ui = useUiStore()
onMounted(() => ui.applyTheme())
const groups = [
  { title: 'PRINCIPAL', items: [{ label:'Visão Geral', to:'/', icon:'home' }] },
  { title: 'COMUNICAÇÃO', items: [
    { label:'Instâncias', to:'/instancias', icon:'radio', permission:'instances.read' },
    { label:'Canais', to:'/canais', icon:'channels', permission:'instances.read' },
    { label:'Conversas', to:'/conversas', icon:'chat', permission:'messages.read' },
    { label:'Mensagens', to:'/mensagens', icon:'mail', permission:'messages.read', feature:'messages' },
    { label:'Contatos', to:'/contatos', icon:'users', permission:'messages.read', feature:'contacts' },
  ]},
  { title: 'VOZ', items: [
    { label:'Chamadas', to:'/chamadas', icon:'phone', permission:'pbx.read', feature:'voice' },
    { label:'Ramais', to:'/ramais', icon:'hash', permission:'pbx.read', feature:'voice' },
    { label:'Filas', to:'/filas', icon:'list', permission:'pbx.read', feature:'voice' },
  ]},
  { title: 'AUTOMAÇÃO', items: [
    { label:'Integrações', to:'/integracoes', icon:'workflow', permission:'instances.read' },
    { label:'Fluxos', to:'/fluxos', icon:'workflow', permission:'studio.read', feature:'studio' },
    { label:'Automações', to:'/automacoes', icon:'automation', permission:'studio.read', feature:'studio' },
  ]},
  { title: 'ADMINISTRAÇÃO', items: [
    { label:'Usuários', to:'/usuarios', icon:'users', permission:'users.read', feature:'users' },
    { label:'Permissões', to:'/permissoes', icon:'key', permission:'users.read', feature:'permissions' },
    { label:'Auditoria', to:'/auditoria', icon:'audit', permission:'audit.read', feature:'audit' },
    { label:'Segurança da conta', to:'/seguranca', icon:'shield', feature:'security' },
  ]},
  { title: 'SISTEMA', items: [
    { label:'Saúde', to:'/saude', icon:'heart' },
    { label:'Atualizações', to:'/atualizacoes', icon:'refresh', feature:'updates' },
    { label:'Configurações', to:'/configuracoes', icon:'settings', feature:'settings' },
  ]},
]
const visibleGroups = computed(() => groups
  .map(g => ({...g, items:g.items.filter((i:any)=>(!i.permission || session.hasPermission(i.permission)) && (!i.feature || featureEnabled(i.feature, false)))}))
  .filter(g=>g.items.length))
async function logout(){ await session.logout(); router.push('/login') }
</script>
<template>
  <div class="app-shell" :class="{ 'sidebar-open': ui.sidebarOpen }">
    <aside class="sidebar">
      <RouterLink to="/" class="sidebar-brand" @click="ui.closeSidebar"><BrandMark :inverse="true" /></RouterLink>
      <nav class="sidebar-nav">
        <section v-for="group in visibleGroups" :key="group.title" class="nav-group">
          <h4>{{ group.title }}</h4>
          <RouterLink v-for="item in group.items" :key="item.to" :to="item.to" class="nav-link" @click="ui.closeSidebar"><AppIcon :name="item.icon" :size="18"/><span>{{ item.label }}</span></RouterLink>
        </section>
      </nav>
    </aside>
    <button class="sidebar-scrim" aria-label="Fechar menu" @click="ui.closeSidebar"></button>
    <div class="workspace">
      <header class="topbar">
        <button class="icon-button mobile-only" @click="ui.toggleSidebar"><AppIcon name="list" /></button>
        <div class="top-search"><AppIcon name="search" :size="18"/><input v-model="ui.query" placeholder="Buscar no sistema..." /></div>
        <div class="top-actions">
          <button class="icon-button" aria-label="Notificações"><AppIcon name="bell" /></button>
          <button class="icon-button" :aria-label="ui.theme === 'dark' ? 'Usar modo claro' : 'Usar modo escuro'" @click="ui.toggleTheme"><AppIcon :name="ui.theme === 'dark' ? 'sun' : 'moon'" /></button>
          <div class="profile-block"><span class="avatar">{{ session.account?.name?.slice(0,1)?.toUpperCase() || 'A' }}</span><div><strong>{{ session.account?.name || 'Administrador' }}</strong><small>{{ session.account?.roleLabel || 'Administração' }}</small></div></div>
          <button class="btn ghost compact" @click="logout">Sair</button>
        </div>
      </header>
      <main class="content"><slot /></main>
    </div>
  </div>
</template>
