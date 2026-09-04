<script setup lang="ts">
defineProps<{ items: Array<{ key: string; label: string; count?: number }> ; modelValue: string }>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>
<template>
  <div class="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
    <button v-for="item in items" :key="item.key" type="button" class="inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition" :class="modelValue===item.key?'bg-blue-600 text-white shadow-sm':'text-slate-600 hover:bg-slate-100'" @click="$emit('update:modelValue',item.key)">
      {{ item.label }}
      <span v-if="item.count!==undefined" class="rounded-full px-2 py-0.5 text-xs" :class="modelValue===item.key?'bg-white/15':'bg-slate-100'">{{ item.count }}</span>
    </button>
  </div>
</template>
