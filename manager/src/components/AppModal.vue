<script setup lang="ts">
import AppIcon from './AppIcon.vue'
withDefaults(defineProps<{ open: boolean; title: string; subtitle?: string; wide?: boolean; dismissible?: boolean }>(), { dismissible: true })
const emit = defineEmits<{ close: [] }>()
function close() { emit('close') }
</script>
<template>
  <Teleport to="body"><Transition name="modal"><div v-if="open" class="modal-backdrop" @mousedown.self="dismissible && close()"><section class="app-modal" :class="{ wide }"><header><div><h3>{{ title }}</h3><p v-if="subtitle">{{ subtitle }}</p></div><button v-if="dismissible" class="icon-button" @click="close"><AppIcon name="close" /></button></header><div class="modal-body"><slot /></div><footer v-if="$slots.footer"><slot name="footer" /></footer></section></div></Transition></Teleport>
</template>
