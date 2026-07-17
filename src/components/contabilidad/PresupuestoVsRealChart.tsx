// presupuesto (D1) — Gráfica presupuesto vs real por mes + proyección de cierre
// de año. Consume ProyeccionPresupuesto (lógica pura ya testeada). Usa colores
// hex de marca directos (el helper compartido de color llega en C2/V1).
import { useEffect, useRef } from 'react'
import { Chart } from '../../lib/chartjs'
import { formatCurrency } from '../../lib/format'
import type { ProyeccionPresupuesto } from '../../domain/presupuesto/proyeccion'

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const COLOR_PRESUP = '#1B3B36'   // primary
const COLOR_REAL = '#B96A3F'     // accent
const COLOR_LINEA = 'rgba(27,59,54,0.35)'

interface Props {
  proyeccion: ProyeccionPresupuesto
  anio: number
  moneda: string
}

export function PresupuestoVsRealChart({ proyeccion, anio, moneda }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const instance = useRef<Chart | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    if (instance.current) instance.current.destroy()

    // Presupuesto acumulado (línea de referencia) vs real acumulado (barras),
    // para leer de un vistazo si el gasto va por encima/por debajo del plan.
    const presupAcum: number[] = []
    const realAcum: number[] = []
    let pa = 0
    let ra = 0
    for (let i = 0; i < 12; i++) {
      pa += proyeccion.presupuestadoMensual[i]
      presupAcum.push(pa)
      // El real solo acumula hasta los meses transcurridos (evita "caer" a plano).
      if (i < proyeccion.mesesTranscurridos) { ra += proyeccion.ejecutadoMensual[i]; realAcum.push(ra) }
      else realAcum.push(NaN)
    }

    instance.current = new Chart(canvasRef.current, {
      data: {
        labels: MESES.map((m) => `${m}`),
        datasets: [
          {
            type: 'bar',
            label: 'Real acumulado',
            data: realAcum,
            backgroundColor: COLOR_REAL,
            borderRadius: 4,
            order: 2,
          },
          {
            type: 'line',
            label: 'Presupuesto acumulado',
            data: presupAcum,
            borderColor: COLOR_PRESUP,
            backgroundColor: COLOR_LINEA,
            borderWidth: 2,
            tension: 0.3,
            pointRadius: 0,
            fill: false,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(Number(ctx.parsed.y) || 0, moneda)}`,
            },
          },
        },
        scales: { y: { beginAtZero: true, ticks: { callback: (v) => formatCurrency(Number(v), moneda) } } },
      },
    })
    return () => { instance.current?.destroy(); instance.current = null }
  }, [proyeccion, moneda])

  const sobregiro = proyeccion.desviacionProyectada > 0
  const pctProyectado = proyeccion.presupuestadoAnual > 0
    ? Math.round((proyeccion.proyeccionAnual / proyeccion.presupuestadoAnual) * 100)
    : 0

  return (
    <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink)' }}>
          Presupuesto vs. real — {anio}
        </div>
        {proyeccion.mesesTranscurridos > 0 && proyeccion.mesesTranscurridos < 12 && (
          <div style={{ fontSize: 12, color: 'var(--at-ink-soft, var(--at-ink-3))' }}>
            Proyección de cierre:{' '}
            <strong style={{ color: sobregiro ? 'var(--at-danger)' : 'var(--at-success)' }}>
              {formatCurrency(proyeccion.proyeccionAnual, moneda)}
            </strong>{' '}
            ({pctProyectado}% del plan · {sobregiro ? '+' : ''}{formatCurrency(proyeccion.desviacionProyectada, moneda)})
          </div>
        )}
      </div>
      <div style={{ height: 240 }}>
        <canvas ref={canvasRef} aria-label={`Presupuesto vs real ${anio}`} role="img" />
      </div>
    </div>
  )
}
