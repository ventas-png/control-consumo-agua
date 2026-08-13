// domain/empresa/roles.ts — Acceso a datos del RBAC del tenant (T7/PR3).
//
// Baja a domain/ los `select`/`insert`/`update`/`delete` que vivían inline en
// RolPermisosModal y CustomRoleEditor sobre las tablas `roles`,
// `role_permissions`, `permissions` y `user_roles`. La lógica de UI (diff de
// permisos/roles, derivación de "permisos efectivos", validación) se queda en
// los componentes; aquí sólo el I/O a Supabase. Las lecturas devuelven
// `{ data, error }` para que la UI conserve su manejo de errores (throw → catch).
import { supabase } from '../../lib/supabase'
import { fetchAllRows } from '../../lib/fetchAllRows'
import type { PermissionDef, RoleDef } from '../../types'

// Las lecturas del catálogo RBAC PAGINAN con fetchAllRows: el catálogo ronda
// las 1 170 claves y un rol de acceso amplio (p. ej. "Finanzas / Contador")
// arrastra más de 1 100 filas él solo, así que estas consultas viven por
// encima del tope silencioso de PostgREST (~1 000 filas). Truncadas, el panel
// de permisos efectivos muestra menos de lo que el rol tiene —y, peor, el
// editor hace read-modify-write: guardar un rol precargado a medias BORRA los
// permisos que no llegaron. `.range()` exige un orden total, de ahí los
// `.order()` por clave primaria en cada una.

/** Roles del sistema (plantillas) + los personalizados de la company (para el
 * selector RBAC). Excluye los roles de ajustes individuales por usuario
 * (user_override_for), que se gestionan aparte desde el panel de permisos. */
export async function fetchCompanyRoles(
  companyId: string,
): Promise<{ data: RoleDef[] | null; error: string | null }> {
  const { data, error } = await supabase
    .from('roles')
    .select('id, company_id, name, description, is_system, color, service, cloned_from_role_id')
    .or(`is_system.eq.true,company_id.eq.${companyId}`)
    .is('user_override_for', null)
    .order('is_system', { ascending: false })
    .order('name')
  return { data: (data as RoleDef[]) ?? null, error: error?.message ?? null }
}

/** Mapa role_id → permission_key (todas las filas; la UI arma el índice por rol). */
export async function fetchAllRolePermissions(): Promise<{
  data: Array<{ role_id: string; permission_key: string; effect: string }> | null
  error: string | null
}> {
  const { data, error } = await fetchAllRows<{ role_id: string; permission_key: string; effect: string }>(
    (from, to) => supabase
      .from('role_permissions')
      .select('role_id, permission_key, effect')
      .order('role_id')
      .order('permission_key')
      .order('effect')
      .range(from, to),
  )
  return { data: error ? null : data, error }
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
  const { data, error } = await fetchAllRows<PermissionDef>(
    (from, to) => supabase
      .from('permissions')
      .select('key, category, label, description')
      .order('category')
      .order('label')
      .order('key')
      .range(from, to),
  )
  return { data: error ? null : data, error }
}

/** Un rol por id (para precargar el editor en modo edición o clonado). */
export async function fetchRoleById(
  roleId: string,
): Promise<{ data: RoleDef | null; error: string | null }> {
  const { data, error } = await supabase
    .from('roles')
    .select('id, company_id, name, description, is_system, color, service, cloned_from_role_id')
    .eq('id', roleId)
    .single()
  return { data: (data as RoleDef) ?? null, error: error?.message ?? null }
}

