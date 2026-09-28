<script setup lang="ts">
import { computed } from 'vue'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const cachedViews = computed(() => session.authenticated ? ['VoiceView'] : [])
</script>

<template>
  <RouterView v-slot="{ Component }">
    <KeepAlive :include="cachedViews">
      <component :is="Component" />
    </KeepAlive>
  </RouterView>
</template>
