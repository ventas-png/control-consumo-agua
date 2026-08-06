import { useEffect, useRef, useState } from 'react'
import { Chart, type ChartConfiguration } from '../../lib/chartjs'
import { resolveChartColor, resolveChartColors, chartFill } from '../../lib/chartColors'
import { useThemeVersion } from '../../hooks/useThemeVersion'
import { StatTile } from '../shared/StatTile'
import { FilterChips } from '../shared/FilterChips'
import { ChartCard } from './ChartCard'
import { HeroPlataforma } from './HeroPlataforma'
import { SuperAdminOpsStrip } from './SuperAdminOpsStrip'
import { TrialCohortesChart } from './TrialCohortesChart'
import { parseFecha } from '../../lib/format'
import { formatUsdCents } from './empresaHelpers'
import {
  buildPlanDoughnut,
  churnRatePct,
  computeConversionTrial,
  computeDeltaPct,
  computeNetGrowth,
  formatMesLabel,
} from './metricsHelpers'
import {
  usePlataformaKpisQuery,
  useMrrTrendQuery,
  useSuperadminTrendsQuery,
  useTrialCohortesQuery,
  type SuperadminTrendPoint,
  type MrrTrendPoint,
  type PlanDistributionEntry,
} from '../../domain/superadmin/queries'

// ============================================================================
// SuperAdminDashboardTab — analítica SaaS del panel superadmin.
// ============================================================================
// Cuatro bandas:
//   0. SuperAdminOpsStrip  — frescura de MV, snapshot diario, salud, refresh.
//   1. HeroPlataforma      — MRR cobrable titular + ARR/ARPA + totales.
//   2. StatTiles           — crecimiento y retención (activas, trial, churn, neto).
//   3. Grid de gráficas    — MRR cobrable vs total, altas/bajas/neto, empresas
//      activas, cohortes de trial y composición por plan.
// Todos los agregados llegan pre-calculados por RPC SECURITY DEFINER acotadas a
// super_admin (nada se agrega en el cliente); las fórmulas de presentación
// viven en metricsHelpers (puras y testeadas). Colores de canvas SIEMPRE vía
// resolveChartColor/chartFill (el canvas no resuelve var(--at-*)).

type RangoDias = '30' | '90' | '180' | '365'
type RangoMeses = '6' | '12' | '24'

const RANGO_DIAS_OPTS: Array<{ value: RangoDias; label: string }> = [
  { value: '30', label: '30 d' },
  { value: '90', label: '90 d' },
  { value: '180', label: '180 d' },
  { value: '365', label: '1 año' },
]
const RANGO_MESES_OPTS: Array<{ value: RangoMeses; label: string }> = [
  { value: '6', label: '6 m' },
  { value: '12', label: '12 m' },
  { value: '24', label: '24 m' },
]

interface Props {
  onVerEmpresas: () => void
  onShowHealth: () => void
}

