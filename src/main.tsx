import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './components/shared/shared.css'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initMonitoring } from './lib/monitoring'
import { initAnalytics } from './lib/analytics'

// Error monitoring + product analytics. Both no-op without their env vars.
initMonitoring()
initAnalytics()

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
      <App />
    </ErrorBoundary>
  </StrictMode>
)
