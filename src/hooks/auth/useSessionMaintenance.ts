// Mantenimiento de la sesión activa (P1 #5, extraído de useAuth sin cambios
// de comportamiento): refresh periódico del token, refresh realtime de
// permisos RBAC y aviso/cierre por expiración.
import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import { confirm } from '../../components/shared/Dialog'
import type { UserSession } from '../../types'
import { supabase } from '../../lib/supabase'
import { APP_CONFIG } from '../../lib/config'
import { storeSession, clearSession } from '../../lib/authSession'
import { refreshSessionFromSupabase } from '../../domain/auth/session'

export function useSessionMaintenance(
  currentUser: UserSession | null,
  setCurrentUser: Dispatch<SetStateAction<UserSession | null>>,
) {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser])
}
