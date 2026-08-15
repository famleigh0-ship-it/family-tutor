import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: false, // we ship our own public/manifest.json
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}']
      }
    })
  ],
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
