import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './lib/AuthContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)

// Phase 10 PWA: register the service worker (src/sw.js, built via
// vite-plugin-pwa's injectManifest strategy — see vite.config.js) only in
// production. In dev, Vite serves the app unbundled and there's no built
// dist/sw.js to register anyway. `virtual:pwa-register` is the plugin's
// own registration helper rather than a hand-rolled
// navigator.serviceWorker.register call.
if (import.meta.env.PROD) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({
        onRegisteredSW(swUrl) {
          console.log(`[pwa] service worker registered: ${swUrl}`)
        },
        onRegisterError(error) {
          console.error('[pwa] service worker registration failed', error)
        }
      })
    })
    .catch((error) => console.error('[pwa] failed to load registration module', error))
}
