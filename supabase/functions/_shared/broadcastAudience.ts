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

/** Parte una lista en chunks de tamaño `size` (para batch INSERT / .in()). */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
