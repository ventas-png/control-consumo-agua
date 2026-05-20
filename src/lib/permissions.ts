import type { UserRole, UserSession } from '../types'

// Permission key conventions:
//   condominios.tab.<tab_id>   — visibility of a condominios tab
//   admin.<resource>.<action>  — administrative actions (future)
//
// Exempt platform roles (super_admin, company_owner, admin) bypass all checks
// at both DB (user_has_permission) and UI (hasPermission) layers.

const EXEMPT_PLATFORM_ROLES = ['super_admin', 'company_owner', 'admin'] as const

export function isExemptPlatformRole(role: string | undefined | null): boolean {
  return role != null && (EXEMPT_PLATFORM_ROLES as readonly string[]).includes(role)
}

/**
 * Returns true if the current session has the given permission key.
 * Exempt platform roles always return true.
 */
export function hasPermission(session: UserSession | null | undefined, key: string): boolean {
  if (!session) return false
  if (isExemptPlatformRole(session.role)) return true
  return session.permissions?.has(key) ?? false
}

/**
 * Returns true if the session has any of the given permission keys.
 */
export function hasAnyPermission(session: UserSession | null | undefined, keys: string[]): boolean {
  if (!session) return false
  if (isExemptPlatformRole(session.role)) return true
  if (!session.permissions) return false
  return keys.some(k => session.permissions!.has(k))
}

export function condominiosTabPermission(tabId: string): string {
  return `condominios.tab.${tabId}`
}

// ─── Role display ────────────────────────────────────────────────────────────
// Shared labels and color palette for rendering the current user's role chip.
// Kept here so Topbar/Sidebar/PerfilSection don't drift apart.

export const PLATFORM_ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  company_owner: 'Admin Empresa',
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Visualizador',
  cliente: 'Cliente',
  collector: 'Gestor de Cobros',
}

export const PLATFORM_ROLE_COLORS: Record<UserRole, string> = {
  super_admin: '#9C5733',
  company_owner: '#1B3B36',
  admin: '#1B3B36',
  operator: '#577B69',
  viewer: '#7E9389',
  cliente: '#7E9389',
  collector: '#f59e0b',
}

// A user can hold both a platform role and one or more project-scoped
// roles (condominios/agua). The most specific role is the most useful to
// surface in the chip, so condominios > agua > general > platform.
const SERVICE_PRIORITY: Record<string, number> = {
  condominios: 3,
  agua: 2,
  general: 1,
}

function pickPrimaryAssignedRole(session: UserSession): { name: string; color: string | null } | null {
  const roles = session.assigned_roles
  if (!roles || roles.length === 0) return null
  let best: typeof roles[number] | null = null
  let bestScore = -1
  for (const r of roles) {
    const score = SERVICE_PRIORITY[r.service ?? ''] ?? 0
    if (score > bestScore) {
      best = r
      bestScore = score
    }
  }
  return best ? { name: best.name, color: best.color } : null
}

/**
 * Returns the user-facing role label, preferring the most specific
 * service-scoped role assigned via user_roles (condominios > agua > general)
 * over the platform-level role.
 */
export function getDisplayRoleLabel(session: UserSession | null | undefined): string {
  if (!session) return ''
  const primary = pickPrimaryAssignedRole(session)
  if (primary) return primary.name
  return PLATFORM_ROLE_LABELS[session.role] ?? session.role
}

/**
 * Returns the color for the role chip, matching getDisplayRoleLabel's choice.
 * Falls back to the platform-role palette when no service-scoped role applies.
 */
export function getDisplayRoleColor(session: UserSession | null | undefined): string {
  if (!session) return '#7E9389'
  const primary = pickPrimaryAssignedRole(session)
  if (primary?.color) return primary.color
  return PLATFORM_ROLE_COLORS[session.role] ?? '#7E9389'
}

/**
 * Returns true if the session can view the given condominios tab.
 */
export function canViewCondominiosTabByPermission(
  session: UserSession | null | undefined,
  tabId: string,
): boolean {
  return hasPermission(session, condominiosTabPermission(tabId))
}
