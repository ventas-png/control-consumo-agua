import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { validatePasswordStrength } from '../../lib/validation'
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
        const { data, error: fnErr } = await supabase.functions.invoke('accept-invitation', {
          body: { token, action: 'preview' },
        })
        if (!alive) return
        const result = data as { valid?: boolean; email?: string; role?: string; company_name?: string | null; error?: string } | null
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
      const { data, error: fnErr } = await supabase.functions.invoke('accept-invitation', {
        body: { token, password, full_name: fullName.trim() || undefined },
      })
      const result = data as { success?: boolean; email?: string; error?: string } | null
      if (fnErr || !result || result.error || !result.success) {
        setError(result?.error ?? fnErr?.message ?? 'No se pudo aceptar la invitación.')
        return
      }

      // Sesión lista: inicia sesión con el correo de la invitación y la
      // contraseña recién creada, luego entra al flujo autenticado normal.
      const email = result.email ?? preview?.email ?? ''
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password })
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
      <style>{styles}</style>
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

const styles = `
.invite-screen {
  position: fixed; inset: 0; z-index: 2000;
  background: linear-gradient(135deg, var(--at-primary-hover) 0%, var(--at-accent-2) 100%);
  display: flex; align-items: center; justify-content: center;
  overflow: auto; padding: 20px;
}
.invite-card {
  background: var(--at-surface); border-radius: 20px;
  box-shadow: 0 30px 80px rgba(0,0,0,.3);
  width: 100%; max-width: 460px; padding: 32px;
  position: relative;
}
.invite-logo { display: flex; justify-content: center; margin-bottom: 14px; margin-top: 4px; }
.invite-card h1 { font-size: 21px; font-weight: 800; color: var(--at-ink); margin: 0 0 6px; text-align: center; }
.invite-sub { color: var(--at-ink-3); font-size: 14px; margin: 0 0 22px; text-align: center; line-height: 1.5; }
.invite-summary {
  background: var(--at-surface-2); border: 1.5px solid var(--at-line);
  border-radius: 12px; padding: 6px 16px; margin-bottom: 20px;
}
.invite-summary-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 0; border-bottom: 1px solid var(--at-line);
}
.invite-summary-row:last-child { border-bottom: none; }
.invite-summary-row > span {
  font-size: 12px; font-weight: 700; color: var(--at-ink-3);
  text-transform: uppercase; letter-spacing: 0.04em;
}
.invite-summary-row > strong { font-size: 14px; color: var(--at-ink); font-weight: 700; }
.invite-field { display: block; margin-bottom: 14px; }
.invite-field > span {
  display: block; font-size: 12px; font-weight: 700;
  color: var(--at-ink-2); margin-bottom: 5px;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.invite-field input {
  width: 100%; box-sizing: border-box;
  padding: 11px 14px; border: 1.5px solid var(--at-line);
  border-radius: 10px; font-size: 14px;
  background: var(--at-surface); color: var(--at-ink);
  outline: none; transition: border-color 0.15s;
}
.invite-field input:focus { border-color: var(--at-primary); box-shadow: 0 0 0 3px rgba(27,59,54,0.12); }
.invite-pw-wrap { position: relative; }
.invite-pw-wrap input { padding-right: 42px; }
.invite-pw-wrap button {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer; font-size: 16px;
  padding: 0; opacity: 0.6;
}
.invite-error {
  background: var(--at-danger-tint); border: 1px solid var(--at-danger-border);
  color: var(--at-danger); border-radius: 10px;
  padding: 10px 14px; font-size: 13px; font-weight: 500;
  margin: 4px 0 14px;
}
.invite-btn-primary {
  width: 100%; padding: 13px; font-size: 15px; font-weight: 700;
  background: linear-gradient(135deg, var(--at-primary), var(--at-accent-2));
  color: white; border: none; border-radius: 12px;
  cursor: pointer; transition: filter 0.15s;
  box-shadow: 0 6px 20px rgba(27, 59, 54, 0.3);
}
.invite-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
.invite-btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
.invite-check, .invite-x {
  width: 60px; height: 60px; border-radius: 50%;
  font-size: 32px; font-weight: 800; color: white;
  display: inline-flex; align-items: center; justify-content: center;
  margin-bottom: 14px;
}
.invite-check { background: var(--at-success); }
.invite-x { background: var(--at-danger); }
.invite-spinner {
  width: 36px; height: 36px; margin: 12px auto 4px;
  border: 3px solid var(--at-line);
  border-top-color: var(--at-primary);
  border-radius: 50%;
  animation: invite-spin 0.8s linear infinite;
}
@keyframes invite-spin { to { transform: rotate(360deg); } }
`
