import { useState } from 'react'
import { requestPasswordReset } from '../../domain/auth/account'
import { isNative } from '../../lib/platform'
import { NATIVE_OAUTH_REDIRECT } from '../../lib/nativeAuth'
import { sanitizeInput, validateEmail } from '../../lib/validation'
import { logSecurityEvent } from '../../lib/security'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'

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
      // En la app nativa window.location.origin es https://localhost /
      // capacitor://localhost, que en un correo no lleva a ninguna parte. Se usa
      // el deep link para que el enlace reabra la app: allí está el code_verifier
      // del flujo PKCE y auth-js emite PASSWORD_RECOVERY al canjear el código,
      // que es justo lo que useOAuthSession espera para mostrar el formulario.
      // Hay que abrir el correo en el MISMO teléfono que pidió el restablecimiento.
      const redirectTo = isNative() ? NATIVE_OAUTH_REDIRECT : window.location.origin
      const { error } = await requestPasswordReset(cleanEmail.toLowerCase(), redirectTo)

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

  return (
    <EditModal
      title="Recuperar Contraseña"
      size="sm"
      onClose={onClose}
      footer={!sent ? (
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            variant="gradient-primary"
            onClick={handleRequest}
            loading={loading}
            loadingText="Enviando..."
          >
            Enviar Enlace
          </Button>
        </>
      ) : (
        <Button variant="gradient-primary" onClick={onClose}>Entendido</Button>
      )}
    >
      {!sent ? (
        <>
          <p style={{ color: 'var(--at-ink-3)', marginBottom: '16px' }}>
            Ingresa tu correo electrónico para recibir instrucciones de recuperación.
          </p>
          <div>
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
              <p style={{ color: 'var(--at-danger)', fontSize: '12px', marginTop: '4px' }}>{emailError}</p>
            )}
          </div>
        </>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <div style={{ padding: '20px', background: 'var(--at-success-tint)', borderRadius: '8px', marginBottom: '16px', color: 'var(--at-success-strong)', fontWeight: 600 }}>
            ✅ ¡Correo enviado! Revisa tu bandeja de entrada.
          </div>
          <p style={{ color: 'var(--at-ink-3)' }}>
            Hemos enviado instrucciones de recuperación a tu correo.
          </p>
        </div>
      )}
    </EditModal>
  )
}
