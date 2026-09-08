<script setup lang="ts">
import AppIcon from './AppIcon.vue'
defineProps<{ icon?: string; title: string; description: string }>()
</script>
<template><div class="empty-state"><span class="empty-icon"><AppIcon :name="icon || 'list'" :size="28" /></span><strong>{{ title }}</strong><p>{{ description }}</p><slot /></div></template>
