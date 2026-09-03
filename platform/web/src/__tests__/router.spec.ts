import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

const authState = vi.hoisted(() => ({ isControlPlane: false }))

vi.mock('../stores/auth', () => ({
  useAuthStore: () => authState,
}))

vi.mock('../pages/ControlDashboardPage.vue', () => ({
  default: { template: '<div data-test="control-dashboard">control</div>' },
}))

vi.mock('../pages/TenantDashboardPage.vue', () => ({
  default: { template: '<div data-test="tenant-dashboard">tenant</div>' },
}))

import PlaneDashboardPage from '../pages/PlaneDashboardPage.vue'
import router from '../router'

describe('roteamento por plano', () => {
  it('resolve a raiz em uma única rota neutra', () => {
    expect(router.resolve('/').name).toBe('home')
  })

  it('renderiza o dashboard do Tenant Plane no host de tenant', () => {
    authState.isControlPlane = false
    const wrapper = mount(PlaneDashboardPage)
    expect(wrapper.find('[data-test="tenant-dashboard"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="control-dashboard"]').exists()).toBe(false)
  })

  it('renderiza o dashboard do Control Plane no host administrativo', () => {
    authState.isControlPlane = true
    const wrapper = mount(PlaneDashboardPage)
    expect(wrapper.find('[data-test="control-dashboard"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="tenant-dashboard"]').exists()).toBe(false)
  })
})
