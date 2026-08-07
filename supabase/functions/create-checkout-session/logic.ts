// Lógica pura de create-checkout-session, extraída del handler para poder
// testearla en aislamiento (infra:I22 · Track T8/T5, issue #321). Sin Deno ni
// supabase-js ni stripe → corre directo en vitest. El handler (index.ts)
// importa estos símbolos: el comportamiento no cambia, solo se mueve la
// definición a un archivo importable desde los tests.
//
// Aquí vive SOLO la parte de decisión: whitelist de orígenes CORS, gate de rol,
// quantities/line_items iniciales del checkout (dinero directo — F2.14 pricing
// por uso), preservación de trial y sanitización del return_path. Las queries,
// Stripe y la lectura de env se quedan en index.ts (que inyecta los valores).

// Roles que pueden gestionar la suscripción (checkout/portal). NUNCA operadores
// ni viewers: tocar billing es dinero de la company.
export const BILLING_MANAGER_ROLES = ['company_owner', 'admin']

/** `true` si `role` puede iniciar checkout / abrir el billing portal. */
export function canManageBilling(role: string): boolean {
  return BILLING_MANAGER_ROLES.includes(role)
}

/** Desglose de uso que devuelve el RPC calculate_monthly_total_cents. */
export interface UsageCounts {
  extra_projects_count: number
  primary_units_count: number
  extra_units_count: number
}

/** Los 4 stripe_price_id del plan (F2.14 multi-line pricing), ya validados no-null. */
export interface CheckoutPriceIds {
  activation: string
  unit_primary: string
  extra_project: string
  unit_extra: string
}

/**
 * Line items iniciales del Checkout según el uso real actual. Stripe Checkout
 * requiere quantity >= 1 en cada line_item, así que: activation siempre 1,
 * unit_primary mínimo 1, y extra_project/unit_extra SOLO se incluyen si > 0
 * (una línea con quantity 0 rompería la sesión). `usage` puede venir undefined
 * (RPC sin filas) → cuenta mínima.
 */
export function buildCheckoutLineItems(
  usage: UsageCounts | null | undefined,
  prices: CheckoutPriceIds,
): Array<{ price: string; quantity: number }> {
  const qty = {
    activation: 1,
    extra_project: usage?.extra_projects_count ?? 0,
    unit_primary: Math.max(1, usage?.primary_units_count ?? 0),
    unit_extra: usage?.extra_units_count ?? 0,
  }
  const lineItems: Array<{ price: string; quantity: number }> = [
    { price: prices.activation, quantity: qty.activation },
    { price: prices.unit_primary, quantity: qty.unit_primary },
  ]
  if (qty.extra_project > 0) lineItems.push({ price: prices.extra_project, quantity: qty.extra_project })
  if (qty.unit_extra > 0) lineItems.push({ price: prices.unit_extra, quantity: qty.unit_extra })
  return lineItems
}

/**
 * Preservación de trial: si la subscription local tiene trial_end en el futuro,
 * Stripe debe respetarlo (`trial_period_days`). Redondea HACIA ARRIBA (ceil)
 * para no acortar el trial prometido; trial vencido o inexistente → undefined
 * (checkout sin trial). `nowMs` inyectable para tests deterministas.
 */
export function computeTrialPeriodDays(
  existingTrialEnd: string | null | undefined,
  nowMs: number = Date.now(),
): number | undefined {
  let trialPeriodDays: number | undefined
  if (existingTrialEnd) {
    const trialMs = new Date(existingTrialEnd).getTime() - nowMs
    if (trialMs > 0) trialPeriodDays = Math.ceil(trialMs / (24 * 60 * 60 * 1000))
  }
  return trialPeriodDays
}

/**
 * Sanitiza el return_path del payload para las success/cancel URLs: solo se
 * acepta un path relativo (prefijo '/'); cualquier otra cosa (URL absoluta,
 * path sin '/', ausente) cae al default '/perfil'. Evita que el caller inyecte
 * un redirect a un dominio externo vía URL absoluta.
 */
export function resolveReturnPath(returnPath: string | undefined): string {
  return returnPath?.startsWith('/') ? returnPath : '/perfil'
}

/** Datos fiscales/dirección de la company relevantes para el Stripe customer. */
export interface CompanyAddressFields {
  country: string | null
  address_line1: string | null
  address_city: string | null
  address_state: string | null
  address_postal_code: string | null
}

/**
 * Address para stripe.customers.create (F4.3.4): SOLO si la company tiene
 * country (requisito de Stripe Tax para calcular IVA); los demás campos entran
 * únicamente si están presentes. Sin country → undefined (no se manda address).
 */
export function buildCustomerAddress(
  c: CompanyAddressFields | null | undefined,
): { country: string; line1?: string; city?: string; state?: string; postal_code?: string } | undefined {
  if (!c?.country) return undefined
  return {
    country: c.country,
    ...(c.address_line1 ? { line1: c.address_line1 } : {}),
    ...(c.address_city ? { city: c.address_city } : {}),
    ...(c.address_state ? { state: c.address_state } : {}),
    ...(c.address_postal_code ? { postal_code: c.address_postal_code } : {}),
  }
}
