<script setup lang="ts">
import AppIcon from './AppIcon.vue'
defineProps<{ icon: string; title: string; value: string; hint?: string; accent?: 'blue' | 'green' | 'violet' | 'cyan' }>()
</script>
<template>
  <article class="metric-card">
    <div class="metric-head"><span class="metric-icon" :class="`accent-${accent || 'blue'}`"><AppIcon :name="icon" :size="19" /></span><span v-if="hint" class="metric-hint">{{ hint }}</span></div>
    <strong class="metric-number">{{ value }}</strong>
    <span class="metric-title">{{ title }}</span>
  </article>
</template>
