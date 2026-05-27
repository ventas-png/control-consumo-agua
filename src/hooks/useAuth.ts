import { useState, useEffect, useCallback, useRef } from 'react'
import Swal from 'sweetalert2'
import type { UserSession, UserRole, AssignedRoleInfo } from '../types'
import { supabase } from '../lib/supabase'
import { APP_CONFIG } from '../lib/config'
import { sanitizeInput, validateEmail } from '../lib/validation'
import { logSecurityEvent } from '../lib/security'

function getStoredSession(): UserSession | null {
  try {
    const data = sessionStorage.getItem('userSession')
    if (!data) return null
    const parsed = JSON.parse(data) as UserSession & { permissions?: string[] | Set<string> }
    if (new Date() >= new Date(parsed.expires_at)) return null
    // permissions serializes as array; hydrate back to Set
    if (Array.isArray(parsed.permissions)) {
      parsed.permissions = new Set(parsed.permissions) as Set<string>
    }
    return parsed as UserSession
  } catch {
    return null
  }
}

function storeSession(session: UserSession): void {
  const serializable = {
    ...session,
    permissions: session.permissions ? [...session.permissions] : undefined,
  }
  sessionStorage.setItem('userSession', JSON.stringify(serializable))
  // Security: no longer store session in localStorage to prevent theft via XSS
}

function clearSession(): void {
  sessionStorage.removeItem('userSession')
  // Clean up legacy cached sessions from previous versions
  localStorage.removeItem('cached_session')
}

// --- Login rate limiting ---
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 60_000 // 1 minute

interface LoginFailures { count: number; lockedUntil: number }

function getLoginFailures(): LoginFailures {
  try {
    const raw = sessionStorage.getItem('login_failures')
    if (!raw) return { count: 0, lockedUntil: 0 }
    return JSON.parse(raw) as LoginFailures
  } catch { return { count: 0, lockedUntil: 0 } }
}

function recordLoginFailure(): void {
  const f = getLoginFailures()
  f.count += 1
  if (f.count >= MAX_LOGIN_ATTEMPTS) {
    f.lockedUntil = Date.now() + LOCKOUT_DURATION_MS
  }
  sessionStorage.setItem('login_failures', JSON.stringify(f))
}

function clearLoginFailures(): void {
  sessionStorage.removeItem('login_failures')
}

function getLoginLockoutMessage(): string | null {
  const f = getLoginFailures()
  if (f.count >= MAX_LOGIN_ATTEMPTS && Date.now() < f.lockedUntil) {
    const secsLeft = Math.ceil((f.lockedUntil - Date.now()) / 1000)
    return `Demasiados intentos fallidos. Intente en ${secsLeft} segundos.`
  }
  if (f.count >= MAX_LOGIN_ATTEMPTS && Date.now() >= f.lockedUntil) {
    clearLoginFailures()
  }
  return null
}

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

async function buildSessionFromSupabase(
  userId: string,
  email: string,
  expiresAt: number | undefined
): Promise<UserSession> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Profile fetch timeout')), 5000)
  )

  // Batch 1: profile + RBAC permissions + assigned roles, in parallel
  const profileQuery = supabase
    .from('app_users')
    .select('full_name, role, company_id, cliente_id, activo')
    .eq('id', userId)
    .single()

  const rbacPermsQuery = supabase.rpc('get_user_permissions', { target_user_id: userId })

  const userRolesQuery = supabase
    .from('user_roles')
    .select('role_id, role:roles(id, name, service, color)')
    .eq('user_id', userId)

  const [profileResult, rbacPermsResult, userRolesResult] = await Promise.race([
    Promise.all([profileQuery, rbacPermsQuery, userRolesQuery]),
    timeout,
  ])

  type ProfileRow = { full_name?: string; role?: string; company_id?: string; cliente_id?: string; activo?: boolean } | null
  const prof = profileResult.data as ProfileRow

  if (prof?.activo === false) {
    throw new Error('Cuenta desactivada. Comuníquese con su empresa de servicios.')
  }
  const dbRole: string = prof?.role ?? ''
  const companyId: string | undefined = prof?.company_id ?? undefined
  const clienteId: string | undefined = prof?.cliente_id ?? undefined
  let uiRole: UserRole = 'viewer'
  if (dbRole === 'super_admin' || dbRole === 'superadmin') uiRole = 'super_admin'
  else if (dbRole === 'company_owner') uiRole = 'company_owner'
  else if (dbRole === 'admin') uiRole = 'admin'
  else if (dbRole === 'operador' || dbRole === 'user' || dbRole === 'operator') uiRole = 'operator'
  else if (dbRole === 'cliente') uiRole = 'cliente'
  else if (dbRole === 'visor' || dbRole === 'viewer') uiRole = 'viewer'
  else if (dbRole === 'collector') uiRole = 'collector'

  const displayName = prof?.full_name ?? email

  // Batch 2: company flags (needs companyId from batch 1) — wrapped in 4s timeout
  // to prevent login from hanging if Supabase is slow or the nested join stalls
  let servicio_agua: boolean | undefined
  let servicio_condominios: boolean | undefined
  try {
    const batch2: Promise<void> = (async () => {
      if (companyId) {
        const { data } = await supabase
          .from('companies')
          .select('servicio_agua, servicio_condominios')
          .eq('id', companyId)
          .single()
        if (data) {
          const flags = data as { servicio_agua: boolean; servicio_condominios: boolean }
          servicio_agua = flags.servicio_agua
          servicio_condominios = flags.servicio_condominios
        }
      } else if (clienteId) {
        type UnidadRow = { projects: { companies: { servicio_agua: boolean; servicio_condominios: boolean } | null } | null }
        const { data: unidadesFlags } = await supabase
          .from('unidades')
          .select('projects(companies(servicio_agua, servicio_condominios))')
          .eq('cliente_id', clienteId)
          .eq('activo', true)
        if (unidadesFlags) {
          for (const u of (unidadesFlags as unknown as UnidadRow[])) {
            const flags = u.projects?.companies
            if (!flags) continue
            if (flags.servicio_condominios) servicio_condominios = true
            if (flags.servicio_agua) servicio_agua = true
          }
        }
      }
    })()

    await Promise.race([batch2, new Promise<void>(resolve => setTimeout(resolve, 4000))])
  } catch {
    // service flags remain undefined — portal falls back to agua portal safely
  }

  return {
    user_id: userId,
    email,
    name: displayName,
    role: uiRole,
    company_id: companyId,
    cliente_id: clienteId,
    login_time: new Date().toISOString(),
    expires_at: expiresAt
      ? new Date(expiresAt * 1000).toISOString()
      : new Date(Date.now() + APP_CONFIG.SESSION_TIMEOUT).toISOString(),
    servicio_agua,
    servicio_condominios,
    permissions: buildPermissionsSet(rbacPermsResult),
    assigned_role_ids: buildAssignedRoleIds(userRolesResult),
    assigned_roles: buildAssignedRoles(userRolesResult),
  }
}

