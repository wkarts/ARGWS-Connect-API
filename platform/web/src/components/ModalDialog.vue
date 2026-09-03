<script setup lang="ts">
import { computed } from 'vue'
import { X } from 'lucide-vue-next'

const props = defineProps<{
  open?: boolean
  modelValue?: boolean
  title: string
  description?: string
  size?: 'md' | 'lg' | 'xl'
}>()

const emit = defineEmits<{
  close: []
  'update:modelValue': [value: boolean]
}>()

const sizes = { md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }
const visible = computed(() => props.open ?? props.modelValue ?? false)

function close() {
  emit('update:modelValue', false)
  emit('close')
}
</script>

<template>
  <teleport to="body">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" @click.self="close">
      <div class="max-h-[92vh] w-full overflow-auto rounded-2xl bg-white shadow-2xl" :class="sizes[size || 'md']">
        <div class="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div>
            <h2 class="text-lg font-semibold">{{ title }}</h2>
            <p v-if="description" class="mt-1 text-sm text-slate-500">{{ description }}</p>
          </div>
          <button class="shrink-0 rounded-lg p-2 hover:bg-slate-100" type="button" aria-label="Fechar" @click="close">
            <X :size="20" />
          </button>
        </div>
        <div class="p-5"><slot /></div>
      </div>
    </div>
  </teleport>
</template>
