// Lógica pura de process-email-queue, extraída del handler para poder testearla
// en aislamiento (infra:I22 · Track T8/T5). Sin Deno ni supabase-js → corre
// directo en vitest. El handler (index.ts) importa estos símbolos: el
// comportamiento no cambia, solo se mueve la definición a un archivo importable.
//
// El worker es casi puro I/O (pop batch → HTTP a send-email → RPC de resultado);
// lo extraíble son sus tres decisiones: el gate del cron (fail-closed), la
// validación mínima del payload encolado y la ventana de expiración del token.

// isCronAuthorized NO se extrae a propósito: la comparación del CRON_SECRET
// debe ser en TIEMPO CONSTANTE (timingSafeEqualSecret, auditoría 2026-07-28
// PR-11). Un `===` de strings sale en el primer byte distinto, así que su
// duración filtra cuántos bytes acertaste — y este worker reenvía ese mismo
// secreto a send-email como x-internal-retry, la ruta que se salta toda la
// autorización. Se queda en el handler, que es quien puede await la cripto.

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
