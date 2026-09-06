import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ControlWhatsAppPage from '../pages/ControlWhatsAppPage.vue'
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('../api/client', () => ({ api: { get, post }, apiError: () => 'Operação indisponível.' }))
const row = (id: string | null) => ({ tenant_id: 'customer', tenant_name: 'Cliente', tenant_slug: 'demo', binding_id: id,
  instance: id ? 'private-' + id : null, instance_mode: 'TENANT', operations_available: true, pairing_available: !!id,
  connection: { state: id ? 'DISCONNECTED' : 'NOT_CREATED', session_exists: false } })
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { wrappers.splice(0).forEach(w => w.unmount()) })
const create = () => { const w = mount(ControlWhatsAppPage); wrappers.push(w); return w }

describe('Control Plane usa vínculos de instância, não conexão de notificação compartilhada', () => {
  it('apresenta cliente sem vínculo sem inventar conexão compartilhada', async () => {
    get.mockResolvedValue({ data: { data: [row(null)] } })
    const wrapper = create(); await flushPromises()
    expect(wrapper.text()).toContain('Sem instância vinculada')
    expect(wrapper.text()).not.toContain('Conexão compartilhada')
    expect(wrapper.findAll('button').some(b => b.text() === 'QR Code')).toBe(false)
  })
  it('seleciona o binding correto entre duas instâncias do mesmo cliente e usa /actions/', async () => {
    get.mockResolvedValue({ data: { data: [row('one'), row('two')] } })
    post.mockResolvedValue({ data: { data: row('two') } })
    const wrapper = create(); await flushPromises()
    expect(wrapper.findAll('article')).toHaveLength(2)
    const buttons = wrapper.findAll('button').filter(b => b.text() === 'QR Code')
    await buttons[1].trigger('click'); await flushPromises()
    expect(post).toHaveBeenCalledWith('/control/v1/whatsapp/instances/customer/actions/connect', { phone: null, binding_id: 'two' })
  })
})
