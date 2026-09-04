<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Check, ChevronDown, Search, X } from 'lucide-vue-next'

export interface SearchSelectOption {
  value: string
  label: string
  description?: string
  keywords?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  modelValue?: string | null
  options: SearchSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  clearable?: boolean
  noResultsText?: string
}>(), {
  modelValue: '',
  placeholder: 'Selecione',
  searchPlaceholder: 'Pesquisar…',
  disabled: false,
  clearable: false,
  noResultsText: 'Nenhum resultado encontrado.',
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const open = ref(false)
const query = ref('')

const selected = computed(() => props.options.find(option => option.value === props.modelValue))
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const visibleOptions = computed(() => {
  const term = normalized(query.value.trim())
  if (!term) return props.options
  return props.options.filter(option => normalized(`${option.label} ${option.description || ''} ${option.keywords || ''}`).includes(term))
})

async function toggle() {
  if (props.disabled) return
  open.value = !open.value
  if (open.value) {
    query.value = ''
    await nextTick()
    input.value?.focus()
  }
}

function choose(option: SearchSelectOption) {
  if (option.disabled) return
  emit('update:modelValue', option.value)
  open.value = false
  query.value = ''
}

function clear(event: MouseEvent | KeyboardEvent) {
  event.stopPropagation()
  emit('update:modelValue', '')
}

function outside(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('mousedown', outside))
onBeforeUnmount(() => document.removeEventListener('mousedown', outside))
</script>

<template>
  <div ref="root" class="relative w-full">
    <button
      type="button"
      class="input flex min-h-10 items-center gap-2 text-left disabled:cursor-not-allowed disabled:bg-slate-100"
      :disabled="disabled"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="min-w-0 flex-1 truncate" :class="selected ? 'text-slate-800' : 'text-slate-400'">{{ selected?.label || placeholder }}</span>
      <span
        v-if="clearable && modelValue"
        role="button"
        tabindex="0"
        class="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label="Limpar seleção"
        @click="clear"
        @keydown.enter.prevent="clear"
        @keydown.space.prevent="clear"
      ><X :size="14" /></span>
      <ChevronDown :size="16" class="shrink-0 text-slate-400 transition" :class="open && 'rotate-180'" />
    </button>

    <div v-if="open" class="absolute z-[80] mt-1 w-full min-w-[18rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
      <div class="border-b border-slate-100 p-2">
        <div class="relative">
          <Search :size="16" class="pointer-events-none absolute left-3 top-2.5 text-slate-400" />
          <input ref="input" v-model="query" class="input !py-2 pl-9" :placeholder="searchPlaceholder" autocomplete="off" @keydown.esc="open=false" />
        </div>
      </div>
      <div class="scroll-clean max-h-72 overflow-y-auto p-1.5">
        <button
          v-for="option in visibleOptions"
          :key="option.value"
          type="button"
          class="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition"
          :class="[option.disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-slate-50', option.value === modelValue ? 'bg-blue-50 text-blue-900' : 'text-slate-700']"
          :disabled="option.disabled"
          @click="choose(option)"
        >
          <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">{{ option.label }}</span><span v-if="option.description" class="mt-0.5 block truncate text-xs text-slate-400">{{ option.description }}</span></span>
          <Check v-if="option.value === modelValue" :size="16" class="mt-0.5 shrink-0 text-blue-700" />
        </button>
        <p v-if="!visibleOptions.length" class="px-3 py-8 text-center text-sm text-slate-400">{{ noResultsText }}</p>
      </div>
    </div>
  </div>
</template>
