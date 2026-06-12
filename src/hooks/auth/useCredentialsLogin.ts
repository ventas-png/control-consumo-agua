// Login con email/contraseña y segundo factor TOTP (P1 #5, extraído de
// useAuth sin cambios de comportamiento): rate-limit, clasificación de
// errores, step-up MFA y construcción de la sesión.
import { useState, useCallback } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import type { UserSession } from '../../types'
import { supabase } from '../../lib/supabase'
import { sanitizeInput, validateEmail } from '../../lib/validation'
import { logSecurityEvent } from '../../lib/security'
import { measureSLO, reportSLOError } from '../../lib/slo'
import { storeSession } from '../../lib/authSession'
import { recordLoginFailure, clearLoginFailures, getLoginLockoutMessage } from '../../lib/loginRateLimit'
import { buildSessionFromSupabase } from '../../domain/auth/session'
import { waitForLateSession } from '../../domain/auth/lateSession'
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

    // Finaliza un login cuyas credenciales Auth ya aceptó: step-up TOTP si
    // el usuario tiene segundo factor, construcción de la sesión de la app y
    // registro del evento. Lo comparten el camino normal y la recuperación
    // de sesión tardía (timeout con respuesta que llegó después del corte).
    const completeLogin = async (user: User, session: Session): Promise<string | null> => {
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
    }

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

      return await completeLogin(data.user, data.session)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown'
      logSecurityEvent('login_error', { email: cleanEmail, error: msg }).catch(console.error)

      if (msg === 'auth_timeout') {
        // El race del timeout NO cancela el signIn subyacente: el servidor
        // pudo aceptar las credenciales y la respuesta llegar tarde (red con
        // pérdida o candado de auth entre pestañas). Antes de declarar el
        // fallo, verificar con gracia corta si la sesión quedó guardada.
        const late = await waitForLateSession(async () => {
          const { data: lateData } = await supabase.auth.getSession()
          return lateData.session ?? null
        })
        if (late?.user) {
          logSecurityEvent('login_late_recovery', { email: cleanEmail }, late.user.id).catch(console.error)
          try {
            return await completeLogin(late.user, late)
          } catch { /* la recuperación falló — cae al mensaje de timeout */ }
        }
        return 'La conexión con el servidor tardó demasiado. Verifique su internet, cierre otras pestañas de la aplicación e intente de nuevo.'
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
