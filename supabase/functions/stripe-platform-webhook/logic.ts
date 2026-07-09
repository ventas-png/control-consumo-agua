// Lógica pura de stripe-platform-webhook, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5, issue #321). Sin Deno ni
// supabase-js ni stripe → corre directo en vitest. El handler (index.ts) importa
// estos símbolos: el comportamiento no cambia, solo se mueve la definición a un
// archivo importable desde los tests.
//
// Aquí vive SOLO la parte de decisión: mapeos de status, construcción de rows
// (subscription/invoice) a partir de objetos Stripe-like, y qué campos entran
// al update de companies en customer.updated. Las queries, la verificación de
// firma HMAC y la idempotencia por INSERT se quedan en index.ts.

// ---------------------------------------------------------------------------
// Tipos estructurales mínimos (mismo enfoque que _shared/billingSync.ts): NO
// importamos stripe; declaramos solo los campos que el webhook realmente lee.
// Stripe.Subscription / Stripe.Invoice reales son asignables a estos tipos.
// ---------------------------------------------------------------------------

/** Subconjunto de Stripe.Subscription que usa el webhook. */
export interface StripeSubscriptionLike {
  id: string
  status: string
  metadata?: Record<string, string> | null
  // Epochs en segundos (convención Stripe); null/0/ausente activa fallbacks.
  current_period_start?: number | null
  current_period_end?: number | null
  trial_end?: number | null
  canceled_at?: number | null
  cancel_at_period_end?: boolean | null
  // Stripe expande customer a objeto según el evento; aceptamos ambas formas.
  customer: string | { id: string }
}

/** Subconjunto de Stripe.Invoice que usa el webhook. */
export interface StripeInvoiceLike {
  id: string
  currency: string
  amount_paid: number
  amount_due: number
  subtotal?: number | null
  status?: string | null
  total_tax_amounts?: Array<{ amount?: number | null }> | null
  customer_tax_ids?: Array<{ type: string; value: string | null }> | null
  customer_address?: { country?: string | null } | null
  period_start?: number | null
  period_end?: number | null
  due_date?: number | null
  status_transitions?: { paid_at?: number | null } | null
  invoice_pdf?: string | null
}

/** Subconjunto de Stripe.Address usado por customer.updated. */
export interface StripeAddressLike {
  country?: string | null
  line1?: string | null
  city?: string | null
  state?: string | null
  postal_code?: string | null
}

/** Subconjunto de Stripe.TaxId usado por customer.updated. */
export interface StripeTaxIdLike {
  type: string
  value: string | null
}

// ---------------------------------------------------------------------------
// Mapeos de status
// ---------------------------------------------------------------------------

export function mapStripeStatus(s: string): string {
  // Stripe puede devolver 'paused' o 'trialing' que ya cubrimos. Cualquier
  // status no presente en el CHECK de subscriptions cae a 'incomplete'.
  const valid = ['trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid']
  return valid.includes(s) ? s : 'incomplete'
}

export function mapInvoiceStatus(s: string | null | undefined): string {
  const valid = ['draft', 'open', 'paid', 'void', 'uncollectible']
  return s && valid.includes(s) ? s : 'open'
}

// ---------------------------------------------------------------------------
// Helpers de referencias Stripe e idempotencia
// ---------------------------------------------------------------------------

/**
 * Stripe entrega referencias como string (id) u objeto expandido. Normaliza a
 * id; `undefined` si la referencia viene null/ausente (p. ej. invoice sin
 * subscription → el caller skipea).
 */
export function stripeRefId(ref: string | { id: string } | null | undefined): string | undefined {
  return typeof ref === 'string' ? ref : ref?.id
}

/** Código Postgres de unique_violation — PK duplicada en stripe_webhook_events. */
export const PG_UNIQUE_VIOLATION = '23505'

/**
 * `true` si el error de INSERT es duplicate key: el evento ya fue procesado y
 * el webhook debe responder 200 sin re-aplicar (idempotencia).
 */
export function isUniqueViolation(code: string | null | undefined): boolean {
  return code === PG_UNIQUE_VIOLATION
}

// ---------------------------------------------------------------------------
// Construcción de rows
// ---------------------------------------------------------------------------

/**
 * Row de `subscriptions` a partir de una Stripe.Subscription-like. `companyId`
 * y `planId` llegan ya validados por el handler (metadata + resolución en DB).
 * `nowMs` es inyectable para tests deterministas; los fallbacks son: period_start
 * ausente → now, period_end ausente → now + 30 días.
 */
