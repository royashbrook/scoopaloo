// Offline shell with honest updates (#18). The old worker served EVERY get
// cache-first under a fixed cache name, so an installed client kept the first
// shell it ever saw and no deploy could reach it online. The rule now:
//   - navigations go network FIRST: an online reload always gets the current
//     deployment; offline falls back to the cached shell.
//   - hashed/static assets stay cache-first: their names change when they change.
//   - only ok responses are ever cached.
const CACHE = 'scoopaloo-v11'
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/rescue.html',
  '/assets/scoopaloo-atlas.png?v=2',
  '/assets/brand/scoopaloo-logo.svg',
  '/assets/brand/scoopaloo-mark.svg',
  '/assets/room/ice-cream-wall.svg?v=1',
  '/assets/room/mint-plant.svg?v=1',
  '/assets/helpers/pip-prep-pal.svg',
  '/assets/items/vanilla-cone.svg',
  '/assets/items/sundae.svg',
  '/assets/items/soft-scoop.svg',
  '/assets/items/cone-shell.svg',
  '/assets/items/sundae-cup.svg',
  '/assets/items/chocolate-scoop.svg',
  '/assets/items/chocolate-cone.svg',
  '/assets/items/chocolate-sundae.svg',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
]

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
  return caches.open(CACHE).then(cache => cache.put(request, copy))
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) return
  // the update probe must see the real server, never our cache: a cache-first
  // answer here would hide every new deployment from the update toast (#19)
  if (new URL(request.url).searchParams.has('update-probe')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // waitUntil, not fire-and-forget: the worker may be killed right after
          // respondWith settles, and a dropped put means the NEXT offline reload
          // serves the previous deployment's shell.
          if (response.ok) event.waitUntil(store(request, response))
          return response
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('/'))),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok) event.waitUntil(store(request, response))
      return response
    })),
  )
})
