import { useState, useEffect, useCallback, useRef } from 'react'
import { confirm } from '../components/shared/Dialog'
import type { UserSession } from '../types'
import { supabase } from '../lib/supabase'
import { APP_CONFIG } from '../lib/config'
import { sanitizeInput, validateEmail } from '../lib/validation'
import { logSecurityEvent } from '../lib/security'
import { measureSLO, reportSLOError } from '../lib/slo'
// agua:A9 — session-storage y rate-limit de login vivían inline aquí
// (responsabilidades mezcladas); ahora son módulos puros y testeables.
import { getStoredSession, storeSession, clearSession } from '../lib/authSession'
import { recordLoginFailure, clearLoginFailures, getLoginLockoutMessage } from '../lib/loginRateLimit'
import { buildSessionFromSupabase, refreshSessionFromSupabase } from '../domain/auth/session'

async function applyOAuthSession(
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
  expiresAt: number | undefined,
  provider: string,
  setCurrentUser: (s: UserSession) => void,
  setNeedsOnboarding: (v: boolean) => void,
  setPendingOAuthUser: (v: { id: string; email: string; full_name: string } | null) => void,
  setLoadingDone: () => void,
): Promise<void> {
  if (getStoredSession()) return
  try {
    // Check if an app_users profile already exists for this auth user
    const { data: profile } = await supabase
      .from('app_users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile) {
      // New OAuth user without app_users — needs onboarding to link to a cliente record
      const fullName: string =
        (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        user.email ?? ''
      setPendingOAuthUser({ id: user.id, email: user.email ?? '', full_name: fullName })
      setNeedsOnboarding(true)
      setLoadingDone()
      return
    }

    const sessionData = await buildSessionFromSupabase(user.id, user.email ?? '', expiresAt)
    storeSession(sessionData)
    setCurrentUser(sessionData)
    await logSecurityEvent('login_success', { email: user.email, provider }, user.id)
  } catch {
    // ignore
  }
}

// MFA challenge pending after a successful password sign-in when the user has
// at least one verified TOTP factor enrolled. Signals the login UI to render a
// 6-digit code input. The session is NOT stored until verifyMfaChallenge()
// succeeds — Supabase keeps the AAL1 token in its own auth.* tables but our
// UserSession layer treats AAL1 as "not logged in" for app purposes.
export interface MfaChallenge {
  factorId: string
  challengeId: string
  email: string
}

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [pendingOAuthUser, setPendingOAuthUser] = useState<{ id: string; email: string; full_name: string } | null>(null)
  const [mfaChallenge, setMfaChallenge] = useState<MfaChallenge | null>(null)

  // On mount: restore session + handle OAuth redirect
  useEffect(() => {
    const stored = getStoredSession()
    if (stored) {
      setCurrentUser(stored)
      setLoading(false)
      // Background role refresh: if role changed in DB, update cached session
      supabase.auth.getSession().then(async ({ data: { session } }) => {
        if (session?.user) {
          const updated = await refreshSessionFromSupabase(stored, session.expires_at)
          if (updated) setCurrentUser(updated)
        }
      })
      return
    }

    // If browser is online, clear any stale offline flag from a previous disconnection
    if (navigator.onLine) localStorage.removeItem('offline_mode')
    const offline = !navigator.onLine || localStorage.getItem('offline_mode') === 'true'
    if (offline) {
      // In offline mode, rely on sessionStorage only (no localStorage session)
      setLoading(false)
      return
    }

    // Check for active Supabase session (e.g. after Google OAuth redirect)
    // Timeout prevents infinite "Cargando..." if Supabase is unreachable
    const timeoutId = setTimeout(() => setLoading(false), 8000)

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      clearTimeout(timeoutId)
      if (session?.user) {
        await applyOAuthSession(session.user, session.expires_at, 'google', setCurrentUser, setNeedsOnboarding, setPendingOAuthUser, () => setLoading(false))
      }
      setLoading(false)
    }).catch(() => {
      clearTimeout(timeoutId)
      setLoading(false)
    })
  }, [])

  // Listen for Supabase auth state changes (OAuth callback + password recovery)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await applyOAuthSession(session.user, session.expires_at, 'oauth', setCurrentUser, setNeedsOnboarding, setPendingOAuthUser, () => setLoading(false))
      }
      if (event === 'PASSWORD_RECOVERY') {
        // Supabase has processed the recovery token — show the reset form
        setIsPasswordRecovery(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // Periodic token refresh (every 30 minutes).
  //
  // Antes hacíamos buildSessionFromSupabase() en cada refresh — eran 3
  // queries adicionales (app_users, user_roles, get_user_permissions RPC, companies)
  // que solo necesitábamos en login o cuando rol/empresa cambiaban. Ahora
  // solo actualizamos el expires_at local; role/permissions persisten
  // estables hasta el próximo login. Si el admin cambia el rol del
  // usuario mid-session, el usuario lo verá tras logout/login (igual que
  // antes — el refresh de 30 min no era una garantía de "latest perms").
  useEffect(() => {
    if (!currentUser) return

    const interval = setInterval(async () => {
      try {
        const { data, error } = await supabase.auth.refreshSession()
        if (error || !data?.session) {
          console.warn('Token refresh failed:', error?.message)
          return
        }

        const newExpiresAt = data.session.expires_at
          ? new Date(data.session.expires_at * 1000).toISOString()
          : new Date(Date.now() + APP_CONFIG.SESSION_TIMEOUT).toISOString()

        setCurrentUser(prev => {
          if (!prev) return prev
          const fresh = { ...prev, expires_at: newExpiresAt }
          storeSession(fresh)
          return fresh
        })
      } catch (err) {
        console.error('Token refresh error:', err)
      }
    }, APP_CONFIG.TOKEN_REFRESH_INTERVAL)

    return () => clearInterval(interval)
  }, [currentUser])

  // Realtime de permisos (plat:P7, F2.5).
  //
  // Antes el set de permisos solo se reconstruia al login o cuando el usuario
  // recargaba la SPA. Si un admin asignaba/revocaba un rol mid-sesion, el
  // residente tenia que cerrar y volver a abrir para verlo.
  //
  // Ahora nos suscribimos a las tres tablas RBAC relevantes para el usuario
  // actual y, en cualquier evento, re-corremos buildSessionFromSupabase via
  // refreshSessionFromSupabase. Si algo cambio realmente, persistimos y
  // re-renderizamos; si no, la llamada es no-op (la comparacion vive dentro).
  //
  //   - user_roles  (filter user_id=eq.me): admin asigna/revoca rol al usuario
  //   - app_users   (filter id=eq.me):      cambio de role legacy / company / activo
  //   - role_permissions (sin filtro):      admin modifica permisos de un rol.
  //     RLS limita lo que se entrega; un cambio en un rol que no pertenece a
  //     mi company se filtra antes de llegar. El refresh es no-op si los
  //     permisos efectivos no cambiaron.
  //
  // Debounce de 800ms: cuando un admin granular bulk-inserta varios permisos
  // a un rol, llegan en rafaga — un solo refresh basta.
  //
  // Fallback visibilitychange: si la pestana estuvo inactiva mucho rato y se
  // perdieron eventos (e.g. el navegador pauso websockets), refrescamos al
  // volver a primer plano.
  //
  // El effect depende solo de user_id (no de currentUser) para no tirar y
  // recrear el canal con cada actualizacion local; usamos un ref para que el
  // callback vea siempre la ultima sesion sin reabrir suscripcion.
  const userRef = useRef<UserSession | null>(currentUser)
  useEffect(() => { userRef.current = currentUser }, [currentUser])
  const refreshTimerRef = useRef<number | undefined>(undefined)
  const userId = currentUser?.user_id
  useEffect(() => {
    if (!userId) return

    const triggerRefresh = () => {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = window.setTimeout(async () => {
        const cur = userRef.current
        if (!cur) return
        const { data: { session } } = await supabase.auth.getSession()
        const updated = await refreshSessionFromSupabase(cur, session?.expires_at)
        if (updated) setCurrentUser(updated)
      }, 800)
    }

    const channel = supabase
      .channel(`auth_rbac:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_roles', filter: `user_id=eq.${userId}` },
        triggerRefresh,
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'app_users', filter: `id=eq.${userId}` },
        triggerRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'role_permissions' },
        triggerRefresh,
      )
      .subscribe()

    const onVisibility = () => {
      if (document.visibilityState === 'visible') triggerRefresh()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearTimeout(refreshTimerRef.current)
      document.removeEventListener('visibilitychange', onVisibility)
      void supabase.removeChannel(channel)
    }
  }, [userId])

  // Session expiry warning (5 minutes before expiry) and forced logout
  useEffect(() => {
    if (!currentUser) return

    let warningShown = false

    const checkExpiry = () => {
      const now = new Date()
      const expiresAt = new Date(currentUser.expires_at)
      const timeUntilExpiry = expiresAt.getTime() - now.getTime()

      // Show warning 5 minutes before expiry
      if (timeUntilExpiry <= APP_CONFIG.SESSION_WARNING_BEFORE_EXPIRY && !warningShown) {
        warningShown = true
        // F3.2: confirm() reemplaza Swal con Radix AlertDialog accesible.
        // No hay equivalente a allowOutsideClick=false en Radix sin truco —
        // dejamos que el usuario pueda cerrar con escape; al cerrar igual
        // intenta refresh.
        void confirm({
          title: 'Sesión expirando pronto',
          text: 'Tu sesión expirará en 5 minutos. Haz clic para continuar activo.',
          icon: 'warning',
          confirmText: 'Continuar',
          cancelText: 'Cerrar',
        }).then(() => {
          supabase.auth.refreshSession().catch(console.error)
        })
      }

      // Auto logout when session expires
      if (timeUntilExpiry <= 0) {
        void confirm({
          title: 'Sesión Expirada',
          text: 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.',
          icon: 'info',
          confirmText: 'OK',
          cancelText: 'Cerrar',
        }).then(() => {
          clearSession()
          setCurrentUser(null)
        })
      }
    }

    // Check expiry every 30 seconds
    const interval = setInterval(checkExpiry, 30000)

    return () => {
      clearInterval(interval)
    }
  }, [currentUser])

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
      if (!aal.error && aal.data && aal.data.nextLevel === 'aal2' && aal.data.currentLevel === 'aal1') {
        const factorsResult = await supabase.auth.mfa.listFactors()
        const totpFactor = factorsResult.data?.totp?.[0] ?? factorsResult.data?.all?.find(f => f.factor_type === 'totp' && f.status === 'verified')
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
  }, [])

  // Verifica el código TOTP del segundo factor y finaliza el login. Solo se
  // llama cuando mfaChallenge !== null (es decir, login() previamente detectó
  // que el usuario tiene un factor verificado). En éxito construye la sesión
  // completa y limpia el challenge; en error devuelve mensaje para el UI.
  const verifyMfaChallenge = useCallback(async (code: string): Promise<string | null> => {
    if (!mfaChallenge) return 'No hay un desafío MFA activo. Vuelve a iniciar sesión.'
    const trimmed = code.trim()
    if (!/^\d{6}$/.test(trimmed)) return 'El código debe tener 6 dígitos.'

    try {
      const { error } = await supabase.auth.mfa.verify({
        factorId: mfaChallenge.factorId,
        challengeId: mfaChallenge.challengeId,
        code: trimmed,
      })
      if (error) {
        logSecurityEvent('mfa_verify_failed', { email: mfaChallenge.email, reason: error.message }).catch(console.error)
        const msg = (error.message ?? '').toLowerCase()
        if (msg.includes('invalid') || msg.includes('verification') || msg.includes('totp')) {
          return 'Código incorrecto o expirado. Revisa la app de autenticación e intenta de nuevo.'
        }
        return error.message ? `Error: ${error.message}` : 'No fue posible verificar el código.'
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

  const logout = useCallback(async () => {
    // F3.2: confirm() de shared/Dialog (Radix AlertDialog + a11y).
    // API isConfirmed se mantiene 1:1 con SweetAlert2 para minimizar el delta.
    const result = await confirm({
      title: '¿Cerrar sesión?',
      text: 'Tendrás que ingresar tus credenciales nuevamente.',
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Sí, salir',
      cancelText: 'Cancelar',
    })

    if (result.isConfirmed) {
      if (currentUser) {
        await logSecurityEvent(
          'logout',
          { session_duration: Date.now() - new Date(currentUser.login_time).getTime() },
          currentUser.user_id
        )
      }
      try {
        await supabase.auth.signOut()
      } catch {
        // ignore sign out errors
      }
      clearSession()
      setCurrentUser(null)
    }
  }, [currentUser])

  const updateProfile = useCallback(async (newName: string): Promise<string | null> => {
    if (!currentUser) return 'No hay sesión activa'
    const { error } = await supabase
      .from('app_users')
      .update({ full_name: newName.trim() })
      .eq('id', currentUser.user_id)
    if (error) return 'Error al actualizar el nombre'
    const updated = { ...currentUser, name: newName.trim() }
    storeSession(updated)
    setCurrentUser(updated)
    return null
  }, [currentUser])

  const completeOnboarding = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const session = await buildSessionFromSupabase(user.id, user.email ?? '', undefined)
      storeSession(session)
      setCurrentUser(session)
      setNeedsOnboarding(false)
      setPendingOAuthUser(null)
      await logSecurityEvent('login_success', { email: user.email, provider: 'google_oauth_onboarding' }, user.id)
    } catch {
      // ignore — user will remain in onboarding state
    }
  }, [])

  return { currentUser, loading, isPasswordRecovery, needsOnboarding, pendingOAuthUser, completeOnboarding, login, loginWithGoogle, logout, updateProfile, mfaChallenge, verifyMfaChallenge, cancelMfaChallenge }
}
