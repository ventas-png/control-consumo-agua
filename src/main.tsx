import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './components/shared/shared.css'
import App from './App'

// One-time migration: remove stale v1 cache key
localStorage.removeItem('aquacontrol_data_v1')

// Apply the saved theme override before first paint to avoid a flash.
// 'auto' (no saved value) leaves it to the prefers-color-scheme media query.
const savedTheme = localStorage.getItem('at-theme')
if (savedTheme === 'dark' || savedTheme === 'light') {
  document.documentElement.setAttribute('data-theme', savedTheme)
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
