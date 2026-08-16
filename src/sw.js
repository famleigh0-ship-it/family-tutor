// Custom service worker source (Phase 10) — vite-plugin-pwa's
// 'injectManifest' strategy builds this into dist/sw.js, replacing
// self.__WB_MANIFEST below with the real hashed/cache-busted asset list at
// build time. See vite.config.js for why injectManifest instead of the
// default generateSW (that mode writes the whole worker itself, leaving no
// room for the routing logic below).

import { clientsClaim } from 'workbox-core'
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL, matchPrecache } from 'workbox-precaching'
import { registerRoute, NavigationRoute, setCatchHandler } from 'workbox-routing'
import { NetworkFirst } from 'workbox-strategies'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'

// Without these two, a newly-installed service worker sits in "waiting"
// state and the OLD one keeps controlling every open tab — including
// intercepting navigations and serving the OLD precached index.html/JS/CSS
// — until every tab for this origin is fully closed and reopened. Confirmed
// live during Phase 11: pushed a new deploy, Vercel showed it as Ready, but
// the browser kept serving the previous build indefinitely even across
// hard-reloads. skipWaiting activates the new worker immediately once
// installed; clientsClaim hands it control of already-open tabs right away
// instead of waiting for their next navigation.
self.skipWaiting()
clientsClaim()

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

// Absolute last resort — only reached if even offline.html isn't in the
// precache. Response.error() here previously meant a fully blank, silent
// failure in standalone mode (no browser chrome to show its own network-
// error page against). A hand-written inline response can never fail the
// same way, since it doesn't depend on any cache lookup succeeding.
const HARD_FALLBACK_HTML = `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Family Tutor</title></head>
<body style="font-family: sans-serif; display: flex; min-height: 100vh; align-items: center; justify-content: center; text-align: center; padding: 24px; background: #f8fafc; color: #0f172a;">
<div><p style="font-size: 16px; font-weight: 500;">You're offline.</p>
<p style="font-size: 14px; color: #64748b;">Reconnect and reopen the app to continue.</p></div>
</body></html>`

// Last-resort fallback, only reached if even the precache can't serve
// index.html (e.g. storage was evicted between install and this request).
// offline.html is a plain static page (not React — see public/offline.html)
// so it renders even if the app shell itself is unavailable.
setCatchHandler(async ({ event }) => {
  if (event.request.destination === 'document') {
    const precached = await matchPrecache('/offline.html')
    return precached ?? new Response(HARD_FALLBACK_HTML, { headers: { 'Content-Type': 'text/html' } })
  }
  return Response.error()
})
