import { useState, type CSSProperties} from 'react'
import { supabase } from '../../lib/supabase'
import { sanitizeInput, validateEmail } from '../../lib/validation'
import { logSecurityEvent } from '../../lib/security'

interface Props {
  onClose: () => void
}

export function PasswordResetModal({ onClose }: Props) {
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleRequest() {
    const cleanEmail = sanitizeInput(email.trim())
    if (!cleanEmail || !validateEmail(cleanEmail)) {
      setEmailError('Por favor ingresa un correo electrónico válido')
      return
    }
    setEmailError('')
    setLoading(true)

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail.toLowerCase(), {
        redirectTo: window.location.origin,
      })

      if (error) {
        setEmailError('Error al solicitar restablecimiento. Intenta de nuevo.')
        setLoading(false)
        return
      }

      await logSecurityEvent('password_reset_requested', { email: cleanEmail })
      setSent(true)
    } catch {
      setEmailError('Error de conexión. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  const overlayStyle: CSSProperties = {
    position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
    background: 'rgba(0,0,0,0.5)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  }

  return (
    <div style={overlayStyle} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', padding: '32px', borderRadius: '16px', width: '90%', maxWidth: '480px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 700 }}>Recuperar Contraseña</h3>
          <button onClick={onClose} aria-label="Cerrar modal" style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer' }}>&times;</button>
        </div>

        {!sent ? (
          <>
            <p style={{ color: '#7E9389', marginBottom: '16px' }}>
              Ingresa tu correo electrónico para recibir instrucciones de recuperación.
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label htmlFor="reset-email" style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '14px' }}>
                Correo Electrónico
              </label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                style={{ width: '100%', padding: '12px', border: '2px solid var(--at-line)', borderRadius: '10px', fontSize: '15px', boxSizing: 'border-box' }}
              />
              {emailError && (
                <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '4px' }}>{emailError}</p>
              )}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleRequest}
                disabled={loading}
                style={{ flex: 1, padding: '12px', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
              >
                {loading ? 'Enviando...' : 'Enviar Enlace'}
              </button>
              <button
                onClick={onClose}
                style={{ flex: 1, padding: '12px', background: '#EAE6D8', color: '#3E5A4C', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div style={{ padding: '20px', background: '#d1fae5', borderRadius: '8px', marginBottom: '16px', color: '#059669', fontWeight: 600 }}>
              ✅ ¡Correo enviado! Revisa tu bandeja de entrada.
            </div>
            <p style={{ color: '#7E9389', marginBottom: '20px' }}>
              Hemos enviado instrucciones de recuperación a tu correo.
            </p>
            <button
              onClick={onClose}
              style={{ padding: '12px 32px', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
            >
              Entendido
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
