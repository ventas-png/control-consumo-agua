import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  sectionName?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[ErrorBoundary] Section "${this.props.sectionName ?? 'unknown'}" crashed:`, error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
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
          <div style={{ fontSize: '48px' }}>⚠️</div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#1e293b' }}>
            Ocurrió un error en esta sección
          </h2>
          <p style={{ margin: 0, color: '#64748b', maxWidth: '420px', fontSize: '14px' }}>
            {this.state.error?.message ?? 'Error inesperado'}
          </p>
          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button
              onClick={this.handleReset}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                border: '1px solid #0ea5e9',
                background: '#0ea5e9',
                color: '#fff',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 500,
              }}
            >
              Reintentar
            </button>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '8px 20px',
                borderRadius: '8px',
                border: '1px solid #e2e8f0',
                background: '#fff',
                color: '#475569',
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
