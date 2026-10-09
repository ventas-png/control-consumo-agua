// Helper para tests de pantalla que dependen de las llaves RBAC REALES de la sesión.
//
// Monta el árbol como en producción (SessionProvider → PermissionsProvider → QueryClientProvider) con las llaves que
// se le den a la persona. Así los tests expresan «esta persona tiene ESTAS llaves» en vez de simular a mano el
// resultado de `usePermisosContabilidad`, y lo que se prueba es la decisión de verdad de qué botón se ofrece.
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { PermissionsProvider } from '../components/shared/PermissionsContext'
import { SessionProvider } from '../components/shared/SessionContext'
import type { UserSession } from '../types'

/** «Ver» y «Editar» de Contabilidad: lo que la política de UPDATE de las tablas de compras exige además de la llave del paso. */
export const VER_Y_EDITAR = ['platform.contabilidad.view', 'platform.contabilidad.edit'] as const
/** Los permisos GENÉRICOS que antes decidían los pasos (y que ya no deciden ninguno de las seis acciones). */
export const GENERICOS_APROBAR = ['platform.contabilidad.approve', 'platform.contabilidad.change_status'] as const

export function sesionCon(permisos: readonly string[], role: UserSession['role'] | string = 'operator'): UserSession {
  return {
    user_id: 'u1', company_id: 'c1', role, permissions: new Set(permisos),
  } as unknown as UserSession
}

export interface OpcionesMontaje {
  permisos?: readonly string[]
  role?: UserSession['role'] | string
  queryClient?: QueryClient
}

/** Monta `ui` con la sesión indicada. Devuelve también el QueryClient para vigilar `invalidateQueries`. */
export function montarConSesion(ui: ReactElement, { permisos = [], role = 'operator', queryClient }: OpcionesMontaje = {}) {
  const qc = queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const vista = render(
    <QueryClientProvider client={qc}>
      <SessionProvider value={sesionCon(permisos, role)}>
        <PermissionsProvider>{ui}</PermissionsProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return { ...vista, qc }
}
