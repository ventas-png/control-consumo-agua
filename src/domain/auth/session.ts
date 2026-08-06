// domain/auth/session.ts — Construcción de la UserSession desde Supabase.
//
// Capa de datos del auth (T7/plat:P13): extraído de useAuth.ts para separar el
// I/O a Supabase + el parsing de RBAC (permisos, roles asignados, flags de
// servicio) de la MÁQUINA DE ESTADO React del hook. Sin React aquí — funciones
// puras de datos, testeables de forma aislada.
import { reportDegradedQuery } from '../queryFetch'
import { supabase } from '../../lib/supabase'
import { APP_CONFIG } from '../../lib/config'
import { storeSession } from '../../lib/authSession'
import type { UserSession, UserRole, AssignedRoleInfo } from '../../types'

export async function buildSessionFromSupabase(
  userId: string,
  email: string,
  expiresAt: number | undefined
): Promise<UserSession> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Profile fetch timeout')), 5000)
  )

  // Batch 1: profile + RBAC permissions + assigned roles, in parallel
  const profileQuery = supabase
    .from('app_users')
    .select('full_name, role, company_id, cliente_id, activo')
    .eq('id', userId)
    .single()

  const rbacPermsQuery = supabase.rpc('get_user_permissions', { target_user_id: userId })

  const userRolesQuery = supabase
    .from('user_roles')
    .select('role_id, role:roles(id, name, service, color, cloned_from_role_id, user_override_for)')
    .eq('user_id', userId)

  const [profileResult, rbacPermsResult, userRolesResult] = await Promise.race([
    Promise.all([profileQuery, rbacPermsQuery, userRolesQuery]),
    timeout,
  ])

  type ProfileRow = { full_name?: string; role?: string; company_id?: string; cliente_id?: string; activo?: boolean } | null
  const prof = profileResult.data as ProfileRow

  if (prof?.activo === false) {
    throw new Error('Cuenta desactivada. Comuníquese con su empresa de servicios.')
  }
  const dbRole: string = prof?.role ?? ''
  const companyId: string | undefined = prof?.company_id ?? undefined
  const clienteId: string | undefined = prof?.cliente_id ?? undefined
  let uiRole: UserRole = 'viewer'
  if (dbRole === 'super_admin' || dbRole === 'superadmin') uiRole = 'super_admin'
  else if (dbRole === 'company_owner') uiRole = 'company_owner'
  else if (dbRole === 'admin') uiRole = 'admin'
  else if (dbRole === 'operador' || dbRole === 'user' || dbRole === 'operator') uiRole = 'operator'
  else if (dbRole === 'cliente') uiRole = 'cliente'
  else if (dbRole === 'visor' || dbRole === 'viewer') uiRole = 'viewer'
  else if (dbRole === 'collector') uiRole = 'collector'

  const displayName = prof?.full_name ?? email

  // Batch 2: company flags (needs companyId from batch 1) — wrapped in 4s timeout
  // to prevent login from hanging if Supabase is slow or the nested join stalls
  let servicio_agua: boolean | undefined
  let servicio_condominios: boolean | undefined
  let empresaSuspendida = false
  let mfa_required = false
  try {
    const batch2: Promise<void> = (async () => {
      if (companyId) {
        const { data, error } = await supabase
          .from('companies')
          .select('servicio_agua, servicio_condominios, activa, mfa_required')
          .eq('id', companyId)
          .single()
        reportDegradedQuery('auth.buildSessionFromSupabase', error)
        if (data) {
          const flags = data as { servicio_agua: boolean; servicio_condominios: boolean; activa: boolean; mfa_required?: boolean }
          servicio_agua = flags.servicio_agua
          servicio_condominios = flags.servicio_condominios
          empresaSuspendida = flags.activa === false
          mfa_required = flags.mfa_required === true
        }
      } else if (clienteId) {
        type UnidadRow = { projects: { companies: { servicio_agua: boolean; servicio_condominios: boolean } | null } | null }
        const { data: unidadesFlags } = await supabase
          .from('unidades')
          .select('projects(companies(servicio_agua, servicio_condominios))')
          .eq('cliente_id', clienteId)
          .eq('activo', true)
        if (unidadesFlags) {
          for (const u of (unidadesFlags as unknown as UnidadRow[])) {
            const flags = u.projects?.companies
            if (!flags) continue
            if (flags.servicio_condominios) servicio_condominios = true
            if (flags.servicio_agua) servicio_agua = true
          }
        }
      }
    })()

    await Promise.race([batch2, new Promise<void>(resolve => setTimeout(resolve, 4000))])
  } catch {
    // service flags remain undefined — portal falls back to agua portal safely
  }

  // Suspensión de empresa (companies.activa=false): bloquear el login de todos
  // sus usuarios salvo super_admin. El mensaje contiene "desactivada" para que
  // useCredentialsLogin lo muestre tal cual. Si la consulta falla/expira, el
  // login procede (fail-open): los triggers COMPANY_SUSPENDED en BD siguen
  // bloqueando las escrituras.
  if (empresaSuspendida && uiRole !== 'super_admin') {
    throw new Error('Empresa desactivada. Comuníquese con soporte de AdministraTodo.')
  }

  return {
    user_id: userId,
    email,
    name: displayName,
    role: uiRole,
    company_id: companyId,
    cliente_id: clienteId,
    login_time: new Date().toISOString(),
    expires_at: expiresAt
      ? new Date(expiresAt * 1000).toISOString()
      : new Date(Date.now() + APP_CONFIG.SESSION_TIMEOUT).toISOString(),
    servicio_agua,
    servicio_condominios,
    mfa_required,
    permissions: buildPermissionsSet(rbacPermsResult),
    assigned_role_ids: buildAssignedRoleIds(userRolesResult),
    assigned_roles: buildAssignedRoles(userRolesResult),
  }
}

