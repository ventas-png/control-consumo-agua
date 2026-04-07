import { useMemo } from 'react'
import type { UserSession } from '../types'
import { EXEMPT_ROLES, NON_CONFIGURABLE_MODULES } from '../lib/moduleConfig'

export interface PermissionsAPI {
  /** ¿El usuario puede ver este módulo en el sidebar? */
  canViewModule: (moduleKey: string) => boolean
  /** ¿El usuario puede crear registros nuevos en este módulo? */
  canCreate: (moduleKey: string) => boolean
  /** ¿El usuario puede editar registros existentes en este módulo? */
  canEdit: (moduleKey: string) => boolean
  /** ¿El usuario puede cambiar estados en este módulo? */
  canChangeStatus: (moduleKey: string) => boolean
}

/**
 * Hook que expone helpers para verificar permisos de módulo del usuario actual.
 *
 * - super_admin / company_owner → siempre true (bypass)
 * - cliente → siempre false (tiene portal separado)
 * - admin / operator / viewer / collector → consulta module_permissions de la sesión
 */
export function usePermissions(session: UserSession | null): PermissionsAPI {
  return useMemo(() => {
    const role = session?.role
    const perms = session?.module_permissions

    // Roles exentos: acceso total
    const isExempt = !!role && EXEMPT_ROLES.includes(role)

    function canViewModule(moduleKey: string): boolean {
      // Módulos no-configurables no pasan por este sistema
      if ((NON_CONFIGURABLE_MODULES as readonly string[]).includes(moduleKey)) return true
      if (isExempt) return true
      if (!perms) return false
      return perms[moduleKey]?.can_view ?? false
    }

    function canCreate(moduleKey: string): boolean {
      if (isExempt) return true
      if (!perms) return false
      const p = perms[moduleKey]
      return p ? p.can_view && p.can_create : false
    }

    function canEdit(moduleKey: string): boolean {
      if (isExempt) return true
      if (!perms) return false
      const p = perms[moduleKey]
      return p ? p.can_view && p.can_edit : false
    }

    function canChangeStatus(moduleKey: string): boolean {
      if (isExempt) return true
      if (!perms) return false
      const p = perms[moduleKey]
      return p ? p.can_view && p.can_change_status : false
    }

    return { canViewModule, canCreate, canEdit, canChangeStatus }
  }, [session?.role, session?.module_permissions])
}
