<script setup lang="ts">
import { Cable, CheckCircle2 } from 'lucide-vue-next'
</script>

<template>
  <section class="space-y-5">
    <div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex items-start gap-4">
        <div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><Cable :size="22" /></div>
        <div>
          <h1 class="text-xl font-bold text-slate-950">Connect|API VOIP</h1>
          <p class="mt-1 text-sm text-slate-500">Módulo VOIP da plataforma.</p>
        </div>
      </div>
      <div class="mt-6 rounded-xl border border-cyan-100 bg-cyan-50/60 p-4 text-sm leading-6 text-slate-700">Base preparada para contas SIP, dispositivos, chamadas, codecs, registros e monitoramento.</div>
    </div>
    <div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p class="flex items-center gap-2 text-sm font-semibold text-slate-800"><CheckCircle2 :size="17" class="text-blue-600" /> Foundation ativa</p>
      <p class="mt-2 text-sm leading-6 text-slate-500">Este módulo faz parte do blueprint Connect|API Platform. A implementação funcional deve seguir os contratos de tenant, RBAC, auditoria, eventos e observabilidade documentados no repositório.</p>
    </div>
  </section>
</template>
