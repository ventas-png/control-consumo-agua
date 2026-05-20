import { useEffect, useRef, useMemo, memo } from 'react'
import { Chart } from '../../lib/chartjs'
import type { Registro, Cliente } from '../../types'

interface Props {
  registros: Registro[]
  clientes: Cliente[]
}

const MESES_NOMBRES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

function AdminDashboardChartsImpl({ registros }: Props) {
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartRef2 = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<Chart | null>(null)
  const chartInstance2 = useRef<Chart | null>(null)

  // Pre-compute todos los datos derivados en una sola pasada sobre registros.
  // Antes: 6× filter por mes + 12× reduce + 3× filter por estado = 21 pasadas
  // sobre el array; con 10k+ registros era el principal cuello de botella
  // del dashboard. Ahora una sola pasada (O(n)) construye ambos charts.
  const chartsData = useMemo(() => {
    const monthKeys: string[] = []
    const labels: string[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      monthKeys.push(key)
      labels.push(`${MESES_NOMBRES[d.getMonth()]} ${d.getFullYear()}`)
    }
    const buckets: Record<string, { consumo: number; recaudo: number }> = {}
    monthKeys.forEach(k => { buckets[k] = { consumo: 0, recaudo: 0 } })

    let pagado = 0
    let pendiente = 0
    let mora = 0

    for (const r of registros) {
      if (r.estado === 'pagado') pagado++
      else if (r.estado === 'pendiente') pendiente++
      else if (r.estado === 'mora') mora++
      const d = new Date(r.fecha)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const b = buckets[key]
      if (b) {
        b.consumo += r.consumo
        b.recaudo += r.monto_calculado ?? 0
      }
    }

    return {
      labels,
      dataConsumo: monthKeys.map(k => buckets[k].consumo),
      dataRecaudo: monthKeys.map(k => buckets[k].recaudo),
      estados: [pagado, pendiente, mora],
    }
  }, [registros])

  // Gráfico 1: Consumo por mes (últimos 6 meses)
  useEffect(() => {
    if (!chartRef.current) return

    if (chartInstance.current) chartInstance.current.destroy()

    chartInstance.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels: chartsData.labels,
        datasets: [
          {
            label: 'Consumo (m³)',
            data: chartsData.dataConsumo,
            borderColor: '#1B3B36',
            backgroundColor: 'rgba(27, 59, 54, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            yAxisID: 'y',
          },
          {
            label: 'Recaudo (Q)',
            data: chartsData.dataRecaudo,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top' },
        },
        scales: {
          y: {
            type: 'linear',
            position: 'left',
            beginAtZero: true,
            title: { display: true, text: 'Consumo (m³)' },
          },
          y1: {
            type: 'linear',
            position: 'right',
            beginAtZero: true,
            title: { display: true, text: 'Recaudo (Q)' },
            grid: { drawOnChartArea: false },
          },
        },
      },
    })

    return () => { chartInstance.current?.destroy() }
  }, [chartsData])

  // Gráfico 2: Distribución por estado
  useEffect(() => {
    if (!chartRef2.current) return

    if (chartInstance2.current) chartInstance2.current.destroy()

    chartInstance2.current = new Chart(chartRef2.current, {
      type: 'doughnut',
      data: {
        labels: ['Pagado', 'Pendiente', 'En Mora'],
        datasets: [{
          data: chartsData.estados,
          backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
          borderColor: ['#059669', '#d97706', '#dc2626'],
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'bottom' },
        },
      },
    })

    return () => { chartInstance2.current?.destroy() }
  }, [chartsData])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: '20px' }}>
      {/* Gráfico de Tendencias */}
      <div style={{
        background: 'white',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
      }}>
        <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '20px', color: '#15291F' }}>
          Tendencias de Consumo y Recaudo
        </h3>
        <div style={{ height: '320px' }}>
          <canvas ref={chartRef} />
        </div>
      </div>

      {/* Gráfico de Estados */}
      <div style={{
        background: 'white',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
      }}>
        <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '20px', color: '#15291F' }}>
          Distribución de Estados
        </h3>
        <div style={{ height: '320px' }}>
          <canvas ref={chartRef2} />
        </div>
      </div>
    </div>
  )
}

// React.memo evita re-render cuando el padre (AdminClientDashboard) cambia
// pero las props (registros) siguen siendo la misma referencia — clave para
// que la memoización en padre tenga efecto.
export const AdminDashboardCharts = memo(AdminDashboardChartsImpl)
