import { useState, useMemo } from 'react'
import type { Registro, Cliente } from '../../types'

interface Props {
  registros: Registro[]
  clientes: Cliente[]
  moneda: string
}

type SortField = 'fecha' | 'cliente' | 'consumo' | 'monto' | 'estado'
type SortOrder = 'asc' | 'desc'

export function AdminHistoryTab({ registros, clientes, moneda }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterEstado, setFilterEstado] = useState<'todos' | 'pagado' | 'pendiente' | 'mora'>('todos')
  const [sortField, setSortField] = useState<SortField>('fecha')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  const registrosFiltrados = useMemo(() => {
    let filtered = registros

    // Filtrar por búsqueda
    if (searchTerm) {
      filtered = filtered.filter(r => {
        const cliente = clientes.find(c => c.id === r.cliente_id)
        return (
          cliente?.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
          cliente?.codigo.toLowerCase().includes(searchTerm.toLowerCase()) ||
          r.id.includes(searchTerm)
        )
      })
    }

    // Filtrar por estado
    if (filterEstado !== 'todos') {
      filtered = filtered.filter(r => r.estado === filterEstado)
    }

    // Ordenar
    filtered.sort((a, b) => {
      let aVal: string | number = ''
      let bVal: string | number = ''

      switch (sortField) {
        case 'fecha':
          aVal = a.fecha
          bVal = b.fecha
          break
        case 'cliente':
          aVal = clientes.find(c => c.id === a.cliente_id)?.nombre || ''
          bVal = clientes.find(c => c.id === b.cliente_id)?.nombre || ''
          break
        case 'consumo':
          aVal = a.consumo
          bVal = b.consumo
          break
        case 'monto':
          aVal = a.monto_calculado || 0
          bVal = b.monto_calculado || 0
          break
        case 'estado':
          aVal = a.estado
          bVal = b.estado
          break
      }

      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return filtered
  }, [registros, clientes, searchTerm, filterEstado, sortField, sortOrder])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  const getEstadoStyle = (estado: string) => {
    switch (estado) {
      case 'pagado':
        return { bg: '#dcfce7', color: '#166534', label: '✓ Pagado' }
      case 'pendiente':
        return { bg: '#fef3c7', color: '#b45309', label: '⏳ Pendiente' }
      case 'mora':
        return { bg: '#fee2e2', color: '#991b1b', label: '⚠ Mora' }
      default:
        return { bg: '#f1f5f9', color: '#475569', label: 'Desconocido' }
    }
  }

  const stats = {
    total: registrosFiltrados.length,
    consumoTotal: registrosFiltrados.reduce((acc, r) => acc + r.consumo, 0),
    recaudoTotal: registrosFiltrados.reduce((acc, r) => acc + (r.monto_calculado ?? 0), 0),
  }

  return (
    <div>
      {/* Filtros */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 200px',
        gap: '16px',
        marginBottom: '24px',
      }}>
        <input
          type="text"
          placeholder="Buscar por cliente, código o ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            border: '2px solid #e2e8f0',
            fontSize: '14px',
            fontFamily: 'inherit',
          }}
        />

        <select
          value={filterEstado}
          onChange={(e) => setFilterEstado(e.target.value as any)}
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            border: '2px solid #e2e8f0',
            fontSize: '14px',
            fontFamily: 'inherit',
            background: 'white',
          }}
        >
          <option value="todos">Todos los estados</option>
          <option value="pagado">Pagado</option>
          <option value="pendiente">Pendiente</option>
          <option value="mora">En mora</option>
        </select>
      </div>

      {/* Resumen */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '12px',
        marginBottom: '24px',
      }}>
        <div style={{
          padding: '16px',
          background: '#f0f9ff',
          borderRadius: '12px',
          border: '1px solid #bae6fd',
        }}>
          <div style={{ fontSize: '12px', color: '#0369a1', marginBottom: '4px' }}>Total Registros</div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: '#0284c7' }}>{stats.total}</div>
        </div>

        <div style={{
          padding: '16px',
          background: '#f0fdf4',
          borderRadius: '12px',
          border: '1px solid #bbf7d0',
        }}>
          <div style={{ fontSize: '12px', color: '#166534', marginBottom: '4px' }}>Consumo Total</div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: '#15803d' }}>{stats.consumoTotal.toFixed(2)} m³</div>
        </div>

        <div style={{
          padding: '16px',
          background: '#f7fee7',
          borderRadius: '12px',
          border: '1px solid #dcfce7',
        }}>
          <div style={{ fontSize: '12px', color: '#4d7c0f', marginBottom: '4px' }}>Recaudo Total</div>
          <div style={{ fontSize: '24px', fontWeight: '700', color: '#65a30d' }}>Q {stats.recaudoTotal.toFixed(2)}</div>
        </div>
      </div>

      {/* Tabla de registros */}
      <div style={{
        background: 'white',
        borderRadius: '12px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
        overflow: 'hidden',
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '14px',
          }}>
            <thead style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              <tr>
                <th scope="col"
                  onClick={() => handleSort('fecha')}
                  style={{
                    padding: '16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#475569',
                    cursor: 'pointer',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Fecha {sortField === 'fecha' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th scope="col"
                  onClick={() => handleSort('cliente')}
                  style={{
                    padding: '16px',
                    textAlign: 'left',
                    fontWeight: '700',
                    color: '#475569',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  Cliente {sortField === 'cliente' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th scope="col"
                  onClick={() => handleSort('consumo')}
                  style={{
                    padding: '16px',
                    textAlign: 'right',
                    fontWeight: '700',
                    color: '#475569',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  Consumo {sortField === 'consumo' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th scope="col"
                  onClick={() => handleSort('monto')}
                  style={{
                    padding: '16px',
                    textAlign: 'right',
                    fontWeight: '700',
                    color: '#475569',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  Monto {sortField === 'monto' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th scope="col"
                  onClick={() => handleSort('estado')}
                  style={{
                    padding: '16px',
                    textAlign: 'center',
                    fontWeight: '700',
                    color: '#475569',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  Estado {sortField === 'estado' && (sortOrder === 'asc' ? '↑' : '↓')}
                </th>
              </tr>
            </thead>
            <tbody>
              {registrosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{
                    padding: '32px',
                    textAlign: 'center',
                    color: '#94a3b8',
                  }}>
                    No se encontraron registros
                  </td>
                </tr>
              ) : (
                registrosFiltrados.map((registro) => {
                  const cliente = clientes.find(c => c.id === registro.cliente_id)
                  const estadoStyle = getEstadoStyle(registro.estado)

                  return (
                    <tr
                      key={registro.id}
                      style={{
                        borderBottom: '1px solid #e2e8f0',
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.background = '#f8fafc'
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLTableRowElement).style.background = 'transparent'
                      }}
                    >
                      <td style={{ padding: '16px', color: '#0f172a', fontWeight: '500', whiteSpace: 'nowrap' }}>
                        {new Date(registro.fecha).toLocaleDateString('es-GT')}
                      </td>
                      <td style={{ padding: '16px', color: '#475569' }}>
                        <div style={{ fontWeight: '600', color: '#0f172a', marginBottom: '2px' }}>
                          {cliente?.nombre}
                        </div>
                        <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                          {cliente?.codigo}
                        </div>
                      </td>
                      <td style={{ padding: '16px', textAlign: 'right', color: '#0ea5e9', fontWeight: '600' }}>
                        {registro.consumo.toFixed(2)} m³
                      </td>
                      <td style={{ padding: '16px', textAlign: 'right', color: '#10b981', fontWeight: '600' }}>
                        {moneda} {(registro.monto_calculado ?? 0).toFixed(2)}
                      </td>
                      <td style={{ padding: '16px', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '6px 12px',
                          background: estadoStyle.bg,
                          color: estadoStyle.color,
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '600',
                        }}>
                          {estadoStyle.label}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
