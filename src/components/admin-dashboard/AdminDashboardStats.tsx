import type { Registro, Cliente } from '../../types'
import { calcularTotalPagar } from '../../lib/business'

interface Props {
  registros: Registro[]
  moneda: string
  clientes: Cliente[]
}

export function AdminDashboardStats({ registros, moneda, clientes }: Props) {
  const hoy = new Date()
  const mesActual = registros.filter(r => new Date(r.fecha).getMonth() === hoy.getMonth())

  const consumoTotal = mesActual.reduce((acc, r) => acc + (parseFloat(String(r.consumo)) || 0), 0)

  const recaudoTotal = mesActual.reduce((acc, r) => {
    const monto = r.monto_calculado ?? calcularTotalPagar(r.consumo, r.tarifa_aplicada, r.canon_aplicado ?? 20).total
    return acc + monto
  }, 0)

  const pendientes = registros.filter(r => r.estado === 'pendiente').length
  const pagados = registros.filter(r => r.estado === 'pagado').length
  const enMora = registros.filter(r => r.estado === 'mora').length

  const totalClientes = clientes.length
  const clientesConLectura = new Set(registros.map(r => r.cliente_id)).size

  const stats = [
    {
      label: 'Consumo Total (mes)',
      value: `${consumoTotal.toFixed(2)} m³`,
      icon: '💧',
      bg: 'linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)',
      color: 'white',
    },
    {
      label: `Recaudo (${moneda})`,
      value: recaudoTotal.toFixed(2),
      icon: '💰',
      bg: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      color: 'white',
    },
    {
      label: 'Pendientes de Pago',
      value: `${pendientes}`,
      icon: '⏳',
      bg: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
      color: 'white',
    },
    {
      label: 'En Mora',
      value: `${enMora}`,
      icon: '⚠️',
      bg: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
      color: 'white',
    },
    {
      label: 'Pagados',
      value: `${pagados}`,
      icon: '✓',
      bg: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
      color: 'white',
    },
    {
      label: 'Clientes Activos',
      value: `${clientesConLectura}/${totalClientes}`,
      icon: '👥',
      bg: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
      color: 'white',
    },
  ]

  return (
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
            color: stat.color,
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '13px', opacity: 0.9, fontWeight: '500', marginBottom: '8px' }}>
                {stat.label}
              </div>
              <div style={{ fontSize: '32px', fontWeight: '700', letterSpacing: '-1px' }}>
                {stat.value}
              </div>
            </div>
            <div style={{ fontSize: '32px', opacity: 0.8 }}>{stat.icon}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