export function SuperAdminDashboardTab({ onVerEmpresas, onShowHealth }: Props) {
  const [rangoDias, setRangoDias] = useState<RangoDias>('90')
  const [rangoMeses, setRangoMeses] = useState<RangoMeses>('12')

  const kpisQ = usePlataformaKpisQuery()
  const mrrQ = useMrrTrendQuery(Number(rangoDias))
  const trendsQ = useSuperadminTrendsQuery(Number(rangoMeses))
  const cohortesQ = useTrialCohortesQuery(Number(rangoMeses))

  const kpis = kpisQ.data
  const serie = mrrQ.data ?? []
  const trends = trendsQ.data ?? []
  const cohortes = cohortesQ.data ?? []

  const isFetching = kpisQ.isFetching || mrrQ.isFetching || trendsQ.isFetching || cohortesQ.isFetching

  // Fórmulas de presentación (metricsHelpers, testeadas).
  const churn = churnRatePct(
    kpis?.suscripciones_activas ?? 0,
    kpis?.suscripciones_trialing ?? 0,
    kpis?.canceladas_30d ?? 0,
  )
  const deltaActivas = computeDeltaPct(serie, p => p.empresas_activas)
  const neto = computeNetGrowth(trends)
  const conversion = computeConversionTrial(cohortes)
  const sparkActivas = serie.map(p => p.empresas_activas)
  const cobrableSinHistoria = serie.length > 0 && serie.every(p => p.mrr_cobrable_cents == null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <SuperAdminOpsStrip
        refreshedAt={kpis?.refreshed_at}
        serie={serie}
        isFetching={isFetching}
        onShowHealth={onShowHealth}
      />

      <HeroPlataforma
        kpis={kpis}
        loading={kpisQ.isLoading}
        error={kpisQ.error}
        onRetry={() => { void kpisQ.refetch() }}
        serie={serie}
        onVerEmpresas={onVerEmpresas}
      />

      {/* Crecimiento y retención */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={onVerEmpresas}
          aria-label="Empresas activas — ver la tabla de empresas"
          // Reset explícito (no `all: unset`, que anularía el outline global de
          // :focus-visible); el foco visible lo pone la regla de index.css.
          style={{
            display: 'flex', flex: '1 1 160px', cursor: 'pointer',
            border: 'none', background: 'transparent', padding: 0,
            textAlign: 'left', font: 'inherit',
          }}
        >
          <StatTile
            label="Empresas activas"
            value={kpis ? kpis.empresas_activas.toLocaleString('es-GT') : '…'}
            delta={deltaActivas ?? undefined}
            sparkline={sparkActivas.length > 1 ? sparkActivas : undefined}
            hint={kpis ? `de ${kpis.total_empresas.toLocaleString('es-GT')} empresas totales →` : undefined}
            style={{ flex: 1 }}
          />
        </button>
        <StatTile
          label="En trial"
          value={kpis ? kpis.suscripciones_trialing.toLocaleString('es-GT') : '…'}
          tone="info"
          hint={conversion
            ? `conversión ${conversion.pct.toFixed(1)}% (${conversion.cohortes} cohorte${conversion.cohortes !== 1 ? 's' : ''})`
            : 'conversión —'}
        />
        <StatTile
          label="Churn 30d"
          value={kpis ? `${churn.toFixed(1)}%` : '…'}
          tone={churn > 5 ? 'danger' : churn > 2 ? 'warning' : undefined}
          hint={kpis ? `${kpis.canceladas_30d} cancelada${kpis.canceladas_30d !== 1 ? 's' : ''}` : undefined}
        />
        <StatTile
          label="Neto último mes"
          value={neto ? `${neto.neto >= 0 ? '+' : ''}${neto.neto}` : '—'}
          tone={neto ? (neto.neto >= 0 ? 'success' : 'danger') : undefined}
          hint={neto
            ? `${neto.altas} alta${neto.altas !== 1 ? 's' : ''} de empresas · ${neto.bajas} baja${neto.bajas !== 1 ? 's' : ''} de suscripciones`
            : 'sin mes cerrado aún'}
        />
      </div>

      {/* Gráficas */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))',
        gap: '16px',
      }}>
        <ChartCard
          title="MRR: cobrable vs total"
          subtitle="Snapshot diario · el desglose cobrable existe desde su activación"
          actions={
            <FilterChips
              options={RANGO_DIAS_OPTS}
              value={rangoDias}
              onChange={setRangoDias}
              ariaLabel="Rango de días de la serie de MRR"
            />
          }
          loading={mrrQ.isLoading}
          refreshing={mrrQ.isFetching && !mrrQ.isLoading}
          empty={serie.length === 0}
          emptyText={mrrQ.isError
            ? 'No se pudo cargar la serie de MRR. Intenta actualizar.'
            : 'Todavía no hay snapshots de MRR. El primer punto se registra hoy y el cron agrega uno diario.'}
          footnote={cobrableSinHistoria
            ? 'El desglose cobrable aún no tiene historia: se muestra solo el MRR total.'
            : undefined}
        >
          <MrrChart serie={serie} />
        </ChartCard>

        <ChartCard
          title="Altas, bajas y neto"
          subtitle={`Empresas creadas vs suscripciones canceladas (${rangoMeses} meses)`}
          actions={
            <FilterChips
              options={RANGO_MESES_OPTS}
              value={rangoMeses}
              onChange={setRangoMeses}
              ariaLabel="Rango de meses de las tendencias"
            />
          }
          loading={trendsQ.isLoading}
          refreshing={trendsQ.isFetching && !trendsQ.isLoading}
          empty={trends.length === 0}
          emptyText={trendsQ.isError
            ? 'No se pudieron cargar las tendencias. Intenta actualizar.'
            : 'Sin datos de tendencia todavía.'}
        >
          <TrendsChart trends={trends} />
        </ChartCard>

        <ChartCard
          title="Empresas activas"
          subtitle="Empresas con cuenta activa, corte diario"
          loading={mrrQ.isLoading}
          refreshing={mrrQ.isFetching && !mrrQ.isLoading}
          empty={serie.length === 0}
          emptyText={mrrQ.isError
            ? 'No se pudo cargar la serie diaria. Intenta actualizar.'
            : 'Sin snapshots todavía. La serie se acumula desde su activación.'}
        >
          <ActivasChart serie={serie} />
        </ChartCard>

        <ChartCard
          title="Cohortes de trial por mes de alta"
          subtitle="Estado ACTUAL de cada cohorte — no es conversión a 30 días"
          loading={cohortesQ.isLoading}
          refreshing={cohortesQ.isFetching && !cohortesQ.isLoading}
          empty={cohortesQ.isError || cohortes.every(c => c.trials === 0)}
          emptyText={cohortesQ.isError
            ? 'No se pudieron cargar las cohortes de trial. Intenta actualizar.'
            : 'Sin cohortes de trial todavía. Cada empresa nueva inicia un trial de 14 días.'}
        >
          <TrialCohortesChart cohortes={cohortes} />
        </ChartCard>

        <ChartCard
          title="Composición por plan"
          subtitle="Suscripciones vigentes (activas + en trial)"
          loading={kpisQ.isLoading}
          refreshing={kpisQ.isFetching && !kpisQ.isLoading}
          empty={kpisQ.isError || (kpis?.plan_distribution ?? []).length === 0}
          emptyText={kpisQ.isError
            ? 'No se pudieron cargar los KPIs de plataforma. Intenta actualizar.'
            : 'Sin suscripciones vigentes.'}
        >
          <PlanDoughnut dist={kpis?.plan_distribution ?? []} total={kpis?.suscripciones_vigentes ?? 0} />
        </ChartCard>
      </div>
    </div>
  )
}

