// Scope por proyecto del Centro de Comunicación (conversaciones + difusión).
//
// **Por qué existe**: `conversations` y `broadcasts` solo llevan `company_id`, y
// su RLS acota por empresa (y, para agentes, por asignación directa o
// `can_view_all`). Ninguna de las dos mira el proyecto. Resultado: un usuario de
// la empresa asignado a UN proyecto veía las conversaciones de los clientes de
// TODOS los proyectos y todos los comunicados de la empresa — el mismo agujero
// que `filterRutasByProjectAccess` cerró para rutas, que es el patrón que este
// módulo espeja.
//
// Las primitivas comunes (índice cliente→proyectos, `ProjectScope`, filtros de
// unidades y clientes) viven en `lib/projectScope.ts` desde que el módulo de
// agua necesitó las mismas; aquí se re-exportan para no tocar a los
// consumidores, y solo quedan los filtros propios de comunicación.
//
// Regla de ambigüedad (consistente con rutasAccess): cuando una fila NO se puede
// mapear a ningún proyecto (cliente sin unidad ni lectura visible, conversación
// interna heredada sin `project_id`) se CONSERVA. Ocultar por falta de datos
// escondería trabajo legítimo; el cierre fino llega porque las conversaciones
// nuevas sí sellan `project_id` (ver domain/comunicacion/conversations.ts) y la
// migración 20260814000000 rellena las viejas.
import type { Broadcast, Conversation, Unidad } from '../types'
import { clienteProjectIds, intersects, type ProjectScope } from './projectScope'

export {
  buildClienteProjectIndex,
  clienteProjectIds,
  filterClientesByProjectAccess,
  filterUnidadesByProjectAccess,
} from './projectScope'
export type { BuildClienteProjectIndexParams, ClienteProjectIndex, ProjectScope } from './projectScope'

export interface FilterConversationsParams {
  conversations: Conversation[]
  scope: ProjectScope
  /** auth.uid() del usuario actual: sus conversaciones asignadas nunca se ocultan. */
  userId?: string
  /** Ids de conversaciones asignadas al usuario vía `conversation_assignments`. */
  assignedConversationIds?: Set<string>
}

/**
 * Acota las conversaciones a los proyectos que el usuario puede ver.
 *
 * Orden de decisión por conversación:
 *  1. rol exento → pasa todo (ve la empresa completa, como en el resto de la app);
 *  2. asignada al usuario (columna `assigned_to` o `conversation_assignments`) →
 *     se conserva SIEMPRE; espeja la RLS de agentes, que expone la conversación
 *     asignada aunque el agente no tenga otro acceso;
 *  3. `project_id` sellado → se exige acceso a ese proyecto (caso exacto);
 *  4. conversación de cliente sin `project_id` → se deriva del cliente; si el
 *     cliente se resuelve, se exige intersección con los proyectos accesibles;
 *  5. no resolvible (cliente sin datos, discusión interna heredada) → se conserva.
 */
export function filterConversationsByProjectAccess({
  conversations,
  scope,
  userId,
  assignedConversationIds,
}: FilterConversationsParams): Conversation[] {
  if (scope.exempt) return conversations
  const { accessibleProjectIds, clienteProjects } = scope

  return conversations.filter(conv => {
    if (userId && conv.assigned_to === userId) return true
    if (assignedConversationIds?.has(conv.id)) return true

    if (conv.project_id) return accessibleProjectIds.has(conv.project_id)

    const projects = clienteProjectIds(conv.cliente_id, clienteProjects)
    if (!projects) return true // ambiguo → se conserva
    return intersects(projects, accessibleProjectIds)
  })
}

export interface FilterBroadcastsParams {
  broadcasts: Broadcast[]
  scope: ProjectScope
  /** Unidades de la empresa, para resolver los comunicados dirigidos a unidades. */
  unidades: Unidad[]
}

/**
 * Acota los comunicados de difusión a los proyectos accesibles. `broadcasts` no
 * guarda proyecto: la audiencia se reconstruye desde `target_type`/`target_ids`,
 * la misma resolución que hace la edge `create-broadcast` al abanicar.
 *
 * `todos` se conserva a propósito: ese comunicado se envió a TODOS los clientes
 * de la empresa, incluidos los del proyecto del usuario, así que le concierne.
 */
export function filterBroadcastsByProjectAccess({
  broadcasts,
  scope,
  unidades,
}: FilterBroadcastsParams): Broadcast[] {
  if (scope.exempt) return broadcasts
  const { accessibleProjectIds, clienteProjects } = scope
  const unidadProject = new Map<string, string>(unidades.map(u => [u.id, u.project_id]))

  return broadcasts.filter(b => {
    const targetIds = b.target_ids ?? []
    switch (b.target_type) {
      case 'todos':
        return true
      case 'proyecto':
        return intersects(targetIds, accessibleProjectIds)
      case 'unidades': {
        const projects = targetIds
          .map(id => unidadProject.get(id))
          .filter((pid): pid is string => !!pid)
        if (projects.length === 0) return true // ninguna unidad resuelta → ambiguo
        return intersects(projects, accessibleProjectIds)
      }
      case 'clientes': {
        let resolved = false
        for (const cid of targetIds) {
          const projects = clienteProjectIds(cid, clienteProjects)
          if (!projects) continue
          resolved = true
          if (intersects(projects, accessibleProjectIds)) return true
        }
        return !resolved // ningún cliente resuelto → ambiguo
      }
      default:
        return true
    }
  })
}

/**
 * Proyecto con el que sellar una conversación nueva de cliente. Solo devuelve un
 * id cuando la elección es INEQUÍVOCA (el cliente vive en un único proyecto de
 * los que el usuario puede ver); si el cliente cruza varios proyectos o no se
 * puede resolver, devuelve `null` y la conversación queda sin sellar — el filtro
 * la tratará como ambigua en vez de encerrarla en el proyecto equivocado.
 */
export function resolveConversationProjectId(
  clienteId: string | null | undefined,
  scope: ProjectScope,
): string | null {
  const projects = clienteProjectIds(clienteId, scope.clienteProjects)
  if (!projects) return null
  const candidates = scope.exempt
    ? [...projects]
    : [...projects].filter(p => scope.accessibleProjectIds.has(p))
  return candidates.length === 1 ? candidates[0] : null
}
