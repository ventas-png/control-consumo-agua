import { useState } from 'react'
import { signupCompany } from '../../domain/auth/account'
import { validatePasswordStrength } from '../../lib/validation'
import { FUNNEL, trackFunnel } from '../../lib/analytics'
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
  // Click-wrap obligatorio (RGPD/CCPA): desmarcado por defecto. Bloquea el envío.
  const [acceptedLegal, setAcceptedLegal] = useState(false)

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
    if (!acceptedLegal) return 'Debes leer y aceptar los Términos de Servicio, la Política de Privacidad y el Anexo DPA para continuar.'
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
      const { data, error: fnError } = await signupCompany({
        email: email.trim().toLowerCase(),
        password,
        full_name: fullName.trim(),
        company_name: companyName.trim(),
        phone: phone.trim() || undefined,
        servicio_agua: servicioAgua,
        servicio_condominios: servicioCondominios,
        // Evidencia click-wrap: el backend la valida y registra (versión + IP +
        // timestamp + user-agent) en legal_acceptances.
        legal_accepted: acceptedLegal,
      })
      if (fnError) {
        setError(`Error: ${fnError ?? 'No se pudo crear la cuenta.'}`)
        return
      }
      if (data?.error) {
        setError(data.error)
        return
      }
      // Funnel (PostHog): cima del embudo. Anónimo (el identify ocurre al primer
      // login). Solo flags de servicio, sin email/nombre/teléfono.
      trackFunnel(FUNNEL.companySignedUp, {
        servicio_agua: servicioAgua,
        servicio_condominios: servicioCondominios,
      })
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

            {/* Click-wrap obligatorio, inmediatamente antes del botón de envío. */}
            <label className="signup-legal" style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', margin: '16px 0 4px', fontSize: '13px', color: 'var(--at-ink-2)', lineHeight: 1.5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={acceptedLegal}
                onChange={e => setAcceptedLegal(e.target.checked)}
                style={{ marginTop: '2px', width: '16px', height: '16px', flexShrink: 0, cursor: 'pointer' }}
                aria-describedby="signup-legal-text"
              />
              <span id="signup-legal-text">
                He leído y acepto los{' '}
                <a href="/terminos-servicio" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--at-primary)', textDecoration: 'underline' }}>Términos de Servicio</a>, la{' '}
                <a href="/politica-privacidad" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--at-primary)', textDecoration: 'underline' }}>Política de Privacidad</a> y el{' '}
                <a href="/acuerdo-dpa-cookies" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--at-primary)', textDecoration: 'underline' }}>Anexo de Procesamiento de Datos (DPA)</a> de administratodo.com.
              </span>
            </label>

            {error && <div className="signup-error" role="alert">⚠️ {error}</div>}
            <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
              <button className="signup-btn-secondary" onClick={() => setStep(1)} type="button" disabled={loading}>
                ← Atrás
              </button>
              <button className="signup-btn-primary" onClick={() => void handleSubmit()} type="button" disabled={loading || !acceptedLegal} style={{ flex: 1 }}>
                {loading ? 'Creando cuenta…' : 'Crear cuenta gratis'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Los estilos .signup-* viven ahora en src/styles/runtime.css (I24).
