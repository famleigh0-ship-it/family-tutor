import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Phase 10: switched from the default 'generateSW' strategy to
      // 'injectManifest' — generateSW mode has the plugin write the whole
      // service worker itself at build time, leaving no room for the real
      // Network-First-for-/api/-plus-offline-fallback logic the spec
      // wants. injectManifest keeps the plugin's precaching (it injects
      // self.__WB_MANIFEST — the hashed, cache-busted build asset list —
      // into our own src/sw.js) but lets that file contain real routing
      // logic. See src/sw.js.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      injectManifest: {
        // offline.html is a static file (not part of the JS/CSS bundle
        // graph) — included explicitly so it's precached at install time
        // and available as the catch-handler fallback even before the
        // network has ever been reached.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}']
      },
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'offline.html'],
      manifest: false // we ship our own public/manifest.json
    })
  ],
  build: {
    sourcemap: true
  },
  base: '/',
  server: {
    port: 5173,
    proxy: {
      // Run `vercel dev` (family-tutor-vercel-dev in .claude/launch.json)
      // alongside this server to get working api/ routes locally without
      // going through vercel dev's own frontend proxy — that proxy 404s on
      // Vite-internal asset requests (/src/*, /@vite/client, /@react-refresh)
      // in Vercel CLI 59.0.0 on Windows, even though the underlying Vite
      // instance it spawns serves them fine directly. Proxying only /api
      // here sidesteps that bug entirely: this server serves the real
      // frontend, vercel dev only ever handles /api/* requests.
      '/api': { target: 'http://localhost:3000', changeOrigin: true }
    }
  }
})
