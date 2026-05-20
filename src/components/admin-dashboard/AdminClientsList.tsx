import { useState } from 'react'
import type { Cliente, Registro } from '../../types'

interface Props {
  clientes: Cliente[]
  registros: Registro[]
  moneda: string
  proyectoId: string
}

export function AdminClientsList({ clientes, registros, moneda }: Props) {
  const [searchTerm, setSearchTerm] = useState('')

  const clientesFiltrados = clientes.filter(c =>
    c.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.codigo.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getClienteStats = (clienteId: string) => {
    const registrosCliente = registros.filter(r => r.cliente_id === clienteId)
    const consumoTotal = registrosCliente.reduce((acc, r) => acc + r.consumo, 0)
    const recaudoTotal = registrosCliente.reduce((acc, r) => acc + (r.monto_calculado ?? 0), 0)
    const ultimaLectura = registrosCliente.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())[0]
    const estado = ultimaLectura?.estado ?? 'sin-lectura'

    return { consumoTotal, recaudoTotal, ultimaLectura, estado }
  }

  const getEstadoColor = (estado: string) => {
    switch (estado) {
      case 'pagado':
        return { bg: 'rgba(16, 185, 129, 0.15)', color: '#059669', label: '✓ Pagado' }
      case 'pendiente':
        return { bg: 'rgba(245, 158, 11, 0.15)', color: '#d97706', label: '⏳ Pendiente' }
      case 'mora':
        return { bg: 'rgba(239, 68, 68, 0.15)', color: '#dc2626', label: '⚠ Mora' }
      default:
        return { bg: 'rgba(148, 163, 184, 0.15)', color: '#7E9389', label: 'Sin lectura' }
    }
  }

  return (
    <div>
      {/* Buscador */}
      <div style={{ marginBottom: '24px' }}>
        <input
          type="text"
          placeholder="Buscar cliente por nombre o código..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 16px',
            borderRadius: '12px',
            border: '2px solid var(--at-line)',
            fontSize: '14px',
            fontFamily: 'inherit',
          }}
        />
      </div>

      {/* Lista de clientes */}
      <div style={{ display: 'grid', gap: '12px' }}>
        {clientesFiltrados.length === 0 ? (
          <div style={{
            padding: '32px',
            background: 'white',
            borderRadius: '12px',
            textAlign: 'center',
            color: '#7E9389',
          }}>
            No se encontraron clientes
          </div>
        ) : (
          clientesFiltrados.map(cliente => {
            const stats = getClienteStats(cliente.id)
            const estadoInfo = getEstadoColor(stats.estado)

            return (
              <div
                key={cliente.id}
                style={{
                  background: 'white',
                  borderRadius: '12px',
                  padding: '16px',
                  border: '1px solid var(--at-line)',
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr 1fr auto',
                  gap: '16px',
                  alignItems: 'center',
                }}
              >
                {/* Nombre y código */}
                <div>
                  <div style={{ fontWeight: '600', color: '#15291F', marginBottom: '4px' }}>
                    {cliente.nombre}
                  </div>
                  <div style={{ fontSize: '12px', color: '#7E9389' }}>
                    Cód: {cliente.codigo}
                  </div>
                </div>

                {/* Consumo total */}
                <div>
                  <div style={{ fontSize: '12px', color: '#7E9389', marginBottom: '4px' }}>
                    Consumo Total
                  </div>
                  <div style={{ fontWeight: '700', fontSize: '16px', color: '#1B3B36' }}>
                    {stats.consumoTotal.toFixed(2)} m³
                  </div>
                </div>

                {/* Recaudo total */}
                <div>
                  <div style={{ fontSize: '12px', color: '#7E9389', marginBottom: '4px' }}>
                    Recaudo Total
                  </div>
                  <div style={{ fontWeight: '700', fontSize: '16px', color: '#10b981' }}>
                    {stats.recaudoTotal.toFixed(2)} {moneda}
                  </div>
                </div>

                {/* Última lectura */}
                <div>
                  <div style={{ fontSize: '12px', color: '#7E9389', marginBottom: '4px' }}>
                    Última Lectura
                  </div>
                  <div style={{ fontWeight: '500', fontSize: '13px', color: '#3E5A4C' }}>
                    {stats.ultimaLectura
                      ? new Date(stats.ultimaLectura.fecha).toLocaleDateString('es-GT')
                      : 'Sin lecturas'
                    }
                  </div>
                </div>

                {/* Estado */}
                <div
                  style={{
                    background: estadoInfo.bg,
                    color: estadoInfo.color,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: '600',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {estadoInfo.label}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Resumen */}
      {clientesFiltrados.length > 0 && (
        <div style={{
          marginTop: '24px',
          padding: '16px',
          background: '#EEF2EC',
          borderRadius: '12px',
          border: '1px solid var(--at-primary-soft-2)',
          fontSize: '13px',
          color: '#102622',
        }}>
          <strong>{clientesFiltrados.length}</strong> clientes mostrados
        </div>
      )}
    </div>
  )
}
