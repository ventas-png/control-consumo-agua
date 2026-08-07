// Lógica pura de create-payment-intent, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5). Sin Deno, supabase-js ni
// stripe → corre directo en vitest. El handler (index.ts) importa estos símbolos:
// el comportamiento no cambia, solo se mueve la definición a un archivo importable.

// Supported currencies for Stripe
export const STRIPE_SUPPORTED_CURRENCIES = new Set([
  'usd', 'eur', 'gbp', 'jpy', 'aud', 'cad', 'chf', 'cny', 'inr', 'mxn',
  'nzd', 'sgd', 'hkd', 'nok', 'sek', 'dkk', 'pln', 'czk', 'huf', 'ron',
  'bgn', 'hrk', 'rub', 'try', 'brl', 'ars', 'clp', 'cop', 'pen', 'uyu',
  'idr', 'myr', 'php', 'thb', 'vnd', 'zar', 'kes', 'egp', 'aed', 'qar'
])

/** Cuerpo esperado por el handler (todos requeridos; monto > 0). */
export interface PaymentIntentRequest {
  cliente_id: string
  registro_id: string
  company_id: string
  monto: number
}

/**
 * `true` si el request trae todos los parámetros y un monto > 0. Espeja EXACTO
 * la condición del handler (`!x || monto <= 0`): strings vacíos, monto 0,
 * negativo o NaN → inválido.
 */
export function esRequestValido(body: Partial<PaymentIntentRequest>): boolean {
  const { cliente_id, registro_id, company_id, monto } = body
  return !(!cliente_id || !registro_id || !company_id || !monto || monto <= 0)
}

/**
 * Moneda efectiva del cobro: la default de la empresa si Stripe la soporta
 * (normalizada a minúsculas), si no fallback a 'usd'. Igual que el handler.
 */
export function resolveCurrency(defaultCurrency: string | null | undefined): string {
  return (defaultCurrency && STRIPE_SUPPORTED_CURRENCIES.has(defaultCurrency.toLowerCase()))
    ? defaultCurrency.toLowerCase()
    : 'usd'
}

/** Monto en unidades mayores → centavos para Stripe (redondeo, no truncado). */
export function montoACentavos(monto: number): number {
  return Math.round(monto * 100) // Convert to cents
}

/**
 * Parámetros del PaymentIntent de Stripe: monto en centavos, moneda ya resuelta,
 * metadata de trazabilidad multi-tenant (cliente/registro/company) y descripción
 * con fallback 'Cliente'. Idéntico al objeto inline del handler original.
 */
export function buildPaymentIntentParams(input: {
  cliente_id: string
  registro_id: string
  company_id: string
  /**
   * Lo que se COBRA de verdad: monto + recargo por pago con tarjeta.
   *
   * A propósito NO se llama `monto`. El handler lo calcula con
   * `totalConRecargo()` de _shared/payments/recargo.ts, que es donde vive la
   * aritmética del recargo; aquí solo se transporta. Si esto recibiera el monto
   * base, se le cobraría de menos al cliente y el recargo se perdería en
   * silencio — sin que ningún tipo ni test lo delatara.
   */
  total: number
  currency: string
  clienteNombre?: string | null
  /** Recargo aplicado, o null si no hay. Solo afecta a la descripción. */
  recargo?: number | null
}) {
  const nombre = input.clienteNombre ?? 'Cliente'
  return {
    amount: montoACentavos(input.total), // Convert to cents (monto + recargo)
    currency: input.currency,
    metadata: {
      cliente_id: input.cliente_id,
      registro_id: input.registro_id,
      company_id: input.company_id,
    },
    description: input.recargo != null
      ? `Pago de agua - ${nombre} · incluye recargo por pago con tarjeta ${input.recargo.toFixed(2)} ${input.currency.toUpperCase()}`
      : `Pago de agua - ${nombre}`,
  }
}
