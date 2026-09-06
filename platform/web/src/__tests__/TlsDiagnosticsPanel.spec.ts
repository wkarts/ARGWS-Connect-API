import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TlsDiagnosticsPanel from '../components/TlsDiagnosticsPanel.vue'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('../api/client', () => ({ api: { get } }))
const report = () => ({ data: { data: {
  schema_version: 1, scope: 'PLATFORM_SERVICES', read_only: true, services_confirmed: false,
  queried_at: '2026-09-06T03:00:00Z',
  services: ['dns', 'acme', 'cloudpanel'].map(id => ({
    id, title: id, state: id === 'dns' ? 'ERROR' : 'WAITING',
    code: id === 'dns' ? 'CLOUDFLARE_HTTP_403' : 'CERTIFICATE_NOT_READY',
    message: 'Confira a configuração indicada.', stage: 'configuration',
    env_fields: id === 'dns' ? ['CLOUDFLARE_API_TOKEN'] : [], checked_at: '2026-09-06T03:00:00Z',
    expires_at: null, last_installed_at: null, last_verified_at: null
  }))
} } })
const wrappers: ReturnType<typeof mount>[] = []
const create = () => { const wrapper = mount(TlsDiagnosticsPanel); wrappers.push(wrapper); return wrapper }
beforeEach(() => { get.mockReset(); get.mockResolvedValue(report()) })
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()) })

describe('Diagnóstico TLS integrado', () => {
  it('consulta automaticamente pelo endpoint existente da API sem serviço temporário', async () => {
    const wrapper = create(); await flushPromises()
    expect(get).toHaveBeenCalledOnce()
    expect(get.mock.calls[0][0]).toBe('/control/v1/tls/diagnostics')
    expect(wrapper.findAll('article')).toHaveLength(3)
    expect(wrapper.text()).toContain('compose.yaml')
    expect(wrapper.text()).toContain('.env')
    expect(wrapper.text()).toContain('CLOUDFLARE_HTTP_403')
    expect(wrapper.text()).toContain('CLOUDFLARE_API_TOKEN')
    expect(wrapper.text()).toContain('Os valores não são exibidos.')
  })

  it('não mantém estado anterior verde após falhar a atualização', async () => {
    const data = report(); data.data.data.services.forEach(service => { service.state = 'READY' })
    get.mockResolvedValueOnce(data)
    const wrapper = create(); await flushPromises()
    expect(wrapper.text()).toContain('Confirmado pelo serviço')
    get.mockRejectedValueOnce(new Error('secret-transport-detail'))
    await wrapper.find('button').trigger('click'); await flushPromises()
    expect(wrapper.findAll('article')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('secret-transport-detail')
    expect(wrapper.text()).toContain('A lista de domínios continua disponível')
  })

  it.each([403, 404])('mostra informação útil para HTTP %s sem refletir corpo arbitrário', async status => {
    get.mockRejectedValueOnce({ response: { status, data: { secret: 'do-not-render' } } })
    const wrapper = create(); await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('do-not-render')
    if (status === 404) expect(wrapper.text()).toContain('mesmo canal publicado')
  })

  it('bloqueia duplo clique durante a consulta e aborta ao sair da página', async () => {
    get.mockReturnValue(new Promise(() => {}))
    const wrapper = create()
    // onMounted starts the request synchronously; Vue updates the DOM on its next tick.
    await flushPromises()
    expect(wrapper.find('button').attributes()).toHaveProperty('disabled')
    await wrapper.find('button').trigger('click')
    expect(get).toHaveBeenCalledOnce()
    const signal = get.mock.calls[0][1].signal as AbortSignal
    wrapper.unmount()
    expect(signal.aborted).toBe(true)
  })

  it('não renderiza HTML no motivo recebido', async () => {
    const data = report(); data.data.data.services[0].message = '<img src=x onerror=alert(1)>'
    get.mockResolvedValueOnce(data)
    const wrapper = create(); await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
  })

  it('não aceita resposta de API incompatível', async () => {
    get.mockResolvedValueOnce({ data: { data: { schema_version: 0 } } })
    const wrapper = create(); await flushPromises()
    expect(wrapper.findAll('article')).toHaveLength(0)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })
})
