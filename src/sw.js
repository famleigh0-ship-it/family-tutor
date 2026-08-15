// Custom service worker source (Phase 10) — vite-plugin-pwa's
// 'injectManifest' strategy builds this into dist/sw.js, replacing
// self.__WB_MANIFEST below with the real hashed/cache-busted asset list at
// build time. See vite.config.js for why injectManifest instead of the
// default generateSW (that mode writes the whole worker itself, leaving no
// room for the routing logic below).

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL, matchPrecache } from 'workbox-precaching'
import { registerRoute, NavigationRoute, setCatchHandler } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

// "Cache First for shell assets" — precacheAndRoute serves every hashed
// build asset (JS/CSS/HTML/icons) from cache first, only refetching when
// the manifest's revision hash changes on a new deploy.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// "Network First for API calls" — try the network, fall back to whatever
// was last cached for that exact URL if the network fails or is too slow.
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 5,
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] })]
  })
)

// SPA navigation fallback — any same-origin navigation not itself in the
// precache (i.e. every client-side route: /home, /session/:id, etc.) falls
// back to the precached index.html, so the real app — not just a static
// page — keeps working offline. "Your progress is saved" is literally
// true, since an in-progress session already persists to sessionStorage.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//]
  })
)

// Last-resort fallback, only reached if even the precache can't serve
// index.html (e.g. storage was evicted between install and this request).
// offline.html is a plain static page (not React — see public/offline.html)
// so it renders even if the app shell itself is unavailable.
setCatchHandler(async ({ event }) => {
  if (event.request.destination === 'document') {
    return (await matchPrecache('/offline.html')) ?? Response.error()
  }
  return Response.error()
})
