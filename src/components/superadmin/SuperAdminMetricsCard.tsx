// ============================================================================
// SuperAdminMetricsCard — LEGACY (solo computeMetrics, cubierta por tests).
// ============================================================================
// El componente de UI que vivía aquí (KPI-grid oscuro de "Métricas globales
// SaaS") fue sustituido por HeroPlataforma + StatTiles del dashboard rediseñado:
// los KPIs reales llegan pre-agregados de mv_superadmin_plataforma vía la RPC
// get_superadmin_plataforma_kpis (acotada a super_admin) y las fórmulas de
// presentación viven en metricsHelpers.ts.
//
// computeMetrics() se conserva como referencia pura del agregado en cliente
// (suma flat de price_monthly_cents sobre filas crudas): NO distingue
// cobrabilidad y nadie la invoca en producción — existe solo para los tests
// unitarios que fijan la semántica histórica.

interface SubscriptionRow {
  status: string
  canceled_at: string | null
  plan: { id: string; code: string; name: string; price_monthly_cents: number } | null
}

interface Metrics {
  mrrCents: number
  mrrCobrableCents: number
  mrrPotencialCents: number
  grandfatheredCount: number
  activeCount: number
  trialingCount: number
  cancelledLast30Days: number
  totalSubscriptions: number
  planDistribution: Array<{ planCode: string; planName: string; count: number }>
  loading: boolean
  error: string | null
}

/** @deprecated Referencia legacy solo para tests — la métrica real viene de la MV. */
export function computeMetrics(rows: SubscriptionRow[]): Metrics {
  const ACTIVE = new Set(['active', 'trialing'])
  let mrrCents = 0
  let activeCount = 0
  let trialingCount = 0
  let cancelledLast30Days = 0
  const planCounts = new Map<string, { code: string; name: string; count: number }>()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  for (const r of rows) {
    if (r.status === 'active') activeCount++
    if (r.status === 'trialing') trialingCount++
    if (r.status === 'canceled' && r.canceled_at && new Date(r.canceled_at) >= thirtyDaysAgo) {
      cancelledLast30Days++
    }
    if (ACTIVE.has(r.status) && r.plan) {
      mrrCents += r.plan.price_monthly_cents
      const key = r.plan.code
      const existing = planCounts.get(key)
      if (existing) existing.count++
      else planCounts.set(key, { code: r.plan.code, name: r.plan.name, count: 1 })
    }
  }

  const planDistribution = [...planCounts.values()]
    .map(p => ({ planCode: p.code, planName: p.name, count: p.count }))
    .sort((a, b) => b.count - a.count)

  return {
    mrrCents,
    // Helper LEGACY (suma flat desde filas crudas, solo tests): no distingue
    // cobrabilidad — la partición real viene de la MV.
    mrrCobrableCents: mrrCents,
    mrrPotencialCents: 0,
    grandfatheredCount: 0,
    activeCount,
    trialingCount,
    cancelledLast30Days,
    totalSubscriptions: activeCount + trialingCount,
    planDistribution,
    loading: false,
    error: null,
  }
}
