// _shared/notificationPrefs.ts — decisión PURA de supresión por preferencia de canal.
//
// **Por qué**: el orquestador (notifications_outbox + notifications-dispatcher,
// #378) despacha por canal pero NO consultaba la preferencia del destinatario:
// si un productor encolaba un email, salía aunque el usuario hubiera desactivado
// ese canal en notification_preferences (com:N9/N10). El follow-up de la Sesión A
// es que el dispatcher RESPETE esas preferencias antes de despachar cada fila.
//
// El dispatcher (service_role) consulta el helper SQL `notification_channel_enabled
// (user_id, channel)` (modelo opt-out: ausencia de fila = habilitado). Para eso
// necesita el user_id del destinatario. Esta es la parte PURA: a partir de la fila
// del outbox (canal + payload) decide qué user_id usar para el chequeo, sin I/O —
// igual que se espeja `calcularMora` para el cron (frontera Deno/Vite: nada de src/).
//
// Reglas:
//   - 'in_app' NUNCA se suprime (la campana siempre recibe) → devuelve null para
//     que el dispatcher salte el chequeo. Es el contrato del modelo opt-out.
//   - Para email/whatsapp/push el `recipient` del outbox es un email/teléfono/token,
//     NO un user_id; el productor declara el usuario destino en `payload.user_id`.
//     Si no hay un user_id válido (p.ej. difusión a `clientes` que no son usuarios
//     de plataforma), devuelve null → no se suprime (default sano: opt-out).
//
// Nota: NO importa nada (función pura) → importable desde Deno y desde vitest.

/** Razón canónica de supresión cuando el usuario desactivó el canal. */
export const SUPPRESSION_REASON_CHANNEL_DISABLED = 'channel_disabled'

/** Canales que el usuario puede desactivar. 'in_app' queda EXCLUIDO a propósito. */
export type SuppressibleChannel = 'email' | 'whatsapp' | 'push'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `true` si `v` es un UUID canónico (formato 8-4-4-4-12). */
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/** `true` si el canal admite supresión por preferencia (todo menos 'in_app'). */
export function isSuppressibleChannel(channel: string): channel is SuppressibleChannel {
  return channel === 'email' || channel === 'whatsapp' || channel === 'push'
}

export interface PreferenceUserIdArgs {
  channel: string
  /** Payload del outbox; el productor declara el usuario destino en `user_id`. */
  payload: Record<string, unknown> | null | undefined
}

/**
 * Devuelve el user_id contra el que el dispatcher debe chequear la preferencia de
 * canal, o `null` si NO debe chequear (→ no suprimir):
 *   - 'in_app' → null (nunca se suprime; la campana siempre recibe).
 *   - resto → `payload.user_id` si es un UUID válido; null si no.
 *
 * Mantener PURA: la consulta a `notification_channel_enabled` y el marcado la hace
 * el dispatcher (I/O).
 */
export function resolvePreferenceUserId(args: PreferenceUserIdArgs): string | null {
  if (!isSuppressibleChannel(args.channel)) return null
  const uid = args.payload?.user_id
  return isUuid(uid) ? uid : null
}
