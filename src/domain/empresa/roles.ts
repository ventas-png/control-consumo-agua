// domain/empresa/roles.ts — Acceso a datos del RBAC del tenant (T7/PR3).
//
// Baja a domain/ los `select`/`insert`/`update`/`delete` que vivían inline en
// RolPermisosModal y CustomRoleEditor sobre las tablas `roles`,
// `role_permissions`, `permissions` y `user_roles`. La lógica de UI (diff de
// permisos/roles, derivación de "permisos efectivos", validación) se queda en
// los componentes; aquí sólo el I/O a Supabase. Las lecturas devuelven
// `{ data, error }` para que la UI conserve su manejo de errores (throw → catch).
import { supabase } from '../../lib/supabase'
import type { PermissionDef, RoleDef } from '../../types'

/** Roles del sistema + los personalizados de la company (para el selector RBAC). */
export async function fetchCompanyRoles(
  companyId: string,
): Promise<{ data: RoleDef[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('roles')
    .select('id, company_id, name, description, is_system, color, service')
    .or(`is_system.eq.true,company_id.eq.${companyId}`)
    .order('is_system', { ascending: false })
    .order('name')
  return { data: (data as RoleDef[]) ?? null, error: error?.message ?? null }
}

/** Mapa role_id → permission_key (todas las filas; la UI arma el índice por rol). */
export async function fetchAllRolePermissions(): Promise<{
  data: Array<{ role_id: string; permission_key: string; effect: string }> | null
  error: string | null
}> {
  const { data, error } = await supabase
    .from('role_permissions')
    .select('role_id, permission_key, effect')
  return {
    data: (data as Array<{ role_id: string; permission_key: string; effect: string }>) ?? null,
    error: error?.message ?? null,
  }
}

/** Roles asignados a un usuario, con su expiración (para el modal de roles). */
export async function fetchUserRoleAssignments(
  userId: string,
): Promise<{ data: Array<{ role_id: string; expires_at: string | null }> | null; error: string | null }> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role_id, expires_at')
    .eq('user_id', userId)
  return {
    data: (data as Array<{ role_id: string; expires_at: string | null }>) ?? null,
    error: error?.message ?? null,
  }
}

/** Sólo los role_id asignados a un usuario (snapshot para el diff de guardado). */
export async function fetchUserRoleIds(
  userId: string,
): Promise<{ data: Array<{ role_id: string }> | null; error: string | null }> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role_id')
    .eq('user_id', userId)
  return { data: (data as Array<{ role_id: string }>) ?? null, error: error?.message ?? null }
}

/** Quita roles de un usuario (los `role_id` los calcula el diff de la UI). */
export async function deleteUserRoles(
  userId: string,
  roleIds: string[],
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', userId)
    .in('role_id', roleIds)
  return { error: error?.message ?? null }
}

/** Asigna roles a un usuario (filas ya armadas por la UI: user_id/role_id/expires_at). */
export async function insertUserRoles(
  rows: Array<Record<string, unknown>>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('user_roles').insert(rows)
  return { error: error?.message ?? null }
}

/** Actualiza la expiración de un rol ya asignado. */
export async function updateUserRoleExpiration(
  userId: string,
  roleId: string,
  expiresAt: string | null,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('user_roles')
    .update({ expires_at: expiresAt })
    .eq('user_id', userId)
    .eq('role_id', roleId)
  return { error: error?.message ?? null }
}

/** Elimina un rol personalizado por id. */
export async function deleteRole(roleId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('roles').delete().eq('id', roleId)
  return { error: error?.message ?? null }
}

// ── CustomRoleEditor: catálogo de permisos + CRUD de roles personalizados ──

/** Catálogo completo de permisos (para el editor de rol personalizado). */
export async function fetchPermissionsCatalog(): Promise<{
  data: PermissionDef[] | null
  error: string | null
}> {
  const { data, error } = await supabase
    .from('permissions')
    .select('key, category, label, description')
    .order('category')
    .order('label')
  return { data: (data as PermissionDef[]) ?? null, error: error?.message ?? null }
}

/** Un rol por id (para precargar el editor en modo edición). */
export async function fetchRoleById(
  roleId: string,
): Promise<{ data: RoleDef | null; error: string | null }> {
  const { data, error } = await supabase
    .from('roles')
    .select('id, company_id, name, description, is_system, color')
    .eq('id', roleId)
    .single()
  return { data: (data as RoleDef) ?? null, error: error?.message ?? null }
}

/** Permisos (effect=allow) de un rol (precarga del editor / clonado). */
export async function fetchRolePermissionKeys(
  roleId: string,
): Promise<{ data: Array<{ permission_key: string }> | null; error: string | null }> {
  const { data, error } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role_id', roleId)
    .eq('effect', 'allow')
  return { data: (data as Array<{ permission_key: string }>) ?? null, error: error?.message ?? null }
}

/** Todas las claves de permiso de un rol (sin filtrar por effect) — para el
 * diff de guardado, que compara contra TODO lo persistido. */
export async function fetchAllRolePermissionKeys(
  roleId: string,
): Promise<{ data: Array<{ permission_key: string }> | null; error: string | null }> {
  const { data, error } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role_id', roleId)
  return { data: (data as Array<{ permission_key: string }>) ?? null, error: error?.message ?? null }
}

/** Actualiza un rol personalizado (patch ya armado por la UI). */
export async function updateRole(
  roleId: string,
  patch: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('roles').update(patch).eq('id', roleId)
  return { error: error?.message ?? null }
}

/** Crea un rol personalizado y devuelve su id (payload ya armado por la UI). */
export async function createRole(
  payload: Record<string, unknown>,
): Promise<{ data: { id: string } | null; error: string | null }> {
  const { data, error } = await supabase.from('roles').insert(payload).select('id').single()
  return { data: (data as { id: string }) ?? null, error: error?.message ?? null }
}

/** Quita permisos de un rol (diff de la UI). */
export async function deleteRolePermissions(
  roleId: string,
  permissionKeys: string[],
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('role_permissions')
    .delete()
    .eq('role_id', roleId)
    .in('permission_key', permissionKeys)
  return { error: error?.message ?? null }
}

/** Agrega permisos a un rol (filas ya armadas por la UI). */
export async function insertRolePermissions(
  rows: Array<Record<string, unknown>>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('role_permissions').insert(rows)
  return { error: error?.message ?? null }
}
