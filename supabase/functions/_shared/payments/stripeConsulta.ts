// E8 (20261019000000): consulta de estado de un cobro de Stripe desde el
// servidor (confirm-charge, cron de reconciliación y «Consultar al
// proveedor»). Stripe no pasa por el adapter genérico: su referencia es el
// PaymentIntent (payment_requests.stripe_payment_intent) y la clave secreta
// es la de la empresa (company_payment_secrets).
//
// Sólo un estado FINAL del proveedor decide: succeeded → aprobado,
// canceled → rechazado. Todo lo demás (requires_*, processing) es pendiente:
// no se libera nada por antigüedad.
import type { EstadoCobroProveedor, ResultadoCobro } from './types.ts'

export function estadoDePaymentIntentStripe(status: string | null | undefined): EstadoCobroProveedor {
  if (status === 'succeeded') return 'aprobado'
  if (status === 'canceled') return 'rechazado'
  return 'pendiente'
}

export async function consultarPaymentIntentStripe(
  intentId: string,
  claveSecreta: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResultadoCobro> {
  const res = await fetchImpl(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(intentId)}`, {
    headers: { Authorization: `Bearer ${claveSecreta}` },
  })
  const cuerpo = await res.json().catch(() => null) as { status?: string; error?: { message?: string } } | null
  if (!res.ok) {
    return { ok: false, estado: 'error', referencia: intentId, error: cuerpo?.error?.message ?? `Stripe respondió ${res.status}.` }
  }
  return { ok: true, estado: estadoDePaymentIntentStripe(cuerpo?.status), referencia: intentId, raw: cuerpo }
}
