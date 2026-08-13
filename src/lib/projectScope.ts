// Primitivas compartidas del alcance por proyecto.
//
// **Por qué existe**: casi todas las tablas del tenant se acotan por EMPRESA
// (RLS + `.eq('company_id', …)`), no por proyecto. Un usuario asignado a UN
// proyecto de una empresa con varios veía, por tanto, los datos de todos. El
// cierre se hace filtrando en el cliente contra los proyectos que el usuario sí
// puede ver (`proyectos` ya llega acotado por `filterProyectosByAssignment`),
// con la RLS como defensa autoritativa detrás.
//
// Estas piezas nacieron en `lib/comunicacionAccess.ts` (rutas + comunicación) y
// se extrajeron aquí cuando el módulo de agua necesitó exactamente las mismas:
// el índice cliente→proyectos, el `ProjectScope` y los filtros de unidades y
// clientes son idénticos en los tres sitios. `comunicacionAccess` las re-exporta
// para no tocar a sus consumidores.
//
// Los `clientes` no llevan `project_id` propio: su proyecto se deriva de las
// unidades que ocupan y de las lecturas registradas a su nombre. Por eso el
// índice cliente→proyectos es la pieza central.
//
// Regla de ambigüedad (consistente en todo el código de alcance): cuando una
// fila NO se puede mapear a ningún proyecto se CONSERVA. Ocultar por falta de
// datos escondería trabajo legítimo del propio usuario; lo que sí se puede
// mapear a un proyecto ajeno se oculta siempre.
import type { Cliente, Registro, Unidad } from '../types'

/** cliente_id → proyectos en los que ese cliente tiene presencia. */
export type ClienteProjectIndex = Map<string, Set<string>>

export interface BuildClienteProjectIndexParams {
  /** Unidades de la empresa (`unidades.cliente_id` → `unidades.project_id`). */
  unidades: Unidad[]
  /** Lecturas de la empresa; aportan el proyecto de clientes sin unidad propia. */
  registros?: Registro[]
}

/**
 * Construye el índice cliente→proyectos a partir de unidades y lecturas.
 *
 * OJO: debe alimentarse con las listas CRUDAS (las que devuelve la query, antes
 * de filtrar por proyecto). Si se construye con datos ya filtrados, un cliente
 * de otro proyecto se vuelve "no resoluble" y la regla de ambigüedad lo
 * conservaría — justo lo que el filtro pretende evitar.
 */
export function buildClienteProjectIndex({
  unidades,
  registros = [],
}: BuildClienteProjectIndexParams): ClienteProjectIndex {
  const index: ClienteProjectIndex = new Map()
  const link = (clienteId?: string | null, projectId?: string | null) => {
    if (!clienteId || !projectId) return
    let set = index.get(clienteId)
    if (!set) { set = new Set(); index.set(clienteId, set) }
    set.add(projectId)
  }
  for (const u of unidades) link(u.cliente_id, u.project_id)
  for (const r of registros) link(r.cliente_id, r.project_id)
  return index
}

/** Contexto de acceso del usuario actual, compartido por todos los filtros. */
export interface ProjectScope {
  /** Proyectos que el usuario puede ver (ya filtrados por asignación). */
  accessibleProjectIds: Set<string>
  /**
   * `true` si el rol salta el filtrado por proyecto (ver `isProjectExempt`):
   * super_admin / company_owner, y `admin` mientras no tenga una asignación
   * explícita de proyecto.
   */
  exempt: boolean
  /** Índice cliente→proyectos (de `buildClienteProjectIndex`). */
  clienteProjects: ClienteProjectIndex
}

/** ¿Alguno de estos ids está entre los proyectos accesibles? */
export function intersects(ids: Iterable<string>, accessible: Set<string>): boolean {
  for (const id of ids) if (accessible.has(id)) return true
  return false
}

/**
 * Proyectos de un cliente según el índice. `null` = no resolvible (el cliente no
 * tiene unidad ni lectura visible) — caso ambiguo, no "sin acceso".
 */
export function clienteProjectIds(clienteId: string | null | undefined, index: ClienteProjectIndex): Set<string> | null {
  if (!clienteId) return null
  const set = index.get(clienteId)
  return set && set.size > 0 ? set : null
}

/** Unidades de los proyectos accesibles. `project_id` es NOT NULL: filtro exacto. */
export function filterUnidadesByProjectAccess(unidades: Unidad[], scope: ProjectScope): Unidad[] {
  if (scope.exempt) return unidades
  return unidades.filter(u => scope.accessibleProjectIds.has(u.project_id))
}

/**
 * Clientes alcanzables desde los proyectos accesibles. Los clientes que no se
 * pueden mapear (aún sin unidad ni lectura) se conservan: son el alta reciente
 * que todavía no opera en ningún proyecto, y ocultarlos rompería darlos de alta,
 * escribirles un comunicado o abrirles una conversación.
 */
export function filterClientesByProjectAccess(clientes: Cliente[], scope: ProjectScope): Cliente[] {
  if (scope.exempt) return clientes
  return clientes.filter(c => {
    const projects = clienteProjectIds(c.id, scope.clienteProjects)
    if (!projects) return true
    return intersects(projects, scope.accessibleProjectIds)
  })
}
