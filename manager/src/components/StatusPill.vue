<script setup lang="ts">
defineProps<{ status?: 'ok' | 'attention' | 'unavailable' | 'connected' | 'connecting' | 'disconnected'; label?: string }>()
</script>
<template>
  <span class="status-pill" :class="`status-${status || 'attention'}`"><i></i>{{ label || (status === 'ok' || status === 'connected' ? 'Operacional' : status === 'connecting' ? 'Conectando' : status === 'disconnected' || status === 'unavailable' ? 'Indisponível' : 'Atenção') }}</span>
</template>
