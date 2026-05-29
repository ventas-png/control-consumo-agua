import { useState, useEffect, type CSSProperties} from 'react'
import { notify } from '../shared/Dialog'
import { supabase } from '../../lib/supabase'
import { logSecurityEvent } from '../../lib/security'
import { validatePasswordStrength } from '../../lib/validation'

interface Props {
  onBack: () => void
}

export function PasswordResetPage({ onBack }: Props) {
  const [sessionReady, setSessionReady] = useState<boolean | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [newPassError, setNewPassError] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    // Supabase processes the recovery token from the URL automatically (detectSessionInUrl: true)
    // and fires PASSWORD_RECOVERY — we just verify a recovery session exists
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSessionReady(!!session)
    })
  }, [])

  async function handleUpdate() {
    setNewPassError('')
    setConfirmError('')

    const pwCheck = validatePasswordStrength(newPassword)
    if (!pwCheck.valid) {
      setNewPassError(pwCheck.message)
      return
    }
    if (newPassword !== confirmPassword) {
      setConfirmError('Las contraseñas no coinciden')
      return
    }

    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })

      if (error) {
        notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar la contraseña. Intenta de nuevo.' })
        setLoading(false)
        return
      }

      // Invalidate all sessions after password change
      await supabase.auth.signOut({ scope: 'global' })
      window.history.replaceState({}, document.title, window.location.pathname)
      await logSecurityEvent('password_reset_completed', { success: true })
      setSuccess(true)
    } catch {
      notify({ variant: 'error', title: 'Error', text: 'Error de conexión. Intenta de nuevo.' })
    } finally {
      setLoading(false)
    }
  }

  const cardStyle: CSSProperties = {
    maxWidth: '500px', margin: '40px auto', background: 'var(--at-surface)',
    borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)',
  }

  if (sessionReady === null) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 50%, var(--at-accent-2) 100%)' }}>
        <div style={cardStyle}><p style={{ textAlign: 'center' }}>Validando enlace...</p></div>
      </div>
    )
  }

  if (!sessionReady) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 50%, var(--at-accent-2) 100%)' }}>
        <div style={cardStyle}>
          <div style={{ background: 'var(--at-danger-tint)', color: 'var(--at-danger)', padding: '15px', borderRadius: '8px', marginBottom: '16px' }}>
            Enlace inválido o expirado. Solicita un nuevo restablecimiento.
          </div>
          <button onClick={onBack} style={{ padding: '12px 24px', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            Volver al Inicio
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 50%, var(--at-accent-2) 100%)' }}>
      <div style={cardStyle}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '24px' }}>Restablecer Contraseña</h2>

        {!success ? (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="reset-new-password" style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '14px' }}>Nueva Contraseña</label>
              <input
                id="reset-new-password"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                style={{ width: '100%', padding: '12px', border: '2px solid var(--at-line)', borderRadius: '10px', fontSize: '15px', boxSizing: 'border-box' }}
              />
              {newPassError && <p style={{ color: 'var(--at-danger)', fontSize: '12px', marginTop: '4px' }}>{newPassError}</p>}
            </div>
            <div style={{ marginBottom: '24px' }}>
              <label htmlFor="reset-confirm-password" style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '14px' }}>Confirmar Contraseña</label>
              <input
                id="reset-confirm-password"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repite tu nueva contraseña"
                style={{ width: '100%', padding: '12px', border: '2px solid var(--at-line)', borderRadius: '10px', fontSize: '15px', boxSizing: 'border-box' }}
              />
              {confirmError && <p style={{ color: 'var(--at-danger)', fontSize: '12px', marginTop: '4px' }}>{confirmError}</p>}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleUpdate}
                disabled={loading}
                style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
              >
                {loading ? 'Actualizando...' : 'Actualizar Contraseña'}
              </button>
              <button
                onClick={onBack}
                style={{ flex: 1, padding: '12px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
              >
                Volver
              </button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ padding: '20px', background: 'var(--at-success-tint)', borderRadius: '8px', marginBottom: '20px', color: 'var(--at-success-strong)', fontWeight: 600 }}>
              ✅ ¡Contraseña actualizada exitosamente!
            </div>
            <p style={{ color: 'var(--at-ink-3)', marginBottom: '20px' }}>
              Tu contraseña ha sido actualizada. Ahora puedes iniciar sesión.
            </p>
            <button
              onClick={onBack}
              style={{ padding: '12px 32px', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
            >
              Iniciar Sesión
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
