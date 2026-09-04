<script setup lang="ts">
import { computed } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  modelValue: Record<string, unknown>
  label?: string
  keyLabel?: string
  valueLabel?: string
  emptyText?: string
}>(), {
  label: '', keyLabel: 'Campo', valueLabel: 'Valor', emptyText: 'Nenhum campo adicional configurado.'
})
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, unknown>] }>()

const entries = computed(() => Object.entries(props.modelValue || {}).map(([key, value]) => ({ key, value, type: typeof value })))

function updateKey(oldKey:string,newKey:string){
  const trimmed=newKey.trim(); if(!trimmed||trimmed===oldKey)return
  const next={...props.modelValue}; const value=next[oldKey]; delete next[oldKey]; next[trimmed]=value; emit('update:modelValue',next)
}
function updateValue(key:string,value:unknown){emit('update:modelValue',{...props.modelValue,[key]:value})}
function updateType(key:string,type:string){
  const current=props.modelValue[key]
  let value:unknown=''
  if(type==='boolean')value=Boolean(current)
  else if(type==='number')value=Number(current)||0
  else value=current == null ? '' : String(current)
  updateValue(key,value)
}
function add(){let index=1;let key=`campo_${index}`;while(key in props.modelValue){index++;key=`campo_${index}`}emit('update:modelValue',{...props.modelValue,[key]:''})}
function remove(key:string){const next={...props.modelValue};delete next[key];emit('update:modelValue',next)}
</script>

<template>
  <div>
    <div v-if="label" class="mb-2 flex items-center justify-between gap-3"><label class="label !mb-0">{{label}}</label><button type="button" class="btn-secondary !min-h-8 !px-2.5 !py-1.5 text-xs" @click="add"><Plus :size="14"/>Adicionar campo</button></div>
    <div v-if="entries.length" class="space-y-2">
      <div v-for="entry in entries" :key="entry.key" class="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 md:grid-cols-[1fr_8rem_1.5fr_auto]">
        <div><label class="mb-1 block text-xs font-medium text-slate-500">{{keyLabel}}</label><input :value="entry.key" class="input" @change="updateKey(entry.key,($event.target as HTMLInputElement).value)"/></div>
        <div><label class="mb-1 block text-xs font-medium text-slate-500">Tipo</label><select :value="entry.type" class="select" @change="updateType(entry.key,($event.target as HTMLSelectElement).value)"><option value="string">Texto</option><option value="number">Número</option><option value="boolean">Sim/Não</option></select></div>
        <div><label class="mb-1 block text-xs font-medium text-slate-500">{{valueLabel}}</label><label v-if="entry.type==='boolean'" class="flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm"><input :checked="Boolean(entry.value)" type="checkbox" @change="updateValue(entry.key,($event.target as HTMLInputElement).checked)"/>{{entry.value?'Sim':'Não'}}</label><input v-else :value="entry.value" :type="entry.type==='number'?'number':'text'" class="input" @input="updateValue(entry.key,entry.type==='number'?Number(($event.target as HTMLInputElement).value):($event.target as HTMLInputElement).value)"/></div>
        <div class="flex items-end"><button type="button" class="btn-secondary !px-3 text-rose-600" title="Remover campo" @click="remove(entry.key)"><Trash2 :size="16"/></button></div>
      </div>
    </div>
    <div v-else class="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">{{emptyText}} <button type="button" class="font-semibold text-blue-700" @click="add">Adicionar</button></div>
  </div>
</template>
