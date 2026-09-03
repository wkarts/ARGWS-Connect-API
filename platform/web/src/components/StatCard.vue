<script setup lang="ts">
import type { Component } from 'vue'
defineProps<{ label: string; value: string | number; hint?: string; icon: Component; tone?: 'teal' | 'blue' | 'amber' | 'rose' }>()
const tones = {
  teal: 'border-emerald-100 bg-emerald-50 text-emerald-600',
  blue: 'border-blue-100 bg-blue-50 text-blue-600',
  amber: 'border-amber-100 bg-amber-50 text-amber-600',
  rose: 'border-rose-100 bg-rose-50 text-rose-600',
}
</script>
<template>
  <div class="metric-card">
    <div class="min-w-0">
      <p class="text-[12px] font-medium text-slate-600">{{ label }}</p>
      <p class="mt-1 truncate text-[1.55rem] font-semibold tracking-[-.03em] text-slate-950">{{ value }}</p>
      <p v-if="hint" class="mt-1 text-[10px] leading-4 text-slate-400">{{ hint }}</p>
    </div>
    <div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl border" :class="tones[tone || 'blue']">
      <component :is="icon" :size="21" />
    </div>
  </div>
</template>
