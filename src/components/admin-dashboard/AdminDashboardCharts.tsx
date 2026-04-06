import { useEffect, useRef, useState } from 'react'
import { Chart, registerables } from 'chart.js'
import type { Registro, Cliente } from '../../types'

Chart.register(...registerables)

interface Props {
  registros: Registro[]
  clientes: Cliente[]
}

export function AdminDashboardCharts({ registros, clientes }: Props) {
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartRef2 = useRef<HTMLCanvasElement>(null)
  const chartInstance = useRef<Chart | null>(null)
  const chartInstance2 = useRef<Chart | null>(null)

  // Gráfico 1: Consumo por mes (últimos 6 meses)
  useEffect(() => {
    if (!chartRef.current) return

    const mesesNombres = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
    const labels: string[] = []
    const dataConsumo: number[] = []
    const dataRecaudo: number[] = []

    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      const mes_idx = d.getMonth()
      const anio = d.getFullYear()
      labels.push(`${mesesNombres[mes_idx]} ${anio}`)

      const mesRegistros = registros.filter(r => {
        const fr = new Date(r.fecha)
        return fr.getMonth() === mes_idx && fr.getFullYear() === anio
      })

      const consumo = mesRegistros.reduce((acc, r) => acc + r.consumo, 0)
      const recaudo = mesRegistros.reduce((acc, r) => acc + (r.monto_calculado ?? 0), 0)

      dataConsumo.push(consumo)
      dataRecaudo.push(recaudo)
    }

    if (chartInstance.current) chartInstance.current.destroy()

    chartInstance.current = new Chart(chartRef.current, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Consumo (m³)',
            data: dataConsumo,
            borderColor: '#0ea5e9',
            backgroundColor: 'rgba(14, 165, 233, 0.1)',
            borderWidth: 3,
            fill: true,
            tension: 0.4,
            yAxisID: 'y',
          },
          {
            label: 'Recaudo (Q)',
            data: dataRecaudo,
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
  }, [registros])

  // Gráfico 2: Distribución por estado
  useEffect(() => {
    if (!chartRef2.current) return

    const estados = {
      pagado: registros.filter(r => r.estado === 'pagado').length,
      pendiente: registros.filter(r => r.estado === 'pendiente').length,
      mora: registros.filter(r => r.estado === 'mora').length,
    }

    if (chartInstance2.current) chartInstance2.current.destroy()

    chartInstance2.current = new Chart(chartRef2.current, {
      type: 'doughnut',
      data: {
        labels: ['Pagado', 'Pendiente', 'En Mora'],
        datasets: [{
          data: [estados.pagado, estados.pendiente, estados.mora],
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
  }, [registros])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '24px' }}>
      {/* Gráfico de Tendencias */}
      <div style={{
        background: 'white',
        borderRadius: '16px',
        padding: '24px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
      }}>
        <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '20px', color: '#0f172a' }}>
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
        <h3 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '20px', color: '#0f172a' }}>
          Distribución de Estados
        </h3>
        <div style={{ height: '320px' }}>
          <canvas ref={chartRef2} />
        </div>
      </div>
    </div>
  )
}
