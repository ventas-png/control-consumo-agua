// domain/shared/mutations.ts — Escrituras para componentes compartidos. T7/PR3.
import { supabase } from '../../lib/supabase'
import { extractFunctionError } from '../functionError'

/** Cuerpo para abrir el Stripe Checkout (plat:P36d). */
export interface CheckoutSessionBody {
  plan_code: string
  billing_cycle: string
  return_path: string
}

/**
 * Invoca el edge `create-checkout-session`. Dos caminos posibles:
 *  - Alta/primera suscripción → devuelve `url` de Stripe Checkout (redirigir).
 *  - Cambio de plan de una company que YA tiene suscripción activa (P0 #1) → el
 *    edge cambia el plan in-place (sin doble cobro) y devuelve `swapped: true`
 *    sin URL; el front muestra éxito y recarga la suscripción, no redirige.
 * `{ url: null, swapped: false, error }` si falla.
 */
export async function createCheckoutSession(
  body: CheckoutSessionBody,
): Promise<{ url: string | null; swapped: boolean; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('create-checkout-session', { body })
  if (error) return { url: null, swapped: false, error: await extractFunctionError(error) }
  const d = data as { url?: string; swapped?: boolean } | null
  return { url: d?.url ?? null, swapped: d?.swapped === true, error: null }
}

/**
 * Invoca el edge `create-billing-portal-session` (Stripe Billing Portal) y
 * devuelve la URL a la que redirigir. `{ url: null, error }` si falla o no hay URL.
 */
export async function createBillingPortalSession(): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('create-billing-portal-session', { body: {} })
  if (error) return { url: null, error: await extractFunctionError(error) }
  const url = (data as { url?: string } | null)?.url ?? null
  return { url, error: null }
}
