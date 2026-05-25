import { Component, type ErrorInfo, type ReactNode } from 'react'
import { captureException } from '../lib/monitoring'

interface Props {
  children: ReactNode
  sectionName?: string
}

interface State {
  hasError: boolean
  error: Error | null
  isChunkError: boolean
}

// Sentinel in sessionStorage to prevent infinite reload loops if the chunk
// error persists (e.g. the build is genuinely broken, not just stale).
const CHUNK_RELOAD_FLAG = 'aquacontrol_chunk_reload_attempted'

// Patterns thrown by browsers when a dynamic import() returns HTML (the
// Vercel/Netlify SPA fallback page) instead of the expected JS chunk. This
// happens when a tab open across a deploy navigates to a route whose lazy
// chunk hash no longer exists on the server.
const CHUNK_ERROR_PATTERNS = [
  'is not a valid JavaScript MIME type',          // Safari + Chrome (HTML returned)
  'Failed to fetch dynamically imported module',   // Chrome
  'error loading dynamically imported module',     // Firefox
  'Importing a module script failed',              // Safari
  'ChunkLoadError',                                // webpack-style (rare in Vite)
  'Loading chunk',                                 // older webpack
  "Unable to preload CSS",                         // Vite SSR-related
]

function isChunkLoadError(error: Error): boolean {
  const msg = error?.message ?? ''
  const name = error?.name ?? ''
  return name === 'ChunkLoadError' || CHUNK_ERROR_PATTERNS.some(p => msg.includes(p))
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, isChunkError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, isChunkError: isChunkLoadError(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary] Section "${this.props.sectionName ?? 'unknown'}" crashed:`, error, info)

    // Report real crashes to Sentry. Chunk-load errors are transient (stale tab
    // after a deploy) and self-heal via reload, so don't pollute the dashboard.
    if (!isChunkLoadError(error)) {
      captureException(error, {
        section: this.props.sectionName ?? 'unknown',
        componentStack: info.componentStack,
      })
    }

    // Auto-reload on first chunk-load error (stale tab after deploy). Guard
    // with a sessionStorage flag so a genuinely broken build doesn't loop.
    if (isChunkLoadError(error)) {
      const alreadyReloaded = sessionStorage.getItem(CHUNK_RELOAD_FLAG)
      if (!alreadyReloaded) {
        sessionStorage.setItem(CHUNK_RELOAD_FLAG, String(Date.now()))
        // Tiny delay so the user briefly sees "Actualizando…" instead of a
        // blink; also lets React commit the state before navigation.
        setTimeout(() => { window.location.reload() }, 600)
      }
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, isChunkError: false })
  }

  render() {
    if (this.state.hasError) {
      const isChunk = this.state.isChunkError
      const alreadyReloaded = isChunk && sessionStorage.getItem(CHUNK_RELOAD_FLAG)
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 24px',
          textAlign: 'center',
          minHeight: '300px',
          gap: '12px',
        }}>
          <div style={{ fontSize: '48px' }}>{isChunk ? '🔄' : '⚠️'}</div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: 'var(--at-ink)' }}>
            {isChunk
              ? (alreadyReloaded ? 'No se pudo cargar esta sección' : 'Actualizando a la nueva versión…')
              : 'Ocurrió un error en esta sección'}
          </h2>
          <p style={{ margin: 0, color: 'var(--at-ink-3)', maxWidth: '420px', fontSize: '14px' }}>
            {isChunk
              ? (alreadyReloaded
                  ? 'Recarga la página manualmente. Si el problema persiste, limpia la caché del navegador.'
                  : 'Se detectó una nueva versión de la app. Recargando automáticamente…')
              : (this.state.error?.message ?? 'Error inesperado')}
          </p>
          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            {!isChunk && (
              <button
                onClick={this.handleReset}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  border: '1px solid var(--at-primary)',
                  background: 'var(--at-primary)',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 500,
                }}
              >
                Reintentar
              </button>
            )}
            <button
              onClick={() => { sessionStorage.removeItem(CHUNK_RELOAD_FLAG); window.location.reload() }}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                border: '1px solid var(--at-line)',
                background: 'var(--at-surface)',
                color: 'var(--at-ink-2)',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 500,
              }}
            >
              Recargar página
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
