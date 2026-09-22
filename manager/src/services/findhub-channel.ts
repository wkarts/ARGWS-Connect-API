// The channel boundary is intentionally independent from WhatsApp capabilities.
export const FINDHUB_PROVIDER = 'GOOGLE-FIND-HUB'
export function isFindHub(value: any): boolean {
  return String(value?.provider || value?.integration || value || '').toUpperCase() === FINDHUB_PROVIDER
}
export function findHubPath(id: string, section = 'conta'): string {
  return `/findhub/${encodeURIComponent(id)}/${section}`
}
export function isWhatsAppInstance(value: any): boolean {
  return ['WHATSAPP-BAILEYS', 'WHATSAPP-ZAPO', 'WHATSAPP-BUSINESS'].includes(String(value?.provider || value?.integration || ''))
}
