// Validación ESTRICTA del body de confirm-charge (B6, auditoría 2026-07-16 S9).
// Patrón I22: módulo puro sin APIs de Deno — testeable bajo vitest.

export interface ConfirmChargeBody {
  payment_request_id: string
}

export type ValidacionBody<T> =
  | { ok: true; body: T }
  | { ok: false; error: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** payment_request_id es obligatorio y debe ser UUID. */
export function validarConfirmChargeBody(raw: unknown): ValidacionBody<ConfirmChargeBody> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'body inválido (se espera objeto JSON)' }
  }
  const id = (raw as Record<string, unknown>).payment_request_id
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    return { ok: false, error: 'payment_request_id inválido (se espera UUID)' }
  }
  return { ok: true, body: { payment_request_id: id } }
}
