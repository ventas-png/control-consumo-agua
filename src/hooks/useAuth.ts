// Orquestador de autenticación (P1 #5). Las tres responsabilidades que vivían
// mezcladas aquí ahora son hooks enfocados que comparten el estado de sesión:
//   - hooks/auth/useOAuthSession      — bootstrap/restauración + flujo OAuth/onboarding
//   - hooks/auth/useSessionMaintenance — refresh de token, realtime RBAC, expiración
//   - hooks/auth/useCredentialsLogin   — login email/contraseña + step-up MFA + Google
// useAuth conserva la API pública intacta (App.tsx es su único consumidor) y
// las acciones que tocan la sesión completa (logout, updateProfile).
import { useState, useCallback } from 'react'
import { confirm } from '../components/shared/Dialog'
import type { UserSession } from '../types'
import { supabase } from '../lib/supabase'
import { logSecurityEvent } from '../lib/security'
import { queryClient } from '../domain/queryClient'
import { storeSession, clearSession } from '../lib/authSession'
import { updateAppUserName } from '../domain/auth/account'
import { useOAuthSession } from './auth/useOAuthSession'
import { useSessionMaintenance } from './auth/useSessionMaintenance'
import { useCredentialsLogin } from './auth/useCredentialsLogin'

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<UserSession | null>(null)

  const { loading, isPasswordRecovery, needsOnboarding, pendingOAuthUser, completeOnboarding, oauthError } =
    useOAuthSession(setCurrentUser)
  useSessionMaintenance(currentUser, setCurrentUser)
  const { login, loginWithGoogle, mfaChallenge, verifyMfaChallenge, cancelMfaChallenge } =
    useCredentialsLogin(setCurrentUser)

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
      // Equipos compartidos: al salir hay que borrar TODO rastro del tenant.
      // signOut() + clearSession() limpian la sesión, pero los datos ya
      // descargados siguen en memoria (React Query, gcTime 24h) y en Cache
      // Storage (el SW cachea /rest/ y /storage/ de Supabase). Purgamos ambos
      // para que el siguiente usuario en el mismo navegador no los vea.
      queryClient.clear()
      if (typeof caches !== 'undefined') {
        void Promise.all(
          ['supabase-rest', 'supabase-storage'].map(n => caches.delete(n).catch(() => false)),
        )
      }
      setCurrentUser(null)
    }
  }, [currentUser])

  const updateProfile = useCallback(async (newName: string): Promise<string | null> => {
    if (!currentUser) return 'No hay sesión activa'
    const trimmed = newName.trim()
    const { error } = await updateAppUserName(currentUser.user_id, trimmed)
    if (error) return 'Error al actualizar el nombre'
    const updated = { ...currentUser, name: trimmed }
    storeSession(updated)
    setCurrentUser(updated)
    return null
  }, [currentUser])

  return { currentUser, loading, isPasswordRecovery, needsOnboarding, pendingOAuthUser, completeOnboarding, oauthError, login, loginWithGoogle, logout, updateProfile, mfaChallenge, verifyMfaChallenge, cancelMfaChallenge }
}
