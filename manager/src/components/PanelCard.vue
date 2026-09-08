<script setup lang="ts">
defineProps<{ title?: string; description?: string }>()
</script>
<template>
  <section class="panel-card">
    <header v-if="title || $slots.actions" class="panel-head"><div><h2 v-if="title">{{ title }}</h2><p v-if="description">{{ description }}</p></div><div><slot name="actions" /></div></header>
    <slot />
  </section>
</template>
