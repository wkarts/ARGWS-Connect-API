import type { ContactItem } from '@/types/domain'

export function testMessageDestination(typedNumber: string, contact?: ContactItem, provider = ''): string {
  const value = contact ? String(contact.number || contact.rawRef || '').trim() : String(typedNumber || '').trim()
  if (contact && /^\d+(?::\d+)?@lid$/.test(value)) {
    if (provider === 'WHATSAPP-BUSINESS') throw new Error('Este contato ainda não possui telefone conhecido para envio oficial.')
    return value.replace(/:\d+@/, '@')
  }
  const match = /^(\d+)(?::\d+)?@(s\.whatsapp\.net|c\.us)$/.exec(value)
  const candidate = match ? match[1] : value
  if (candidate.includes('@') || !/^\+?[\d\s().-]+$/.test(candidate)) throw new Error('Informe um telefone com código do país, DDD e número.')
  const digits = candidate.replace(/\D/g, '')
  if (!/^[1-9]\d{7,14}$/.test(digits)) throw new Error('Informe um telefone internacional válido, com 8 a 15 dígitos.')
  return digits
}

export function testMessageText(value: string): string {
  const text = String(value || '').trim()
  if (!text || text.length > 4096) throw new Error('Escreva uma mensagem de até 4.096 caracteres.')
  return text
}
