import { useEffect, useRef } from 'react'
import { Chart } from '../../lib/chartjs'
import { resolveChartColor, chartFill } from '../../lib/chartColors'
import { useThemeVersion } from '../../hooks/useThemeVersion'
import { formatMesLabel } from './metricsHelpers'
import type { TrialCohortePoint } from '../../domain/superadmin/queries'

// ============================================================================
// TrialCohortesChart — barras apiladas: cohortes mensuales de EMPRESAS por su
// primer trial, clasificadas por el estado ACTUAL de su suscripción vigente
// (no es conversión a 30 días; no hay historial de transiciones). Los seis
// buckets particionan la cohorte, así que la altura de cada barra = trials.
// ============================================================================

export function TrialCohortesChart({ cohortes }: { cohortes: TrialCohortePoint[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instance = useRef<Chart | null>(null)
  const themeVersion = useThemeVersion()

  useEffect(() => {
    if (!canvasRef.current) return
    if (instance.current) instance.current.destroy()

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const inkSoft = resolveChartColor('var(--at-ink-3)')

    instance.current = new Chart(canvasRef.current, {
      type: 'bar',
      data: {
        labels: cohortes.map(c => formatMesLabel(c.mes)),
        datasets: [
          { label: 'Convertidas (cobrando)', data: cohortes.map(c => c.activas_cobrables), backgroundColor: resolveChartColor('var(--at-success)') },
          { label: 'Convertidas sin cobro', data: cohortes.map(c => c.activas_sin_cobro), backgroundColor: chartFill('var(--at-success)', 0.45) },
          { label: 'En trial', data: cohortes.map(c => c.en_trial), backgroundColor: resolveChartColor('var(--at-info)') },
          { label: 'Trial vencido', data: cohortes.map(c => c.trial_vencido), backgroundColor: resolveChartColor('var(--at-warning)') },
          { label: 'Pago vencido', data: cohortes.map(c => c.pago_vencido), backgroundColor: chartFill('var(--at-warning)', 0.45) },
          { label: 'Canceladas', data: cohortes.map(c => c.canceladas), backgroundColor: resolveChartColor('var(--at-danger)') },
        ].map(d => ({ ...d, borderRadius: 2 })),
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
          x: { stacked: true, ticks: { color: inkSoft }, grid: { display: false } },
          y: {
            stacked: true, beginAtZero: true,
            ticks: { precision: 0, color: inkSoft },
            grid: { color: chartFill('var(--at-ink-3)', 0.14) },
          },
        },
      },
    })
    return () => { instance.current?.destroy(); instance.current = null }
  }, [cohortes, themeVersion])

  return <canvas ref={canvasRef} aria-label="Cohortes de trial por mes de alta" role="img" />
}
