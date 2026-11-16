import type { SectionGroup } from './condominiosRoles'
import { RENTAS_ACTIONS, RENTAS_DATA_MODULE_KEYS, rentasPermissionKey } from './moduleConfig'

// Grupos de permisos de Manejo de Rentas para la matriz de roles. Un grupo por
// módulo; cada uno expone las 4 acciones que existen en el catálogo
// (rentas.<módulo>.view / create / edit / delete — migración 20261125000000).
const ETIQUETAS: Record<(typeof RENTAS_DATA_MODULE_KEYS)[number], string> = {
  rentas_propiedades: 'Rentas: Propiedades',
  rentas_reservas: 'Rentas: Reservas',
  rentas_contratos: 'Rentas: Contratos',
  rentas_inventario: 'Rentas: Inventario',
}

export const RENTAS_MODULE_GROUPS: SectionGroup[] = RENTAS_DATA_MODULE_KEYS.map(modulo => ({
  key: modulo,
  label: ETIQUETAS[modulo],
  tabs: RENTAS_ACTIONS.map(a => rentasPermissionKey(modulo, a)),
}))

/**
 * Sólo los grupos cuyas llaves ya existen en el catálogo cargado: si la
 * migración que las siembra aún no se aplicó, la matriz no ofrece casillas
 * que la base rechazaría (mismo criterio que «Compras y pagos»).
 */
export function gruposRentasDisponibles(catalogo: ReadonlyMap<string, unknown>): SectionGroup[] {
  return RENTAS_MODULE_GROUPS.flatMap(g => {
    const tabs = g.tabs.filter(llave => catalogo.has(llave))
    return tabs.length > 0 ? [{ ...g, tabs }] : []
  })
}
