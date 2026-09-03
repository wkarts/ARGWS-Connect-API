<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'
const props = withDefaults(defineProps<{ page?: number; modelValue?: number; pages: number; total?: number }>(), { total: 0, page: 1 })
const emit = defineEmits<{ change: [page: number]; 'update:page': [page: number]; 'update:modelValue': [page: number] }>()
const current = computed(() => props.modelValue ?? props.page ?? 1)
function setPage(value: number) { emit('change', value); emit('update:page', value); emit('update:modelValue', value) }
</script>
<template>
  <div class="flex flex-col gap-3 border-t border-slate-200 bg-white px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
    <span class="text-slate-500">{{ total.toLocaleString('pt-BR') }} registro(s) · página {{ current }} de {{ Math.max(pages, 1) }}</span>
    <div class="flex gap-2"><button class="btn-secondary px-3 py-2" :disabled="current <= 1" @click="setPage(current - 1)"><ChevronLeft :size="16" /> Anterior</button><button class="btn-secondary px-3 py-2" :disabled="current >= pages" @click="setPage(current + 1)">Próxima <ChevronRight :size="16" /></button></div>
  </div>
</template>
