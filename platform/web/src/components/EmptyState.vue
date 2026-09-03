<script setup lang="ts">
import { Inbox } from 'lucide-vue-next'
withDefaults(defineProps<{ title?: string; description?: string }>(), { title: 'Nenhum registro encontrado', description: 'Altere os filtros ou cadastre um novo item.' })
</script>
<template>
  <div class="grid min-h-48 place-items-center px-6 py-10 text-center">
    <div><div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400"><Inbox :size="24" /></div><p class="font-semibold text-slate-700">{{ title }}</p><p class="mt-1 max-w-md text-sm text-slate-500">{{ description }}</p><div class="mt-4"><slot /></div></div>
  </div>
</template>
