// domain/facturacion/billing.ts — Lecturas de la suscripción SaaS del tenant
// (T7/PR3): suscripción activa + plan, catálogo de planes y el desglose de
// consumo mensual (RPC). Distinto del agregado "Factura sobre registros" de
// queries.ts: esto es el billing de la plataforma (Stripe). Funciones planas
// (imperativas) porque PerfilSection las consume con su propio estado de carga;
// degradan a null/[] (la UI ya muestra su loading/empty). Genéricas en el row
// para no duplicar los tipos locales de la UI. P2 tipos: cliente TIPADO `db` —
// tablas/columnas/embeds/RPC chequeados contra el esquema; el row sigue siendo
// genérico del caller, así que el cast a T pasa por unknown en la frontera.
import { reportDegradedQuery } from '../queryFetch'
import { db } from '../../lib/supabase'

/** Suscripción activa (trialing/active/past_due/incomplete) + plan embebido. */
export async function fetchActiveSubscription<T>(companyId: string): Promise<T | null> {
  const { data, error } = await db
    .from('subscriptions')
    .select('status, billing_cycle, current_period_end, trial_end, cancel_at_period_end, plan:billing_plans!inner(code, name, description, price_monthly_cents, currency, features)')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'incomplete'])
    .maybeSingle()
  reportDegradedQuery('facturacion.fetchActiveSubscription', error)
  // Select validado contra el esquema; T lo aporta la UI (tipo local) — frontera.
  return (data as unknown as T | null) ?? null
}

/** Catálogo de planes activos (orden de presentación). Degrada a `[]`. */
export async function fetchActiveBillingPlans<T>(): Promise<T[]> {
  const { data, error } = await db
    .from('billing_plans')
    // F1 (C5): + componentes del precio POR USO (base/extra_project/unit_*) y
    // topes — el picker proyecta el total con el uso actual del tenant en vez
    // de mostrar solo la base plana (que subestimaba la factura real).
    .select('code, name, price_monthly_cents, price_yearly_cents, description, features, base_activation_cents, extra_project_cents, unit_primary_cents, unit_extra_cents, max_projects, max_units')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  reportDegradedQuery('facturacion.fetchActiveBillingPlans', error)
  // Select validado contra el esquema; T lo aporta la UI (tipo local) — frontera.
  return (data as unknown as T[] | null) ?? []
}

/**
 * Desglose del total mensual (RPC `calculate_monthly_total_cents`): base + extras
 * de proyectos/unidades. Devuelve la primera fila o null.
 */
export async function fetchMonthlyTotalBreakdown<T>(companyId: string): Promise<T | null> {
  const { data, error } = await db.rpc('calculate_monthly_total_cents', { p_company_id: companyId })
  reportDegradedQuery('facturacion.fetchMonthlyTotalBreakdown', error)
  // RPC y args validados contra el esquema; T lo aporta la UI — frontera.
  return ((data as unknown as T[] | null)?.[0]) ?? null
}

/**
 * Componentes de precio + topes del billing plan ACTIVO del tenant (para la
 * proyección de costo del modal de ampliación de límites). `null` sin
 * suscripción viva. La RLS billing_plans_select es pública para authenticated.
 */
export async function fetchPlanPricing<T>(companyId: string): Promise<T | null> {
  const { data, error } = await db
    .from('subscriptions')
    .select('plan:billing_plans!inner(base_activation_cents, extra_project_cents, unit_primary_cents, unit_extra_cents, max_projects, max_units)')
    .eq('company_id', companyId)
    .in('status', ['trialing', 'active', 'past_due', 'incomplete'])
    .maybeSingle()
  reportDegradedQuery('facturacion.fetchPlanPricing', error)
  // Select/embed validados contra el esquema; T lo aporta la UI — frontera.
  return ((data as unknown as { plan: T } | null)?.plan) ?? null
}
