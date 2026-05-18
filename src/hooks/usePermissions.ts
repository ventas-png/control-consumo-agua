import { useMemo } from 'react'
import type { UserSession } from '../types'
import { EXEMPT_ROLES, NON_CONFIGURABLE_MODULES, WATER_MODULE_KEYS } from '../lib/moduleConfig'

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
 * - super_admin / company_owner / cliente → siempre true (bypass)
 * - admin / operator / viewer / collector → consulta session.permissions (RBAC)
 *
 * Permission key convention:
 *   - water modules (WATER_MODULE_KEYS) → 'agua.<module>.<action>'
 *   - platform modules (clientes/unidades/configuracion/comunicacion/condominios)
 *     → 'platform.<module>.<action>'
 */
export function usePermissions(session: UserSession | null): PermissionsAPI {
  return useMemo(() => {
    const role = session?.role
    const perms = session?.permissions

    const isExempt = !!role && EXEMPT_ROLES.includes(role)

    function permissionKey(moduleKey: string, action: 'view' | 'create' | 'edit' | 'change_status'): string {
      const prefix = WATER_MODULE_KEYS.has(moduleKey) ? 'agua' : 'platform'
      return `${prefix}.${moduleKey}.${action}`
    }

    function has(moduleKey: string, action: 'view' | 'create' | 'edit' | 'change_status'): boolean {
      return perms?.has(permissionKey(moduleKey, action)) ?? false
    }

    function canViewModule(moduleKey: string): boolean {
      if ((NON_CONFIGURABLE_MODULES as readonly string[]).includes(moduleKey)) return true
      if (isExempt) return true
      return has(moduleKey, 'view')
    }

    function canCreate(moduleKey: string): boolean {
      if (isExempt) return true
      return has(moduleKey, 'view') && has(moduleKey, 'create')
    }

    function canEdit(moduleKey: string): boolean {
      if (isExempt) return true
      return has(moduleKey, 'view') && has(moduleKey, 'edit')
    }

    function canChangeStatus(moduleKey: string): boolean {
      if (isExempt) return true
      return has(moduleKey, 'view') && has(moduleKey, 'change_status')
    }

    return { canViewModule, canCreate, canEdit, canChangeStatus }
  }, [session?.role, session?.permissions])
}
