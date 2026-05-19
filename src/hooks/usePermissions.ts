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

// Sidebar keys for condominios shortcuts → corresponding condominios tab ids.
// Visibility falls back to checking `condominios.tab.<tabId>` for these.
const CONDOMINIOS_SIDEBAR_TAB_MAP: Record<string, string> = {
  condominios_visitantes: 'visitantes',
  condominios_cuotas: 'cuotas',
  condominios_mantenimiento: 'mantenimiento',
}

/**
 * Hook que expone helpers para verificar permisos de módulo del usuario actual.
 *
 * - super_admin / company_owner / cliente → siempre true (bypass)
 * - admin / operator / viewer / collector → consulta session.permissions (RBAC)
 *
 * Permission key convention:
 *   - water modules (WATER_MODULE_KEYS) → 'agua.<module>.<action>'
 *   - condominios sidebar shortcuts (condominios_dashboard, condominios_visitantes,
 *     condominios_cuotas, condominios_mantenimiento) → resolved against the
 *     fine-grained 'condominios.tab.<tab_id>' keys granted by condominios roles
 *   - condominios parent ('condominios') → visible if user has any
 *     'condominios.tab.*' permission (avoids requiring the broader
 *     platform.condominios.view to be granted explicitly)
 *   - other platform modules (clientes/unidades/configuracion/comunicacion)
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

    function hasAnyCondominiosTab(): boolean {
      if (!perms) return false
      for (const key of perms) {
        if (key.startsWith('condominios.tab.')) return true
      }
      return false
    }

    function canViewModule(moduleKey: string): boolean {
      if ((NON_CONFIGURABLE_MODULES as readonly string[]).includes(moduleKey)) return true
      if (isExempt) return true

      // Condominios shortcuts in the sidebar map to fine-grained tab permissions.
      const condTab = CONDOMINIOS_SIDEBAR_TAB_MAP[moduleKey]
      if (condTab) return perms?.has(`condominios.tab.${condTab}`) ?? false

      // Panel / Módulo Completo are visible whenever the user has any
      // condominios tab granted — they're entry points, not specific tabs.
      if (moduleKey === 'condominios_dashboard') return hasAnyCondominiosTab()
      if (moduleKey === 'condominios') {
        return has('condominios', 'view') || hasAnyCondominiosTab()
      }

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
