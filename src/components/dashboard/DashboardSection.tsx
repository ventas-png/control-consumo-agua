import { useEffect, useRef } from 'react'
import type { Registro } from '../../types'
import { calcularTotalPagar } from '../../lib/business'
import { Chart, registerables } from 'chart.js'

Chart.register(...registerables)

interface Props {
  registros: Registro[]
}

export function DashboardSection({ registros }: Props) {
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<Chart | null>(null)

  const hoy = new Date()
  const mesActual = registros.filter(r => new Date(r.fecha).getMonth() === hoy.getMonth())
  const consumoTotal = mesActual.reduce((acc, r) => acc + (parseFloat(String(r.consumo)) || 0), 0)
  const recaudoTotal = mesActual.reduce((acc, r) => {
    const monto = r.monto_calculado ?? calcularTotalPagar(r.consumo, r.tarifa_aplicada, r.canon_aplicado ?? 20).total
    return acc + monto
  }, 0)
  const pendientes = registros.filter(r => r.estado === 'pendiente').length

  useEffect(() => {
    if (!chartRef.current) return

    const mesesNombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    const labels: string[] = []
    const dataConsumo: number[] = []

    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      const mes_idx = d.getMonth()
      const anio = d.getFullYear()
      labels.push(`${mesesNombres[mes_idx]} ${anio}`)
      const suma = registros
        .filter(r => {
          const fr = new Date(r.fecha)
          return fr.getMonth() === mes_idx && fr.getFullYear() === anio
        })
        .reduce((acc, curr) => acc + curr.consumo, 0)
      dataConsumo.push(suma)
    }

    if (chartInstance.current) chartInstance.current.destroy()

    chartInstance.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Consumo (m³)',
          data: dataConsumo,
          borderColor: '#0ea5e9',
          backgroundColor: 'rgba(14, 165, 233, 0.1)',
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
  }, [registros])

  const statCards = [
    { label: 'Consumo Mes (m³)', value: consumoTotal.toFixed(2), bg: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)' },
    { label: 'Recaudo Estimado (Q)', value: recaudoTotal.toFixed(2), bg: 'linear-gradient(135deg, #10b981 0%, #059669 100%)' },
    { label: 'Pendientes de Pago', value: String(pendientes), bg: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' },
  ]

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {statCards.map(s => (
          <div key={s.label} style={{ background: s.bg, padding: '24px', borderRadius: '20px', color: 'white', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
            <div style={{ fontSize: '14px', opacity: 0.9 }}>{s.label}</div>
            <div style={{ fontSize: '28px', fontWeight: 700, marginTop: '8px' }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'white', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '20px' }}>Tendencias de Consumo</div>
        <div style={{ height: '300px' }}>
          <canvas ref={chartRef} />
        </div>
      </div>
    </div>
  )
}