export function buildSubscriptionRow(
  stripeSub: StripeSubscriptionLike,
  companyId: string,
  planId: string,
  nowMs: number = Date.now(),
) {
  const billingCycle = stripeSub.metadata?.billing_cycle === 'yearly' ? 'yearly' : 'monthly'

  const periodStart = stripeSub.current_period_start
    ? new Date(stripeSub.current_period_start * 1000).toISOString()
    : new Date(nowMs).toISOString()
  const periodEnd = stripeSub.current_period_end
    ? new Date(stripeSub.current_period_end * 1000).toISOString()
    : new Date(nowMs + 30 * 24 * 60 * 60 * 1000).toISOString()
  const trialEnd = stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000).toISOString() : null
  const canceledAt = stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000).toISOString() : null

  return {
    company_id: companyId,
    plan_id: planId,
    status: mapStripeStatus(stripeSub.status),
    billing_cycle: billingCycle,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    trial_end: trialEnd,
    canceled_at: canceledAt,
    cancel_at_period_end: !!stripeSub.cancel_at_period_end,
    stripe_subscription_id: stripeSub.id,
    stripe_customer_id: typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer.id,
  }
}

/**
 * Row de `invoices` a partir de una Stripe.Invoice-like. `subscriptionId` y
 * `companyId` son los de la subscription LOCAL ya resuelta por el handler.
 * Dinero siempre en centavos: amount_paid gana si > 0, si no amount_due (una
 * invoice `open`/`payment_failed` aún no tiene amount_paid).
 */
export function buildInvoiceRow(
  stripeInvoice: StripeInvoiceLike,
  subscriptionId: string,
  companyId: string,
  nowMs: number = Date.now(),
) {
  // F4.3.4: extraer tax desde Stripe Invoice. Cuando automatic_tax esta
  // habilitado, total_tax_amounts contiene el desglose; usamos el total.
  const taxAmount = Array.isArray(stripeInvoice.total_tax_amounts)
    ? stripeInvoice.total_tax_amounts.reduce((s, t) => s + (t.amount ?? 0), 0)
    : 0
  // customer_tax_ids: array de { type, value } del customer al momento del
  // cobro. Snapshot del primero (típicamente solo hay uno).
  const taxIdEntry = Array.isArray(stripeInvoice.customer_tax_ids)
    ? stripeInvoice.customer_tax_ids[0]
    : null
  const countryBilled = stripeInvoice.customer_address?.country ?? null

  return {
    subscription_id: subscriptionId,
    company_id: companyId,
    amount_cents: stripeInvoice.amount_paid > 0 ? stripeInvoice.amount_paid : stripeInvoice.amount_due,
    subtotal_cents: stripeInvoice.subtotal ?? null,
    tax_amount_cents: taxAmount,
    tax_id: taxIdEntry?.value ?? null,
    tax_id_type: taxIdEntry?.type ?? null,
    country_billed: countryBilled,
    currency: stripeInvoice.currency,
    status: mapInvoiceStatus(stripeInvoice.status),
    period_start: stripeInvoice.period_start
      ? new Date(stripeInvoice.period_start * 1000).toISOString()
      : new Date(nowMs).toISOString(),
    period_end: stripeInvoice.period_end
      ? new Date(stripeInvoice.period_end * 1000).toISOString()
      : new Date(nowMs).toISOString(),
    due_date: stripeInvoice.due_date ? new Date(stripeInvoice.due_date * 1000).toISOString() : null,
    paid_at: stripeInvoice.status_transitions?.paid_at
      ? new Date(stripeInvoice.status_transitions.paid_at * 1000).toISOString()
      : null,
    stripe_invoice_id: stripeInvoice.id,
    pdf_url: stripeInvoice.invoice_pdf,
  }
}

/**
 * Update parcial de `companies` para customer.updated (F4.3.4): solo entran los
 * campos de address presentes y el tax_id solo si trae value. Objeto vacío →
 * el handler NO ejecuta el update.
 */
export function buildCustomerUpdate(
  addr: StripeAddressLike | null | undefined,
  taxIdEntry: StripeTaxIdLike | null | undefined,
): Record<string, string | null> {
  const update: Record<string, string | null> = {}
  if (addr?.country) update.country = addr.country
  if (addr?.line1) update.address_line1 = addr.line1
  if (addr?.city) update.address_city = addr.city
  if (addr?.state) update.address_state = addr.state
  if (addr?.postal_code) update.address_postal_code = addr.postal_code
  if (taxIdEntry?.value) {
    update.tax_id = taxIdEntry.value
    update.tax_id_type = taxIdEntry.type
  }
  return update
}
