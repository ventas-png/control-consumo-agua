import type { Proyecto, MaxUnidadesPorTipo } from '../types'
import { SYSTEM_ROLE_IDS } from './systemRoleIds'

// Roles de plataforma que ven TODOS los proyectos de la empresa (sin asignación
// por proyecto). Espeja PROJECT_EXEMPT_ROLES del antiguo useData.
export const PROJECT_EXEMPT_ROLES = new Set(['super_admin', 'company_owner', 'admin'])

// Roles cuyo alcance es la EMPRESA por definición: el staff de la plataforma y
// el dueño de la empresa. Ni siquiera una asignación explícita de proyecto los
// acota (el dueño administra todos sus proyectos; el super_admin, todas las
// empresas). El resto de roles exentos —hoy solo `admin`— sí se acotan en cuanto
// se les asigna un proyecto: ver isProjectExempt.
export const COMPANY_WIDE_ROLES = new Set(['super_admin', 'company_owner'])

/** ¿El alcance de este rol es la empresa entera, pase lo que pase? */
export function isCompanyWideRole(role?: string): boolean {
  return !!role && COMPANY_WIDE_ROLES.has(role)
}

// Roles de sistema de condominios que SÍ restringen la visibilidad por proyecto
// (todos salvo administrador_general). Se derivan de systemRoleIds para evitar
// drift de UUIDs si cambian las migraciones de seed.
export const RESTRICTED_COND_ROLE_IDS = new Set<string>(
  Object.entries(SYSTEM_ROLE_IDS.condominios)
    .filter(([k]) => k !== 'administrador_general')
    .map(([, v]) => v),
)

/**
 * ¿Este usuario salta el filtrado por asignación de proyecto? Un rol exento ve
 * todos los proyectos de su empresa, con dos excepciones:
 *
 *  1. tener además un rol de condominios restringido (p. ej. un company_owner
 *     que también es "finanzas" de un condominio queda acotado a sus proyectos);
 *  2. tener una asignación EXPLÍCITA de proyecto (`user_project_assignments`).
 *     Asignar un proyecto a alguien es un acto deliberado de acotarlo, así que
 *     un `admin` con proyecto asignado pasa a ver SOLO ese proyecto — que es lo
 *     que un "Administrador del Condominio" espera. Los roles de alcance de
 *     empresa (super_admin / company_owner) no se acotan nunca por esta vía.
 *
 * `assignments` sigue la semántica de la query: `undefined`/`null` = aún sin
 * cargar o en error, y entonces NO acota (el rol exento mantiene su vista de
 * empresa mientras carga, en vez de parpadear vacío); `[]` = cargado y sin
 * asignaciones, que es el admin de toda la vida y sigue viendo la empresa.
 */
export function isProjectExempt(
  role?: string,
  assignedRoleIds?: string[],
  assignments?: string[] | null,
): boolean {
  if (!role) return false
  if (!PROJECT_EXEMPT_ROLES.has(role)) return false
  const hasRestrictedCondRole = (assignedRoleIds ?? []).some((rid) => RESTRICTED_COND_ROLE_IDS.has(rid))
  if (hasRestrictedCondRole) return false
  if (!isCompanyWideRole(role) && (assignments?.length ?? 0) > 0) return false
  return true
}

interface FilterProyectosParams {
  /** Lista cruda de proyectos que RLS ya acotó por empresa. */
  proyectos: Proyecto[]
  /** Auth user id; ausente → no se filtra (espeja el guard `!uid` del original). */
  userId?: string
  /** Rol de plataforma del usuario actual. */
  role?: string
  /** Ids de roles RBAC asignados (para detectar roles de condominios restringidos). */
  assignedRoleIds?: string[]
  /**
   * project_ids de `user_project_assignments`. `undefined`/`null` mientras la
   * query carga o ante un error → fail-closed (ningún proyecto) para usuarios
   * restringidos.
   */
  assignments?: string[] | null
}

/**
 * Acota la lista de proyectos a los que el usuario puede ver, replicando el
 * `filterDataByAssignment` que vivía en useData:
 *  - sin identidad resuelta (`!userId` o `!role`) → no filtra (lista cruda);
 *  - rol exento → ve todos los proyectos de la empresa (ojo: un `admin` deja de
 *    ser exento en cuanto tiene asignaciones explícitas — ver isProjectExempt);
 *  - resto → solo los proyectos asignados. Fail-closed: assignments null/vacío
 *    (cargando o error) restringe a ninguno en vez de caer a la lista completa.
 *    RLS sobre `projects` es la defensa autoritativa; esto mantiene el cliente
 *    consistente con ella.
 */
export function filterProyectosByAssignment({
  proyectos,
  userId,
  role,
  assignedRoleIds,
  assignments,
}: FilterProyectosParams): Proyecto[] {
  if (!userId || !role) return proyectos
  if (isProjectExempt(role, assignedRoleIds, assignments)) return proyectos
  const allowed = new Set(assignments ?? [])
  return proyectos.filter((p) => allowed.has(p.id))
}

function maxUnidadesFrom(p: Proyecto): MaxUnidadesPorTipo {
  return {
    apartamento:     p.max_unidades_apartamento ?? null,
    casa:            p.max_unidades_casa ?? null,
    bodega:          p.max_unidades_bodega ?? null,
    local_comercial: p.max_unidades_local_comercial ?? null,
    oficina:         p.max_unidades_oficina ?? null,
    parqueadero:     p.max_unidades_parqueadero ?? null,
    otro:            p.max_unidades_otro ?? null,
  }
}

export interface ProyectoConfig {
  moneda: string
  maxUnidadesPorTipo: MaxUnidadesPorTipo | null
}

/**
 * Deriva la `moneda` y los `maxUnidadesPorTipo` a partir del PRIMER proyecto
 * accesible (orden por nombre), con fallback al primer proyecto crudo.
 *
 * Espeja la derivación escalonada de useData: `applyResults` partía del primer
 * proyecto crudo y `filterDataByAssignment` re-derivaba desde el primer
 * proyecto filtrado, conservando los valores crudos como fallback cuando la
 * lista accesible queda vacía (usuario sin proyectos asignados). La forma
 * compacta de aquí es equivalente caso por caso.
 */
export function deriveProyectoConfig(
  proyectosAccesibles: Proyecto[],
  proyectosRaw: Proyecto[] = proyectosAccesibles,
): ProyectoConfig {
  const base = proyectosAccesibles[0] ?? proyectosRaw[0]
  return {
    moneda: proyectosAccesibles[0]?.moneda ?? proyectosRaw[0]?.moneda ?? 'Q',
    maxUnidadesPorTipo: base ? maxUnidadesFrom(base) : null,
  }
}
