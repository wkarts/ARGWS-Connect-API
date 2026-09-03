<script setup lang="ts">withDefaults(defineProps<{ rows?: number; columns?: number }>(), { rows: 5, columns: 5 })</script>
<template><tbody><tr v-for="row in rows" :key="row"><td v-for="column in columns" :key="column" class="px-4 py-4"><div class="h-4 animate-pulse rounded bg-slate-100" :style="{width: `${55 + ((row * column * 13) % 40)}%`}" /></td></tr></tbody></template>
