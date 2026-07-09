// Lógica pura de process-email-queue, extraída del handler para poder testearla
// en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js → corre
// directo en vitest. El handler (index.ts) importa estos símbolos: el
// comportamiento no cambia, solo se mueve la definición a un archivo importable.
//
// El worker es casi puro I/O (pop batch → HTTP a send-email → RPC de resultado);
// lo extraíble son sus tres decisiones: el gate del cron (fail-closed), la
// validación mínima del payload encolado y la ventana de expiración del token.

/**
 * Gate de auth del worker: solo el cron (con CRON_SECRET) puede invocar.
 * FAIL-CLOSED: si CRON_SECRET no está configurado (cadena vacía) NADIE queda
 * autorizado — ni siquiera un caller que mande el header vacío. Espejo exacto
 * de `!CRON_SECRET || auth !== CRON_SECRET` del handler.
 */
export function isCronAuthorized(headerSecret: string | null, cronSecret: string): boolean {
  return Boolean(cronSecret) && headerSecret === cronSecret
}

/**
 * Validación mínima del payload encolado antes de intentar el envío. Mismo
 * mensaje que el handler (se persiste vía update_email_attempt).
 */
export function validateQueuePayload(
  payload: { template_key?: string; to_email?: string },
): { ok: true } | { ok: false; error: string } {
  if (!payload.template_key || !payload.to_email) {
    return { ok: false, error: 'payload invalido (template_key/to_email)' }
  }
  return { ok: true }
}

// Ventana de refresh: el token se considera expirado si le quedan < 5 min de
// vida. `nowMs` inyectable para test determinista. Sin expiry → no expirado.
export const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000

export function isTokenExpired(tokenExpiry: string | null, nowMs: number = Date.now()): boolean {
  return tokenExpiry != null &&
    new Date(tokenExpiry).getTime() - nowMs < TOKEN_REFRESH_WINDOW_MS
}
