import { useState, type KeyboardEvent} from 'react'
import { createClienteAccount } from '../../domain/auth/account'
import { validatePasswordStrength } from '../../lib/validation'
import { BrandLogo } from '../shared/BrandLogo'

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
  // Click-wrap obligatorio (RGPD/CCPA): desmarcado por defecto. Bloquea el envío.
  const [acceptedLegal, setAcceptedLegal] = useState(false)

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

    if (!acceptedLegal) {
      setError('Debes leer y aceptar los Términos de Servicio, la Política de Privacidad y el Anexo DPA para continuar.')
      return
    }

    setLoading(true)
    try {
      const { data, error: fnError } = await createClienteAccount({
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        cui_dui: cuiDui.trim(),
        fecha_nacimiento: fechaNacimiento,
        password,
        // Evidencia click-wrap: el backend la valida y registra (versión + IP +
        // timestamp + user-agent) en legal_acceptances.
        legal_accepted: acceptedLegal,
      })

      if (fnError) {
        setError(`Error: ${fnError}`)
        return
      }

      if (data?.error) {
        setError(data.error)
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
      background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 50%, var(--at-accent-2) 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
    }}>
      {/* Estilos (.reg-*, keyframes) en src/styles/runtime.css (I24). */}

      <div className="reg-card" style={{
        background: 'var(--at-surface)',
        borderRadius: '24px',
        width: '100%',
        maxWidth: '460px',
        boxShadow: '0 24px 64px rgba(0,0,0,0.18)',
        animation: 'fadeInUp 0.4s ease',
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div style={{
            width: '56px', height: '56px', margin: '0 auto 14px', lineHeight: 0,
            filter: 'drop-shadow(0 8px 20px rgba(27,59,54,0.3))',
          }}>
            <BrandLogo size={56} />
          </div>
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700, color: 'var(--at-ink)' }}>
            Crear cuenta de cliente
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: '13.5px', color: 'var(--at-ink-3)' }}>
            Ingrese sus datos para verificar su identidad y crear acceso al portal
          </p>
        </div>

        {success ? (
          <div style={{
            textAlign: 'center',
            padding: '32px 20px',
            background: 'linear-gradient(135deg, var(--at-success-tint), var(--at-success-tint))',
            borderRadius: '16px',
            border: '1px solid var(--at-success-border)',
          }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>✅</div>
            <p style={{ margin: 0, fontWeight: 600, color: 'var(--at-success-strong)', fontSize: '15px' }}>
              ¡Cuenta creada exitosamente!
            </p>
            <p style={{ margin: '6px 0 0', fontSize: '13px', color: 'var(--at-success-strong)' }}>
              Iniciando sesión...
            </p>
          </div>
        ) : (
          <>
            {/* Info banner */}
            <div style={{
              background: 'linear-gradient(135deg, var(--at-primary-tint), var(--at-primary-soft))',
              border: '1px solid var(--at-primary-soft-2)',
              borderRadius: '12px',
              padding: '12px 16px',
              marginBottom: '24px',
              fontSize: '12.5px',
              color: 'var(--at-ink-deep)',
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
                <label htmlFor="reg-fullname" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>
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
                    border: '1.5px solid var(--at-line)', borderRadius: '10px',
                    background: 'var(--at-surface-2)', color: 'var(--at-ink)',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                  }}
                />
              </div>

              <div>
                <label htmlFor="reg-email" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>
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
                    border: '1.5px solid var(--at-line)', borderRadius: '10px',
                    background: 'var(--at-surface-2)', color: 'var(--at-ink)',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                  }}
                />
              </div>

              <div className="reg-two-col" style={{ display: 'grid', gap: '12px' }}>
                <div>
                  <label htmlFor="reg-cui" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>
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
                      border: '1.5px solid var(--at-line)', borderRadius: '10px',
                      background: 'var(--at-surface-2)', color: 'var(--at-ink)',
                      transition: 'border-color 0.2s, box-shadow 0.2s',
                    }}
                  />
                </div>

                <div>
                  <label htmlFor="reg-birthdate" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>
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
                      border: '1.5px solid var(--at-line)', borderRadius: '10px',
                      background: 'var(--at-surface-2)', color: 'var(--at-ink)',
                      transition: 'border-color 0.2s, box-shadow 0.2s',
                    }}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="reg-password" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>
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
                      border: '1.5px solid var(--at-line)', borderRadius: '10px',
                      background: 'var(--at-surface-2)', color: 'var(--at-ink)',
                      transition: 'border-color 0.2s, box-shadow 0.2s',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    style={{
                      position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: '15px', color: 'var(--at-ink-3)', padding: '2px',
                    }}
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="reg-confirm-password" style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '5px' }}>
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
                    border: `1.5px solid ${confirmPassword && confirmPassword !== password ? 'var(--at-danger)' : 'var(--at-line)'}`,
                    borderRadius: '10px',
                    background: 'var(--at-surface-2)', color: 'var(--at-ink)',
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                  }}
                />
                {confirmPassword && confirmPassword !== password && (
                  <p style={{ margin: '4px 0 0', fontSize: '11.5px', color: 'var(--at-danger)' }}>
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
                background: 'var(--at-danger-tint)',
                border: '1px solid var(--at-danger-border)',
                borderRadius: '10px',
                fontSize: '13px',
                color: 'var(--at-danger-strong)',
                display: 'flex',
                gap: '8px',
                alignItems: 'flex-start',
              }}>
                <span style={{ flexShrink: 0 }}>⚠️</span>
                <span>{error}</span>
              </div>
            )}

            {/* Click-wrap obligatorio, inmediatamente antes del botón de envío. */}
            <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', marginTop: '18px', fontSize: '12.5px', color: 'var(--at-ink-2)', lineHeight: 1.5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={acceptedLegal}
                onChange={e => setAcceptedLegal(e.target.checked)}
                style={{ marginTop: '2px', width: '16px', height: '16px', flexShrink: 0, cursor: 'pointer' }}
              />
              <span>
                He leído y acepto los{' '}
                <a href="/terminos-servicio" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--at-primary)', textDecoration: 'underline' }}>Términos de Servicio</a>, la{' '}
                <a href="/politica-privacidad" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--at-primary)', textDecoration: 'underline' }}>Política de Privacidad</a> y el{' '}
                <a href="/acuerdo-dpa-cookies" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--at-primary)', textDecoration: 'underline' }}>Anexo de Procesamiento de Datos (DPA)</a> de administratodo.com.
              </span>
            </label>

            {/* Submit button */}
            <button
              className="reg-btn-primary"
              onClick={handleRegister}
              disabled={loading || !acceptedLegal}
              style={{
                marginTop: '20px',
                width: '100%',
                padding: '13px',
                background: loading
                  ? 'var(--at-ink-3)'
                  : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                color: 'white',
                border: 'none',
                borderRadius: '12px',
                fontSize: '15px',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                boxShadow: loading ? 'none' : '0 4px 14px rgba(27, 59, 54,0.35)',
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

            {/* Back link */}
            <button
              className="reg-btn-back"
              onClick={onBack}
              style={{
                marginTop: '14px',
                width: '100%',
                padding: '10px',
                background: 'transparent',
                color: 'var(--at-ink-3)',
                border: '1.5px solid var(--at-line)',
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
