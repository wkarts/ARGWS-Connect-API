const CACHE = 'multitenant-app-static-v2'
const STATIC = ['/', '/icons/icon.svg', '/icons/icon-192.svg', '/icons/icon-512.svg']

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(STATIC))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const request = event.request
  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }

  // Extensões do navegador podem disparar requisições chrome-extension://,
  // moz-extension:// e outros esquemas dentro da página. CacheStorage aceita
  // somente HTTP(S); esses recursos não pertencem à aplicação financeira.
  if (!['http:', 'https:'].includes(url.protocol)) return
  if (url.origin !== self.location.origin) return
  if (request.method !== 'GET') return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/health')) return

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone()
          event.waitUntil(
            caches.open(CACHE)
              .then(cache => cache.put(request, clone))
              .catch(() => undefined)
          )
        }
        return response
      })
      .catch(async () => {
        const hit = await caches.match(request)
        if (hit) return hit
        if (request.mode === 'navigate') {
          const fallback = await caches.match('/')
          if (fallback) return fallback
        }
        return Response.error()
      })
  )
})
