// Lógica pura de create-user, extraída del handler para poder testearla en
// aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js → corre directo
// en vitest. El handler (index.ts) importa estos símbolos: el comportamiento no
// cambia, solo se mueve la definición a un archivo importable desde los tests.

// Roles que un caller NO super_admin (company_owner/admin) puede crear. Espejo
// del whitelist de invite-user (INVITABLE_ROLES). NUNCA super_admin ni
// company_owner: es la barrera contra escalada de privilegios de este endpoint.
export const ALLOWED_ROLES_FOR_NON_SUPER = ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector']

/** `true` si el rol es super_admin (ambas grafías históricas). */
export function isSuperAdminRole(role: string): boolean {
  return role === 'super_admin' || role === 'superadmin'
}

/**
 * `true` si el rol del caller puede gestionar usuarios (crear/eliminar):
 * super_admin, company_owner o admin. Cualquier otro rol → 403 en el handler.
 */
export function canManageUsers(role: string): boolean {
  return isSuperAdminRole(role) || role === 'company_owner' || role === 'admin'
}

/** `true` si un caller no-super puede otorgar `role` (whitelist, case-sensitive). */
export function isRoleAllowedForNonSuper(role: string): boolean {
  return ALLOWED_ROLES_FOR_NON_SUPER.includes(role)
}

/**
 * Normaliza el email (trim + lowercase). El login normaliza el email, así que
 * el valor almacenado debe estar normalizado también: un espacio final o una
 * mayúscula crearía una cuenta a la que luego no se puede entrar.
 */
export function normalizeEmail(raw: string | null | undefined): string {
  return (raw ?? '').trim().toLowerCase()
}

/**
 * `true` si falta algún campo obligatorio del alta (email ya normalizado:
 * un email de solo espacios queda '' y cuenta como faltante).
 */
export function hasMissingRequiredFields(input: {
  email: string
  password: string
  full_name: string
  role: string
  company_id: string
}): boolean {
  return !input.email || !input.password || !input.full_name || !input.role || !input.company_id
}

// Rol de sistema de plataforma (RBAC user_roles) que corresponde a cada rol de
// app_users. Espejo del mapping de la migración
// 20260518000013_rbac_platform_modules.sql.
export const PLATFORM_ROLE_ID: Record<string, string> = {
  admin:     '00000000-0000-0000-0000-000000000201',
  operator:  '00000000-0000-0000-0000-000000000202',
  operador:  '00000000-0000-0000-0000-000000000202',
  viewer:    '00000000-0000-0000-0000-000000000203',
  visor:     '00000000-0000-0000-0000-000000000203',
  collector: '00000000-0000-0000-0000-000000000204',
}

/**
 * role_id de plataforma para `role`, o `undefined` si el rol no lleva RBAC.
 * Nota: super_admin / company_owner / cliente no reciben rol de plataforma —
 * bypasean los checks RBAC vía EXEMPT_ROLES en moduleConfig.ts.
 */
export function platformRoleIdFor(role: string): string | undefined {
  return PLATFORM_ROLE_ID[role]
}
