// Clasificador de errores de Gmail/network como retriable vs permanente.
// Compartido entre send-email (decide si enqueue) y process-email-queue (decide
// si reportar failed_permanent inmediatamente sin esperar el cap de attempts).
//
// Retriable: 429 (quota), 5xx (server), network errors (fetch failed).
// Permanente: 400 (bad request), 401/403 (token revoked → user debe re-OAuth),
//             404 (template missing), validation errors.

const RETRIABLE_PATTERNS: RegExp[] = [
  /\b429\b/,                     // Too Many Requests
  /\b5\d{2}\b/,                  // 5xx server errors
  /rateLimit/i,
  /quotaExceeded/i,
  /backendError/i,
  /serviceUnavailable/i,
  /Failed to fetch/i,
  /fetch failed/i,
  /network/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /timeout/i,
]

const PERMANENT_PATTERNS: RegExp[] = [
  /\binvalid_grant\b/i,          // OAuth refresh token revoked
  /\b400\b/,
  /\b401\b/,
  /\b403\b/,
  /\b404\b/,
  /unauthorized/i,
  /forbidden/i,
  /invalid.*token/i,
]

export function isRetriable(errorMessage: string): boolean {
  if (!errorMessage) return false
  // Permanent gana cuando coexiste con patrones genericos.
  for (const p of PERMANENT_PATTERNS) {
    if (p.test(errorMessage)) return false
  }
  for (const p of RETRIABLE_PATTERNS) {
    if (p.test(errorMessage)) return true
  }
  // Default conservador: si no podemos clasificar, retry. Mejor perder algunos
  // recursos en retries que perder un correo.
  return true
}
