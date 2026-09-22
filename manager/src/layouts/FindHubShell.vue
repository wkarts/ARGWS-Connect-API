<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from './AppShell.vue'
import { findHubPath } from '@/services/findhub-channel'
const route = useRoute()
const groups = computed(() => [
  { title: 'GOOGLE FIND HUB', items: [
    { label: 'Contas Google', to: '/findhub', icon: 'location', permission: 'instances.read' },
    ...(route.params.id ? [
      { label: 'Vinculação da conta', to: findHubPath(String(route.params.id), 'conta'), icon: 'key', permission: 'instances.read' },
      { label: 'Dispositivos', to: findHubPath(String(route.params.id), 'dispositivos'), icon: 'radio', permission: 'instances.read' },
      { label: 'Histórico de posições', to: findHubPath(String(route.params.id), 'historico'), icon: 'location', permission: 'instances.read' },
      { label: 'Integração Traccar', to: findHubPath(String(route.params.id), 'integracoes'), icon: 'workflow', permission: 'instances.read' },
      { label: 'Eventos e webhooks', to: findHubPath(String(route.params.id), 'eventos'), icon: 'workflow', permission: 'instances.read' },
    ] : []),
  ] },
  { title: 'PLATAFORMA', items: [
    { label: 'Todos os canais', to: '/instancias', icon: 'channels', permission: 'instances.read' },
    { label: 'Documentação', to: '/documentacao', icon: 'list', feature: 'docs' },
    { label: 'Diagnóstico', to: '/diagnostico', icon: 'audit', permission: 'audit.read' },
  ] },
])
</script>
<template><AppShell :navigation-groups="groups"><slot /></AppShell></template>
