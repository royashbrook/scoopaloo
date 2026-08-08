// Offline shell with honest updates (#18). The old worker served EVERY get
// cache-first under a fixed cache name, so an installed client kept the first
// shell it ever saw and no deploy could reach it online. The rule now:
//   - navigations go network FIRST: an online reload always gets the current
//     deployment; offline falls back to the cached shell.
//   - hashed/static assets stay cache-first: their names change when they change.
//   - only ok responses are ever cached.
const CACHE = 'scoopaloo-v3'
const SHELL = ['/', '/manifest.webmanifest', '/rescue.html', '/assets/scoopaloo-atlas.png?v=2']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

function store(request, response) {
  const copy = response.clone()
  caches.open(CACHE).then(cache => cache.put(request, copy))
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) store(request, response)
          return response
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('/'))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) store(request, response)
      return response
    })),
  )
})
