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

/** Estado de suspensión de la propia empresa (banner COMPANY_SUSPENDED). */
export interface CompanySuspension {
  activa: boolean
  suspended_reason: string | null
}

/**
 * Flags de suspensión del tenant del usuario (la RLS companies_select permite
 * leer la propia empresa). `null` si la fila no es visible/no existe.
 */
export async function fetchCompanySuspension(companyId: string): Promise<CompanySuspension | null> {
  const { data } = await supabase
    .from('companies')
    .select('activa, suspended_reason')
    .eq('id', companyId)
    .maybeSingle()
  return (data as CompanySuspension) ?? null
}
