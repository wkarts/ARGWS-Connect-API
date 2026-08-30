<script setup lang="ts">
const modules = ['Parceiros', 'Tenants', 'Instalações', 'Domínios', 'Nodes', 'Provisionamento', 'Observabilidade'];
</script>

<template>
  <main class="shell">
    <aside>
      <strong>ARGWS Connect</strong>
      <span>Control Plane</span>
      <nav><button v-for="item in modules" :key="item">{{ item }}</button></nav>
    </aside>
    <section>
      <header><div><small>FASE 2</small><h1>Visão operacional</h1></div><span class="status">Foundation</span></header>
      <div class="grid">
        <article><span>Tenants</span><b>—</b><small>Registry em construção</small></article>
        <article><span>Instalações</span><b>—</b><small>Provisioner em construção</small></article>
        <article><span>Nodes</span><b>—</b><small>Agent contract em construção</small></article>
        <article><span>Saúde</span><b>OK</b><small>/api/system/health</small></article>
      </div>
    </section>
  </main>
</template>

<style>
:root{font-family:Inter,system-ui,sans-serif;color:#0f172a;background:#f8fafc}*{box-sizing:border-box}body{margin:0}.shell{min-height:100vh;display:grid;grid-template-columns:250px 1fr}aside{padding:28px;background:#fff;border-right:1px solid #e2e8f0;display:flex;flex-direction:column;gap:4px}aside strong{font-size:20px}aside span{color:#64748b;font-size:13px}nav{display:grid;gap:6px;margin-top:28px}button{border:0;background:transparent;text-align:left;padding:11px 12px;border-radius:9px;color:#334155}button:hover{background:#eff6ff;color:#2563eb}section{padding:32px}header{display:flex;justify-content:space-between;align-items:center}h1{margin:3px 0 24px;font-size:28px}small{color:#64748b}.status{background:#dbeafe;color:#1d4ed8;padding:7px 10px;border-radius:999px;font-size:12px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}article{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;display:grid;gap:8px}article b{font-size:28px}@media(max-width:900px){.shell{grid-template-columns:1fr}aside{display:none}.grid{grid-template-columns:1fr 1fr}}@media(max-width:540px){section{padding:20px}.grid{grid-template-columns:1fr}}
</style>
