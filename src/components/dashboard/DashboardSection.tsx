import { useEffect, useMemo, useRef } from 'react'
import type { Registro } from '../../types'
import { resumenDashboardAgua } from '../../lib/dashboardAgua'
import { Chart } from '../../lib/chartjs'

// El CSS de .dash-skeleton (shimmer) vive ahora en src/styles/runtime.css (I24).

interface Props {
  registros: Registro[]
  moneda?: string
  isLoading?: boolean
}

export function DashboardSection({ registros, moneda = 'Q', isLoading = false }: Props) {
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<Chart | null>(null)

  // KPIs + serie en una sola pasada, con comparación año+mes y parse de fecha
  // seguro ante date-only strings (auditoría 2026-07-16, D2).
  const resumen = useMemo(() => resumenDashboardAgua(registros), [registros])

  useEffect(() => {
    if (!chartRef.current) return

    if (chartInstance.current) chartInstance.current.destroy()

    chartInstance.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: resumen.serie.labels,
        datasets: [{
          label: 'Consumo (m³)',
          data: resumen.serie.consumo,
          borderColor: 'var(--at-primary)',
          backgroundColor: 'rgba(27, 59, 54, 0.1)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    })

    return () => { chartInstance.current?.destroy() }
  }, [resumen])

  const statCards = [
    { label: 'Consumo Mes (m³)', value: resumen.consumoMes.toFixed(2), bg: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-primary-hover) 100%)' },
    { label: `Recaudo Estimado (${moneda})`, value: resumen.recaudoMes.toFixed(2), bg: 'linear-gradient(135deg, var(--at-success) 0%, var(--at-success-strong) 100%)' },
    { label: 'Pendientes de Pago', value: String(resumen.pendientes), bg: 'linear-gradient(135deg, var(--at-warning) 0%, var(--at-warning) 100%)' },
  ]

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {statCards.map(s => (
          <div key={s.label} style={{ background: s.bg, padding: '24px', borderRadius: '20px', color: 'white', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
            <div style={{ fontSize: '14px', opacity: 0.9 }}>{s.label}</div>
            {isLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                <div className="dash-skeleton" style={{ height: '28px', width: '65%' }} />
              </div>
            ) : (
              <div style={{ fontSize: '28px', fontWeight: 700, marginTop: '8px' }}>{s.value}</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--at-surface)', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '20px' }}>Tendencias de Consumo</div>
        <div style={{ height: '300px', position: 'relative' }}>
          {isLoading && (
            <div style={{
              position: 'absolute', inset: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: '10px', background: 'rgba(255,255,255,0.85)', borderRadius: '12px', zIndex: 1,
            }}>
              <div style={{
                width: '32px', height: '32px',
                border: '3px solid var(--at-line)', borderTop: '3px solid var(--at-primary)',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              }} />
              <span style={{ fontSize: '13px', color: 'var(--at-ink-3)', fontWeight: 500 }}>Cargando datos…</span>
            </div>
          )}
          <canvas ref={chartRef} />
        </div>
      </div>
    </div>
  )
}
