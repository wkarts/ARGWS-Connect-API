<script setup lang="ts">
type Status =
  | 'ok'
  | 'attention'
  | 'unavailable'
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'unknown'

defineProps<{ status?: Status; label?: string }>()
</script>

<template>
  <span
    class="status-pill"
    :class="`status-${status === 'unknown' ? 'attention' : (status || 'attention')}`"
  >
    <i></i>
    {{
      label
        || (status === 'ok' || status === 'connected'
          ? 'Operacional'
          : status === 'connecting'
            ? 'Conectando'
            : status === 'disconnected' || status === 'unavailable'
              ? 'Indisponível'
              : 'Atenção')
    }}
  </span>
</template>
