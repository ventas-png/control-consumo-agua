// Login con email/contraseña y segundo factor TOTP (P1 #5, extraído de
// useAuth sin cambios de comportamiento): rate-limit, clasificación de
// errores, step-up MFA y construcción de la sesión.
import { useState, useCallback } from 'react'
import type { UserSession } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput, validateEmail } from '../../lib/validation'
import { logSecurityEvent } from '../../lib/security'
import { measureSLO, reportSLOError } from '../../lib/slo'
import { storeSession } from '../../lib/authSession'
import { recordLoginFailure, clearLoginFailures, getLoginLockoutMessage } from '../../lib/loginRateLimit'
import { buildSessionFromSupabase } from '../../domain/auth/session'
import { type MfaChallenge, needsTotpStepUp, findVerifiedTotpFactor, isValidTotpCode, classifyMfaVerifyError } from '../../domain/auth/mfa'

export function useCredentialsLogin(setCurrentUser: (s: UserSession) => void) {
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null)

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    // Rate limiting check
    const lockoutMsg = getLoginLockoutMessage()
    if (lockoutMsg) return lockoutMsg

    const cleanEmail = sanitizeInput(email.trim())

    if (!cleanEmail || !password) return 'Email y contraseña son requeridos'
    if (!validateEmail(cleanEmail)) return 'Formato de email inválido'

    try {
      // signInWithPassword has no built-in timeout — wrap it so a stalled
      // network connection doesn't keep "Autenticando..." on screen forever.
      // 20 s covers Supabase free-tier cold starts (~15-20 s).
      // infra:I3 — measureSLO emite breach si excede 2s p95.
      const authResult = await measureSLO('login.complete', () =>
        Promise.race([
          supabase.auth.signInWithPassword({
            email: cleanEmail.toLowerCase(),
            password,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('auth_timeout')), 20000)
          ),
        ])
      )
      const { data, error } = authResult

      if (error || !data?.session || !data?.user) {
        recordLoginFailure()
        logSecurityEvent('failed_login_attempt', {
          email: cleanEmail,
          reason: error?.message ?? 'invalid_credentials',
        }).catch(console.error)

        const msg = (error?.message ?? '').toLowerCase()
        // infra:I3 — solo reportar al SLO error rate los fallos INESPERADOS;
        // credenciales malas y email no confirmado son fallos legítimos
        // del usuario, no de la plataforma.
        const isUserError = msg.includes('invalid login credentials') ||
          msg.includes('invalid_credentials') ||
          msg.includes('email not confirmed') ||
          msg.includes('password') && msg.includes('compromised') ||
          msg.includes('too many')
        if (!isUserError) {
          reportSLOError('login.error_rate', { reason: error?.message ?? 'unknown' })
        }

        if (msg.includes('invalid login credentials') || msg.includes('invalid_credentials')) return 'Email o contraseña incorrectos'
        if (msg.includes('email not confirmed')) return 'Email no confirmado'
        if (msg.includes('password') && msg.includes('compromised')) return 'Contraseña comprometida. Debe cambiar su contraseña antes de ingresar.'
        if (msg.includes('too many')) return 'Demasiados intentos. Espere unos minutos.'
        return error?.message ? `Error: ${error.message}` : 'Login fallido'
      }

      const { user, session } = data

      // Check if the user requires a second factor (TOTP) before we hand them
      // a UserSession. Supabase's getAuthenticatorAssuranceLevel() returns the
      // current AAL of the token plus the next required one based on enrolled
      // factors. If nextLevel === 'aal2' and current is 'aal1' the user must
      // verify a TOTP code before being treated as logged in.
      const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (needsTotpStepUp(aal)) {
        const factorsResult = await supabase.auth.mfa.listFactors()
        const totpFactor = findVerifiedTotpFactor(factorsResult.data)
        if (totpFactor) {
          const challengeResult = await supabase.auth.mfa.challenge({ factorId: totpFactor.id })
          if (!challengeResult.error && challengeResult.data) {
            setMfaChallenge({
              factorId: totpFactor.id,
              challengeId: challengeResult.data.id,
              email: cleanEmail,
            })
            logSecurityEvent('mfa_challenge_started', { email: cleanEmail }, user.id).catch(console.error)
            return null
          }
        }
        // If we got here, the user has MFA required but we couldn't surface a
        // challenge. Sign out the half-authenticated token to avoid leaving a
        // residual session and surface the error.
        await supabase.auth.signOut().catch(() => undefined)
        return 'No fue posible iniciar el segundo factor. Intente de nuevo.'
      }

      const sessionData = await buildSessionFromSupabase(user.id, user.email ?? '', session.expires_at)
      storeSession(sessionData)
      setCurrentUser(sessionData)
      clearLoginFailures()

      logSecurityEvent('login_success', { email: cleanEmail }, user.id).catch(console.error)
      return null
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown'
      logSecurityEvent('login_error', { email: cleanEmail, error: msg }).catch(console.error)

      if (msg === 'auth_timeout') {
        return 'El servidor tardó en responder. Puede estar iniciando — intente de nuevo en unos segundos.'
      }
      const isNetworkError = msg.toLowerCase().includes('fetch') ||
        msg.toLowerCase().includes('network') ||
        msg.toLowerCase().includes('failed to fetch') ||
        msg.toLowerCase().includes('load failed')
      if (isNetworkError) {
        return 'Sin conexión con el servidor. Use "Diagnóstico del sistema" para verificar la URL activa.'
      }
      if (msg.includes('desactivada')) return msg
      return `Error de conexión: ${msg}`
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Verifica el código TOTP del segundo factor y finaliza el login. Solo se
  // llama cuando mfaChallenge !== null (es decir, login() previamente detectó
  // que el usuario tiene un factor verificado). En éxito construye la sesión
  // completa y limpia el challenge; en error devuelve mensaje para el UI.
  const verifyMfaChallenge = useCallback(async (code: string): Promise<string | null> => {
    if (!mfaChallenge) return 'No hay un desafío MFA activo. Vuelve a iniciar sesión.'
    const trimmed = code.trim()
    if (!isValidTotpCode(trimmed)) return 'El código debe tener 6 dígitos.'

    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId: mfaChallenge.factorId,
        challengeId: mfaChallenge.challengeId,
        code: trimmed,
      })
      if (error) {
        logSecurityEvent('mfa_verify_failed', { email: mfaChallenge.email, reason: error.message }).catch(console.error)
        return classifyMfaVerifyError(error.message)
      }

      const { data: sessionRes } = await supabase.auth.getSession()
      const userId = sessionRes.session?.user?.id
      const email = sessionRes.session?.user?.email ?? mfaChallenge.email
      const expiresAt = sessionRes.session?.expires_at
      if (!userId) {
        return 'La sesión expiró durante la verificación. Vuelve a iniciar sesión.'
      }

      const sessionData = await buildSessionFromSupabase(userId, email, expiresAt)
      storeSession(sessionData)
      setCurrentUser(sessionData)
      setMfaChallenge(null)
      clearLoginFailures()
      logSecurityEvent('mfa_verify_success', { email }, userId).catch(console.error)
      return null
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown'
      logSecurityEvent('mfa_verify_error', { email: mfaChallenge.email, error: msg }).catch(console.error)
      return `Error de conexión: ${msg}`
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mfaChallenge])

  // Aborta un challenge MFA en curso: cierra la sesión Supabase a medias y
  // limpia el estado para que el usuario regrese a la pantalla de email/pass.
  const cancelMfaChallenge = useCallback(async (): Promise<void> => {
    setMfaChallenge(null)
    try { await supabase.auth.signOut() } catch { /* ignore */ }
  }, [])

  const loginWithGoogle = useCallback(async (): Promise<string | null> => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
      if (error) return 'Error al iniciar sesión con Google'
      return null
    } catch {
      return 'Error al iniciar sesión con Google'
    }
  }, [])

  return { login, loginWithGoogle, mfaChallenge, verifyMfaChallenge, cancelMfaChallenge }
}
