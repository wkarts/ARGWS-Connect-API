<script setup lang="ts">
import { computed } from 'vue'
import { useAuthStore } from '../stores/auth'
import ControlDashboardPage from './ControlDashboardPage.vue'
import TenantDashboardPage from './TenantDashboardPage.vue'
import PartnerDashboardPage from './partner/PartnerDashboardPage.vue'

const auth = useAuthStore()
const component = computed(() => auth.isControlPlane ? ControlDashboardPage : auth.isPartnerPlane ? PartnerDashboardPage : TenantDashboardPage)
</script>

<template><component :is="component" /></template>
