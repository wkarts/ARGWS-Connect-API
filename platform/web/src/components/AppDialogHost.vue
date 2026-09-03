<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { AlertTriangle, CheckCircle2, CircleHelp, Info, X } from 'lucide-vue-next'
import { appDialogState, resolveAppDialog } from '../composables/useAppDialog'

const input=ref<HTMLInputElement|null>(null)
const icon=computed(()=>appDialogState.tone==='danger'?AlertTriangle:appDialogState.tone==='warning'?AlertTriangle:appDialogState.tone==='success'?CheckCircle2:appDialogState.mode==='confirm'?CircleHelp:Info)
const iconClass=computed(()=>appDialogState.tone==='danger'?'bg-rose-50 text-rose-700':appDialogState.tone==='warning'?'bg-amber-50 text-amber-700':appDialogState.tone==='success'?'bg-emerald-50 text-emerald-700':'bg-teal-50 text-teal-700')
const confirmClass=computed(()=>appDialogState.tone==='danger'?'btn-primary !bg-rose-600 hover:!bg-rose-700':'btn-primary')
const canConfirm=computed(()=>appDialogState.mode!=='prompt'||!appDialogState.required||appDialogState.inputValue.trim().length>0)
watch(()=>appDialogState.open,async value=>{if(value&&appDialogState.mode==='prompt'){await nextTick();input.value?.focus()}})
function keyboard(event:KeyboardEvent){if(event.key==='Escape'&&appDialogState.mode!=='alert')resolveAppDialog(false);if(event.key==='Enter'&&canConfirm.value)resolveAppDialog(true)}
</script>

<template>
  <Teleport to="body">
    <div v-if="appDialogState.open" class="fixed inset-0 z-[9999] grid place-items-center bg-slate-950/55 p-4 backdrop-blur-[2px]" role="presentation" @keydown="keyboard">
      <section class="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" role="dialog" aria-modal="true" :aria-label="appDialogState.title">
        <header class="flex items-start gap-3 border-b border-slate-100 p-5">
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl" :class="iconClass"><component :is="icon" :size="21"/></div>
          <div class="min-w-0 flex-1"><h2 class="text-base font-bold text-slate-900">{{appDialogState.title}}</h2><p class="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600">{{appDialogState.message}}</p></div>
          <button v-if="appDialogState.mode!=='alert'" type="button" class="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Cancelar" @click="resolveAppDialog(false)"><X :size="18"/></button>
        </header>
        <div v-if="appDialogState.mode==='prompt'" class="p-5">
          <label v-if="appDialogState.inputLabel" class="label">{{appDialogState.inputLabel}}</label>
          <input ref="input" v-model="appDialogState.inputValue" class="input" :placeholder="appDialogState.placeholder" @keyup.enter="canConfirm&&resolveAppDialog(true)"/>
        </div>
        <footer class="flex justify-end gap-2 bg-slate-50 px-5 py-4">
          <button v-if="appDialogState.mode!=='alert'" type="button" class="btn-secondary" @click="resolveAppDialog(false)">{{appDialogState.cancelLabel}}</button>
          <button type="button" :class="confirmClass" :disabled="!canConfirm" @click="resolveAppDialog(true)">{{appDialogState.confirmLabel}}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
