import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './components/shared/shared.css'
import App from './App'

// One-time migration: remove stale v1 cache key
localStorage.removeItem('aquacontrol_data_v1')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
