import { useEffect, useRef } from 'react'
import { Chart } from '../../lib/chartjs'
import { SuperAdminMetricsCard } from './SuperAdminMetricsCard'
import {
  useSuperadminTrendsQuery,
  useMrrTrendQuery,
  type SuperadminTrendPoint,
  type MrrTrendPoint,
} from '../../domain/superadmin/queries'

// ============================================================================
// SuperAdminDashboardTab — KPIs + gráficas de tendencia del SaaS.
// ============================================================================
// Mantiene SuperAdminMetricsCard (MRR/activas/trial/churn desde la MV) y suma
// dos gráficas con el patrón canvas-ref de AdminDashboardCharts:
//   · MRR diario (platform_metrics_daily — la serie se acumula desde el primer
//     snapshot del cron, no es reconstruible hacia atrás).
//   · Altas de empresas vs bajas de suscripciones por mes.

const MESES_NOMBRES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

/** "2026-06-01" → "Jun 2026" (etiqueta de mes para la gráfica de altas/bajas). */
export function formatMesLabel(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return mes
  return `${MESES_NOMBRES[m - 1]} ${y}`
}

export function SuperAdminDashboardTab() {
  const { data: mrrSerie = [], isLoading: mrrLoading } = useMrrTrendQuery(90)
  const { data: trends = [], isLoading: trendsLoading } = useSuperadminTrendsQuery(12)

  return (
    <div>
      <SuperAdminMetricsCard />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '16px',
      }}>
        <ChartCard
          title="MRR (últimos 90 días)"
          subtitle="Snapshot diario — la serie se acumula desde su activación"
          loading={mrrLoading}
          empty={mrrSerie.length === 0}
          emptyText="Todavía no hay snapshots de MRR. El primer punto se registra hoy y el cron agrega uno diario."
        >
          <MrrChart serie={mrrSerie} />
        </ChartCard>

        <ChartCard
          title="Altas y bajas por mes"
          subtitle="Empresas creadas vs suscripciones canceladas (12 meses)"
          loading={trendsLoading}
          empty={trends.length === 0}
          emptyText="Sin datos de tendencia todavía."
        >
          <TrendsChart trends={trends} />
        </ChartCard>
      </div>
    </div>
  )
}

function ChartCard({ title, subtitle, loading, empty, emptyText, children }: {
  title: string
  subtitle?: string
  loading: boolean
  empty: boolean
  emptyText: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      background: 'var(--at-surface)',
      borderRadius: '14px',
      padding: '18px 20px',
      border: '1px solid var(--at-line)',
      boxShadow: '0 2px 12px rgba(0,0,0,.04)',
    }}>
      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink)' }}>{title}</div>
        {subtitle && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{subtitle}</div>}
      </div>
      {loading ? (
        <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--at-ink-3)', fontSize: '13px' }}>
          Cargando…
        </div>
      ) : empty ? (
        <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--at-ink-3)', fontSize: '13px', textAlign: 'center', padding: '0 20px' }}>
          {emptyText}
        </div>
      ) : (
        <div style={{ height: '220px' }}>{children}</div>
      )}
    </div>
  )
}

function MrrChart({ serie }: { serie: MrrTrendPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instance = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    if (instance.current) instance.current.destroy()

    instance.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: serie.map(p => new Date(p.day).toLocaleDateString('es-GT', { day: '2-digit', month: 'short' })),
        datasets: [{
          label: 'MRR (USD)',
          data: serie.map(p => p.mrr_cents / 100),
          borderColor: '#1B3B36',
          backgroundColor: 'rgba(27, 59, 54, 0.1)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: serie.length > 30 ? 0 : 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { callback: (v) => `$${v}` } },
        },
      },
    })
    return () => { instance.current?.destroy(); instance.current = null }
  }, [serie])

  return <canvas ref={canvasRef} aria-label="Tendencia de MRR" role="img" />
}

function TrendsChart({ trends }: { trends: SuperadminTrendPoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instance = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    if (instance.current) instance.current.destroy()

    instance.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: trends.map(t => formatMesLabel(t.mes)),
        datasets: [
          {
            label: 'Altas',
            data: trends.map(t => t.altas),
            backgroundColor: 'rgba(27, 59, 54, 0.75)',
            borderRadius: 4,
          },
          {
            label: 'Bajas',
            data: trends.map(t => t.bajas),
            backgroundColor: 'rgba(185, 106, 63, 0.75)',
            borderRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    })
    return () => { instance.current?.destroy(); instance.current = null }
  }, [trends])

  return <canvas ref={canvasRef} aria-label="Altas y bajas por mes" role="img" />
}
