// Bootstrap de sesión y flujo OAuth (P1 #5, extraído de useAuth sin cambios
// de comportamiento): restauración de la sesión almacenada al montar, manejo
// del redirect OAuth (incluido el onboarding de usuarios Google sin perfil),
// el evento PASSWORD_RECOVERY y el cierre del onboarding.
import { useState, useEffect, useCallback } from 'react'
import type { UserSession } from '../../types'
import { supabase, getOAuthCallbackError } from '../../lib/supabase'
import { logSecurityEvent } from '../../lib/security'
import { getStoredSession, storeSession } from '../../lib/authSession'
import { buildSessionFromSupabase, refreshSessionFromSupabase, appUserProfileExists } from '../../domain/auth/session'
import { describeOAuthCallbackError } from '../../domain/auth/oauthCallbackError'

export interface PendingOAuthUser { id: string; email: string; full_name: string }

async function applyOAuthSession(
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
  expiresAt: number | undefined,
  provider: string,
  setCurrentUser: (s: UserSession) => void,
  setNeedsOnboarding: (v: boolean) => void,
  setPendingOAuthUser: (v: PendingOAuthUser | null) => void,
  setLoadingDone: () => void,
  setOauthError: (msg: string) => void,
): Promise<void> {
  if (getStoredSession()) return
  try {
    // Check if an app_users profile already exists for this auth user
    const profileExists = await appUserProfileExists(user.id)

    if (!profileExists) {
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
  } catch (e) {
    // Google ya autenticó al usuario: si aquí no se pudo armar la sesión de la
    // app, dejarlo mudo lo devuelve a la landing sin pista alguna. Se muestra
    // el motivo; para cuenta/empresa desactivada además se cierra la media
    // sesión de Supabase para que un reload no reintente en silencio.
    const msg = e instanceof Error ? e.message : ''
    logSecurityEvent('oauth_session_build_failed', { email: user.email, error: msg }, user.id).catch(() => undefined)
    if (msg.includes('desactivada')) {
      await supabase.auth.signOut().catch(() => undefined)
      setOauthError(msg)
    } else if (msg.toLowerCase().includes('timeout')) {
      setOauthError('La conexión con el servidor tardó demasiado al iniciar sesión. Intente de nuevo.')
    } else {
      setOauthError('No se pudo completar el inicio de sesión. Intente de nuevo.' + (msg ? ` Detalle: ${msg}` : ''))
    }
  }
}

export function useOAuthSession(setCurrentUser: (s: UserSession) => void) {
  const [loading, setLoading] = useState(true)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)
  const [needsOnboarding, setNeedsOnboarding] = useState(false)
  const [pendingOAuthUser, setPendingOAuthUser] = useState<PendingOAuthUser | null>(null)
  // Error visible del flujo OAuth: callback fallido (capturado de la URL en
  // lib/supabase) o fallo al construir la sesión tras un SIGNED_IN.
  const [oauthError, setOauthError] = useState<string | null>(null)

  // Superficie del error que GoTrue devolvió en el redirect (p.ej. "Unable to
  // exchange external code" cuando el client secret de Google es inválido).
  // Antes este error se perdía y el usuario volvía a la landing sin mensaje.
  useEffect(() => {
    const cbError = getOAuthCallbackError()
    if (!cbError) return
    setOauthError(describeOAuthCallbackError(cbError))
    logSecurityEvent('oauth_callback_error', { code: cbError.code, error: cbError.description }).catch(() => undefined)
  }, [])

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
        await applyOAuthSession(session.user, session.expires_at, 'google', setCurrentUser, setNeedsOnboarding, setPendingOAuthUser, () => setLoading(false), setOauthError)
      }
      setLoading(false)
    }).catch(() => {
      clearTimeout(timeoutId)
      setLoading(false)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Listen for Supabase auth state changes (OAuth callback + password recovery)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await applyOAuthSession(session.user, session.expires_at, 'oauth', setCurrentUser, setNeedsOnboarding, setPendingOAuthUser, () => setLoading(false), setOauthError)
      }
      if (event === 'PASSWORD_RECOVERY') {
        // Supabase has processed the recovery token — show the reset form
        setIsPasswordRecovery(true)
      }
    })
    return () => subscription.unsubscribe()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { loading, isPasswordRecovery, needsOnboarding, pendingOAuthUser, completeOnboarding, oauthError }
}
