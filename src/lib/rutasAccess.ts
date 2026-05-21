import type { Ruta, Contador, Unidad, Registro } from '../types'

interface FilterRutasParams {
  rutas: Ruta[]
  contadores: Contador[]
  unidades: Unidad[]
  registros: Registro[]
  /** Project ids the current user is allowed to see. */
  accessibleProjectIds: Set<string>
  /** Auth user id of the current user (their own assigned routes are kept). */
  userId: string
}

// Routes (`rutas`) carry no project_id — a route just references clientes /
// contadores / unidades, each of which belongs to a project. RLS only scopes
// rutas by company, so a user assigned to a subset of the company's projects
// would otherwise see routes belonging to projects they cannot access. This
// keeps only the routes whose items live in the user's accessible projects.
export function filterRutasByProjectAccess({
  rutas,
  contadores,
  unidades,
  registros,
  accessibleProjectIds,
  userId,
}: FilterRutasParams): Ruta[] {
  const contadorProject = new Map<string, string>(contadores.map(c => [c.id, c.project_id]))
  const unidadProject = new Map<string, string>(unidades.map(u => [u.id, u.project_id]))

  // Clientes have no project_id; derive their project(s) from the units they
  // own and the readings recorded against them.
  const clienteProjects = new Map<string, Set<string>>()
  const linkCliente = (clienteId?: string | null, projectId?: string | null) => {
    if (!clienteId || !projectId) return
    let set = clienteProjects.get(clienteId)
    if (!set) { set = new Set(); clienteProjects.set(clienteId, set) }
    set.add(projectId)
  }
  for (const u of unidades) linkCliente(u.cliente_id, u.project_id)
  for (const r of registros) linkCliente(r.cliente_id, r.project_id)

  const itemsInAccessibleProject = (ids: string[], projectOf: Map<string, string>): boolean =>
    ids.some(id => {
      const pid = projectOf.get(id)
      return !!pid && accessibleProjectIds.has(pid)
    })

  return rutas.filter(ruta => {
    // Always keep routes assigned to the current user (mirrors the rutas RLS
    // policy, which exposes a user's own assigned routes regardless of project).
    if (ruta.asignado_a && ruta.asignado_a === userId) return true

    const tipo = ruta.tipo_ruta ?? 'clientes'
    if (tipo === 'contadores') return itemsInAccessibleProject(ruta.contador_ids ?? [], contadorProject)
    if (tipo === 'unidades') return itemsInAccessibleProject(ruta.unidad_ids ?? [], unidadProject)

    // Cliente routes: hide only when every resolvable cliente belongs to a
    // project outside the user's access. Fully unresolved clientes (no owned
    // unit and no visible readings) are ambiguous and kept, so a legitimate
    // route is never hidden just because its data could not be mapped here.
    let anyAccessible = false
    let anyInaccessible = false
    for (const id of ruta.cliente_ids ?? []) {
      const set = clienteProjects.get(id)
      if (!set) continue
      for (const pid of set) {
        if (accessibleProjectIds.has(pid)) anyAccessible = true
        else anyInaccessible = true
      }
    }
    if (anyAccessible) return true
    return !anyInaccessible
  })
}
