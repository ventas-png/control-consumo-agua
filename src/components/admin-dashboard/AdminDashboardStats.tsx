import { memo } from 'react'
import type { Registro, Cliente } from '../../types'
import { calcularTotalPagar } from '../../lib/business'

const SKELETON_CSS = `
@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
.stat-skeleton {
  background: linear-gradient(90deg,
    rgba(255,255,255,0.18) 25%,
    rgba(255,255,255,0.38) 50%,
    rgba(255,255,255,0.18) 75%
  );
  background-size: 800px 100%;
  animation: shimmer 1.4s infinite linear;
  border-radius: 8px;
}
`

function SkeletonLine({ width, height = 14 }: { width: number | string; height?: number }) {
  return (
    <div
      className="stat-skeleton"
      style={{ width, height, borderRadius: '6px' }}
    />
  )
}

interface Props {
  registros: Registro[]
  moneda: string
  clientes: Cliente[]
  fechaDesde?: string
  fechaHasta?: string
  isLoading?: boolean
}

function AdminDashboardStatsImpl({ registros, moneda, clientes, fechaDesde, fechaHasta, isLoading = false }: Props) {
  const mesActual = registros.filter(r => {
    const f = r.fecha.slice(0, 10)
    return (!fechaDesde || f >= fechaDesde) && (!fechaHasta || f <= fechaHasta)
  })

  const consumoTotal = mesActual.reduce((acc, r) => acc + (parseFloat(String(r.consumo)) || 0), 0)

  const recaudoTotal = mesActual.reduce((acc, r) => {
    const monto =
      r.monto_calculado > 0
        ? r.monto_calculado
        : (r.tarifa_aplicada > 0 || r.canon_aplicado > 0)
          ? calcularTotalPagar(
              r.consumo,
              r.tarifa_aplicada,
              r.canon_aplicado ?? 0,
              0,
              r.tarifa_exceso_aplicada ?? 0
            ).total
          : 0
    return acc + monto
  }, 0)

  const pendientes = mesActual.filter(r => r.estado === 'pendiente').length
  const pagados = mesActual.filter(r => r.estado === 'pagado').length
  const enMora = mesActual.filter(r => r.estado === 'mora').length

  const totalClientes = clientes.length
  const clientesConLectura = new Set(mesActual.map(r => r.cliente_id)).size

  const stats = [
    {
      label: 'Consumo del Período',
      value: `${consumoTotal.toFixed(2)}`,
      unit: 'm³',
      icon: '💧',
      bg: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-primary-hover) 100%)',
    },
    {
      label: 'Recaudo Estimado',
      value: recaudoTotal.toFixed(2),
      unit: moneda,
      icon: '💰',
      bg: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    },
    {
      label: 'Pendientes',
      value: `${pendientes}`,
      unit: 'lecturas',
      icon: '⏳',
      bg: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    },
    {
      label: 'En Mora',
      value: `${enMora}`,
      unit: 'pagos',
      icon: '⚠️',
      bg: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
    },
    {
      label: 'Pagados',
      value: `${pagados}`,
      unit: 'lecturas',
      icon: '✓',
      bg: 'linear-gradient(135deg, var(--at-accent) 0%, var(--at-accent-hover) 100%)',
    },
    {
      label: 'Clientes Activos',
      value: `${clientesConLectura}`,
      unit: `de ${totalClientes}`,
      icon: '👥',
      bg: 'linear-gradient(135deg, var(--at-accent-2) 0%, var(--at-primary-hover) 100%)',
    },
  ]

  return (
    <>
      <style>{SKELETON_CSS}</style>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '32px',
      }}>
        {stats.map((stat, idx) => (
          <div
            key={idx}
            style={{
              background: stat.bg,
              padding: '24px',
              borderRadius: '16px',
              color: 'white',
              boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', opacity: 0.9, fontWeight: 500, marginBottom: '8px' }}>
                  {stat.label}
                </div>
                {isLoading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
                    <SkeletonLine width="70%" height={32} />
                    <SkeletonLine width="45%" height={12} />
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                    <div style={{ fontSize: '32px', fontWeight: '700', letterSpacing: '-1px' }}>
                      {stat.value}
                    </div>
                    <div style={{ fontSize: '14px', opacity: 0.85, fontWeight: '500' }}>
                      {stat.unit}
                    </div>
                  </div>
                )}
              </div>
              <div style={{ fontSize: '32px', opacity: isLoading ? 0.4 : 0.8 }}>{stat.icon}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export const AdminDashboardStats = memo(AdminDashboardStatsImpl)
