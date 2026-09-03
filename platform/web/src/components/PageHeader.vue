<script setup lang="ts">
const props = defineProps<{ title: string; subtitle?: string; description?: string }>()
</script>
<template>
  <div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div class="min-w-0">
      <h1 class="page-title">{{ props.title }}</h1>
      <p v-if="props.subtitle || props.description" class="page-subtitle">{{ props.subtitle || props.description }}</p>
    </div>
    <div class="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
      <slot name="actions"><slot /></slot>
    </div>
  </div>
</template>
