<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ inverse?: boolean }>(), { inverse: false })
const source = computed(() => props.inverse
  ? '/manager/assets/images/argws-connect-logo-dark.svg'
  : '/manager/assets/images/argws-connect-logo-horizontal.svg')
</script>
<template>
  <span class="brand-mark" aria-label="Connect|API">
    <img :src="source" alt="Connect|API" />
  </span>
</template>
