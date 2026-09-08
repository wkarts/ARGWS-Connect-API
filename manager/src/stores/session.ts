import { defineStore } from 'pinia'
import type { Session } from '@/types/domain'
import { connect } from '@/services/connect'
import { runtime } from '@/config/runtime'

export const useSessionStore = defineStore('session', {
  state: () => ({ session: null as Session | null, checked: false, challenge: null as any }),
  getters: {
    account: (s) => s.session?.account,
    security: (s) => s.session?.security,
    authenticated: (s) => Boolean(s.session),
    hasPermission: (s) => (permission?: string) => {
      if (!permission) return true
      const list = s.session?.permissions || []
      return list.includes('*') || list.includes(permission)
    },
  },
  actions: {
    async restore() {
      if (this.checked) return Boolean(this.session)
      this.checked = true
      try { this.session = await connect.me(); return true } catch { this.session = null; return false }
    },
    async loginAccount(email: string, password: string) {
      const result = await connect.login(email, password)
      if (result.challenge) { this.challenge = result.raw; return 'challenge' }
      this.session = result.session!; this.challenge = null; return 'ok'
    },
    async loginAccess(code: string) {
      this.session = await connect.loginAccess(code)
      this.challenge = null
      this.checked = true
      return 'ok'
    },
    async login(email: string, password: string) {
      return runtime.authMode === 'access-code' ? this.loginAccess(password || email) : this.loginAccount(email, password)
    },
    async verify(code = '', recovery = '') { this.session = await connect.verify(code, recovery); this.challenge = null },
    async refresh() { this.session = await connect.me() },
    async logout() { await connect.logout().catch(() => null); this.session = null; this.challenge = null; this.checked = true },
  },
})