/** Permisos (effect=allow) de un rol (precarga del editor / clonado). */
export async function fetchRolePermissionKeys(
  roleId: string,
): Promise<{ data: Array<{ permission_key: string }> | null; error: string | null }> {
  const { data, error } = await fetchAllRows<{ permission_key: string }>(
    (from, to) => supabase
      .from('role_permissions')
      .select('permission_key')
      .eq('role_id', roleId)
      .eq('effect', 'allow')
      .order('permission_key')
      .range(from, to),
  )
  return { data: error ? null : data, error }
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

/**
 * Deja el rol EXACTAMENTE con estos permisos (quita sobrantes, agrega
 * faltantes). Una sola llamada, atómica, con la lista en el CUERPO.
 *
 * Sustituye al diff cliente (delete + insert) para el editor de roles: aquel
 * mandaba las claves a borrar dentro de la query string, y con un rol grande
 * —1 080 claves al recortar el catálogo completo a 90 permisos— la URL pasaba
 * de 50 KB y la pasarela devolvía un «Bad Request» de texto plano. Ver la
 * migración 20260817000000.
 */
export async function setRolePermissions(
  roleId: string,
  permissionKeys: string[],
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('set_role_permissions', {
    p_role_id: roleId,
    p_keys: permissionKeys,
  })
  return { error: error?.message ?? null }
}

// Tamaño de lote del borrado por claves. Cada clave ocupa ~45 caracteres una
// vez URL-encodeada (comillas y comas incluidas), así que 40 por petición deja
// la query string bien por debajo del límite habitual de 4 KB de las pasarelas.
const DELETE_KEYS_CHUNK = 40

/**
 * Quita permisos de un rol (diff de la UI). Trocea la lista: las claves viajan
 * en la URL, así que una lista larga en una sola petición la rechaza la
 * pasarela antes de llegar a PostgREST. Corta en el primer error.
 */
export async function deleteRolePermissions(
  roleId: string,
  permissionKeys: string[],
): Promise<{ error: string | null }> {
  for (let i = 0; i < permissionKeys.length; i += DELETE_KEYS_CHUNK) {
    const { error } = await supabase
      .from('role_permissions')
      .delete()
      .eq('role_id', roleId)
      .in('permission_key', permissionKeys.slice(i, i + DELETE_KEYS_CHUNK))
    if (error) return { error: error.message }
  }
  return { error: null }
}

/** Agrega permisos a un rol (filas ya armadas por la UI). */
export async function insertRolePermissions(
  rows: Array<Record<string, unknown>>,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('role_permissions').insert(rows)
  return { error: error?.message ?? null }
}

// ── Plantillas y ajustes individuales (modelo plantilla → rol de empresa) ──

/** Permisos de un rol CON su effect (allow/deny) — para copiar plantillas y
 * cargar los ajustes individuales (fetchRolePermissionKeys filtra solo allow). */
export async function fetchRolePermissionsWithEffect(
  roleId: string,
): Promise<{ data: Array<{ permission_key: string; effect: string }> | null; error: string | null }> {
  const { data, error } = await fetchAllRows<{ permission_key: string; effect: string }>(
    (from, to) => supabase
      .from('role_permissions')
      .select('permission_key, effect')
      .eq('role_id', roleId)
      .order('permission_key')
      .order('effect')
      .range(from, to),
  )
  return { data: error ? null : data, error }
}

/**
 * Busca-o-crea la copia de empresa de una plantilla (rol del sistema).
 * Reutiliza solo adopciones FIELES (linaje + nombre de la plantilla, con o sin
 * sufijo " (plantilla)"); las copias personalizadas/renombradas no cuentan,
 * así "Usar plantilla" siempre entrega la versión íntegra. La colisión con
 * UNIQUE(company_id, name) — rol homónimo hecho a mano o adopción concurrente
 * de otro admin — se resuelve re-consultando y/o con nombres alternativos.
 */
export async function ensureCompanyRoleFromTemplate(
  companyId: string,
  templateRoleId: string,
): Promise<{ data: { id: string } | null; error: string | null }> {
  const { data: tpl, error: tplErr } = await supabase
    .from('roles')
    .select('name, description, color, service')
    .eq('id', templateRoleId)
    .single()
  if (tplErr || !tpl) return { data: null, error: tplErr?.message ?? 'Plantilla no encontrada.' }

  const t = tpl as { name: string; description: string | null; color: string | null; service: string | null }
  const adoptionNames = [t.name, `${t.name} (plantilla)`]

  const findAdoption = async (): Promise<string | null> => {
    const { data: existing } = await supabase
      .from('roles')
      .select('id')
      .eq('company_id', companyId)
      .eq('cloned_from_role_id', templateRoleId)
      .in('name', adoptionNames)
      .order('created_at', { ascending: true })
      .limit(1)
    return (existing as Array<{ id: string }> | null)?.[0]?.id ?? null
  }

  const found = await findAdoption()
  if (found) return { data: { id: found }, error: null }

  const candidates = [...adoptionNames, `${t.name} (${templateRoleId.slice(0, 8)})`]
  let createdId: string | null = null
  let lastError: string | null = null
  for (const name of candidates) {
    const { data: ins, error: insErr } = await supabase
      .from('roles')
      .insert({
        company_id: companyId,
        name,
        description: t.description,
        is_system: false,
        color: t.color,
        service: t.service,
        cloned_from_role_id: templateRoleId,
      })
      .select('id')
      .single()
    if (!insErr && ins) {
      createdId = (ins as { id: string }).id
      break
    }
    lastError = insErr?.message ?? null
    // 23505 = unique_violation: nombre tomado. Otro error → abortar.
    if (insErr?.code !== '23505') return { data: null, error: lastError }
    // Pudo ganar una adopción concurrente con ese nombre — reutilizarla.
    const concurrent = await findAdoption()
    if (concurrent) return { data: { id: concurrent }, error: null }
  }
  if (!createdId) return { data: null, error: lastError ?? 'No se pudo crear el rol desde la plantilla.' }

  const { data: perms, error: permsErr } = await fetchRolePermissionsWithEffect(templateRoleId)
  if (permsErr) return { data: null, error: permsErr }
  if (perms && perms.length > 0) {
    const { error: insPermErr } = await insertRolePermissions(
      perms.map(p => ({ role_id: createdId, permission_key: p.permission_key, effect: p.effect })),
    )
    if (insPermErr) return { data: null, error: insPermErr }
  }
  return { data: { id: createdId }, error: null }
}

/** Rol de ajustes individuales de un usuario (o null si no tiene). */
export async function fetchUserOverrideRole(
  userId: string,
): Promise<{ data: { id: string } | null; error: string | null }> {
  const { data, error } = await supabase
    .from('roles')
    .select('id')
    .eq('user_override_for', userId)
    .maybeSingle()
  return { data: (data as { id: string } | null) ?? null, error: error?.message ?? null }
}

/** Crea el rol oculto de ajustes individuales de un usuario (lazy, al primer
 * ajuste). El índice único parcial sobre user_override_for impide duplicados. */
export async function createOverrideRole(
  companyId: string,
  userId: string,
  name: string,
): Promise<{ data: { id: string } | null; error: string | null }> {
  const { data, error } = await supabase
    .from('roles')
    .insert({
      company_id: companyId,
      name,
      description: 'Ajustes finos asignados directamente al usuario',
      is_system: false,
      color: '#7E9389',
      user_override_for: userId,
    })
    .select('id')
    .single()
  return { data: (data as { id: string }) ?? null, error: error?.message ?? null }
}
