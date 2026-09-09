/** Preserve namespace and legacy group hyphens. Never guess type from length. */
export function whatsappDestination(value: string): string {
  const ref = String(value || '').trim()
  if (/^\d+(?:-\d+)?@g\.us$/.test(ref)) return ref
  if (/^\d+(?::\d+)?@(s\.whatsapp\.net|lid)$/.test(ref)) return ref.replace(/:\d+@/, '@')
  if (ref.includes('@') || !/^[+\d\s().-]+$/.test(ref)) throw new Error('Destino WhatsApp inválido.')
  const phone = ref.replace(/\D/g, '')
  if (!/^\d{5,15}$/.test(phone)) throw new Error('Informe um telefone internacional ou selecione a conversa.')
  return phone
}
