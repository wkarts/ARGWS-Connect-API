<script setup lang="ts">
import { Building2, CalendarDays, CircleHelp, Globe2, KeyRound, RefreshCw, ShieldCheck, Sparkles, WalletCards } from 'lucide-vue-next'
import PageHeader from '../../components/PageHeader.vue'
</script>

<template>
  <PageHeader title="Dashboard" subtitle="Visão comercial e operacional da carteira do parceiro Connect|API.">
    <template #actions>
      <button class="btn-secondary h-9 text-[12px]"><CalendarDays :size="15" /> Período atual</button>
      <button class="btn-secondary h-9 text-[12px]"><RefreshCw :size="15" /> Atualizar</button>
    </template>
  </PageHeader>

  <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
    <section class="metric-card"><div><p class="text-[12px] font-medium text-slate-600">Tenants gerenciados</p><p class="mt-1 text-[1.65rem] font-semibold text-slate-950">—</p><p class="mt-1 text-[10px] text-slate-400">Aguardando Partner API</p></div><div class="grid h-11 w-11 place-items-center rounded-xl border border-blue-100 bg-blue-50 text-blue-600"><Building2 :size="21"/></div></section>
    <section class="metric-card"><div><p class="text-[12px] font-medium text-slate-600">Planos ativos</p><p class="mt-1 text-[1.65rem] font-semibold text-slate-950">—</p><p class="mt-1 text-[10px] text-slate-400">Catálogo do parceiro</p></div><div class="grid h-11 w-11 place-items-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-600"><WalletCards :size="21"/></div></section>
    <section class="metric-card"><div><p class="text-[12px] font-medium text-slate-600">Domínios</p><p class="mt-1 text-[1.65rem] font-semibold text-slate-950">—</p><p class="mt-1 text-[10px] text-slate-400">Gerenciados na carteira</p></div><div class="grid h-11 w-11 place-items-center rounded-xl border border-indigo-100 bg-indigo-50 text-indigo-600"><Globe2 :size="21"/></div></section>
    <section class="metric-card"><div><p class="text-[12px] font-medium text-slate-600">API Keys</p><p class="mt-1 text-[1.65rem] font-semibold text-slate-950">—</p><p class="mt-1 text-[10px] text-slate-400">Integrações do parceiro</p></div><div class="grid h-11 w-11 place-items-center rounded-xl border border-violet-100 bg-violet-50 text-violet-600"><KeyRound :size="21"/></div></section>
    <section class="metric-card"><div><p class="text-[12px] font-medium text-slate-600">Status do Partner Plane</p><p class="mt-1 text-[1.35rem] font-semibold text-blue-600">UI pronta</p><p class="mt-1 text-[10px] text-slate-400">Backend isolado pendente</p></div><div class="grid h-11 w-11 place-items-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600"><ShieldCheck :size="21"/></div></section>
  </div>

  <div class="mt-4 grid gap-4 xl:grid-cols-3">
    <section class="dashboard-panel xl:col-span-2">
      <div class="dashboard-panel-header"><div><h2 class="section-title">Carteira de tenants</h2><p class="mt-0.5 text-[11px] text-slate-400">Resumo reservado ao parceiro autenticado</p></div><Building2 :size="17" class="text-blue-600"/></div>
      <div class="dashboard-panel-body">
        <div class="chart-grid flex min-h-[180px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/30 px-8 text-center">
          <div class="max-w-xl"><ShieldCheck :size="24" class="mx-auto text-blue-500"/><p class="mt-3 text-[13px] font-semibold text-slate-800">Frontend separado do Control Plane</p><p class="mt-2 text-[11px] leading-5 text-slate-500">Nenhum endpoint administrativo <code>/control/v1</code> é reutilizado pelo Parceiro. Quando o Partner API for implementado, este painel receberá somente os tenants, planos, consumo e domínios explicitamente delegados.</p></div>
        </div>
      </div>
    </section>
    <section class="dashboard-panel">
      <div class="dashboard-panel-header"><div><h2 class="section-title">Atalhos</h2><p class="mt-0.5 text-[11px] text-slate-400">Gestão da operação</p></div><Sparkles :size="17" class="text-cyan-600"/></div>
      <div class="dashboard-panel-body space-y-2">
        <RouterLink to="/partner-tenants" class="flex items-center gap-3 rounded-lg border border-slate-100 p-3 text-[12px] font-medium text-slate-700 hover:border-blue-100 hover:bg-blue-50/40"><Building2 :size="17" class="text-blue-600"/> Meus tenants</RouterLink>
        <RouterLink to="/partner-branding" class="flex items-center gap-3 rounded-lg border border-slate-100 p-3 text-[12px] font-medium text-slate-700 hover:border-cyan-100 hover:bg-cyan-50/40"><Sparkles :size="17" class="text-cyan-600"/> Whitelabel</RouterLink>
        <RouterLink to="/partner-support" class="flex items-center gap-3 rounded-lg border border-slate-100 p-3 text-[12px] font-medium text-slate-700 hover:border-indigo-100 hover:bg-indigo-50/40"><CircleHelp :size="17" class="text-indigo-600"/> Suporte</RouterLink>
      </div>
    </section>
  </div>
</template>
