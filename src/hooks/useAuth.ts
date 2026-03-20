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

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null)
  const [loading, setLoading] = useState(true)

  // On mount: restore session
  useEffect(() => {
    const stored = getStoredSession()
    if (stored) {
      setCurrentUser(stored)
    } else {
      const offline = !navigator.onLine || localStorage.getItem('offline_mode') === 'true'
      if (offline) {
        const cached = getCachedSession()
        if (cached) setCurrentUser(cached)
      }
    }
    setLoading(false)
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
        await logSecurityEvent('failed_login_attempt', {
          email: cleanEmail,
          reason: error?.message ?? 'invalid_credentials',
        })

        const msg = (error?.message ?? '').toLowerCase()
        if (msg.includes('invalid login credentials')) return 'Email o contraseña incorrectos'
        if (msg.includes('email not confirmed')) return 'Email no confirmado'
        return 'Login fallido'
      }

      const { user, session } = data

      const { data: profile } = await supabase
        .from('app_users')
        .select('full_name, role')
        .eq('id', user.id)
        .single()

      const dbRole: string = (profile as { full_name?: string; role?: string } | null)?.role ?? 'visor'
      let uiRole: UserRole = 'viewer'
      if (dbRole === 'admin') uiRole = 'admin'
      else if (dbRole === 'operador') uiRole = 'operator'
      else if (dbRole === 'visor') uiRole = 'viewer'

      const displayName = (profile as { full_name?: string } | null)?.full_name ?? user.email ?? ''
      const expiresAt = session.expires_at
        ? new Date(session.expires_at * 1000).toISOString()
        : new Date(Date.now() + APP_CONFIG.SESSION_TIMEOUT).toISOString()

      const sessionData: UserSession = {
        user_id: user.id,
        email: user.email ?? '',
        name: displayName,
        role: uiRole,
        login_time: new Date().toISOString(),
        expires_at: expiresAt,
      }

      storeSession(sessionData)
      setCurrentUser(sessionData)
      localStorage.removeItem('login_failures')

      await logSecurityEvent('login_success', { email: cleanEmail }, user.id)
      return null
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'unknown'
      await logSecurityEvent('login_error', { email: cleanEmail, error: msg })

      if (msg.includes('fetch') || msg.includes('network')) return 'Error de red. Verifique su conexión.'
      return 'Error de conexión. Intente de nuevo.'
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

  return { currentUser, loading, login, logout }
}
