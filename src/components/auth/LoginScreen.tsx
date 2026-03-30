import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'

interface Props {
  onLogin: (email: string, password: string) => Promise<string | null>
  onLoginWithGoogle: () => Promise<string | null>
  onForgotPassword: () => void
  onRegister: () => void
}

const ROLES = [
  {
    icon: '🛡️',
    label: 'Administrador',
    color: '#7c3aed',
    bg: 'rgba(124,58,237,0.12)',
    perms: ['Gestión de clientes', 'Lecturas y facturación', 'Calidad del agua', 'Configuración del sistema'],
  },
  {
    icon: '⚙️',
    label: 'Operador',
    color: '#0ea5e9',
    bg: 'rgba(14,165,233,0.12)',
    perms: ['Gestión de clientes', 'Lecturas y facturación', 'Calidad del agua', 'Solo lectura config.'],
  },
  {
    icon: '👁️',
    label: 'Visor',
    color: '#14b8a6',
    bg: 'rgba(20,184,166,0.12)',
    perms: ['Ver historial', 'Dashboard analítico', 'Mapa de clientes', 'Solo consulta'],
  },
]

export function LoginScreen({ onLogin, onLoginWithGoogle, onForgotPassword, onRegister }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [showDiag, setShowDiag] = useState(false)
  const [diagContent, setDiagContent] = useState('')
  const [shake, setShake] = useState(false)
  const [superAdminMode, setSuperAdminMode] = useState(
    () => new URLSearchParams(window.location.search).get('superadmin') === '1'
  )

  function toggleSuperAdminMode() {
    const next = !superAdminMode
    setSuperAdminMode(next)
    const url = new URL(window.location.href)
    if (next) url.searchParams.set('superadmin', '1')
    else url.searchParams.delete('superadmin')
    window.history.replaceState(null, '', url.toString())
  }

  async function handleLogin() {
    setError('')
    setLoading(true)
    const err = await onLogin(email, password)
    if (err) {
      setError(err)
      setShake(true)
      setTimeout(() => setShake(false), 500)
    }
    setLoading(false)
  }

  async function handleGoogle() {
    setGoogleLoading(true)
    const err = await onLoginWithGoogle()
    if (err) {
      setError(err)
      setShake(true)
      setTimeout(() => setShake(false), 500)
    }
    setGoogleLoading(false)
  }

  async function runDiagnostics() {
    setDiagContent('🔍 Ejecutando diagnósticos...')
    const lines: string[] = []
    lines.push(`🌐 Red: ${navigator.onLine ? '✅ Online' : '❌ Offline'}`)
    try {
      const start = performance.now()
      const { error: e } = await supabase.from('clientes').select('count', { count: 'exact', head: true })
      const ms = (performance.now() - start).toFixed(0)
      lines.push(`🗄️ Supabase: ${e ? '❌ ' + e.message : `✅ ${ms}ms`}`)
    } catch (e) {
      lines.push(`🗄️ Supabase: ❌ ${e instanceof Error ? e.message : 'Error'}`)
    }
    try {
      localStorage.setItem('_t', '1'); localStorage.removeItem('_t')
      lines.push('💾 localStorage: ✅')
    } catch { lines.push('💾 localStorage: ❌') }
    setDiagContent(lines.join('\n'))
  }

  function clearData() {
    sessionStorage.removeItem('userSession')
    localStorage.clear()
    setEmail(''); setPassword(''); setError(''); setShowDiag(false)
    Swal.fire({ icon: 'success', title: 'Datos limpiados', timer: 1500, showConfirmButton: false })
  }

  return (
    <>
      <style>{`
        @keyframes floatBubble {
          0%   { transform: translateY(0) scale(1); opacity: 0.18; }
          50%  { transform: translateY(-60px) scale(1.1); opacity: 0.28; }
          100% { transform: translateY(0) scale(1); opacity: 0.18; }
        }
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%     { transform: translateX(-8px); }
          40%     { transform: translateX(8px); }
          60%     { transform: translateX(-6px); }
          80%     { transform: translateX(6px); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .login-input:focus {
          outline: none;
          border-color: #0ea5e9 !important;
          box-shadow: 0 0 0 3px rgba(14,165,233,0.15);
        }
        .login-input::placeholder { color: #94a3b8; }
        .login-btn-main:hover:not(:disabled) {
          filter: brightness(1.08);
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(14,165,233,0.4);
        }
        .login-btn-main:active:not(:disabled) { transform: translateY(0); }
        .login-btn-google:hover:not(:disabled) {
          background: #f8fafc !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.12) !important;
        }
        .role-card:hover { transform: translateY(-2px); }
      `}</style>

      {/* Full-screen background */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'linear-gradient(135deg, #0369a1 0%, #0891b2 40%, #0d9488 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000, overflow: 'hidden',
      }}>
        {/* Floating bubbles */}
        {[
          { size: 120, left: '8%',  top: '15%', delay: '0s',   dur: '7s'  },
          { size: 80,  left: '75%', top: '60%', delay: '1.5s', dur: '9s'  },
          { size: 60,  left: '55%', top: '10%', delay: '3s',   dur: '6s'  },
          { size: 160, left: '85%', top: '5%',  delay: '0.5s', dur: '11s' },
          { size: 50,  left: '20%', top: '75%', delay: '2s',   dur: '8s'  },
          { size: 100, left: '40%', top: '80%', delay: '4s',   dur: '10s' },
        ].map((b, i) => (
          <div key={i} style={{
            position: 'absolute',
            width: b.size, height: b.size,
            left: b.left, top: b.top,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.25)',
            animation: `floatBubble ${b.dur} ${b.delay} ease-in-out infinite`,
            pointerEvents: 'none',
          }} />
        ))}

        {/* Main card */}
        <div style={{
          display: 'flex',
          maxWidth: '860px',
          width: '95%',
          maxHeight: '95vh',
          borderRadius: '24px',
          boxShadow: '0 32px 80px rgba(0,0,0,0.35)',
          overflow: 'auto',
          animation: 'fadeIn 0.5s ease both',
        }}>

          {/* LEFT PANEL — Roles info (hidden on small screens via width trick) */}
          <div style={{
            flex: '0 0 320px',
            background: 'linear-gradient(160deg, rgba(3,105,161,0.95) 0%, rgba(13,148,136,0.95) 100%)',
            backdropFilter: 'blur(12px)',
            padding: '40px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            color: 'white',
            minWidth: 0,
          }} className="login-left-panel">
            {/* Logo / brand */}
            <div style={{ textAlign: 'center', marginBottom: '8px' }}>
              <div style={{
                width: 72, height: 72, borderRadius: '20px',
                background: 'rgba(255,255,255,0.15)',
                border: '2px solid rgba(255,255,255,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '36px', margin: '0 auto 12px',
              }}>💧</div>
              <h1 style={{ fontSize: '20px', fontWeight: 800, margin: 0, letterSpacing: '-0.3px' }}>
                Control de Consumo
              </h1>
              <p style={{ fontSize: '13px', opacity: 0.8, margin: '4px 0 0' }}>
                Sistema de Gestión de Agua
              </p>
            </div>

            {/* Role divider */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.2)', paddingTop: '20px' }}>
              <p style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1px', opacity: 0.7, textTransform: 'uppercase', margin: '0 0 14px' }}>
                Niveles de acceso
              </p>
              {ROLES.map(r => (
                <div key={r.label} className="role-card" style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  borderRadius: '12px',
                  padding: '12px 14px',
                  marginBottom: '10px',
                  transition: 'transform 0.2s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ fontSize: '18px' }}>{r.icon}</span>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>{r.label}</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: '18px', opacity: 0.8, fontSize: '12px', lineHeight: '1.7' }}>
                    {r.perms.map(p => <li key={p}>{p}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT PANEL — Login form */}
          <div style={{
            flex: 1,
            background: 'rgba(255,255,255,0.97)',
            padding: '44px 36px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minWidth: '300px',
          }}>
            {superAdminMode && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                color: 'white', borderRadius: '20px', padding: '4px 12px',
                fontSize: '12px', fontWeight: 700, letterSpacing: '0.5px',
                marginBottom: '12px',
              }}>
                🛡️ MODO SUPER ADMINISTRADOR
              </div>
            )}
            <h2 style={{ fontSize: '26px', fontWeight: 800, color: superAdminMode ? '#6d28d9' : '#0f172a', margin: '0 0 4px', letterSpacing: '-0.5px' }}>
              {superAdminMode ? 'Acceso Privilegiado' : 'Bienvenido'}
            </h2>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 28px' }}>
              {superAdminMode
                ? 'Área restringida — Solo personal autorizado'
                : 'Inicia sesión para acceder al sistema'}
            </p>

            {/* Google button */}
            <button
              className="login-btn-google"
              onClick={handleGoogle}
              disabled={googleLoading || loading}
              style={{
                width: '100%', padding: '12px', fontSize: '15px', fontWeight: 600,
                background: 'white', color: '#374151',
                border: '1.5px solid #e2e8f0', borderRadius: '12px',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '10px',
                transition: 'all 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                marginBottom: '20px',
              }}
            >
              {googleLoading ? (
                <span style={{
                  width: 20, height: 20, borderRadius: '50%',
                  border: '2.5px solid #e2e8f0', borderTopColor: '#4285f4',
                  display: 'inline-block', animation: 'spin 0.7s linear infinite',
                }} />
              ) : (
                <svg width="20" height="20" viewBox="0 0 48 48" fill="none">
                  <path d="M44.5 20H24v8.5h11.8C34.7 33.9 29.9 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z" fill="#FFC107"/>
                  <path d="M6.3 14.7l7 5.1C15.1 16.1 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 16.3 2 9.7 7.4 6.3 14.7z" fill="#FF3D00"/>
                  <path d="M24 46c5.5 0 10.5-1.9 14.3-5.1l-6.6-5.6C29.8 36.9 27 38 24 38c-5.9 0-10.8-4-12.4-9.4l-7 5.4C8.2 41.2 15.5 46 24 46z" fill="#4CAF50"/>
                  <path d="M44.5 20H24v8.5h11.8c-0.8 2.4-2.3 4.4-4.3 5.8l6.6 5.6C42 36.6 45 31 45 24c0-1.3-.2-2.7-.5-4z" fill="#1976D2"/>
                </svg>
              )}
              {googleLoading ? 'Conectando...' : 'Continuar con Google'}
            </button>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
              <span style={{ fontSize: '13px', color: '#94a3b8', fontWeight: 500 }}>o con tu correo</span>
              <div style={{ flex: 1, height: '1px', background: '#e2e8f0' }} />
            </div>

            {/* Email input */}
            <div style={{ position: 'relative', marginBottom: '12px' }}>
              <span style={{
                position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)',
                fontSize: '17px', pointerEvents: 'none', userSelect: 'none',
              }}>✉️</span>
              <input
                className="login-input"
                type="email"
                placeholder="Correo electrónico"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                style={{
                  padding: '13px 14px 13px 44px',
                  border: '1.5px solid #e2e8f0', borderRadius: '12px',
                  width: '100%', fontSize: '15px', boxSizing: 'border-box',
                  background: '#f8fafc', transition: 'border-color 0.2s, box-shadow 0.2s',
                  color: '#0f172a',
                }}
              />
            </div>

            {/* Password input */}
            <div style={{ position: 'relative', marginBottom: '20px' }}>
              <span style={{
                position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)',
                fontSize: '17px', pointerEvents: 'none', userSelect: 'none',
              }}>🔒</span>
              <input
                className="login-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="Contraseña"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLogin()}
                style={{
                  padding: '13px 44px 13px 44px',
                  border: '1.5px solid #e2e8f0', borderRadius: '12px',
                  width: '100%', fontSize: '15px', boxSizing: 'border-box',
                  background: '#f8fafc', transition: 'border-color 0.2s, box-shadow 0.2s',
                  color: '#0f172a',
                }}
              />
              <button
                onClick={() => setShowPassword(v => !v)}
                style={{
                  position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: '17px',
                  padding: 0, lineHeight: 1,
                }}
                tabIndex={-1}
                title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>

            {/* Error message */}
            {error && (
              <div style={{
                background: '#fef2f2', border: '1px solid #fecaca',
                borderRadius: '10px', padding: '10px 14px',
                color: '#dc2626', fontSize: '14px', fontWeight: 600,
                marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px',
                animation: shake ? 'shake 0.4s ease' : 'none',
              }}>
                ⚠️ {error}
              </div>
            )}

            {/* Submit button */}
            <button
              className="login-btn-main"
              onClick={handleLogin}
              disabled={loading || googleLoading}
              style={{
                width: '100%', padding: '14px', fontSize: '16px', fontWeight: 700,
                background: superAdminMode
                  ? 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)'
                  : 'linear-gradient(135deg, #0ea5e9 0%, #0891b2 50%, #0d9488 100%)',
                color: 'white', border: 'none', borderRadius: '12px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.8 : 1,
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}
            >
              {loading ? (
                <>
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%',
                    border: '2.5px solid rgba(255,255,255,0.4)', borderTopColor: 'white',
                    display: 'inline-block', animation: 'spin 0.7s linear infinite',
                  }} />
                  Autenticando...
                </>
              ) : '🔑 Iniciar Sesión'}
            </button>

            {/* Forgot password */}
            <div style={{ marginTop: '16px', textAlign: 'center' }}>
              <button
                onClick={onForgotPassword}
                style={{
                  background: 'none', border: 'none', color: '#0ea5e9',
                  cursor: 'pointer', fontSize: '14px', fontWeight: 500,
                  textDecoration: 'underline', textUnderlineOffset: '3px',
                }}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            {/* Customer registration */}
            <div style={{
              marginTop: '14px',
              padding: '14px 16px',
              background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)',
              border: '1px solid #bae6fd',
              borderRadius: '12px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '10px', flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: '13px', color: '#0369a1' }}>
                ¿Eres cliente y quieres consultar tu consumo?
              </span>
              <button
                onClick={onRegister}
                style={{
                  background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                  color: 'white', border: 'none', borderRadius: '8px',
                  padding: '7px 16px', fontSize: '13px', fontWeight: 600,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  boxShadow: '0 2px 8px rgba(14,165,233,0.3)',
                }}
              >
                Registrarse →
              </button>
            </div>

            {/* Diagnostics toggle */}
            <div style={{ marginTop: '24px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
              <button
                onClick={() => { setShowDiag(v => !v); if (!showDiag) runDiagnostics() }}
                style={{
                  background: 'none', border: '1px solid #e2e8f0', borderRadius: '8px',
                  color: '#64748b', cursor: 'pointer', fontSize: '12px',
                  padding: '6px 12px', width: '100%', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', gap: '6px',
                }}
              >
                {showDiag ? '▲' : '▼'} Diagnóstico del sistema
              </button>
              {showDiag && (
                <div style={{ marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <div style={{
                    flex: 1, background: '#f8fafc', padding: '10px 12px',
                    borderRadius: '8px', border: '1px solid #e2e8f0',
                    fontSize: '12px', fontFamily: 'monospace', whiteSpace: 'pre-line',
                    color: '#334155', lineHeight: '1.8', minWidth: '180px',
                  }}>
                    {diagContent || '...'}
                  </div>
                  <button
                    onClick={clearData}
                    style={{
                      padding: '8px 14px', background: '#fef3c7',
                      border: '1px solid #fde68a', borderRadius: '8px',
                      cursor: 'pointer', fontSize: '12px', color: '#92400e',
                      alignSelf: 'flex-start', whiteSpace: 'nowrap',
                    }}
                  >
                    🧹 Limpiar datos
                  </button>
                </div>
              )}
            </div>

            {/* Super Admin link */}
            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <button
                onClick={toggleSuperAdminMode}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '12px', color: superAdminMode ? '#6d28d9' : '#94a3b8',
                  fontWeight: superAdminMode ? 700 : 400,
                  textDecoration: 'underline', textUnderlineOffset: '3px',
                  transition: 'color 0.2s',
                }}
              >
                {superAdminMode ? '← Volver al acceso estándar' : '¿Super Administrador? Ingresar aquí'}
              </button>
            </div>
          </div>
        </div>

        {/* Responsive: hide left panel on small screens */}
        <style>{`
          @media (max-width: 640px) {
            .login-left-panel { display: none !important; }
          }
        `}</style>
      </div>
    </>
  )
}
