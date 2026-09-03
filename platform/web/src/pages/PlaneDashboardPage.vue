<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '../stores/auth'
import ControlDashboardPage from './ControlDashboardPage.vue'
import TenantDashboardPage from './TenantDashboardPage.vue'
import PartnerDashboardPage from './partner/PartnerDashboardPage.vue'

const auth = useAuthStore()
const dashboardComponent = computed(() => {
  if (auth.isControlPlane) return ControlDashboardPage
  if (auth.isPartnerPlane) return PartnerDashboardPage
  return TenantDashboardPage
})
</script>

<template>
  <component :is="dashboardComponent" />
</template>
