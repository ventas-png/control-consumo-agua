import type { UserSession } from '../types'

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

/**
 * Returns true if the session can view the given condominios tab.
 */
export function canViewCondominiosTabByPermission(
  session: UserSession | null | undefined,
  tabId: string,
): boolean {
  return hasPermission(session, condominiosTabPermission(tabId))
}
