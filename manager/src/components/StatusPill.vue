<script setup lang="ts">
defineProps<{ status?: 'ok' | 'attention' | 'unavailable' | 'connected' | 'connecting' | 'disconnected' | 'unknown' | string; label?: string }>()
</script>
<template>
  <span class="status-pill" :class="`status-${status || 'attention'}`"><i></i>{{ label || (status === 'ok' || status === 'connected' || status === 'open' ? 'Operacional' : status === 'connecting' ? 'Conectando' : status === 'disconnected' || status === 'unavailable' || status === 'close' ? 'Indisponível' : 'Atenção') }}</span>
</template>
