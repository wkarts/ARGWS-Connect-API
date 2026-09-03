<script setup lang="ts">
import { X } from 'lucide-vue-next'
defineProps<{ open: boolean; title: string; size?: 'md' | 'lg' | 'xl' }>()
const emit = defineEmits<{ close: [] }>()
const sizes = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }
</script>
<template>
  <teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" @click.self="emit('close')">
      <div class="max-h-[92vh] w-full overflow-auto rounded-2xl bg-white shadow-2xl" :class="sizes[size || 'md']">
        <div class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
          <h2 class="text-lg font-semibold">{{ title }}</h2><button class="rounded-lg p-2 hover:bg-slate-100" @click="emit('close')"><X :size="20" /></button>
        </div>
        <div class="p-5"><slot /></div>
      </div>
    </div>
  </teleport>
</template>
