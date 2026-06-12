import type { SectionGroup } from './condominiosRoles'

// Cálculo PURO de los permisos efectivos del modal de roles (RolPermisosModal /
// PermissionMatrixPanel). Espeja la semántica server-side de
// get_user_permissions (migración 20260518000008): unión de allows MENOS unión
// de denies entre todos los roles activos — un deny de cualquier rol gana
// siempre, incluso sobre un allow de ajuste individual.

export type PermissionEffect = 'allow' | 'deny'

export interface RolePermissionRow {
  role_id: string
  permission_key: string
  effect: string
}

export interface RolePermIndex {
  allows: Map<string, Set<string>>
  denies: Map<string, Set<string>>
}

/** Indexa las filas de role_permissions por rol, separando allow/deny. */
export function buildRolePermIndex(rows: RolePermissionRow[]): RolePermIndex {
  const allows = new Map<string, Set<string>>()
  const denies = new Map<string, Set<string>>()
  for (const r of rows) {
    const target = r.effect === 'deny' ? denies : r.effect === 'allow' ? allows : null
    if (!target) continue
    const set = target.get(r.role_id) ?? new Set<string>()
    set.add(r.permission_key)
    target.set(r.role_id, set)
  }
  return { allows, denies }
}

export interface EffectiveResult {
  /** Efectivo SOLO por roles (sin ajustes): allows − denies de los seleccionados. */
  base: Set<string>
  /** Efectivo final: (allows de roles + allows de ajustes) − (denies de roles + denies de ajustes). */
  effective: Set<string>
  /** key → ids de roles seleccionados que la otorgan (atribución para los chips). */
  grantedBy: Map<string, string[]>
  /** Ajustes que SÍ cambian el resultado respecto del base. */
  overriddenKeys: Set<string>
  /** Ajustes sin efecto (p. ej. deny de algo que ningún rol otorga, o allow de
   * algo ya otorgado — o bloqueado por un deny de rol, que el servidor no
   * permite vencer). Se muestran en gris y se podan al guardar. */
  redundantOverrides: Set<string>
}

export function computeEffective(
  selectedRoleIds: Set<string>,
  index: RolePermIndex,
  overrides: Map<string, PermissionEffect> = new Map(),
): EffectiveResult {
  const baseAllows = new Set<string>()
  const baseDenies = new Set<string>()
  const grantedBy = new Map<string, string[]>()

  for (const roleId of selectedRoleIds) {
    for (const key of index.allows.get(roleId) ?? []) {
      baseAllows.add(key)
      const arr = grantedBy.get(key) ?? []
      arr.push(roleId)
      grantedBy.set(key, arr)
    }
    for (const key of index.denies.get(roleId) ?? []) baseDenies.add(key)
  }

  const base = new Set<string>()
  for (const key of baseAllows) if (!baseDenies.has(key)) base.add(key)

  const overriddenKeys = new Set<string>()
  const redundantOverrides = new Set<string>()
  const effective = new Set(base)

  for (const [key, effect] of overrides) {
    if (effect === 'allow') {
      // Un allow de ajuste no vence un deny de rol (semántica del servidor).
      if (base.has(key) || baseDenies.has(key)) {
        redundantOverrides.add(key)
      } else {
        effective.add(key)
        overriddenKeys.add(key)
      }
    } else {
      if (!base.has(key)) {
        redundantOverrides.add(key)
      } else {
        effective.delete(key)
        overriddenKeys.add(key)
      }
    }
  }

  return { base, effective, grantedBy, overriddenKeys, redundantOverrides }
}

export type AccessLevel = 'completo' | 'parcial' | 'ninguno'

export interface GroupStatus {
  key: string
  label: string
  level: AccessLevel
  count: number
  total: number
}

/** Rollup por grupo de módulo/sección: Completo / Parcial N/total / Sin acceso.
 * Los `tabs` del grupo deben ser claves de permiso completas. */
export function groupStatus(effective: Set<string>, groups: SectionGroup[]): GroupStatus[] {
  return groups.map(group => {
    const total = group.tabs.length
    const count = group.tabs.filter(k => effective.has(k)).length
    const level: AccessLevel = count === 0 ? 'ninguno' : count === total ? 'completo' : 'parcial'
    return { key: group.key, label: group.label, level, count, total }
  })
}
