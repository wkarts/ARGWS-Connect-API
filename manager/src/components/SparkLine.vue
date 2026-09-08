<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ values?: number[] }>()
const data = computed(() => props.values?.length ? props.values : [14,12,15,16,18,20,17,19,22,21,24,27,23,25,29,31,28,33,30,36,34,38])
const points = computed(() => { const d=data.value; const max=Math.max(...d,1), min=Math.min(...d,0); return d.map((v,i)=>`${(i/(d.length-1))*100},${90-((v-min)/(Math.max(1,max-min)))*70}`).join(' ') })
</script>
<template><svg class="spark-line" viewBox="0 0 100 100" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".18"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><polygon :points="`0,100 ${points} 100,100`" fill="url(#area)"/><polyline :points="points" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg></template>
