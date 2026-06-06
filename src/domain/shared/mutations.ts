// domain/shared/mutations.ts — Escrituras para componentes compartidos. T7/PR3.
import { supabase } from '../../lib/supabase'

/** Cuerpo para abrir el Stripe Checkout (plat:P36d). */
export interface CheckoutSessionBody {
  plan_code: string
  billing_cycle: string
  return_path: string
}

/**
 * Invoca el edge `create-checkout-session` (crea la sesión de Stripe Checkout) y
 * devuelve la URL a la que redirigir. `{ url: null, error }` si falla o no hay URL.
 */
export async function createCheckoutSession(
  body: CheckoutSessionBody,
): Promise<{ url: string | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke('create-checkout-session', { body })
  if (error) return { url: null, error: error.message }
  const url = (data as { url?: string } | null)?.url ?? null
  return { url, error: null }
}
