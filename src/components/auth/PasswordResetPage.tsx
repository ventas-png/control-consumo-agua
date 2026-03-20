import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'
import { logSecurityEvent } from '../../lib/security'

interface Props {
  token: string
  onBack: () => void
}

export function PasswordResetPage({ token, onBack }: Props) {
  const [resetEmail, setResetEmail] = useState<string | null>(null)
  const [tokenValid, setTokenValid] = useState<boolean | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [newPassError, setNewPassError] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    async function validateToken() {
      const { data, error } = await supabase.rpc('validate_reset_token', { token_input: token })
      if (error || !(data as { valid?: boolean })?.valid) {
        setTokenValid(false)
      } else {
        setTokenValid(true)
        setResetEmail((data as { email?: string }).email ?? null)
      }
    }
    validateToken()
  }, [token])

  async function handleUpdate() {
    setNewPassError('')
    setConfirmError('')

    if (newPassword.length < 6) {
      setNewPassError('La contraseña debe tener al menos 6 caracteres')
      return
    }
    if (newPassword !== confirmPassword) {
      setConfirmError('Las contraseñas no coinciden')
      return
    }

    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('update_user_password', {
        email_input: resetEmail,
        new_password: newPassword,
      })

      if (error || !(data as { success?: boolean })?.success) {
        Swal.fire('Error', 'No se pudo actualizar la contraseña. Intenta de nuevo.', 'error')
        setLoading(false)
        return
      }

      window.history.replaceState({}, document.title, window.location.pathname)
      await logSecurityEvent('password_reset_completed', { email: resetEmail, success: true })
      setSuccess(true)
    } catch {
      Swal.fire('Error', 'Error de conexión. Intenta de nuevo.', 'error')
    } finally {
      setLoading(false)
    }
  }

  const cardStyle: React.CSSProperties = {
    maxWidth: '500px', margin: '40px auto', background: 'white',
    borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)',
  }

  if (tokenValid === null) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #14b8a6 100%)' }}>
        <div style={cardStyle}><p style={{ textAlign: 'center' }}>Validando enlace...</p></div>
      </div>
    )
  }

  if (tokenValid === false) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #14b8a6 100%)' }}>
        <div style={cardStyle}>
          <div style={{ background: '#fef2f2', color: '#dc2626', padding: '15px', borderRadius: '8px', marginBottom: '16px' }}>
            Enlace inválido o expirado. Solicita un nuevo restablecimiento.
          </div>
          <button onClick={onBack} style={{ padding: '12px 24px', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            Volver al Inicio
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #14b8a6 100%)' }}>
      <div style={cardStyle}>
        <h2 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '24px' }}>Restablecer Contraseña</h2>

        {!success ? (
          <>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '14px' }}>Nueva Contraseña</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                style={{ width: '100%', padding: '12px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '15px', boxSizing: 'border-box' }}
              />
              {newPassError && <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px' }}>{newPassError}</p>}
            </div>
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '14px' }}>Confirmar Contraseña</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repite tu nueva contraseña"
                style={{ width: '100%', padding: '12px', border: '2px solid #e2e8f0', borderRadius: '10px', fontSize: '15px', boxSizing: 'border-box' }}
              />
              {confirmError && <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px' }}>{confirmError}</p>}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleUpdate}
                disabled={loading}
                style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
              >
                {loading ? 'Actualizando...' : 'Actualizar Contraseña'}
              </button>
              <button
                onClick={onBack}
                style={{ flex: 1, padding: '12px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
              >
                Volver
              </button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ padding: '20px', background: '#d1fae5', borderRadius: '8px', marginBottom: '20px', color: '#059669', fontWeight: 600 }}>
              ✅ ¡Contraseña actualizada exitosamente!
            </div>
            <p style={{ color: '#64748b', marginBottom: '20px' }}>
              Tu contraseña ha sido actualizada. Ahora puedes iniciar sesión.
            </p>
            <button
              onClick={onBack}
              style={{ padding: '12px 32px', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
            >
              Iniciar Sesión
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
