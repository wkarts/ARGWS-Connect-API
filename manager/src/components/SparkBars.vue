<script setup lang="ts">
const props = defineProps<{ values?: number[] }>()
const data = computed(() => props.values?.length ? props.values : [])
const max = computed(() => Math.max(...data.value, 1))
import { computed } from 'vue'
</script>
<template><div class="spark-bars"><i v-for="(v,i) in data" :key="i" :style="{height:`${Math.max(8,(v/max)*100)}%`}"></i></div></template>
