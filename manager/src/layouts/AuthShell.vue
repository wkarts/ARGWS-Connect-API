<script setup lang="ts">
import BrandMark from '@/components/BrandMark.vue'
</script>
<template><div class="auth-shell"><div class="auth-brand"><BrandMark /></div><div class="auth-card"><slot /></div><p class="auth-foot">Acesso protegido à administração do seu ambiente de comunicação.</p></div></template>
