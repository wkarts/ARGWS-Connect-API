export type RuntimePlane = 'control' | 'partner' | 'tenant'

function normalizeHost(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '')
}

function hasHostnameLabel(hostname: string, label: string): boolean {
  return normalizeHost(hostname).split('.').includes(label)
}

export function resolveRuntimePlane(
  hostname: string,
  search = '',
  configuredControlHost = '',
  configuredPartnerHost = '',
): RuntimePlane {
  const host = normalizeHost(hostname)
  const controlHost = normalizeHost(configuredControlHost)
  const partnerHost = normalizeHost(configuredPartnerHost)
  const params = new URLSearchParams(search)

  if (params.get('control') === '1') return 'control'
  if (params.get('partner') === '1') return 'partner'

  if (
    (controlHost && host === controlHost) ||
    hasHostnameLabel(host, 'control') ||
    hasHostnameLabel(host, 'admin')
  ) {
    return 'control'
  }

  if (
    (partnerHost && host === partnerHost) ||
    hasHostnameLabel(host, 'partner') ||
    hasHostnameLabel(host, 'partners')
  ) {
    return 'partner'
  }

  return 'tenant'
}
