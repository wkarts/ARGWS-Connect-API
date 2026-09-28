<script setup lang="ts">
import { computed } from 'vue'
import { coordinate, positionTime } from '@/services/findhub-position'
const props = withDefaults(defineProps<{ device?: any; staleAfterSeconds?: number; compact?: boolean }>(), { staleAfterSeconds: 300, compact: false })
const position = computed(() => props.device?.latestPosition)
const status = computed(() => position.value ? 'Última posição conhecida' : 'Sem localização')
</script>
<template>
  <section class="position-details" :class="{compact}" aria-label="Coordenadas recebidas do dispositivo">
    <dl class="coordinates" aria-live="polite" aria-atomic="true">
      <div><dt>Latitude</dt><dd>{{ coordinate(position?.latitude) }}</dd></div>
      <div><dt>Longitude</dt><dd>{{ coordinate(position?.longitude) }}</dd></div>
    </dl>
    <p class="position-time"><strong>{{ status }}</strong> · Relatório: {{ positionTime(position?.timestamp) }}</p>
    <template v-if="!compact">
      <p class="position-time">Recebido: {{ positionTime(device?.lastReceivedAt) }} <span v-if="position?.accuracy != null"> · Precisão: {{ Number(position.accuracy).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) }} m</span></p>
      <p v-if="position" class="position-time">Origem: {{ position.source || 'Não informada' }}</p>
    </template>
  </section>
</template>
<style scoped>
.position-details{margin:14px 0;padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}.coordinates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:0}.coordinates dt{font-size:12px;color:var(--muted)}.coordinates dd{margin:4px 0 0;font-variant-numeric:tabular-nums;font-weight:600;overflow-wrap:anywhere}.position-time{font-size:12px;line-height:1.5;color:var(--muted);margin:8px 0 0}.position-time strong{color:var(--text);font-weight:500}.compact{padding:10px;background:var(--background);margin:12px 0}.compact .position-time{font-size:11px}
</style>
