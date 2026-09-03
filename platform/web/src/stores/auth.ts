import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api, sessionStorageKey } from '../api/client'
import type { ApiResponse, AuthSession } from '../types'

type Plane = 'control' | 'partner' | 'tenant'

export const useAuthStore = defineStore('auth', () => {
  const session = ref<AuthSession | null>(null)
  const loading = ref(false)

  const controlHost = String(import.meta.env.VITE_CONTROL_PLANE_HOST || 'control.localhost').toLowerCase()
  const partnerHost = String(import.meta.env.VITE_PARTNER_PLANE_HOST || 'partner.localhost').toLowerCase()

  const isControlHost = computed(() => {
    const host = window.location.hostname.toLowerCase()
    return (
      host === controlHost ||
      host.startsWith('control.') ||
      host.startsWith('admin.') ||
      new URLSearchParams(location.search).get('control') === '1'
    )
  })

  const isPartnerHost = computed(() => {
    const host = window.location.hostname.toLowerCase()
    return (
      host === partnerHost ||
      host.startsWith('partner.') ||
      host.startsWith('partners.') ||
      new URLSearchParams(location.search).get('partner') === '1'
    )
  })

  const authenticated = computed(() => Boolean(session.value?.tokens.access_token))
  const user = computed(() => session.value?.user ?? null)
  const role = computed(() => String(user.value?.role || '').toUpperCase())

  const isControlPlane = computed(() => isControlHost.value)
  const isPartnerPlane = computed(() => !isControlPlane.value && (isPartnerHost.value || role.value.startsWith('PARTNER_')))
  const isTenantPlane = computed(() => !isControlPlane.value && !isPartnerPlane.value)
  const plane = computed<Plane>(() => isControlPlane.value ? 'control' : isPartnerPlane.value ? 'partner' : 'tenant')

  const mfaPending = computed(() => Boolean(
    session.value?.security?.required && !session.value?.security?.verified,
  ))

  function persist(value: AuthSession | null) {
    session.value = value
    if (value) localStorage.setItem(sessionStorageKey(), JSON.stringify(value))
    else localStorage.removeItem(sessionStorageKey())
  }

  function hydrate() {
    const raw = localStorage.getItem(sessionStorageKey())
    if (!raw) return
    try { session.value = JSON.parse(raw) as AuthSession } catch { localStorage.removeItem(sessionStorageKey()) }
  }

  async function login(email: string, password: string) {
    loading.value = true
    try {
      // O Partner Plane usa o contrato de autenticação tenant por padrão até existir
      // um backend /partner/v1 dedicado. A UI nunca reutiliza endpoints /control/v1.
      const endpoint = isControlPlane.value ? '/control/v1/auth/login' : '/v1/auth/login'
      const response = await api.post<ApiResponse<AuthSession>>(endpoint, { email, password })
      persist(response.data.data)
    } finally {
      loading.value = false
    }
  }

  function replaceSession(value: AuthSession) {
    persist(value)
  }

  async function logout() {
    const current = session.value
    try {
      if (current?.tokens.refresh_token) {
        const endpoint = isControlPlane.value ? '/control/v1/auth/logout' : '/v1/auth/logout'
        await api.post(endpoint, { refresh_token: current.tokens.refresh_token })
      }
    } finally {
      persist(null)
    }
  }

  return {
    session, user, authenticated, loading,
    isControlPlane, isPartnerPlane, isTenantPlane, plane,
    mfaPending, hydrate, login, replaceSession, logout,
  }
})
