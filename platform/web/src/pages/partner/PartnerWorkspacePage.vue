<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Activity, Building2, CircleHelp, Globe2, KeyRound, Settings, ShieldCheck, Sparkles, WalletCards } from 'lucide-vue-next'
import PageHeader from '../../components/PageHeader.vue'

const route = useRoute()
const definitions: Record<string, { title: string; subtitle: string; icon: unknown }> = {
  'partner-tenants': { title: 'Meus tenants', subtitle: 'Tenants vinculados e delegados ao parceiro.', icon: Building2 },
  'partner-plans': { title: 'Planos comerciais', subtitle: 'Catálogo, limites e ofertas disponibilizados ao parceiro.', icon: WalletCards },
  'partner-domains': { title: 'Domínios', subtitle: 'Domínios dos tenants pertencentes à carteira do parceiro.', icon: Globe2 },
  'partner-usage': { title: 'Consumo', subtitle: 'Uso consolidado dos recursos comerciais e técnicos delegados.', icon: Activity },
  'partner-api': { title: 'API Keys', subtitle: 'Credenciais próprias do Partner Plane, sem privilégios do Control Plane.', icon: KeyRound },
  'partner-branding': { title: 'Whitelabel', subtitle: 'Identidade visual e regras comerciais do parceiro.', icon: Sparkles },
  'partner-support': { title: 'Suporte', subtitle: 'Acompanhamento e abertura de solicitações do parceiro.', icon: CircleHelp },
  'partner-settings': { title: 'Configurações', subtitle: 'Preferências e políticas permitidas para a conta parceira.', icon: Settings },
}
const page = computed(() => definitions[String(route.name)] || definitions['partner-tenants'])
</script>

<template>
  <PageHeader :title="page.title" :subtitle="page.subtitle" />
  <section class="dashboard-panel">
    <div class="dashboard-panel-body py-14">
      <div class="mx-auto max-w-2xl text-center">
        <div class="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600"><component :is="page.icon" :size="22"/></div>
        <h2 class="mt-4 text-[15px] font-semibold text-slate-900">Interface do Partner Plane preparada</h2>
        <p class="mt-2 text-[12px] leading-6 text-slate-500">Este módulo já usa o mesmo design system do Control Plane e do Tenant Plane. A integração funcional deve ser ligada a endpoints exclusivos de parceiro e a um escopo de autorização próprio.</p>
        <div class="mx-auto mt-5 inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] font-medium text-emerald-700"><ShieldCheck :size="15"/> Sem acesso implícito a /control/v1</div>
      </div>
    </div>
  </section>
</template>
