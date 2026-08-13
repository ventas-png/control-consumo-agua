// _shared/broadcastAudience.ts — resolución PURA de la audiencia de un comunicado.
//
// **Por qué**: hasta com:N5 el cliente resolvía la audiencia en el navegador
// (useBroadcasts.resolveClienteIds) a partir de TODOS los clientes/unidades que
// ya tenía cargados, y luego hacía un batch INSERT de ~500 filas. Eso obliga a
// enviar todo el padrón al cliente y confía en datos del navegador. La edge fn
// `create-broadcast` resuelve la audiencia en el SERVIDOR contra la BD; esta es
// la parte pura (mapeo de filas → cliente_ids) para poder testearla sin red,
// igual que se espeja `calcularMora` para el cron (frontera Deno/Vite).
//
// Nota: NO importa nada — función pura sobre arreglos ya consultados por el
// caller (importable desde Deno y desde vitest).

export type BroadcastTargetType = 'todos' | 'proyecto' | 'unidades' | 'clientes'

/** Referencia mínima de unidad necesaria para resolver su cliente. */
export interface UnidadRef {
  id: string
  project_id: string
  cliente_id: string | null
}

export interface ResolveAudienceArgs {
  targetType: BroadcastTargetType
  /** Ids seleccionados según el tipo: proyectos, unidades o clientes. */
  targetIds: string[]
  /** Todos los cliente_id vinculados a la empresa (company_clientes). */
  companyClienteIds: string[]
  /** Unidades de la empresa (solo se usan para 'proyecto'/'unidades'). */
  unidades: UnidadRef[]
}

/**
 * Resuelve la lista final de cliente_ids destinatarios. Siempre interseca con
 * `companyClienteIds` (defensa: un admin no puede difundir a clientes que no son
 * de su empresa, aunque mande ids arbitrarios) y deduplica.
 */
export function resolveBroadcastClienteIds(args: ResolveAudienceArgs): string[] {
  const { targetType, targetIds, companyClienteIds, unidades } = args
  const companySet = new Set(companyClienteIds)
  const targetSet = new Set(targetIds)

  let ids: string[]
  switch (targetType) {
    case 'todos':
      ids = companyClienteIds
      break
    case 'clientes':
      ids = targetIds
      break
    case 'proyecto': {
      const s = new Set<string>()
      for (const u of unidades) {
        if (u.cliente_id && targetSet.has(u.project_id)) s.add(u.cliente_id)
      }
      ids = [...s]
      break
    }
    case 'unidades': {
      const s = new Set<string>()
      for (const u of unidades) {
        if (u.cliente_id && targetSet.has(u.id)) s.add(u.cliente_id)
      }
      ids = [...s]
      break
    }
    default:
      ids = []
  }

  // Solo clientes de la empresa, sin duplicados.
  return [...new Set(ids.filter((id) => companySet.has(id)))]
}

// ── Alcance por proyecto del emisor ──────────────────────────────────────────
// Espeja src/lib/proyectosAccess.ts + src/lib/comunicacionAccess.ts en el
// servidor: quién puede difundir a qué. Sin esto, `target_ids` viaja desde el
// navegador y un usuario acotado a un proyecto podía abanicar a los clientes de
// TODOS los proyectos de la empresa mandando ids arbitrarios.

/** Roles de plataforma que difunden a toda la empresa (PROJECT_EXEMPT_ROLES). */
export const PROJECT_EXEMPT_SENDER_ROLES = ['super_admin', 'superadmin', 'company_owner', 'admin']

/**
 * Roles de sistema de condominios que SÍ acotan por proyecto (todos salvo
 * administrador_general). Espeja RESTRICTED_COND_ROLE_IDS de proyectosAccess:
 * un company_owner que además es "finanzas" de un condominio queda acotado.
 */
export const RESTRICTED_COND_ROLE_IDS = [
  '00000000-0000-0000-0000-000000000002', // junta_directiva
  '00000000-0000-0000-0000-000000000003', // finanzas
  '00000000-0000-0000-0000-000000000004', // operaciones
  '00000000-0000-0000-0000-000000000005', // seguridad
  '00000000-0000-0000-0000-000000000006', // comunidad
  '00000000-0000-0000-0000-000000000007', // recepcion
  '00000000-0000-0000-0000-000000000008', // visualizador
]

/** ¿Este emisor difunde a toda la empresa, sin recorte por proyecto? */
export function isProjectExemptSender(role: string, assignedRoleIds: string[] = []): boolean {
  return (
    PROJECT_EXEMPT_SENDER_ROLES.includes(role) &&
    !assignedRoleIds.some((id) => RESTRICTED_COND_ROLE_IDS.includes(id))
  )
}

export interface RestrictClienteIdsArgs {
  /** Audiencia ya resuelta por `resolveBroadcastClienteIds`. */
  clienteIds: string[]
  /** Proyectos que el emisor tiene asignados. */
  allowedProjectIds: string[]
  /** Unidades de la empresa (mapa cliente → proyectos). */
  unidades: UnidadRef[]
}

/**
 * Recorta la audiencia a los clientes alcanzables desde los proyectos del
 * emisor. Un cliente que NO se puede mapear a ningún proyecto (aún sin unidad)
 * se conserva: es el alta reciente, y bloquearla rompería el comunicado de
 * bienvenida. La misma regla de ambigüedad que lib/comunicacionAccess.
 */
export function restrictClienteIdsToProjects({
  clienteIds,
  allowedProjectIds,
  unidades,
}: RestrictClienteIdsArgs): string[] {
  const allowed = new Set(allowedProjectIds)
  const clienteProjects = new Map<string, Set<string>>()
  for (const u of unidades) {
    if (!u.cliente_id || !u.project_id) continue
    let set = clienteProjects.get(u.cliente_id)
    if (!set) { set = new Set(); clienteProjects.set(u.cliente_id, set) }
    set.add(u.project_id)
  }

  return clienteIds.filter((id) => {
    const projects = clienteProjects.get(id)
    if (!projects || projects.size === 0) return true // ambiguo → se conserva
    for (const pid of projects) if (allowed.has(pid)) return true
    return false
  })
}

/** Parte una lista en chunks de tamaño `size` (para batch INSERT / .in()). */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