function buildPermissionsSet(result: { data: unknown; error: unknown }): Set<string> | undefined {
  if (result.error || !result.data) return undefined
  // get_user_permissions RPC returns SETOF text -> array of { get_user_permissions: string } or string[]
  const rows = result.data as Array<{ get_user_permissions?: string } | string>
  const keys: string[] = []
  for (const row of rows) {
    if (typeof row === 'string') keys.push(row)
    else if (row && typeof row.get_user_permissions === 'string') keys.push(row.get_user_permissions)
  }
  return new Set(keys)
}

function buildAssignedRoleIds(result: { data: unknown; error: unknown }): string[] | undefined {
  if (result.error || !result.data) return undefined
  const rows = result.data as Array<{ role_id: string }>
  return rows.map(r => r.role_id)
}

function buildAssignedRoles(result: { data: unknown; error: unknown }): AssignedRoleInfo[] | undefined {
  if (result.error || !result.data) return undefined
  type Row = {
    role_id: string
    role: { id: string; name: string; service: string | null; color: string | null } | null
  }
  const rows = result.data as Row[]
  const allowed = new Set(['condominios', 'agua', 'general'])
  return rows
    .filter((r): r is Row & { role: NonNullable<Row['role']> } => r.role !== null)
    .map(r => ({
      id: r.role.id,
      name: r.role.name,
      service: r.role.service && allowed.has(r.role.service)
        ? (r.role.service as AssignedRoleInfo['service'])
        : null,
      color: r.role.color,
    }))
}

// Reconstruye la sesion desde Supabase y la persiste si cambiaron role,
// company/cliente, service flags o el set de permisos. Devuelve la nueva
// sesion (o null si no aplico cambio) para que el caller decida si re-render.
// Usado tanto por el refresh inicial al montar como por el listener Realtime
// que reacciona a INSERT/DELETE en user_roles / role_permissions / app_users.
async function refreshSessionFromSupabase(
  current: UserSession,
  expiresAt: number | undefined,
): Promise<UserSession | null> {
  try {
    const fresh = await buildSessionFromSupabase(
      current.user_id,
      current.email,
      expiresAt,
    )
    const freshPerms = fresh.permissions ? [...fresh.permissions].sort() : []
    const currentPerms = current.permissions ? [...current.permissions].sort() : []
    const permissionsChanged = JSON.stringify(freshPerms) !== JSON.stringify(currentPerms)
    if (
      fresh.role !== current.role ||
      fresh.name !== current.name ||
      fresh.company_id !== current.company_id ||
      fresh.cliente_id !== current.cliente_id ||
      fresh.servicio_condominios !== current.servicio_condominios ||
      fresh.servicio_agua !== current.servicio_agua ||
      permissionsChanged
    ) {
      // Conservar expires_at original — el refresh de permisos no extiende la sesion
      const merged = { ...fresh, expires_at: current.expires_at }
      storeSession(merged)
      return merged
    }
  } catch {
    // ignore — keep existing session on error
  }
  return null
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
        Swal.fire({
          icon: 'warning',
          title: 'Sesión expirando pronto',
          html: '<p>Tu sesión expirará en 5 minutos.</p><p>Haz clic para continuar activo.</p>',
          confirmButtonText: 'Continuar',
          allowOutsideClick: false,
          allowEscapeKey: false,
          didClose: () => {
            // User clicked "Continuar" - try to refresh immediately
            supabase.auth.refreshSession().catch(console.error)
          }
        })
      }

      // Auto logout when session expires
      if (timeUntilExpiry <= 0) {
        Swal.fire({
          icon: 'info',
          title: 'Sesión Expirada',
          text: 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.',
          confirmButtonText: 'OK',
          allowOutsideClick: false,
          allowEscapeKey: false,
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
      const authResult = await Promise.race([
        supabase.auth.signInWithPassword({
          email: cleanEmail.toLowerCase(),
          password,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('auth_timeout')), 20000)
        ),
      ])
      const { data, error } = authResult

      if (error || !data?.session || !data?.user) {
        recordLoginFailure()
        logSecurityEvent('failed_login_attempt', {
          email: cleanEmail,
          reason: error?.message ?? 'invalid_credentials',
        }).catch(console.error)

        const msg = (error?.message ?? '').toLowerCase()
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
    const result = await Swal.fire({
      title: 'Cerrar Sesión?',
      text: 'Tendrás que ingresar tus credenciales nuevamente',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#7E9389',
      confirmButtonText: 'Sí, salir',
      cancelButtonText: 'Cancelar',
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
