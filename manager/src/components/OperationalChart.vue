<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(defineProps<{
  title: string
  points: Array<{ label: string; value: number | null }>
  kind?: 'bar' | 'line'
  unit?: string
}>(), { kind: 'bar', unit: '' })
const valid = (value: number | null): value is number => value !== null && Number.isFinite(value) && value >= 0
const hasData = computed(() => props.points.some(p => valid(p.value)))
const ceiling = computed(() => Math.max(1, ...props.points.map(p => valid(p.value) ? p.value : 0)))
const x = (i: number) => 55 + (i + 0.5) * 790 / Math.max(1, props.points.length)
const y = (v: number) => 165 - (v / ceiling.value) * 140
const width = computed(() => Math.max(2, Math.min(30, 570 / Math.max(1, props.points.length))))
const format = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: props.unit === 'MB' ? 2 : 1 })
const labels = computed(() => props.points.map((p, i) => ({ ...p, i })).filter(p => p.i === 0 || p.i === props.points.length - 1 || p.i % Math.ceil(props.points.length / 5) === 0))
const paths = computed(() => {
  const result: string[] = []
  let segment = ''
  props.points.forEach((p, i) => {
    if (!valid(p.value)) { if (segment) result.push(segment); segment = ''; return }
    segment += `${segment ? ' L' : 'M'} ${x(i)} ${y(p.value)}`
  })
  if (segment) result.push(segment)
  return result
})
</script>
<template>
  <div class="operational-chart">
    <div v-if="!hasData" class="chart-empty">Sem dados no período</div>
    <svg v-else viewBox="0 0 860 204" role="img" :aria-label="title" class="chart-svg">
      <title>{{ title }}. Valores observados; intervalos sem coleta não são preenchidos.</title>
      <g v-for="fraction in [0, 0.5, 1]" :key="fraction" class="chart-grid">
        <line x1="50" x2="850" :y1="y(ceiling * fraction)" :y2="y(ceiling * fraction)" />
        <text x="44" :y="y(ceiling * fraction) + 4" text-anchor="end">{{ format(ceiling * fraction) }}</text>
      </g>
      <template v-if="kind === 'bar'">
        <g v-for="(point, i) in points" :key="point.label">
          <rect v-if="valid(point.value)" :x="x(i) - width / 2" :y="y(point.value)" :width="width" :height="Math.max(1, 165 - y(point.value))" rx="3" class="chart-bar">
            <title>{{ point.label }}: {{ format(point.value) }} {{ unit }}</title>
          </rect>
        </g>
      </template>
      <template v-else>
        <path v-for="(path, i) in paths" :key="i" :d="path" class="chart-line" />
        <template v-for="(point, i) in points" :key="point.label">
          <circle v-if="valid(point.value)" :cx="x(i)" :cy="y(point.value)" r="3.5" class="chart-point">
            <title>{{ point.label }}: {{ format(point.value) }} {{ unit }}</title>
          </circle>
        </template>
      </template>
      <text v-for="point in labels" :key="point.label" :x="x(point.i)" y="190" text-anchor="middle" class="chart-label">{{ point.label }}</text>
    </svg>
    <details v-if="hasData" class="chart-values">
      <summary>Ver valores</summary>
      <div class="chart-value-list"><span v-for="point in points" :key="point.label"><strong>{{ point.label }}</strong> {{ valid(point.value) ? `${format(point.value)} ${unit}` : 'Sem coleta' }}</span></div>
    </details>
  </div>
</template>
<style scoped>
.operational-chart { min-width:0 }
.chart-svg { display:block; width:100%; min-height:160px; overflow:visible }
.chart-grid line { stroke:var(--border,#dbe4ef); stroke-width:1 }
.chart-grid text,.chart-label { fill:var(--muted,#64748b); font-size:12px }
.chart-bar { fill:var(--primary,#2563eb); opacity:.82 }
.chart-line { fill:none; stroke:var(--primary,#2563eb); stroke-width:2.8; stroke-linecap:round; stroke-linejoin:round }
.chart-point { fill:var(--primary,#2563eb) }
.chart-empty { min-height:180px; display:grid; place-items:center; color:var(--muted,#64748b); border:1px dashed var(--border,#dbe4ef); border-radius:10px }
.chart-values { margin-top:8px; color:var(--muted,#64748b); font-size:12px }
.chart-values summary { cursor:pointer }
.chart-value-list { margin-top:8px; display:grid; grid-template-columns:repeat(auto-fit,minmax(145px,1fr)); gap:8px; max-height:190px; overflow:auto }
.chart-value-list span { display:flex; justify-content:space-between; gap:12px }
@media(max-width:640px) { .chart-svg { min-height:130px } }
</style>
