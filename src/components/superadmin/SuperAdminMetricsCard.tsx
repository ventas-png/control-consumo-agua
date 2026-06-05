import { type CSSProperties } from 'react'
import { usePlataformaKpisQuery } from '../../domain/superadmin/queries'

// ============================================================================
// SuperAdminMetricsCard — F4.5.3: KPIs de negocio para superadmin.
// ============================================================================
// Renderiza arriba de la lista de empresas en SuperAdminSection. Muestra:
//   - MRR (Monthly Recurring Revenue) de subscriptions activas + trialing
//   - Conteo de empresas activas y en trial
//   - Churn rate ultimos 30 dias
//   - Distribucion por plan (top 5 con barra normalizada)
//
// PERF: estos agregados YA NO se calculan en el cliente. Se leen pre-agregados
// de la vista materializada mv_superadmin_plataforma vía la RPC SECURITY DEFINER
// get_superadmin_plataforma_kpis (acotada a super_admin), refrescada por pg_cron
// (migración 20260605200000). Antes este componente descargaba TODAS las
// subscriptions y sumaba MRR/churn/plan en JS.
//
// computeMetrics() (más abajo) se conserva como referencia pura + cubierta por
// tests unitarios; ya no la invoca el componente.

interface SubscriptionRow {
  status: string
  canceled_at: string | null
  plan: { id: string; code: string; name: string; price_monthly_cents: number } | null
}

interface Metrics {
  mrrCents: number
  activeCount: number
  trialingCount: number
  cancelledLast30Days: number
  totalSubscriptions: number
  planDistribution: Array<{ planCode: string; planName: string; count: number }>
  loading: boolean
  error: string | null
}

export function SuperAdminMetricsCard() {
  const { data: kpis, isLoading, error } = usePlataformaKpisQuery()

  if (isLoading) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>Cargando métricas…</div>
      </div>
    )
  }
  if (error) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: '13px', color: 'var(--at-danger)' }}>Error cargando métricas: {error instanceof Error ? error.message : String(error)}</div>
      </div>
    )
  }

  const m: Metrics = {
    mrrCents: kpis?.mrr_cents ?? 0,
    activeCount: kpis?.suscripciones_activas ?? 0,
    trialingCount: kpis?.suscripciones_trialing ?? 0,
    cancelledLast30Days: kpis?.canceladas_30d ?? 0,
    totalSubscriptions: kpis?.suscripciones_vigentes ?? 0,
    planDistribution: kpis?.plan_distribution ?? [],
    loading: false,
    error: null,
  }

  return (
    <div style={cardStyle}>
      <div style={titleStyle}>Métricas globales SaaS</div>

      <div style={kpiGridStyle}>
        <Kpi label="MRR" value={formatUsd(m.mrrCents)} subtitle="recurring revenue / mes" highlight />
        <Kpi label="Empresas activas" value={m.activeCount.toString()} />
        <Kpi label="En trial" value={m.trialingCount.toString()} />
        <Kpi label="Churn 30d" value={`${formatPct(churnRate(m))}`} subtitle={`${m.cancelledLast30Days} canceladas`} />
      </div>

      {m.planDistribution.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <div style={subTitleStyle}>Distribución por plan</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
            {m.planDistribution.slice(0, 5).map(p => {
              const pct = m.totalSubscriptions > 0 ? (p.count / m.totalSubscriptions) * 100 : 0
              return (
                <div key={p.planCode} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ minWidth: '140px', fontSize: '13px', color: 'var(--at-chip)', fontWeight: 600 }}>
                    {p.planName}
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`${p.planName}: ${p.count} suscripciones (${Math.round(pct)}%)`}
                    aria-valuenow={p.count}
                    aria-valuemin={0}
                    aria-valuemax={m.totalSubscriptions}
                    style={{ flex: 1, height: '12px', background: 'rgba(255,255,255,0.1)', borderRadius: '6px', overflow: 'hidden' }}
                  >
                    <div style={{
                      width: `${pct}%`, height: '100%',
                      background: 'linear-gradient(90deg, var(--at-primary), var(--at-accent-2))',
                      transition: 'width 0.3s ease',
                    }} />
                  </div>
                  <div style={{ minWidth: '80px', textAlign: 'right', fontSize: '12px', color: 'var(--at-chip)' }}>
                    <strong style={{ fontSize: '14px' }}>{p.count}</strong>{' '}
                    <span style={{ color: 'var(--at-ink-3)' }}>({Math.round(pct)}%)</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, subtitle, highlight = false }: { label: string; value: string; subtitle?: string; highlight?: boolean }) {
  return (
    <div style={{
      background: highlight ? 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))' : 'rgba(255,255,255,0.04)',
      borderRadius: '12px',
      padding: '14px 16px',
      border: '1px solid rgba(255,255,255,0.08)',
    }}>
      <div style={{ fontSize: '10px', fontWeight: 700, color: highlight ? 'rgba(255,255,255,0.8)' : 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div style={{ fontSize: '22px', fontWeight: 800, color: highlight ? 'white' : 'var(--at-chip)', marginTop: '4px' }}>
        {value}
      </div>
      {subtitle && (
        <div style={{ fontSize: '11px', color: highlight ? 'rgba(255,255,255,0.7)' : 'var(--at-ink-3)', marginTop: '2px' }}>
          {subtitle}
        </div>
      )}
    </div>
  )
}

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
    activeCount,
    trialingCount,
    cancelledLast30Days,
    totalSubscriptions: activeCount + trialingCount,
    planDistribution,
    loading: false,
    error: null,
  }
}

function churnRate(m: Metrics): number {
  const denominator = m.activeCount + m.trialingCount + m.cancelledLast30Days
  if (denominator === 0) return 0
  return (m.cancelledLast30Days / denominator) * 100
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`
}

// ───── Styles (oscuros para SuperAdminSection con bg negro) ─────
const cardStyle: CSSProperties = {
  background: 'linear-gradient(135deg, var(--at-ink), var(--at-ink))',
  borderRadius: '16px',
  padding: '24px 28px',
  marginBottom: '24px',
  border: '1px solid rgba(255,255,255,0.06)',
}
const titleStyle: CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--at-ink-3)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  marginBottom: '16px',
}
const subTitleStyle: CSSProperties = {
  fontSize: '11px',
  fontWeight: 700,
  color: 'var(--at-ink-3)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}
const kpiGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: '12px',
}