// ───── Gráficas (patrón canvas-ref + destroy; colores resueltos en runtime) ─────

function MrrChart({ serie }: { serie: MrrTrendPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instance = useRef<Chart | null>(null)
  const themeVersion = useThemeVersion()

  useEffect(() => {
    if (!canvasRef.current) return
    if (instance.current) instance.current.destroy()

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const inkSoft = resolveChartColor('var(--at-ink-3)')
    const tieneCobrable = serie.some(p => p.mrr_cobrable_cents != null)

    const datasets: ChartConfiguration<'line'>['data']['datasets'] = [{
      label: 'MRR total',
      data: serie.map(p => p.mrr_cents / 100),
      borderColor: inkSoft,
      borderWidth: 1.5,
      borderDash: [4, 4],
      fill: false,
      tension: 0.3,
      pointRadius: 0,
    }]
    if (tieneCobrable) {
      datasets.push({
        label: 'MRR cobrable',
        // null = día sin desglose (pre-migración): hueco honesto, no cero.
        data: serie.map(p => (p.mrr_cobrable_cents == null ? null : p.mrr_cobrable_cents / 100)),
        borderColor: resolveChartColor('var(--at-primary)'),
        backgroundColor: chartFill('var(--at-primary)', 0.14),
        borderWidth: 2.5,
        fill: true,
        tension: 0.3,
        spanGaps: false,
        pointRadius: serie.length > 30 ? 0 : 3,
      })
    }

    instance.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: serie.map(p => parseFecha(p.day).toLocaleDateString('es-GT', { day: '2-digit', month: 'short' })),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduceMotion ? false : { duration: 320 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: tieneCobrable,
            position: 'bottom',
            labels: { boxWidth: 12, font: { size: 11 }, color: inkSoft },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatUsdCents(Math.round((Number(ctx.parsed.y) || 0) * 100))}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: inkSoft, maxTicksLimit: 10 }, grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { color: inkSoft, callback: (v) => `$${Number(v).toLocaleString('en-US')}` },
            grid: { color: chartFill('var(--at-ink-3)', 0.14) },
          },
        },
      },
    })
    return () => { instance.current?.destroy(); instance.current = null }
  }, [serie, themeVersion])

  return <canvas ref={canvasRef} aria-label="Tendencia de MRR cobrable y total" role="img" />
}

