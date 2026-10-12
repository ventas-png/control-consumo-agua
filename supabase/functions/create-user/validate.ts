// Lógica pura de create-user, extraída del handler para poder testearla en
// aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js → corre directo
// en vitest. El handler (index.ts) importa estos símbolos: el comportamiento no
// cambia, solo se mueve la definición a un archivo importable desde los tests.

// Universo de roles que un caller NO super_admin puede otorgar (company_owner o admin): espejo del
// whitelist de invite-user (INVITABLE_ROLES). NUNCA super_admin ni company_owner: es la barrera
// contra escalada de privilegios de este endpoint. QUIÉN puede otorgar cada uno lo decide
// canCreateRole(): el propietario puede todos; el administrador, todos MENOS ROLES_SOLO_PRINCIPAL.
export const ALLOWED_ROLES_FOR_NON_SUPER = ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector']

// Roles que SOLO otorga el PRINCIPAL de la empresa (company_owner, o super_admin/superadmin). Un
// administrador sin filas de proyecto es «exento» (ve toda la empresa) y un alta de administrador
// nace sin filas: si un administrador pudiera darlas, fabricaría exentos (D-2). Decisión del dueño
// del negocio (2026-10-11): la autoridad es del principal. Espejo de la política RLS
// user_invitations_insert (migración 20261026000700), que es el control real del camino directo.
export const ROLES_SOLO_PRINCIPAL = ['admin']

export const MSG_SOLO_PRINCIPAL_ADMIN = 'Solo el propietario de la empresa puede crear administradores.'

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

/** `true` si `role` pertenece al universo de roles que algún caller no-super puede otorgar (case-sensitive). No dice QUIÉN: ver canCreateRole. */
export function isRoleAllowedForNonSuper(role: string): boolean {
  return ALLOWED_ROLES_FOR_NON_SUPER.includes(role)
}

/** `true` si el rol es el PRINCIPAL de la empresa: company_owner o super_admin/superadmin. Un administrador (acotado o exento) NO lo es. */
export function isPrincipalRole(role: string): boolean {
  return isSuperAdminRole(role) || role === 'company_owner'
}

/**
 * Por qué `callerRole` NO puede crear a alguien con `targetRole`, o `null` si puede.
 *   · super_admin: cualquier rol (así se da de alta al company_owner de una empresa nueva);
 *   · company_owner: todo el universo de ALLOWED_ROLES_FOR_NON_SUPER (administrador incluido);
 *   · admin: el universo MENOS ROLES_SOLO_PRINCIPAL (no crea administradores);
 *   · cualquier otro rol: nada.
 */
export function createRoleDenial(callerRole: string, targetRole: string): string | null {
  if (isSuperAdminRole(callerRole)) return null
  if (!canManageUsers(callerRole)) return 'Insufficient permissions'
  if (!isRoleAllowedForNonSuper(targetRole)) {
    return isPrincipalRole(callerRole)
      ? 'Solo puedes crear usuarios con rol admin/operador/visualizador/cobros'
      : 'Solo puedes crear usuarios con rol operador/visualizador/cobros'
  }
  if (ROLES_SOLO_PRINCIPAL.includes(targetRole) && !isPrincipalRole(callerRole)) return MSG_SOLO_PRINCIPAL_ADMIN
  return null
}

/** `true` si `callerRole` puede crear a alguien con `targetRole` (ver createRoleDenial). */
export function canCreateRole(callerRole: string, targetRole: string): boolean {
  return createRoleDenial(callerRole, targetRole) === null
}

/**
 * `true` si el valor es texto o falta (undefined / null): el cuerpo llega de la red y un arreglo, un objeto o un número no deben llegar a
 * auth.admin.createUser ni a app_users (ni recortarse: TypeError → 500): se rechazan con 400. Espejo de isTextOrAbsent de invite-user/validate.ts
 * (cada función se despliega con lo suyo; la prueba fija que coinciden).
 */
export function isTextOrAbsent(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === 'string'
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
