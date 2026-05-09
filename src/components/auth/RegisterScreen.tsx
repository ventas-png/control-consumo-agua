import { useState, type KeyboardEvent} from 'react'
import { supabase } from '../../lib/supabase'
import { validatePasswordStrength } from '../../lib/validation'

interface Props {
  onBack: () => void
  onRegistered: (email: string, password: string) => void
}

export function RegisterScreen({ onBack, onRegistered }: Props) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [cuiDui, setCuiDui] = useState('')
  const [fechaNacimiento, setFechaNacimiento] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleRegister() {
    setError('')

    if (!fullName.trim() || !email.trim() || !cuiDui.trim() || !fechaNacimiento || !password || !confirmPassword) {
      setError('Por favor complete todos los campos.')
      return
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      setError('Ingrese un correo electrónico válido.')
      return
    }

    const pwCheck = validatePasswordStrength(password)
    if (!pwCheck.valid) {
      setError(pwCheck.message)
      return
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-cliente-account', {
        body: {
          full_name: fullName.trim(),
          email: email.trim().toLowerCase(),
          cui_dui: cuiDui.trim(),
          fecha_nacimiento: fechaNacimiento,
          password,
        },
      })

      if (fnError) {
        setError(`Error: ${fnError.message || fnError.context?.statusCode || JSON.stringify(fnError)}`)
        return
      }

      const result = data as { success?: boolean; error?: string }
      if (result.error) {
        setError(result.error)
        return
      }

      setSuccess(true)
      // Auto-login after a brief success message
      setTimeout(() => {
        onRegistered(email.trim().toLowerCase(), password)
      }, 1500)
    } catch {
      setError('Error inesperado. Intente nuevamente.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !loading) handleRegister()
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #0d9488 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
    }}>
      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .reg-input:focus {
          outline: none;
          border-color: #0ea5e9 !important;
          box-shadow: 0 0 0 3px rgba(14,165,233,0.15);
        }
        .reg-btn-primary:hover:not(:disabled) {
          background: linear-gradient(135deg, #0284c7, #0891b2) !important;
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(14,165,233,0.4) !important;
        }
        .reg-btn-back:hover {
          background: rgba(255,255,255,0.12) !important;
        }
        .reg-card {
          padding: 40px;
        }
        .reg-two-col {
          grid-template-columns: 1fr 1fr;
        }
        @media (max-width: 480px) {
          .reg-card { padding: 24px 20px !important; }
          .reg-two-col { grid-template-columns: 1fr !important; }
        }
      `}</style>

      <div className="reg-card" style={{
        background: 'rgba(255,255,255,0.97)',
        borderRadius: '24px',
        width: '100%',
        maxWidth: '460px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
        animation: 'fadeInUp 0.4s ease',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            width: '56px', height: '56px', borderRadius: '16px',
            background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '26px', margin: '0 auto 14px',
            boxShadow: '0 8px 20px rgba(14,165,233,0.3)',
          }}>
            💧
          </div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
            Crear cuenta de cliente
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '13.5px', color: '#64748b' }}>
            Ingrese sus datos para verificar su identidad y crear acceso al portal
          </p>
        </div>

        {success ? (
          <div style={{
            textAlign: 'center',
            padding: '32px 20px',
            background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
            borderRadius: '16px',
            border: '1px solid #bbf7d0',
          }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>✅</div>
            <p style={{ margin: 0, fontWeight: 600, color: '#15803d', fontSize: '15px' }}>
              ¡Cuenta creada exitosamente!
            </p>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#166534' }}>
              Iniciando sesión...
            </p>
          </div>
        ) : (
          <>
            {/* Info banner */}
            <div style={{
              background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
              border: '1px solid #bfdbfe',
              borderRadius: '12px',
              padding: '12px 16px',
              marginBottom: '24px',
              fontSize: '12.5px',
              color: '#1e40af',
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start',
            }}>
              <span style={{ flexShrink: 0, fontSize: '14px' }}>ℹ️</span>
              <span>Sus datos deben coincidir con los registrados en el sistema. Solo clientes autorizados pueden crear cuenta.</span>
            </div>

            {/* Form fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label htmlFor="reg-fullname" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>
                  Nombre completo
                </label>
                <input
                  id="reg-fullname"
                  className="reg-input"
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ej. Juan Pérez García"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '10px 14px', fontSize: '14px',
                    border: '1.5px solid #e2e8f0', borderRadius: '10px',
                    background: '#f8fafc', color: '#0f172a',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                  }}
                />
              </div>

              <div>
                <label htmlFor="reg-email" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>
                  Correo electrónico
                </label>
                <input
                  id="reg-email"
                  className="reg-input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="correo@ejemplo.com"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '10px 14px', fontSize: '14px',
                    border: '1.5px solid #e2e8f0', borderRadius: '10px',
                    background: '#f8fafc', color: '#0f172a',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                  }}
                />
              </div>

              <div className="reg-two-col" style={{ display: 'grid', gap: '12px' }}>
                <div>
                  <label htmlFor="reg-cui" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>
                    DPI / CUI
                  </label>
                  <input
                    id="reg-cui"
                    className="reg-input"
                    type="text"
                    value={cuiDui}
                    onChange={e => setCuiDui(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="1234567890101"
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '10px 14px', fontSize: '14px',
                      border: '1.5px solid #e2e8f0', borderRadius: '10px',
                      background: '#f8fafc', color: '#0f172a',
                      transition: 'border-color 0.2s, box-shadow 0.2s',
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="reg-birthdate" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>
                    Fecha de nacimiento
                  </label>
                  <input
                    id="reg-birthdate"
                    className="reg-input"
                    type="date"
                    value={fechaNacimiento}
                    onChange={e => setFechaNacimiento(e.target.value)}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '10px 14px', fontSize: '14px',
                      border: '1.5px solid #e2e8f0', borderRadius: '10px',
                      background: '#f8fafc', color: '#0f172a',
                      transition: 'border-color 0.2s, box-shadow 0.2s',
                    }}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="reg-password" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>
                  Contraseña
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="reg-password"
                    className="reg-input"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Mínimo 8 caracteres"
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      padding: '10px 44px 10px 14px', fontSize: '14px',
                      border: '1.5px solid #e2e8f0', borderRadius: '10px',
                      background: '#f8fafc', color: '#0f172a',
                      transition: 'border-color 0.2s, box-shadow 0.2s',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    style={{
                      position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: '15px', color: '#94a3b8', padding: '2px',
                    }}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="reg-confirm-password" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: '#374151', marginBottom: '5px' }}>
                  Confirmar contraseña
                </label>
                <input
                  id="reg-confirm-password"
                  className="reg-input"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Repita su contraseña"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '10px 14px', fontSize: '14px',
                    border: `1.5px solid ${confirmPassword && confirmPassword !== password ? '#ef4444' : '#e2e8f0'}`,
                    borderRadius: '10px',
                    background: '#f8fafc', color: '#0f172a',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                  }}
                />
                {confirmPassword && confirmPassword !== password && (
                  <p style={{ margin: '4px 0 0', fontSize: '11.5px', color: '#ef4444' }}>
                    Las contraseñas no coinciden
                  </p>
                )}
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div style={{
                marginTop: '16px',
                padding: '12px 14px',
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '10px',
                fontSize: '13px',
                color: '#b91c1c',
                display: 'flex',
                gap: '8px',
                alignItems: 'flex-start',
              }}>
                <span style={{ flexShrink: 0 }}>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {/* Submit button */}
            <button
              className="reg-btn-primary"
              onClick={handleRegister}
              disabled={loading}
              style={{
                marginTop: '20px',
                width: '100%',
                padding: '13px',
                background: loading
                  ? '#94a3b8'
                  : 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                boxShadow: loading ? 'none' : '0 4px 14px rgba(14,165,233,0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              {loading ? (
                <>
                  <div style={{
                    width: '16px', height: '16px',
                    border: '2px solid rgba(255,255,255,0.4)',
                    borderTop: '2px solid white',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  Verificando...
                </>
              ) : (
                'Crear cuenta'
              )}
            </button>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

            {/* Back link */}
            <button
              className="reg-btn-back"
              onClick={onBack}
              style={{
                marginTop: '14px',
                width: '100%',
                padding: '10px',
                background: 'transparent',
                color: '#64748b',
                border: '1.5px solid #e2e8f0',
                borderRadius: '10px',
                fontSize: '13.5px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              ← Volver al inicio de sesión
            </button>
          </>
        )}
      </div>
    </div>
  )
}
