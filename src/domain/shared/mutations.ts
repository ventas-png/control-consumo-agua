// domain/shared/mutations.ts — Escrituras para componentes compartidos. T7/PR3.
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'

/**
 * Extrae el mensaje de error real que devolvió la edge function. El SDK
 * responde "Edge Function returned a non-2xx status code" para cualquier
 * fallo HTTP; el body `{ error }` con la causa (p.ej. "Stripe no
 * configurado…") solo está disponible en `error.context`.
 */
async function extractFunctionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: string } | null
      if (body?.error) return body.error
    } catch {
      // body no-JSON o ya consumido: cae al mensaje genérico
    }
  }
  const msg = (error as { message?: unknown } | null)?.message
  return typeof msg === 'string' ? msg : String(error)
}

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
  if (error) return { url: null, error: await extractFunctionError(error) }
  const url = (data as { url?: string } | null)?.url ?? null
  return { url, error: null }
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
