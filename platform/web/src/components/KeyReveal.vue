<script setup lang="ts">
import { AlertTriangle, X } from 'lucide-vue-next'
import CopyButton from './CopyButton.vue'
defineProps<{ open: boolean; title?: string; value: string; description?: string }>()
defineEmits<{ close: [] }>()
</script>
<template>
  <div v-if="open" class="fixed inset-0 z-[70] grid place-items-center bg-slate-950/60 p-4">
    <section class="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
      <div class="flex items-start gap-3"><div class="rounded-2xl bg-amber-100 p-3 text-amber-700"><AlertTriangle :size="24"/></div><div class="flex-1"><h2 class="text-lg font-bold">{{title||'Credencial criada'}}</h2><p class="mt-1 text-sm text-slate-500">{{description||'Copie e armazene com segurança. A credencial completa não será exibida novamente.'}}</p></div><button class="rounded-xl p-2 text-slate-400 hover:bg-slate-100" @click="$emit('close')"><X :size="20"/></button></div>
      <div class="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4"><code class="break-all text-sm font-semibold text-amber-950">{{value}}</code></div>
      <div class="mt-5 flex justify-end gap-2"><CopyButton :value="value"/><button class="btn-primary" @click="$emit('close')">Já salvei</button></div>
    </section>
  </div>
</template>