export function buildPermissionsSet(result: { data: unknown; error: unknown }): Set<string> | undefined {
  if (result.error || !result.data) return undefined
  // get_user_permissions RPC returns SETOF text -> array of { get_user_permissions: string } or string[]
  const rows = result.data as Array<{ get_user_permissions?: string } | string>
  const keys: string[] = []
  for (const row of rows) {
    if (typeof row === 'string') keys.push(row)
    else if (row && typeof row.get_user_permissions === 'string') keys.push(row.get_user_permissions)
  }
  return new Set(keys)
}

export function buildAssignedRoleIds(result: { data: unknown; error: unknown }): string[] | undefined {
  if (result.error || !result.data) return undefined
  const rows = result.data as Array<{ role_id: string; role?: { cloned_from_role_id?: string | null } | null }>
  // Expansión por linaje: las copias de empresa heredan los gates gruesos que
  // dependen de UUIDs de roles del sistema (RESTRICTED_COND_ROLE_IDS en
  // proyectosAccess, ADMIN_GENERAL_ROLE_ID en ComunicacionSection) incluyendo
  // el id de su plantilla de origen junto al propio.
  const ids = new Set<string>()
  for (const r of rows) {
    ids.add(r.role_id)
    const origin = r.role?.cloned_from_role_id
    if (origin) ids.add(origin)
  }
  return [...ids]
}

export function buildAssignedRoles(result: { data: unknown; error: unknown }): AssignedRoleInfo[] | undefined {
  if (result.error || !result.data) return undefined
  type Row = {
    role_id: string
    role: {
      id: string
      name: string
      service: string | null
      color: string | null
      user_override_for?: string | null
    } | null
  }
  const rows = result.data as Row[]
  const allowed = new Set(['condominios', 'agua', 'general'])
  return rows
    .filter((r): r is Row & { role: NonNullable<Row['role']> } => r.role !== null)
    // El rol oculto de ajustes individuales no es un rol "visible": no debe
    // aparecer como chip en topbar/perfil (pickPrimaryAssignedRole).
    .filter(r => !r.role.user_override_for)
    .map(r => ({
      id: r.role.id,
      name: r.role.name,
      service: r.role.service && allowed.has(r.role.service)
        ? (r.role.service as AssignedRoleInfo['service'])
        : null,
      color: r.role.color,
    }))
}

/**
 * ¿Existe ya un perfil `app_users` para este auth user? Lo usa el bootstrap de
 * OAuth para decidir si el usuario nuevo (sin perfil) debe pasar por onboarding.
 */
export async function appUserProfileExists(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('app_users')
    .select('id')
    .eq('id', userId)
    .maybeSingle()
  reportDegradedQuery('auth.appUserProfileExists', error)
  // Un fallo de la consulta NO significa "no tiene perfil": devolver false haría
  // que un usuario existente cayera en el onboarding de cuenta nueva. Se propaga
  // el error para que el caller lo trate como fallo recuperable y ofrezca
  // reintentar. Importa sobre todo en la app móvil: como la sesión de app vive en
  // sessionStorage (que el WebView borra al cerrar la app), este chequeo corre en
  // CADA arranque en frío, y ahí las redes móviles fallan con frecuencia.
  if (error) throw new Error(error.message)
  return !!data
}

// Reconstruye la sesion desde Supabase y la persiste si cambiaron role,
// company/cliente, service flags o el set de permisos. Devuelve la nueva
// sesion (o null si no aplico cambio) para que el caller decida si re-render.
// Usado tanto por el refresh inicial al montar como por el listener Realtime
// que reacciona a INSERT/DELETE en user_roles / role_permissions / app_users.
export async function refreshSessionFromSupabase(
  current: UserSession,
  expiresAt: number | undefined,
): Promise<UserSession | null> {
  try {
    const fresh = await buildSessionFromSupabase(
      current.user_id,
      current.email,
      expiresAt,
    )
    const freshPerms = fresh.permissions ? [...fresh.permissions].sort() : []
    const currentPerms = current.permissions ? [...current.permissions].sort() : []
    const permissionsChanged = JSON.stringify(freshPerms) !== JSON.stringify(currentPerms)
    if (
      fresh.role !== current.role ||
      fresh.name !== current.name ||
      fresh.company_id !== current.company_id ||
      fresh.cliente_id !== current.cliente_id ||
      fresh.servicio_condominios !== current.servicio_condominios ||
      fresh.servicio_agua !== current.servicio_agua ||
      permissionsChanged
    ) {
      // Conservar expires_at original — el refresh de permisos no extiende la sesion
      const merged = { ...fresh, expires_at: current.expires_at }
      storeSession(merged)
      return merged
    }
  } catch {
    // ignore — keep existing session on error
  }
  return null
}
