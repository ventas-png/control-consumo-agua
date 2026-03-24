import { useState, useEffect, useCallback } from 'react'
import Swal from 'sweetalert2'
import type { UserSession, UserRole } from '../types'
import { supabase } from '../lib/supabase'
import { APP_CONFIG } from '../lib/config'
import { sanitizeInput, validateEmail } from '../lib/validation'
import { logSecurityEvent } from '../lib/security'

function getStoredSession(): UserSession | null {
  try {
    const data = sessionStorage.getItem('userSession')
    if (!data) return null
    const session = JSON.parse(data) as UserSession
    if (new Date() < new Date(session.expires_at)) return session
    return null
  } catch {
    return null
  }
}

function getCachedSession(): UserSession | null {
  try {
    const data = localStorage.getItem('cached_session')
    if (!data) return null
    const session = JSON.parse(data) as UserSession
    if (new Date() < new Date(session.expires_at)) return session
    localStorage.removeItem('cached_session')
    return null
  } catch {
    return null
  }
}

function storeSession(session: UserSession): void {
  sessionStorage.setItem('userSession', JSON.stringify(session))
  localStorage.setItem('cached_session', JSON.stringify(session))
}

function clearSession(): void {
  sessionStorage.removeItem('userSession')
  localStorage.removeItem('cached_session')
}

async function buildSessionFromSupabase(
  userId: string,
  email: string,
  expiresAt: number | undefined
): Promise<UserSession> {
  const profileQuery = supabase
    .from('app_users')
    .select('full_name, role, company_id')
    .eq('id', userId)
    .single()

  const timeout = new Promise<{ data: null; error: null }>(resolve =>
    setTimeout(() => resolve({ data: null, error: null }), 5000)
  )

  const { data: profile } = await Promise.race([profileQuery, timeout])

  const dbRole: string = (profile as { full_name?: string; role?: string; company_id?: string } | null)?.role ?? ''
  const companyId: string | undefined = (profile as { full_name?: string; role?: string; company_id?: string } | null)?.company_id ?? undefined
  let uiRole: UserRole = 'viewer'
  if (dbRole === 'super_admin' || dbRole === 'superadmin') uiRole = 'super_admin'
  else if (dbRole === 'company_owner') uiRole = 'company_owner'
  else if (dbRole === 'admin') uiRole = 'admin'
  else if (dbRole === 'operador' || dbRole === 'user' || dbRole === 'operator') uiRole = 'operator'
  else if (dbRole === 'visor' || dbRole === 'cliente' || dbRole === 'viewer') uiRole = 'viewer'

  const displayName = (profile as { full_name?: string } | null)?.full_name ?? email

  return {
    user_id: userId,
    email,
    name: displayName,
    role: uiRole,
    company_id: companyId,
    login_time: new Date().toISOString(),
    expires_at: expiresAt
      ? new Date(expiresAt * 1000).toISOString()
      : new Date(Date.now() + APP_CONFIG.SESSION_TIMEOUT).toISOString(),
  }
}

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null)
  const [loading, setLoading] = useState(true)

  // On mount: restore session + handle OAuth redirect
  useEffect(() => {
    const stored = getStoredSession()
    if (stored) {
      setCurrentUser(stored)
      setLoading(false)
      // Background role refresh: if role changed in DB, update cached session
      supabase.auth.getSession().then(async ({ data: { session } }) => {
        if (session?.user) {
          try {
            const fresh = await buildSessionFromSupabase(
              session.user.id,
              session.user.email ?? '',
              session.expires_at
            )
            if (fresh.role !== stored.role) {
              storeSession(fresh)
              setCurrentUser(fresh)
            }
          } catch {
            // keep existing session on error
          }
        }
      })
      return
    }

    const offline = !navigator.onLine || localStorage.getItem('offline_mode') === 'true'
    if (offline) {
      const cached = getCachedSession()
      if (cached) setCurrentUser(cached)
      setLoading(false)
      return
    }

    // Check for active Supabase session (e.g. after Google OAuth redirect)
    // Timeout prevents infinite "Cargando..." if Supabase is unreachable
    const timeoutId = setTimeout(() => setLoading(false), 8000)

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      clearTimeout(timeoutId)
      if (session?.user) {
        const existing = getStoredSession()
        if (!existing) {
          try {
            const sessionData = await buildSessionFromSupabase(
              session.user.id,
              session.user.email ?? '',
              session.expires_at
            )
            storeSession(sessionData)
            setCurrentUser(sessionData)
            await logSecurityEvent('login_success', { email: session.user.email, provider: 'google' }, session.user.id)
          } catch {
            // ignore
          }
        }
      }
      setLoading(false)
    }).catch(() => {
      clearTimeout(timeoutId)
      setLoading(false)
    })
  }, [])

  // Listen for Supabase auth state changes (OAuth callback)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if ((event === 'SIGNED_IN') && session?.user) {
        const existing = getStoredSession()
        if (!existing) {
          try {
            const sessionData = await buildSessionFromSupabase(
              session.user.id,
              session.user.email ?? '',
              session.expires_at
            )
            storeSession(sessionData)
            setCurrentUser(sessionData)
            await logSecurityEvent('login_success', { email: session.user.email, provider: 'oauth' }, session.user.id)
          } catch {
            // ignore
          }
        }
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  // Periodic session expiry check
  useEffect(() => {
    const interval = setInterval(() => {
      if (!currentUser) return
      if (new Date() >= new Date(currentUser.expires_at)) {
        Swal.fire({
          icon: 'warning',
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
    }, 60000)
    return () => clearInterval(interval)
  }, [currentUser])

  const login = useCallback(async (email: string, password: string): Promise<string | null> => {
    const cleanEmail = sanitizeInput(email.trim())

    if (!cleanEmail || !password) return 'Email y contraseña son requeridos'
    if (!validateEmail(cleanEmail)) return 'Formato de email inválido'

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail.toLowerCase(),
        password,
      })

      if (error || !data?.session || !data?.user) {
        logSecurityEvent('failed_login_attempt', {
          email: cleanEmail,
          reason: error?.message ?? 'invalid_credentials',
        }).catch(console.error)

        const msg = (error?.message ?? '').toLowerCase()
        if (msg.includes('invalid login credentials')) return 'Email o contraseña incorrectos'
        if (msg.includes('email not confirmed')) return 'Email no confirmado'
        return 'Login fallido'
      }

      const { user, session } = data

      const sessionData = await buildSessionFromSupabase(user.id, user.email ?? '', session.expires_at)
      storeSession(sessionData)
      setCurrentUser(sessionData)
      localStorage.removeItem('login_failures')

      logSecurityEvent('login_success', { email: cleanEmail }, user.id).catch(console.error)
      return null
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown'
      logSecurityEvent('login_error', { email: cleanEmail, error: msg }).catch(console.error)

      if (msg.includes('fetch') || msg.includes('network')) return 'Error de red. Verifique su conexión.'
      return 'Error de conexión. Intente de nuevo.'
    }
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
      cancelButtonColor: '#64748b',
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

  return { currentUser, loading, login, loginWithGoogle, logout, updateProfile }
}
