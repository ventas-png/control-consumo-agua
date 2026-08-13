// Scope por proyecto del módulo Agua (contadores, unidades, lecturas, tarifas y
// clientes).
//
// **Por qué existe**: las colecciones del módulo se piden por EMPRESA
// (`useContadoresQuery`, `useUnidadesQuery`, `useRegistrosQuery`,
// `useTarifasQuery`, `useClientesQuery` → `.eq('company_id', …)`), y solo
// `proyectos` y `rutas` se acotaban después por asignación de proyecto. Un
// usuario asignado a UN condominio veía, por tanto, los medidores, las unidades,
// el histórico de lecturas, los cobros y el dashboard de TODA la empresa: el
// mismo agujero que ya se cerró en rutas (`lib/rutasAccess`) y en el Centro de
// Comunicación (`lib/comunicacionAccess`). Este módulo lo cierra para el resto
// del módulo de agua, con la RLS (migración 20260815000000) como defensa
// autoritativa detrás.
//
// Las piezas comunes (índice cliente→proyectos, `ProjectScope`, filtros de
// unidades y clientes) viven en `lib/projectScope.ts`.
import type { Contador, Registro, Tarifa } from '../types'
import { clienteProjectIds, intersects, type ProjectScope } from './projectScope'

/**
 * Contadores de los proyectos accesibles. `contadores.project_id` es NOT NULL,
 * así que el filtro es exacto: no hay caso ambiguo que conservar.
 */
export function filterContadoresByProjectAccess(contadores: Contador[], scope: ProjectScope): Contador[] {
  if (scope.exempt) return contadores
  return contadores.filter(c => scope.accessibleProjectIds.has(c.project_id))
}

/**
 * Tarifas de los proyectos accesibles. `tarifas.project_id` es NOT NULL (una
 * tarifa se define siempre dentro de un proyecto), así que también es exacto.
 */
export function filterTarifasByProjectAccess(tarifas: Tarifa[], scope: ProjectScope): Tarifa[] {
  if (scope.exempt) return tarifas
  return tarifas.filter(t => scope.accessibleProjectIds.has(t.project_id))
}

export interface FilterRegistrosParams {
  registros: Registro[]
  /** Contadores CRUDOS de la empresa: resuelven el proyecto de lecturas sin sellar. */
  contadores: Contador[]
  scope: ProjectScope
}

/**
 * Lecturas de los proyectos accesibles.
 *
 * `registros.project_id` es NULLABLE (las lecturas anteriores al sellado no lo
 * llevan), así que se resuelve en cascada:
 *   1. `project_id` sellado → caso exacto;
 *   2. el proyecto del contador de la lectura (`contadores.project_id`);
 *   3. el proyecto del cliente (índice unidades+lecturas del `scope`);
 *   4. irresoluble → se CONSERVA (regla de ambigüedad del resto del código de
 *      alcance): es una lectura vieja sin proyecto, sin contador y de un cliente
 *      que no ocupa ninguna unidad, y esconderla borraría histórico propio del
 *      usuario sin poder afirmar que sea de otro proyecto.
 */
export function filterRegistrosByProjectAccess({
  registros,
  contadores,
  scope,
}: FilterRegistrosParams): Registro[] {
  if (scope.exempt) return registros
  const contadorProject = new Map<string, string>(contadores.map(c => [c.id, c.project_id]))

  return registros.filter(r => {
    if (r.project_id) return scope.accessibleProjectIds.has(r.project_id)

    const desdeContador = r.contador_id ? contadorProject.get(r.contador_id) : undefined
    if (desdeContador) return scope.accessibleProjectIds.has(desdeContador)

    const projects = clienteProjectIds(r.cliente_id, scope.clienteProjects)
    if (!projects) return true // ambiguo → se conserva
    return intersects(projects, scope.accessibleProjectIds)
  })
}
