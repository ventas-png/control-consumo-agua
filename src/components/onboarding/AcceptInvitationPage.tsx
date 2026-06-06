import { useState, useEffect, useCallback } from 'react'
import { previewInvitation } from '../../domain/onboarding/queries'
import { acceptInvitation, signInWithPassword } from '../../domain/onboarding/mutations'
import { validatePasswordStrength } from '../../lib/validation'
import { FUNNEL, trackFunnel } from '../../lib/analytics'
import { BrandLogo } from '../shared/BrandLogo'

// Landing pública de aceptación de invitación (T3/plat:P3).
//
// URL: /aceptar-invitacion?token=...  (registrada como early-return en App.tsx
// con el mismo patrón que /dev/components — no entra al árbol autenticado).
//
// Flujo:
//   1. Lee el token del query param.
//   2. preview → muestra empresa + rol + correo (edge accept-invitation, action='preview').
//   3. El invitado fija su contraseña → accept-invitation (action='accept') crea
//      el auth user + app_users + rol RBAC y marca la invitación aceptada.
//   4. signInWithPassword con el correo de la invitación → sesión lista; redirige
//      a "/" para entrar al flujo autenticado normal (useAuth la recoge).

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  operador: 'Operador',
  viewer: 'Visualizador',
  visor: 'Visualizador',
  collector: 'Cobros',
}

interface PreviewState {
  email: string
  role: string
  company_name: string | null
}

function getToken(): string {
  return new URLSearchParams(window.location.search).get('token')?.trim() ?? ''
}

export function AcceptInvitationPage() {
  const [token] = useState<string>(getToken)
  const [phase, setPhase] = useState<'loading' | 'form' | 'invalid' | 'success'>('loading')
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [invalidMsg, setInvalidMsg] = useState<string>('')

  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Carga el preview de la invitación al montar.
  useEffect(() => {
    if (!token) {
      setInvalidMsg('Falta el token de invitación en el enlace.')
      setPhase('invalid')
      return
    }
    let alive = true
    void (async () => {
      try {
        const { data: result, error: fnErr } = await previewInvitation(token)
        if (!alive) return
        if (fnErr || !result || result.error || !result.valid) {
          setInvalidMsg(result?.error ?? 'Esta invitación no es válida o expiró.')
          setPhase('invalid')
          return
        }
        setPreview({ email: result.email ?? '', role: result.role ?? '', company_name: result.company_name ?? null })
        setPhase('form')
      } catch {
        if (!alive) return
        setInvalidMsg('No se pudo verificar la invitación. Intenta de nuevo más tarde.')
        setPhase('invalid')
      }
    })()
    return () => { alive = false }
  }, [token])

  const handleSubmit = useCallback(async () => {
    setError('')
    const pw = validatePasswordStrength(password)
    if (!pw.valid) { setError(pw.message); return }
    if (password !== confirmPassword) { setError('Las contraseñas no coinciden.'); return }

    setSubmitting(true)
    try {
      const { data: result, error: fnErr } = await acceptInvitation(token, password, fullName.trim() || undefined)
      if (fnErr || !result || result.error || !result.success) {
        setError(result?.error ?? fnErr ?? 'No se pudo aceptar la invitación.')
        return
      }

      // Funnel (PostHog): invitación aceptada = cuenta creada. Se emite acá
      // (no en cada setPhase('success')) para no duplicar si el auto-login falla.
      // Anónimo todavía; sin email ni nombre.
      trackFunnel(FUNNEL.invitationAccepted)

      // Sesión lista: inicia sesión con el correo de la invitación y la
      // contraseña recién creada, luego entra al flujo autenticado normal.
      const email = result.email ?? preview?.email ?? ''
      const { error: signInErr } = await signInWithPassword(email, password)
      if (signInErr) {
        // La cuenta se creó pero el auto-login falló (raro). Mandamos al login.
        setPhase('success')
        return
      }
      setPhase('success')
      // Pequeño respiro para que el usuario vea la confirmación, luego entra.
      window.setTimeout(() => { window.location.replace('/') }, 1200)
    } catch {
      setError('Error inesperado. Intenta de nuevo.')
    } finally {
      setSubmitting(false)
    }
  }, [token, password, confirmPassword, fullName, preview])

  const roleLabel = preview ? (ROLE_LABEL[preview.role] ?? preview.role) : ''

  return (
    <div className="invite-screen">
      <div className="invite-card">
        <div className="invite-logo"><BrandLogo size={48} /></div>

        {phase === 'loading' && (
          <>
            <h1>Verificando invitación…</h1>
            <div className="invite-spinner" aria-label="Cargando" />
          </>
        )}

        {phase === 'invalid' && (
          <div style={{ textAlign: 'center' }}>
            <div className="invite-x">!</div>
            <h1>Invitación no válida</h1>
            <p className="invite-sub">{invalidMsg}</p>
            <button className="invite-btn-primary" onClick={() => window.location.replace('/')} type="button">
              Ir al inicio
            </button>
          </div>
        )}

        {phase === 'success' && (
          <div style={{ textAlign: 'center' }}>
            <div className="invite-check">✓</div>
            <h1>¡Cuenta activada!</h1>
            <p className="invite-sub">
              Te uniste a <strong>{preview?.company_name ?? 'tu empresa'}</strong>. Entrando…
            </p>
            <button className="invite-btn-primary" onClick={() => window.location.replace('/')} type="button">
              Entrar ahora
            </button>
          </div>
        )}

        {phase === 'form' && preview && (
          <>
            <h1>Te invitaron a {preview.company_name ?? 'una empresa'}</h1>
            <p className="invite-sub">Crea tu contraseña para activar tu cuenta.</p>

            <div className="invite-summary">
              <div className="invite-summary-row">
                <span>Empresa</span>
                <strong>{preview.company_name ?? '—'}</strong>
              </div>
              <div className="invite-summary-row">
                <span>Rol</span>
                <strong>{roleLabel}</strong>
              </div>
              <div className="invite-summary-row">
                <span>Correo</span>
                <strong>{preview.email}</strong>
              </div>
            </div>

            <label className="invite-field">
              <span>Nombre completo</span>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Ana García"
                autoComplete="name"
              />
            </label>
            <label className="invite-field">
              <span>Contraseña</span>
              <div className="invite-pw-wrap">
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
            <label className="invite-field">
              <span>Confirmar contraseña</span>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repite la contraseña"
                autoComplete="new-password"
              />
            </label>

            {error && <div className="invite-error" role="alert">⚠️ {error}</div>}

            <button
              className="invite-btn-primary"
              onClick={() => void handleSubmit()}
              type="button"
              disabled={submitting}
            >
              {submitting ? 'Activando cuenta…' : 'Aceptar invitación'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// Los estilos .invite-* (e invite-spin) viven ahora en src/styles/runtime.css (I24).
