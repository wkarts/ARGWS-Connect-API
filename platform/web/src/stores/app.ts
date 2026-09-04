import { ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '../api/client'
import type { ApiResponse } from '../types'
import { applyBranding, bootBranding, type RuntimeBranding } from '../config/runtimeBranding'

interface TenantContextData {
  tenant_id: string
  slug: string
  hostname: string
  timezone: string
  branding: RuntimeBranding
}

interface PublicSiteData {
  demo_mode: boolean
}

export const useAppStore = defineStore('app', () => {
  const tenant = ref<TenantContextData | null>(null)
  const branding = ref<RuntimeBranding | null>(bootBranding())
  const demoMode = ref(false)
  const sidebarOpen = ref(false)
  const globalLoading = ref(false)

  async function loadTenantContext() {
    try {
      const response = await api.get<ApiResponse<TenantContextData>>('/v1/context')
      tenant.value = response.data.data
      branding.value = response.data.data.branding
      applyBranding(branding.value)
    } catch {
      tenant.value = null
    }

    if (tenant.value) {
      try {
        const siteResponse = await api.get<ApiResponse<PublicSiteData>>('/v1/public/site')
        demoMode.value = Boolean(siteResponse.data.data.demo_mode)
      } catch {
        demoMode.value = false
      }
    } else {
      demoMode.value = false
    }
  }

  return { tenant, branding, demoMode, sidebarOpen, globalLoading, loadTenantContext }
})
