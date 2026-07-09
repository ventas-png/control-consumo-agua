// Lógica pura de log-security-event, extraída del handler para poder testearla
// en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js → corre
// directo en vitest. El handler (index.ts) importa estos símbolos: el
// comportamiento no cambia, solo se mueve la decisión a un archivo importable.

// Tipos de evento permitidos SIN JWT válido (se disparan antes de completar el
// login). Cualquier otro event_type exige autenticación — whitelist cerrado:
// un cliente anónimo no puede inventar tipos de evento post-auth.
export const PRE_AUTH_EVENTS = new Set([
  'failed_login_attempt',
  'login_error',
  'login_success',
  'password_reset_requested',
])

/** `true` si el evento puede registrarse sin JWT (whitelist pre-auth). */
export function isPreAuthEvent(eventType: string): boolean {
  return PRE_AUTH_EVENTS.has(eventType)
}

/** Lector mínimo de headers (estructural — `Request.headers` lo satisface). */
export interface HeaderReader {
  get(name: string): string | null
}

/**
 * IP real del cliente, en orden de confianza: cf-connecting-ip → primer hop de
 * x-forwarded-for → fly-client-ip → 'unknown'.
 */
export function getClientIP(headers: HeaderReader): string {
  const cf = headers.get('cf-connecting-ip')
  if (cf) return cf
  const xff = headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const fly = headers.get('fly-client-ip')
  if (fly) return fly
  return 'unknown'
}

/**
 * Fila de security_logs. `user_id` es SIEMPRE el del JWT verificado — el
 * builder ni siquiera acepta un user_id del body, así el spoofing de identidad
 * es imposible por construcción. user_agent ausente → '' (no null).
 */
export function buildSecurityLogRow(input: {
  verifiedUserId: string | null
  eventType: string
  details: Record<string, unknown>
  ip: string
  userAgent?: string
  timestamp: string
}): {
  user_id: string | null
  event_type: string
  details: Record<string, unknown>
  ip_address: string
  user_agent: string
  timestamp: string
} {
  return {
    user_id: input.verifiedUserId ?? null,
    event_type: input.eventType,
    details: input.details,
    ip_address: input.ip,
    user_agent: input.userAgent ?? '',
    timestamp: input.timestamp,
  }
}
