// Lógica pura de create-broadcast (validación de entrada + gate de rol),
// extraída del handler para poder testearla en aislamiento (infra:I22 · Track
// T8/T5). Sin Deno ni supabase-js → corre directo en vitest. El handler
// (index.ts) importa estos símbolos: el comportamiento no cambia, solo se mueve
// la definición a un archivo importable desde los tests. La resolución de
// audiencia vive en _shared/broadcastAudience.ts (pura, con sus propios tests).

import type { BroadcastTargetType } from '../_shared/broadcastAudience.ts'

export const VALID_TARGETS: BroadcastTargetType[] = ['todos', 'proyecto', 'unidades', 'clientes']

// Roles que pueden enviar comunicados (espejo del `allowed` del handler).
// NUNCA operator/viewer/collector: un comunicado abanica a cientos de clientes.
export const BROADCAST_SENDER_ROLES = ['super_admin', 'superadmin', 'company_owner', 'admin']

/** `true` si el rol puede crear comunicados. */
export function canCreateBroadcast(role: string): boolean {
  return BROADCAST_SENDER_ROLES.includes(role)
}

export interface BroadcastRequestBody {
  title?: string
  body?: string
  target_type?: BroadcastTargetType
  target_ids?: string[]
  send_email?: boolean
}

export type ParsedBroadcastRequest =
  | {
      ok: true
      title: string
      message: string
      targetType: BroadcastTargetType
      targetIds: string[]
      sendEmail: boolean
    }
  | { ok: false; error: string }

/**
 * Normaliza y valida el body del request, replicando exactamente el handler:
 *   - title/body → trim; vacíos (o solo espacios) rechazan con su mensaje.
 *   - target_type debe estar en VALID_TARGETS.
 *   - target_ids: solo se acepta un array real (cualquier otra cosa → []).
 *   - send_email: estrictamente `=== true` (truthy arbitrario NO cuenta).
 * El orden de los rechazos (título → mensaje → audiencia) se preserva.
 */
export function parseBroadcastRequest(body: BroadcastRequestBody): ParsedBroadcastRequest {
  const title = (body.title ?? '').trim()
  const message = (body.body ?? '').trim()
  const targetType = body.target_type as BroadcastTargetType
  const targetIds = Array.isArray(body.target_ids) ? body.target_ids : []
  const sendEmail = body.send_email === true

  if (!title) return { ok: false, error: 'El título es obligatorio.' }
  if (!message) return { ok: false, error: 'El mensaje es obligatorio.' }
  if (!VALID_TARGETS.includes(targetType)) {
    return { ok: false, error: 'Tipo de audiencia inválido.' }
  }

  return { ok: true, title, message, targetType, targetIds, sendEmail }
}
