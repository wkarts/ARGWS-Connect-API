import { describe, expect, it } from 'vitest'
import { resolveRuntimePlane } from '../config/plane'

describe('detecção de plano por hostname', () => {
  it.each([
    'control.connect.argws.com.br',
    'd.control.connect.argws.com.br',
    'admin.connect.argws.com.br',
    'd.admin.connect.argws.com.br',
  ])('classifica %s como Control Plane', hostname => {
    expect(resolveRuntimePlane(hostname)).toBe('control')
  })

  it.each([
    'partner.connect.argws.com.br',
    'd.partner.connect.argws.com.br',
    'partners.connect.argws.com.br',
  ])('classifica %s como Partner Plane', hostname => {
    expect(resolveRuntimePlane(hostname)).toBe('partner')
  })

  it.each([
    'demo.d.connect.argws.com.br',
    'cliente.d.connect.argws.com.br',
    'cliente.connect.argws.com.br',
  ])('classifica %s como Tenant Plane', hostname => {
    expect(resolveRuntimePlane(hostname)).toBe('tenant')
  })

  it('honra hosts configurados explicitamente', () => {
    expect(resolveRuntimePlane('cp.example.net', '', 'cp.example.net', 'pp.example.net')).toBe('control')
    expect(resolveRuntimePlane('pp.example.net', '', 'cp.example.net', 'pp.example.net')).toBe('partner')
  })

  it('mantém os overrides de diagnóstico por query string', () => {
    expect(resolveRuntimePlane('localhost', '?control=1')).toBe('control')
    expect(resolveRuntimePlane('localhost', '?partner=1')).toBe('partner')
  })
})
