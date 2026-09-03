<script setup lang="ts">
import { ref } from 'vue'
import { Check, Copy } from 'lucide-vue-next'

const props = withDefaults(defineProps<{ value: string; label?: string; compact?: boolean }>(), {
  label: 'Copiar',
  compact: false
})
const copied = ref(false)
async function copy() {
  if (!props.value) return
  await navigator.clipboard.writeText(props.value)
  copied.value = true
  window.setTimeout(() => { copied.value = false }, 1800)
}
</script>
<template>
  <button type="button" class="btn-secondary" :class="compact ? 'px-2.5 py-1.5 text-xs' : ''" :disabled="!value" @click="copy">
    <Check v-if="copied" :size="compact ? 14 : 16" class="text-emerald-600" />
    <Copy v-else :size="compact ? 14 : 16" />
    {{ copied ? 'Copiado' : label }}
  </button>
</template>
