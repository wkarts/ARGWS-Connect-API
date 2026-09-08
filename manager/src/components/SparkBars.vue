<script setup lang="ts">
const props = defineProps<{ values?: number[] }>()
const data = computed(() => props.values?.length ? props.values : [4,6,5,7,8,6,9,12,10,14,16,13,18,22,19,26,31,28,24,20,18,23,19,25])
const max = computed(() => Math.max(...data.value, 1))
import { computed } from 'vue'
</script>
<template><div class="spark-bars"><i v-for="(v,i) in data" :key="i" :style="{height:`${Math.max(8,(v/max)*100)}%`}"></i></div></template>
