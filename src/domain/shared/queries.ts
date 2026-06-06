// domain/shared/queries.ts — Lecturas para componentes compartidos
// transversales (banner de trial, etc.). T7/PR3.
import { supabase } from '../../lib/supabase'

/** Suscripción "vigente" (status no terminal) de una empresa. */
export interface ActiveSubscription {
  status: string
  trial_end: string | null
}

/**
 * Suscripción vigente del tenant (status en trialing/active/past_due/incomplete),
 * para el banner de expiración de trial. `null` si no hay ninguna.
 */
export async function fetchActiveSubscription(companyId: string): Promise<ActiveSubscription | null> {
  const { data } = await supabase
    .from('subscriptions')
    .select('status, trial_end')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'incomplete'])
    .maybeSingle()
  return (data as ActiveSubscription) ?? null
}
