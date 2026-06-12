// domain/facturacion/billing.ts — Lecturas de la suscripción SaaS del tenant
// (T7/PR3): suscripción activa + plan, catálogo de planes y el desglose de
// consumo mensual (RPC). Distinto del agregado "Factura sobre registros" de
// queries.ts: esto es el billing de la plataforma (Stripe). Funciones planas
// (imperativas) porque PerfilSection las consume con su propio estado de carga;
// degradan a null/[] (la UI ya muestra su loading/empty). Genéricas en el row
// para no duplicar los tipos locales de la UI.
import { supabase } from '../../lib/supabase'

/** Suscripción activa (trialing/active/past_due/incomplete) + plan embebido. */
export async function fetchActiveSubscription<T>(companyId: string): Promise<T | null> {
  const { data } = await supabase
    .from('subscriptions')
    .select('status, billing_cycle, current_period_end, trial_end, cancel_at_period_end, plan:billing_plans!inner(code, name, description, price_monthly_cents, currency, features)')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'incomplete'])
    .maybeSingle()
  return (data as T | null) ?? null
}

/** Catálogo de planes activos (orden de presentación). Degrada a `[]`. */
export async function fetchActiveBillingPlans<T>(): Promise<T[]> {
  const { data } = await supabase
    .from('billing_plans')
    .select('code, name, price_monthly_cents, price_yearly_cents, description, features')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  return (data as T[] | null) ?? []
}

/**
 * Desglose del total mensual (RPC `calculate_monthly_total_cents`): base + extras
 * de proyectos/unidades. Devuelve la primera fila o null.
 */
export async function fetchMonthlyTotalBreakdown<T>(companyId: string): Promise<T | null> {
  const { data } = await supabase.rpc('calculate_monthly_total_cents', { p_company_id: companyId })
  return ((data as T[] | null)?.[0]) ?? null
}

/**
 * Componentes de precio + topes del billing plan ACTIVO del tenant (para la
 * proyección de costo del modal de ampliación de límites). `null` sin
 * suscripción viva. La RLS billing_plans_select es pública para authenticated.
 */
export async function fetchPlanPricing<T>(companyId: string): Promise<T | null> {
  const { data } = await supabase
    .from('subscriptions')
    .select('plan:billing_plans!inner(base_activation_cents, extra_project_cents, unit_primary_cents, unit_extra_cents, max_projects, max_units)')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'incomplete'])
    .maybeSingle()
  return ((data as { plan: T } | null)?.plan) ?? null
}
