import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ModalDialog from '../components/ModalDialog.vue'
import ConnectInstancesPage from '../pages/ConnectInstancesPage.vue'

const api = vi.hoisted(() => ({ listEngineInstances: vi.fn(), discoverEngineInstances: vi.fn(), createEngineInstance: vi.fn(),
  adoptEngineInstance: vi.fn(), connectEngineInstance: vi.fn(), deleteEngineInstance: vi.fn(), detachEngineInstance: vi.fn(),
  restartEngineInstance: vi.fn(), reconcileEngineInstance: vi.fn() }))
vi.mock('../api/connectEngine', () => api)
const mounted: ReturnType<typeof mount>[] = []
function create(component: any, options: any = {}) {
  const wrapper = mount(component, { attachTo: document.body, ...options }); mounted.push(wrapper); return wrapper
}
const click = async (label: string) => {
  const button = [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === label)
  expect(button).toBeTruthy(); button!.click(); await flushPromises()
}
beforeEach(() => { vi.resetAllMocks(); api.listEngineInstances.mockResolvedValue([]); api.discoverEngineInstances.mockResolvedValue({ adopted: [] }) })
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()); document.body.innerHTML = '' })

describe('janelas de instâncias reais, sem stub de ModalDialog', () => {
  it('abre por v-model mesmo sem propriedade open', async () => {
    const wrapper = create(ModalDialog, { props: { title: 'Nova instância', modelValue: false } })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await wrapper.setProps({ modelValue: true })
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Nova instância')
    await click('') // botão fechar contém somente ícone
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })
  it('preserva open explícito, inclusive false, com prioridade sobre modelValue', async () => {
    const wrapper = create(ModalDialog, { props: { title: 'Legado', open: false, modelValue: true } })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await wrapper.setProps({ open: true })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
  it('botão Nova instância abre o formulário e envia uma única criação', async () => {
    api.createEngineInstance.mockResolvedValue({ id: 'new-binding' })
    create(ConnectInstancesPage); await flushPromises(); await click('Nova instância')
    const form = document.querySelector('[role="dialog"] form')!
    const input = form.querySelector('input') as HTMLInputElement
    expect(input).toBeTruthy(); input.value = 'atendimento'; input.dispatchEvent(new Event('input', { bubbles: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises()
    expect(api.createEngineInstance).toHaveBeenCalledTimes(1)
    expect(api.createEngineInstance.mock.calls[0][0].alias).toBe('atendimento')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('abre adoção sem consultar ou vincular automaticamente inventário global', async () => {
    create(ConnectInstancesPage); await flushPromises(); await click('Adotar existente')
    expect(document.querySelector('[role="dialog"] input[type="password"]')).not.toBeNull()
    expect(api.adoptEngineInstance).not.toHaveBeenCalled()
  })
  it('erro de criação mantém formulário acessível e mostra motivo', async () => {
    api.createEngineInstance.mockRejectedValue({ response: { data: { error: { message: 'Limite contratado atingido.' } } } })
    create(ConnectInstancesPage); await flushPromises(); await click('Nova instância')
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flushPromises()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.body.textContent).toContain('Limite contratado atingido.')
  })
  it('pareamento abre a janela correta do vínculo selecionado', async () => {
    api.listEngineInstances.mockResolvedValue([{ id: 'tenant-binding', alias: 'sales', provider: 'WHATSAPP-BAILEYS', status: 'CREATED', instance_name: 'private-name' }])
    api.connectEngineInstance.mockResolvedValue({ pending: true })
    create(ConnectInstancesPage); await flushPromises()
    ;(document.querySelector('button[title="Conectar"]') as HTMLButtonElement).click(); await flushPromises()
    expect(api.connectEngineInstance).toHaveBeenCalledWith('tenant-binding', undefined)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Conectar WhatsApp')
  })
})
