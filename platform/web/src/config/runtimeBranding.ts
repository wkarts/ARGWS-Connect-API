export interface RuntimeBranding {
  scope: 'PLATFORM' | 'PARTNER' | 'TENANT' | 'NEUTRAL' | string
  owner_id?: string | null
  version: number
  name: string
  short_name: string
  logo_light_url?: string | null
  logo_dark_url?: string | null
  favicon_url?: string | null
  apple_touch_icon_url?: string | null
  pwa_icon_192_url?: string | null
  pwa_icon_512_url?: string | null
  primary_color: string
  accent_color: string
  background_color: string
  surface_color: string
  text_color: string
  manifest_name: string
  manifest_short_name: string
  resolved: boolean
}

declare global { interface Window { __CONNECT_API_BOOTSTRAP__?: { branding?: RuntimeBranding } } }

export function bootBranding(): RuntimeBranding | null { return window.__CONNECT_API_BOOTSTRAP__?.branding || null }

export function applyBranding(branding: RuntimeBranding | null) {
  if (!branding) return
  const root=document.documentElement
  root.dataset.brandScope=branding.scope
  root.style.setProperty('--brand-primary', branding.primary_color)
  root.style.setProperty('--brand-accent', branding.accent_color)
  root.style.setProperty('--brand-background', branding.background_color)
  root.style.setProperty('--brand-surface', branding.surface_color)
  root.style.setProperty('--brand-text', branding.text_color)
  document.title=branding.name || 'Application'
  const theme=document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if(theme)theme.content=branding.primary_color
  const favicon=document.querySelector<HTMLLinkElement>('#runtime-favicon')
  if(favicon){ if(branding.favicon_url){favicon.href=branding.favicon_url;favicon.removeAttribute('disabled')} else favicon.removeAttribute('href') }
  const apple=document.querySelector<HTMLLinkElement>('#runtime-apple-touch-icon')
  if(apple){ if(branding.apple_touch_icon_url)apple.href=branding.apple_touch_icon_url; else apple.removeAttribute('href') }
  const manifest=document.querySelector<HTMLLinkElement>('#app-manifest')
  if(manifest)manifest.href='/api/v1/public/branding/manifest.webmanifest'
}
