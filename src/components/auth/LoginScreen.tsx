import { useState, useEffect } from 'react'
import { detectSsoForEmail, signInWithSso, type SsoEmailDetection } from '../../lib/sso'

interface Props {
  onLogin: (email: string, password: string) => Promise<string | null>
  onLoginWithGoogle: () => Promise<string | null>
  onForgotPassword: () => void
  onRegister: () => void
}

const FEATURES = [
  {
    icon: '📊',
    title: 'Lecturas en tiempo real',
    desc: 'Monitorea el consumo de cada contador al instante.',
  },
  {
    icon: '💧',
    title: 'Calidad del agua',
    desc: 'Registra y analiza parámetros de calidad por fuente.',
  },
  {
    icon: '📄',
    title: 'Facturación automática',
    desc: 'Genera y gestiona cobros con un solo clic.',
  },
]

export function LoginScreen({ onLogin, onLoginWithGoogle, onForgotPassword, onRegister }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [shake, setShake] = useState(false)
  const [loadingSeconds, setLoadingSeconds] = useState(0)
  // ── SSO/SAML enterprise (plat:P10) ──
  // Detección PRE-login del dominio del email (vía RPC anon sso_lookup_domain).
  // Toda la lógica vive en src/lib/sso.ts (useAuth.ts es T7, no se toca).
  const [sso, setSso] = useState<SsoEmailDetection | null>(null)
  const [ssoLoading, setSsoLoading] = useState(false)
  // Si SSO falla (p.ej. no habilitado en el proyecto → handshake parqueado),
  // se revela el password aunque el dominio esté "enforced": el login NUNCA
  // se rompe (fallback graceful = password, igual que hoy).
  const [ssoFailed, setSsoFailed] = useState(false)

  useEffect(() => {
    if (!loading) { setLoadingSeconds(0); return }
    const id = setInterval(() => setLoadingSeconds(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [loading])

  // Detección de SSO al teclear el email (debounce). Solo guarda la detección si
  // el dominio usa SSO; si no, queda null y el login se comporta como siempre.
  useEffect(() => {
    setSsoFailed(false)
    let cancelled = false
    const id = setTimeout(() => {
      void detectSsoForEmail(email).then(res => {
        if (!cancelled) setSso(res.available ? res : null)
      })
    }, 400)
    return () => { cancelled = true; clearTimeout(id) }
  }, [email])

  const ssoAvailable = !!sso?.available
  const hidePassword = !!sso?.enforced && !ssoFailed

  function getLoginStatusText(seconds: number): string {
    if (seconds >= 15) return 'Iniciando sistema, espere...'
    if (seconds >= 7) return 'Conectando con el servidor...'
    return 'Autenticando...'
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

  async function handleSso() {
    if (!sso?.domain) return
    setError('')
    setSsoLoading(true)
    const res = await signInWithSso(
      sso.providerId ? { providerId: sso.providerId } : { domain: sso.domain },
    )
    if (res.error) {
      // SSO no disponible (p.ej. parqueado): degradamos a password sin romper.
      setSsoFailed(true)
      setError('El inicio de sesión con SSO no está disponible ahora. Usa tu contraseña.')
      setShake(true)
      setTimeout(() => setShake(false), 500)
    }
    setSsoLoading(false)
  }

  return (
    <>
      <style>{`
        @keyframes floatBubble {
          0%   { transform: translateY(0) scale(1); opacity: 0.15; }
          50%  { transform: translateY(-50px) scale(1.08); opacity: 0.25; }
          100% { transform: translateY(0) scale(1); opacity: 0.15; }
        }
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%     { transform: translateX(-8px); }
          40%     { transform: translateX(8px); }
          60%     { transform: translateX(-6px); }
          80%     { transform: translateX(6px); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50%      { transform: scale(1.06); }
        }
        .login-input:focus {
          outline: none;
          border-color: var(--at-primary) !important;
          box-shadow: 0 0 0 3px rgba(27, 59, 54,0.15);
        }
        .login-input::placeholder { color: var(--at-ink-3); }
        .login-btn-main:hover:not(:disabled) {
          filter: brightness(1.08);
          transform: translateY(-1px);
          box-shadow: 0 8px 24px rgba(27, 59, 54,0.45);
        }
        .login-btn-main:active:not(:disabled) { transform: translateY(0); }
        .login-btn-google:hover:not(:disabled) {
          background: var(--at-surface-2) !important;
          box-shadow: 0 4px 14px rgba(0,0,0,0.12) !important;
        }
        .feat-card:hover {
          background: rgba(255,255,255,0.18) !important;
          transform: translateX(4px);
        }
        @media (max-width: 640px) {
          .login-left-panel { display: none !important; }
        }
        .login-right-panel {
          padding: 48px 40px;
        }
        @media (max-width: 480px) {
          .login-right-panel { padding: 32px 20px !important; }
        }
      `}</style>

      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'linear-gradient(135deg, var(--at-primary-hover) 0%, var(--at-primary-hover) 45%, var(--at-accent-2) 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 2000, overflow: 'hidden',
      }}>
        {/* Floating bubbles */}
        {[
          { size: 140, left: '6%',  top: '12%', delay: '0s',   dur: '8s'  },
          { size: 70,  left: '78%', top: '58%', delay: '1.5s', dur: '10s' },
          { size: 55,  left: '52%', top: '8%',  delay: '3s',   dur: '6s'  },
          { size: 180, left: '82%', top: '4%',  delay: '0.5s', dur: '12s' },
          { size: 45,  left: '18%', top: '78%', delay: '2s',   dur: '9s'  },
          { size: 90,  left: '38%', top: '82%', delay: '4s',   dur: '11s' },
        ].map((b, i) => (
          <div key={i} style={{
            position: 'absolute',
            width: b.size, height: b.size,
            left: b.left, top: b.top,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.22)',
            animation: `floatBubble ${b.dur} ${b.delay} ease-in-out infinite`,
            pointerEvents: 'none',
          }} />
        ))}

        {/* Main card */}
        <div style={{
          display: 'flex',
          maxWidth: '880px',
          width: '95%',
          maxHeight: '95vh',
          borderRadius: '28px',
          boxShadow: '0 40px 100px rgba(0,0,0,0.4)',
          overflow: 'auto',
          animation: 'fadeIn 0.45s ease both',
        }}>

          {/* LEFT PANEL — Brand hero */}
          <div className="login-left-panel" style={{
            flex: '0 0 340px',
            background: 'linear-gradient(160deg, rgba(2,90,140,0.97) 0%, rgba(7,130,120,0.97) 100%)',
            backdropFilter: 'blur(16px)',
            padding: '48px 32px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            color: 'white',
            minWidth: 0,
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Decorative circle behind logo */}
            <div style={{
              position: 'absolute', top: '-60px', right: '-60px',
              width: 200, height: 200, borderRadius: '50%',
              background: 'rgba(255,255,255,0.06)',
              pointerEvents: 'none',
            }} />
            <div style={{
              position: 'absolute', bottom: '-40px', left: '-40px',
              width: 160, height: 160, borderRadius: '50%',
              background: 'rgba(255,255,255,0.05)',
              pointerEvents: 'none',
            }} />

            {/* Brand */}
            <div>
              <div style={{
                width: 80, height: 80, borderRadius: '24px',
                background: 'rgba(255,255,255,0.15)',
                border: '2px solid rgba(255,255,255,0.28)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '40px', marginBottom: '20px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                animation: 'pulse 4s ease-in-out infinite',
              }}>💧</div>

              <h1 style={{ fontSize: '26px', fontWeight: 900, margin: '0 0 6px', lineHeight: 1.2, letterSpacing: '-0.5px' }}>
                Control de<br />Consumo
              </h1>
              <p style={{ fontSize: '14px', opacity: 0.75, margin: '0 0 36px', fontWeight: 400 }}>
                Sistema inteligente de gestión de agua
              </p>

              {/* Feature list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {FEATURES.map(f => (
                  <div key={f.title} className="feat-card" style={{
                    display: 'flex', alignItems: 'flex-start', gap: '14px',
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    borderRadius: '14px',
                    padding: '14px 16px',
                    transition: 'all 0.2s',
                    cursor: 'default',
                  }}>
                    <span style={{ fontSize: '26px', lineHeight: 1, flexShrink: 0 }}>{f.icon}</span>
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: '14px', lineHeight: 1.3 }}>{f.title}</p>
                      <p style={{ margin: '3px 0 0', fontSize: '12px', opacity: 0.72, lineHeight: 1.5 }}>{f.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer tagline */}
            <p style={{ margin: 0, fontSize: '12px', opacity: 0.5, fontStyle: 'italic', marginTop: '32px' }}>
              Gestión eficiente · Datos confiables
            </p>
          </div>

          {/* RIGHT PANEL — Login form */}
          <div className="login-right-panel" style={{
            flex: 1,
            background: 'var(--at-surface)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            minWidth: '300px',
          }}>
            <h2 style={{ fontSize: '28px', fontWeight: 900, color: 'var(--at-ink)', margin: '0 0 4px', letterSpacing: '-0.6px' }}>
              Bienvenido
            </h2>
            <p style={{ color: 'var(--at-ink-3)', fontSize: '14.5px', margin: '0 0 32px' }}>
              Inicia sesión para acceder al sistema
            </p>

            {/* Google button */}
            <button
              className="login-btn-google"
              onClick={handleGoogle}
              disabled={googleLoading || loading}
              style={{
                width: '100%', padding: '13px', fontSize: '15px', fontWeight: 600,
                background: 'var(--at-surface)', color: 'var(--at-ink-2)',
                border: '1.5px solid var(--at-line)', borderRadius: '14px',
                cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '10px',
                transition: 'all 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
                marginBottom: '22px',
              }}
            >
              {googleLoading ? (
                <span style={{
                  width: 20, height: 20, borderRadius: '50%',
                  border: '2.5px solid var(--at-line)', borderTopColor: '#4285f4',
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '22px' }}>
              <div style={{ flex: 1, height: '1px', background: 'var(--at-line)' }} />
              <span style={{ fontSize: '13px', color: 'var(--at-ink-3)', fontWeight: 500 }}>o con tu correo</span>
              <div style={{ flex: 1, height: '1px', background: 'var(--at-line)' }} />
            </div>

            {/* Email input */}
            <div style={{ position: 'relative', marginBottom: '12px' }}>
              <span style={{
                position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)',
                fontSize: '16px', pointerEvents: 'none', userSelect: 'none', opacity: 0.6,
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
                  border: '1.5px solid var(--at-line)', borderRadius: '12px',
                  width: '100%', fontSize: '15px', boxSizing: 'border-box',
                  background: 'var(--at-surface-2)', transition: 'border-color 0.2s, box-shadow 0.2s',
                  color: 'var(--at-ink)',
                }}
              />
            </div>

            {/* SSO call-to-action (plat:P10): aparece cuando el dominio usa SSO */}
            {ssoAvailable && (
              <button
                onClick={handleSso}
                disabled={ssoLoading || loading || googleLoading}
                style={{
                  width: '100%', padding: '13px', fontSize: '15px', fontWeight: 700,
                  background: 'var(--at-primary)', color: 'white',
                  border: 'none', borderRadius: '14px', cursor: ssoLoading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  marginBottom: hidePassword ? '8px' : '14px',
                  boxShadow: '0 4px 16px rgba(27, 59, 54,0.30)',
                }}
              >
                {ssoLoading ? 'Redirigiendo…' : `🔐 Continuar con SSO${sso?.domain ? ` (${sso.domain})` : ''}`}
              </button>
            )}
            {hidePassword && (
              <p style={{ margin: '0 0 14px', fontSize: '12.5px', color: 'var(--at-ink-3)', textAlign: 'center' }}>
                Tu organización requiere iniciar sesión con SSO.
              </p>
            )}

            {/* Password input */}
            {!hidePassword && (
            <div style={{ position: 'relative', marginBottom: '22px' }}>
              <span style={{
                position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)',
                fontSize: '16px', pointerEvents: 'none', userSelect: 'none', opacity: 0.6,
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
                  border: '1.5px solid var(--at-line)', borderRadius: '12px',
                  width: '100%', fontSize: '15px', boxSizing: 'border-box',
                  background: 'var(--at-surface-2)', transition: 'border-color 0.2s, box-shadow 0.2s',
                  color: 'var(--at-ink)',
                }}
              />
              <button
                onClick={() => setShowPassword(v => !v)}
                style={{
                  position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px',
                  padding: 0, lineHeight: 1, opacity: 0.55,
                }}
                tabIndex={-1}
                title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
            )}

            {/* Error message */}
            {error && (
              <div style={{
                background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)',
                borderRadius: '10px', padding: '10px 14px',
                color: 'var(--at-danger)', fontSize: '14px', fontWeight: 600,
                marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px',
                animation: shake ? 'shake 0.4s ease' : 'none',
              }}>
                ⚠️ {error}
              </div>
            )}

            {/* Submit button (oculto si el dominio fuerza SSO) */}
            {!hidePassword && (
            <button
              className="login-btn-main"
              onClick={handleLogin}
              disabled={loading || googleLoading}
              style={{
                width: '100%', padding: '14px', fontSize: '16px', fontWeight: 700,
                background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-primary-hover) 50%, var(--at-accent-2) 100%)',
                color: 'white', border: 'none', borderRadius: '14px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.8 : 1,
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                boxShadow: '0 4px 16px rgba(27, 59, 54,0.35)',
              }}
            >
              {loading ? (
                <>
                  <span style={{
                    width: 18, height: 18, borderRadius: '50%',
                    border: '2.5px solid rgba(255,255,255,0.4)', borderTopColor: 'white',
                    display: 'inline-block', animation: 'spin 0.7s linear infinite',
                  }} />
                  {getLoginStatusText(loadingSeconds)}
                </>
              ) : 'Iniciar Sesión'}
            </button>
            )}

            {/* Forgot password */}
            <div style={{ marginTop: '16px', textAlign: 'center' }}>
              <button
                onClick={onForgotPassword}
                style={{
                  background: 'none', border: 'none', color: 'var(--at-primary)',
                  cursor: 'pointer', fontSize: '14px', fontWeight: 500,
                  textDecoration: 'underline', textUnderlineOffset: '3px',
                }}
              >
                ¿Olvidaste tu contraseña?
              </button>
            </div>

            {/* Customer registration */}
            <div style={{
              marginTop: '16px',
              padding: '14px 18px',
              background: 'linear-gradient(135deg, var(--at-primary-tint), var(--at-primary-soft))',
              border: '1px solid var(--at-primary-soft-2)',
              borderRadius: '14px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '10px', flexWrap: 'wrap',
            }}>
              <div>
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--at-primary-hover)' }}>
                  ¿Eres cliente?
                </p>
                <p style={{ margin: '2px 0 0', fontSize: '12px', color: 'var(--at-primary-hover)' }}>
                  Consulta tu consumo en el portal
                </p>
              </div>
              <button
                onClick={onRegister}
                style={{
                  background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                  color: 'white', border: 'none', borderRadius: '10px',
                  padding: '8px 18px', fontSize: '13px', fontWeight: 700,
                  cursor: 'pointer', whiteSpace: 'nowrap',
                  boxShadow: '0 3px 10px rgba(27, 59, 54,0.35)',
                  transition: 'all 0.2s',
                }}
              >
                Registrarse →
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
