import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import './components/shared/shared.css'
// Estilos antes inyectados como <style> inline en runtime; consolidados aquí para
// poder quitar 'unsafe-inline' de style-src en la CSP (infra:I24). Ver runtime.css.
import './styles/runtime.css'
import App from './App'
import { queryClient } from './domain/queryClient'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PwaUpdatePrompt } from './components/PwaUpdatePrompt'
import { CookieConsent } from './components/shared/CookieConsent'
import { DialogProvider } from './components/shared/Dialog'
import { PromptDialogRoot } from './components/shared/PromptDialog'
import { I18nProvider } from './lib/i18n'
import { FeatureFlagsProvider } from './lib/featureFlags'
import { initMonitoring } from './lib/monitoring'
import { initAnalytics } from './lib/analytics'
import { applyStoredConsent } from './lib/cookieConsent'

// Error monitoring + product analytics. Both no-op without their env vars.
// PostHog arranca OPTED-OUT (RGPD); aplicamos el consentimiento ya guardado para que
// quien aceptó "analítica" siga siendo medido sin reabrir el banner.
initMonitoring()
initAnalytics()
applyStoredConsent()

// Chunks viejos tras un deploy (Sentry PINK-RIBBON-1/-7): un tab abierto con el
// index.html anterior intenta lazy-load un chunk hasheado que ya no existe y el
// servidor responde index.html (MIME text/html) → pantalla rota. Recargar trae
// el index nuevo con los hashes vigentes. El guard de sessionStorage evita un
// loop de recargas si el fallo persiste (p. ej. sin conexión): en ese caso
// dejamos que Vite lance el error y lo capture el ErrorBoundary.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'at-chunk-reload-at'
  const last = Number(sessionStorage.getItem(KEY) ?? 0)
  if (Date.now() - last < 30_000) return
  sessionStorage.setItem(KEY, String(Date.now()))
  event.preventDefault()
  window.location.reload()
})

// One-time migration: remove stale v1 cache key
localStorage.removeItem('aquacontrol_data_v1')

// Apply the saved theme override before first paint to avoid a flash.
// 'auto' (no saved value) leaves it to the prefers-color-scheme media query.
const savedTheme = localStorage.getItem('at-theme')
if (savedTheme === 'dark' || savedTheme === 'light') {
  document.documentElement.setAttribute('data-theme', savedTheme)
}

// Root-level boundary: catches anything that escapes the per-section boundaries
// in App.tsx so a crash never shows a blank page.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary sectionName="root">
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <FeatureFlagsProvider>
            <DialogProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
              <PwaUpdatePrompt />
              <PromptDialogRoot />
              <CookieConsent />
            </DialogProvider>
          </FeatureFlagsProvider>
        </I18nProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
)
