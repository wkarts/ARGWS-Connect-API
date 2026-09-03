import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import StatusBadge from '../components/StatusBadge.vue'

describe('StatusBadge', () => {
  it('renderiza status de sucesso com rótulo em português e classe semântica', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'PAID' } })
    expect(wrapper.text()).toBe('Pago')
    expect(wrapper.classes()).toContain('bg-emerald-100')
  })

  it('renderiza status de falha com rótulo em português e classe semântica', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'FAILED' } })
    expect(wrapper.text()).toBe('Falhou')
    expect(wrapper.classes()).toContain('bg-rose-100')
  })
})
