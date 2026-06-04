import { createContext, useContext, type ReactNode } from 'react'
import { usePermissions, type PermissionsAPI } from '../../hooks/usePermissions'
import { useSession } from './SessionContext'

// agua:A3 — Permisos de módulo del usuario vía Context, para dejar de drillear
// los booleanos `canCreate('x')`/`canEdit('x')`/`canChangeStatus('x')` por props
// desde App.tsx hacia cada Section. Cada sección lee la API y resuelve su propio
// módulo (p.ej. `perms.canCreate('clientes')`), de modo que la clave de módulo
// pasa a vivir en la sección que la conoce (en vez de en App).
//
// Deriva de la sesión: monta sobre <SessionProvider> y llama a usePermissions con
// el usuario actual. usePermissions ya memoiza por (role, permissions), así que el
// valor del context es estable entre renders.
const PermissionsContext = createContext<PermissionsAPI | null>(null)

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const session = useSession()
  const permissions = usePermissions(session)
  return <PermissionsContext.Provider value={permissions}>{children}</PermissionsContext.Provider>
}

/** API de permisos del usuario actual. Lanza si se usa fuera de <PermissionsProvider>. */
export function usePermissionsContext(): PermissionsAPI {
  const ctx = useContext(PermissionsContext)
  if (!ctx) {
    throw new Error('usePermissionsContext debe usarse dentro de <PermissionsProvider>.')
  }
  return ctx
}