function TrendsChart({ trends }: { trends: SuperadminTrendPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instance = useRef<Chart | null>(null)
  const themeVersion = useThemeVersion()

  useEffect(() => {
    if (!canvasRef.current) return
    if (instance.current) instance.current.destroy()

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const inkSoft = resolveChartColor('var(--at-ink-3)')

    const config: ChartConfiguration<'bar' | 'line'> = {
      type: 'bar',
      data: {
        labels: trends.map(t => formatMesLabel(t.mes)),
        datasets: [
          {
            label: 'Altas',
            data: trends.map(t => t.altas),
            backgroundColor: chartFill('var(--at-primary)', 0.75),
            borderRadius: 4,
          },
          {
            label: 'Bajas',
            data: trends.map(t => t.bajas),
            backgroundColor: chartFill('var(--at-accent)', 0.75),
            borderRadius: 4,
          },
          {
            type: 'line',
            label: 'Neto',
            data: trends.map(t => t.altas - t.bajas),
            borderColor: resolveChartColor('var(--at-info)'),
            borderWidth: 2,
            pointRadius: 2,
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduceMotion ? false : { duration: 320 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: inkSoft } },
        },
        scales: {
          x: { ticks: { color: inkSoft }, grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: inkSoft },
            grid: { color: chartFill('var(--at-ink-3)', 0.14) },
          },
        },
      },
    }
    instance.current = new Chart(canvasRef.current, config)
    return () => { instance.current?.destroy(); instance.current = null }
  }, [trends, themeVersion])

  return <canvas ref={canvasRef} aria-label="Altas, bajas y crecimiento neto por mes" role="img" />
}

function ActivasChart({ serie }: { serie: MrrTrendPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instance = useRef<Chart | null>(null)
  const themeVersion = useThemeVersion()

  useEffect(() => {
    if (!canvasRef.current) return
    if (instance.current) instance.current.destroy()

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const inkSoft = resolveChartColor('var(--at-ink-3)')

    instance.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: serie.map(p => parseFecha(p.day).toLocaleDateString('es-GT', { day: '2-digit', month: 'short' })),
        datasets: [{
          label: 'Empresas activas',
          data: serie.map(p => p.empresas_activas),
          borderColor: resolveChartColor('var(--at-accent-2)'),
          backgroundColor: chartFill('var(--at-accent-2)', 0.12),
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: serie.length > 30 ? 0 : 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: reduceMotion ? false : { duration: 320 },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: inkSoft, maxTicksLimit: 10 }, grid: { display: false } },
          y: {
            beginAtZero: true,
            ticks: { precision: 0, color: inkSoft },
            grid: { color: chartFill('var(--at-ink-3)', 0.14) },
          },
        },
      },
    })
    return () => { instance.current?.destroy(); instance.current = null }
  }, [serie, themeVersion])

  return <canvas ref={canvasRef} aria-label="Empresas activas por día" role="img" />
}

// Paleta categórica de la dona: núcleo de 3 tokens validado (CVD + separación
// normal) en ambos temas; el resto son fallback defensivo — hoy solo existen 3
// planes. La codificación secundaria (leyenda, bordes de superficie entre
// rebanadas y tooltip con conteo/%) cubre los pares límite del modo oscuro.
const PLAN_DOUGHNUT_TOKENS = [
  'var(--at-primary)',
  'var(--at-accent-light)',
  'var(--at-primary-soft-2)',
  'var(--at-accent)',
  'var(--at-chip)',
  'var(--at-ink-3)',
]

function PlanDoughnut({ dist, total }: { dist: PlanDistributionEntry[]; total: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instance = useRef<Chart | null>(null)
  const themeVersion = useThemeVersion()

  useEffect(() => {
    if (!canvasRef.current) return
    if (instance.current) instance.current.destroy()

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const inkSoft = resolveChartColor('var(--at-ink-3)')
    const { labels, counts } = buildPlanDoughnut(dist)

    instance.current = new Chart(canvasRef.current, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: counts,
          backgroundColor: resolveChartColors(PLAN_DOUGHNUT_TOKENS).slice(0, counts.length),
          borderColor: resolveChartColor('var(--at-surface)'),
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        animation: reduceMotion ? false : { duration: 320 },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 }, color: inkSoft } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const n = Number(ctx.parsed) || 0
                const pct = total > 0 ? Math.round((n / total) * 100) : 0
                return `${ctx.label}: ${n} (${pct}%)`
              },
            },
          },
        },
      },
    })
    return () => { instance.current?.destroy(); instance.current = null }
  }, [dist, total, themeVersion])

  return <canvas ref={canvasRef} aria-label="Composición de suscripciones por plan" role="img" />
}
