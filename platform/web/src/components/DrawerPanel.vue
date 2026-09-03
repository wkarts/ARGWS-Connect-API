<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'
const props = withDefaults(defineProps<{ open: boolean; title: string; subtitle?: string; width?: 'md'|'lg'|'xl'; size?: 'md'|'lg'|'xl' }>(), { width: 'lg' })
const emit = defineEmits<{ close: [] }>()
const resolvedWidth = computed(() => props.size || props.width)
</script>
<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50">
      <div class="absolute inset-0 bg-slate-950/50 backdrop-blur-[1px]" @click="emit('close')" />
      <aside class="absolute inset-y-0 right-0 flex w-full flex-col bg-white shadow-2xl" :class="resolvedWidth === 'md' ? 'max-w-lg' : resolvedWidth === 'xl' ? 'max-w-4xl' : 'max-w-2xl'">
        <header class="flex items-start gap-4 border-b border-slate-200 px-5 py-5"><div class="flex-1"><h2 class="text-lg font-bold text-slate-900">{{ title }}</h2><p v-if="subtitle" class="mt-1 text-sm text-slate-500">{{ subtitle }}</p></div><button type="button" class="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" @click="emit('close')"><X :size="19" /></button></header>
        <div class="flex-1 overflow-y-auto p-5"><slot /></div>
        <footer v-if="$slots.footer" class="border-t border-slate-200 bg-slate-50 px-5 py-4"><slot name="footer" /></footer>
      </aside>
    </div>
  </Teleport>
</template>
