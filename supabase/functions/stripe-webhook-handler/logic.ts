// Lógica pura de stripe-webhook-handler, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5). Sin Deno, supabase-js ni
// stripe → corre directo en vitest. El handler (index.ts) importa estos símbolos:
// el comportamiento no cambia, solo se mueve la definición a un archivo importable.

// Fila de payment_requests que el webhook necesita para armar el pago. Tipo
// estructural mínimo (el handler hace select('*'); aquí declaramos solo lo usado),
// mismo estilo que billingSync.ts para no importar supabase-js.
export interface PaymentRequestRow {
  id: string
  registro_id: string | null
  cliente_id: string
  company_id: string
  monto: number
}

/**
 * Construye la fila de `pagos` que se inserta cuando Stripe confirma un
 * payment_intent.succeeded. Nace AUTO-VERIFICADA (estado y verification_status
 * 'verificado', verified_by 'stripe_webhook') porque la autenticidad ya quedó
 * probada por la firma del webhook — no hay revisión manual. `nowIso` es
 * inyectable para que el test sea determinista; el default es "ahora", igual que
 * el `new Date().toISOString()` inline del handler original.
 */
export function buildPagoRow(
  paymentRequest: PaymentRequestRow,
  paymentIntentId: string,
  nowIso: string = new Date().toISOString(),
) {
  return {
    registro_id: paymentRequest.registro_id,
    cliente_id: paymentRequest.cliente_id,
    project_id: null,
    monto: paymentRequest.monto,
    metodo: 'tarjeta_credito', // Stripe is credit card
    tipo_aplicacion: 'pago_total',
    verification_status: 'verificado',
    estado: 'verificado',
    stripe_payment_intent_id: paymentIntentId,
    comprobante_url: null,
    comprobante_tipo: null,
    verified_at: nowIso,
    verified_by: 'stripe_webhook',
    notas: `Pago automático de Stripe - ${paymentIntentId}`,
    created_by: null,
  }
}
