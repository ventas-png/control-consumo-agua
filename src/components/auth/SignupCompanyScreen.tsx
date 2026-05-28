import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { validatePasswordStrength } from '../../lib/validation'
import { BrandLogo } from '../shared/BrandLogo'

interface Props {
  onBack: () => void
  onSignedUp: (email: string) => void
}

// Onboarding self-service de un nuevo workspace (plat:P5, F2.10).
//
// Es DIFERENTE de RegisterScreen (que es para residentes con CUI/DUI registrandose
// como clientes de una empresa ya existente). Aqui un admin crea una empresa nueva:
//
//   1. Sus datos personales (nombre + email + password)
//   2. Datos de su empresa (nombre + telefono opcional)
//   3. Elige modulo inicial (agua / condominios / ambos)
//   4. Submit → edge function signup-company:
//      - Crea auth user
//      - Crea companies row con signup_source = 'self_service'
//      - Crea app_users link con role = company_owner
//      - Dispara welcome email (fire-and-forget)
//   5. Mensaje de exito: revisa correo para confirmar
export function SignupCompanyScreen({ onBack, onSignedUp }: Props) {
  const [step, setStep] = useState<1 | 2>(1)

  // Step 1 — Datos del admin
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  // Step 2 — Datos de la empresa
  const [companyName, setCompanyName] = useState('')
  const [phone, setPhone] = useState('')
  const [servicioAgua, setServicioAgua] = useState(false)
  const [servicioCondominios, setServicioCondominios] = useState(false)

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  function validateStep1(): string | null {
    if (!fullName.trim()) return 'Ingresa tu nombre completo.'
    if (!email.trim()) return 'Ingresa tu correo electrónico.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Correo electrónico inválido.'
    const pw = validatePasswordStrength(password)
    if (!pw.valid) return pw.message
    if (password !== confirmPassword) return 'Las contraseñas no coinciden.'
    return null
  }

  function validateStep2(): string | null {
    if (!companyName.trim()) return 'Ingresa el nombre de tu empresa.'
    if (!servicioAgua && !servicioCondominios) return 'Selecciona al menos un módulo (agua o condominios).'
    return null
  }

  function nextStep() {
    setError('')
    const e = validateStep1()
    if (e) { setError(e); return }
    setStep(2)
  }

  async function handleSubmit() {
    setError('')
    const e = validateStep2()
    if (e) { setError(e); return }

    setLoading(true)
    try {
      const { data, error: fnError } = await supabase.functions.invoke('signup-company', {
        body: {
          email: email.trim().toLowerCase(),
          password,
          full_name: fullName.trim(),
          company_name: companyName.trim(),
          phone: phone.trim() || undefined,
          servicio_agua: servicioAgua,
          servicio_condominios: servicioCondominios,
        },
      })
      if (fnError) {
        setError(`Error: ${fnError.message ?? 'No se pudo crear la cuenta.'}`)
        return
      }
      const result = data as { success?: boolean; error?: string }
      if (result?.error) {
        setError(result.error)
        return
      }
      setSuccess(true)
    } catch {
      setError('Error inesperado. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="signup-screen">
        <style>{styles}</style>
        <div className="signup-card success">
          <div className="signup-logo"><BrandLogo size={48} /></div>
          <div className="success-check">✓</div>
          <h1>¡Cuenta creada!</h1>
          <p style={{ fontSize: '15px', color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            Empresa <strong>{companyName}</strong> registrada correctamente.
          </p>
          <p style={{ fontSize: '14px', color: 'var(--at-ink-3)', lineHeight: 1.5, marginBottom: '24px' }}>
            Hemos enviado un correo de confirmación a <strong>{email}</strong>.
            Revisa tu bandeja (o spam) y haz clic en el enlace para activar tu cuenta.
          </p>
          <button className="signup-btn-primary" onClick={() => onSignedUp(email.trim().toLowerCase())}>
            Ir al inicio de sesión
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="signup-screen">
      <style>{styles}</style>
      <div className="signup-card">
        <button className="signup-back" onClick={onBack} type="button">← Volver</button>
        <div className="signup-logo"><BrandLogo size={48} /></div>
        <h1>Crea tu cuenta empresarial</h1>
        <p className="signup-subtitle">
          Empieza gratis con AdministraTodo. Sin tarjeta de crédito.
        </p>

        {/* Stepper */}
        <div className="signup-stepper">
          <div className={`signup-step ${step >= 1 ? 'active' : ''}`}>
            <span className="signup-step-num">1</span>
            <span className="signup-step-label">Tus datos</span>
          </div>
          <div className="signup-step-divider" />
          <div className={`signup-step ${step >= 2 ? 'active' : ''}`}>
            <span className="signup-step-num">2</span>
            <span className="signup-step-label">Tu empresa</span>
          </div>
        </div>

        {step === 1 && (
          <>
            <label className="signup-field">
              <span>Nombre completo</span>
              <input type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Ana García" autoComplete="name" />
            </label>
            <label className="signup-field">
              <span>Correo electrónico</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ana@empresa.com" autoComplete="email" />
            </label>
            <label className="signup-field">
              <span>Contraseña</span>
              <div className="signup-pw-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres con letras y números"
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowPassword(v => !v)} aria-label={showPassword ? 'Ocultar' : 'Mostrar'}>
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </label>
            <label className="signup-field">
              <span>Confirmar contraseña</span>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repite la contraseña"
                autoComplete="new-password"
              />
            </label>
            {error && <div className="signup-error" role="alert">⚠️ {error}</div>}
            <button className="signup-btn-primary" onClick={nextStep} type="button">
              Siguiente →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <label className="signup-field">
              <span>Nombre de tu empresa</span>
              <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Administradora García SA" />
            </label>
            <label className="signup-field">
              <span>Teléfono (opcional)</span>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+502 1234-5678" />
            </label>

            <div className="signup-modules">
              <p className="signup-modules-title">¿Qué quieres administrar?</p>
              <p className="signup-modules-sub">Puedes activar el otro módulo más tarde.</p>
              <label className={`signup-module-card ${servicioCondominios ? 'selected' : ''}`}>
                <input type="checkbox" checked={servicioCondominios} onChange={e => setServicioCondominios(e.target.checked)} />
                <div>
                  <strong>🏢 Condominios</strong>
                  <span>Cuotas, reservas, visitantes, tickets, comunicación</span>
                </div>
              </label>
              <label className={`signup-module-card ${servicioAgua ? 'selected' : ''}`}>
                <input type="checkbox" checked={servicioAgua} onChange={e => setServicioAgua(e.target.checked)} />
                <div>
                  <strong>💧 Control de agua</strong>
                  <span>Lecturas, cobros, rutas, tarifas, clientes</span>
                </div>
              </label>
            </div>

            {error && <div className="signup-error" role="alert">⚠️ {error}</div>}
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button className="signup-btn-secondary" onClick={() => setStep(1)} type="button" disabled={loading}>
                ← Atrás
              </button>
              <button className="signup-btn-primary" onClick={() => void handleSubmit()} type="button" disabled={loading} style={{ flex: 1 }}>
                {loading ? 'Creando cuenta…' : 'Crear cuenta gratis'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const styles = `
.signup-screen {
  position: fixed; inset: 0; z-index: 2000;
  background: linear-gradient(135deg, var(--at-primary-hover) 0%, var(--at-accent-2) 100%);
  display: flex; align-items: center; justify-content: center;
  overflow: auto; padding: 20px;
}
.signup-card {
  background: var(--at-surface); border-radius: 20px;
  box-shadow: 0 30px 80px rgba(0,0,0,.3);
  width: 100%; max-width: 480px; padding: 32px;
  position: relative;
}
.signup-card.success { text-align: center; }
.signup-back {
  position: absolute; top: 16px; left: 16px;
  background: none; border: none; color: var(--at-ink-3);
  cursor: pointer; font-size: 13px; font-weight: 500;
  padding: 6px 10px; border-radius: 6px;
}
.signup-back:hover { background: var(--at-surface-2); }
.signup-logo { display: flex; justify-content: center; margin-bottom: 14px; margin-top: 8px; }
.signup-card h1 { font-size: 22px; font-weight: 800; color: var(--at-ink); margin: 0 0 6px; text-align: center; }
.signup-subtitle { color: var(--at-ink-3); font-size: 14px; margin: 0 0 24px; text-align: center; }
.signup-stepper { display: flex; align-items: center; justify-content: center; margin-bottom: 24px; gap: 8px; }
.signup-step { display: flex; align-items: center; gap: 8px; opacity: 0.4; transition: opacity 0.2s; }
.signup-step.active { opacity: 1; }
.signup-step-num {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--at-primary); color: white;
  display: inline-flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 13px;
}
.signup-step-label { font-size: 13px; font-weight: 600; color: var(--at-ink-2); }
.signup-step-divider { width: 40px; height: 2px; background: var(--at-line); }
.signup-field { display: block; margin-bottom: 14px; }
.signup-field > span {
  display: block; font-size: 12px; font-weight: 700;
  color: var(--at-ink-2); margin-bottom: 5px;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.signup-field input {
  width: 100%; box-sizing: border-box;
  padding: 11px 14px; border: 1.5px solid var(--at-line);
  border-radius: 10px; font-size: 14px;
  background: var(--at-surface); color: var(--at-ink);
  outline: none; transition: border-color 0.15s;
}
.signup-field input:focus { border-color: var(--at-primary); box-shadow: 0 0 0 3px rgba(27,59,54,0.12); }
.signup-pw-wrap { position: relative; }
.signup-pw-wrap input { padding-right: 42px; }
.signup-pw-wrap button {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer; font-size: 16px;
  padding: 0; opacity: 0.6;
}
.signup-error {
  background: var(--at-danger-tint); border: 1px solid var(--at-danger-border);
  color: var(--at-danger); border-radius: 10px;
  padding: 10px 14px; font-size: 13px; font-weight: 500;
  margin: 4px 0 14px;
}
.signup-btn-primary {
  width: 100%; padding: 13px; font-size: 15px; font-weight: 700;
  background: linear-gradient(135deg, var(--at-primary), var(--at-accent-2));
  color: white; border: none; border-radius: 12px;
  cursor: pointer; transition: filter 0.15s;
  box-shadow: 0 6px 20px rgba(27, 59, 54, 0.3);
}
.signup-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
.signup-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.signup-btn-secondary {
  padding: 13px 18px; font-size: 15px; font-weight: 600;
  background: var(--at-surface); color: var(--at-ink-2);
  border: 1.5px solid var(--at-line); border-radius: 12px;
  cursor: pointer; transition: background 0.15s;
}
.signup-btn-secondary:hover:not(:disabled) { background: var(--at-surface-2); }
.signup-modules { margin: 6px 0 18px; }
.signup-modules-title { font-size: 13px; font-weight: 700; color: var(--at-ink); margin: 0 0 4px; }
.signup-modules-sub { font-size: 12px; color: var(--at-ink-3); margin: 0 0 12px; }
.signup-module-card {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 14px; margin-bottom: 8px;
  border: 1.5px solid var(--at-line); border-radius: 12px;
  cursor: pointer; transition: all 0.15s;
}
.signup-module-card:hover { background: var(--at-surface-2); }
.signup-module-card.selected { border-color: var(--at-primary); background: var(--at-primary-tint, rgba(27,59,54,0.05)); }
.signup-module-card input { margin-top: 3px; cursor: pointer; }
.signup-module-card strong { display: block; font-size: 14px; color: var(--at-ink); margin-bottom: 2px; }
.signup-module-card span { font-size: 12px; color: var(--at-ink-3); }
.success-check {
  width: 60px; height: 60px; border-radius: 50%;
  background: var(--at-success); color: white;
  font-size: 32px; font-weight: 800;
  display: inline-flex; align-items: center; justify-content: center;
  margin-bottom: 14px;
}
`
