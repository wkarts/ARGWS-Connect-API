<script setup lang="ts">
import { computed } from 'vue'
const props = withDefaults(defineProps<{ modelValue: unknown; label?: string; rows?: number; hint?: string }>(), { rows: 7 })
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()
const isStringModel = computed(() => typeof props.modelValue === 'string')
const text = computed(() => isStringModel.value ? String(props.modelValue || '{}') : JSON.stringify(props.modelValue ?? {}, null, 2))
const valid = computed(() => { try { JSON.parse(text.value || '{}'); return true } catch { return false } })
function update(value: string) {
  if (isStringModel.value) { emit('update:modelValue', value); return }
  try { emit('update:modelValue', JSON.parse(value || '{}')) } catch { /* mantém último objeto válido */ }
}
</script>
<template><div><label v-if="label" class="label">{{ label }}</label><textarea class="input font-mono text-xs" :class="!valid && 'border-rose-400 focus:border-rose-500 focus:ring-rose-100'" :rows="rows" :value="text" spellcheck="false" @input="update(($event.target as HTMLTextAreaElement).value)"/><p class="mt-1 text-xs" :class="valid ? 'text-slate-400' : 'text-rose-600'">{{ valid ? (hint || 'JSON válido') : 'JSON inválido' }}</p></div></template>
