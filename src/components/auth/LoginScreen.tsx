import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'

interface Props {
  onLogin: (email: string, password: string) => Promise<string | null>
  onForgotPassword: () => void
}

export function LoginScreen({ onLogin, onForgotPassword }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showDiag, setShowDiag] = useState(false)
  const [diagContent, setDiagContent] = useState('')

  async function handleLogin() {
    setError('')
    setLoading(true)
    const err = await onLogin(email, password)
    if (err) setError(err)
    setLoading(false)
  }

  async function runDiagnostics() {
    setShowDiag(true)
    setDiagContent('🔍 Ejecutando diagnósticos...')

    const lines: string[] = []

    // Network
    lines.push(`🌐 Red: ${navigator.onLine ? '✅ Online' : '❌ Offline'}`)

    // Supabase
    try {
      const start = performance.now()
      const { error: e } = await supabase.from('clientes').select('count', { count: 'exact', head: true })
      const ms = (performance.now() - start).toFixed(0)
      lines.push(`🗄️ Supabase: ${e ? '❌ ' + e.message : `✅ ${ms}ms`}`)
    } catch (e) {
      lines.push(`🗄️ Supabase: ❌ ${e instanceof Error ? e.message : 'Error'}`)
    }

    // Storage
    try {
      localStorage.setItem('_t', '1'); localStorage.removeItem('_t')
      lines.push('💾 localStorage: ✅')
    } catch { lines.push('💾 localStorage: ❌') }

    setDiagContent(lines.join('\n'))
  }

  function clearData() {
    sessionStorage.removeItem('userSession')
    localStorage.clear()
    setEmail('')
    setPassword('')
    setError('')
    setShowDiag(false)
    Swal.fire({ icon: 'success', title: 'Datos limpiados', timer: 1500, showConfirmButton: false })
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #14b8a6 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(5px)',
        padding: '40px', borderRadius: '20px', boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
        maxWidth: '400px', width: '90%', color: '#0f172a',
      }}>
        <h2 style={{ fontSize: '24px', marginBottom: '8px', textAlign: 'center' }}>
          Acceso Seguro
        </h2>
        <p style={{ color: '#64748b', marginBottom: '20px', textAlign: 'center', fontSize: '14px' }}>
          Ingresa tus credenciales para continuar
        </p>

        <input
          type="email"
          placeholder="Correo electrónico"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          style={{ padding: '14px', border: '2px solid #e2e8f0', borderRadius: '10px', width: '100%', marginBottom: '12px', fontSize: '16px', boxSizing: 'border-box' }}
        />
        <input
          type="password"
          placeholder="Contraseña"
          value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLogin()}
          style={{ padding: '14px', border: '2px solid #e2e8f0', borderRadius: '10px', width: '100%', marginBottom: '16px', fontSize: '16px', boxSizing: 'border-box' }}
        />

        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width: '100%', padding: '14px', fontSize: '16px', fontWeight: 700,
            background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)',
            color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer',
          }}
        >
          {loading ? 'Autenticando...' : 'Iniciar Sesión'}
        </button>

        {error && (
          <p style={{ color: '#ef4444', marginTop: '12px', fontWeight: 600, textAlign: 'center' }}>
            {error}
          </p>
        )}

        <div style={{ marginTop: '12px', textAlign: 'center' }}>
          <button
            onClick={onForgotPassword}
            style={{ background: 'none', border: 'none', color: '#0ea5e9', cursor: 'pointer', fontSize: '14px' }}
          >
            ¿Olvidaste tu contraseña?
          </button>
        </div>

        <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
          <button
            onClick={runDiagnostics}
            style={{ flex: 1, padding: '10px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
          >
            🔍 Diagnóstico
          </button>
          <button
            onClick={clearData}
            style={{ flex: 1, padding: '10px', background: '#fef3c7', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
          >
            🧹 Limpiar datos
          </button>
        </div>

        {showDiag && (
          <div style={{ marginTop: '12px', background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px', fontFamily: 'monospace', whiteSpace: 'pre-line' }}>
            {diagContent}
          </div>
        )}
      </div>
    </div>
  )
}
