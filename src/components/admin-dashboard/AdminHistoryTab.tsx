import { useState, useMemo } from 'react'
import type { Registro, Cliente } from '../../types'
import { DataTable, type DataTableColumn } from '../shared'
import { formatDate, formatCurrency, formatNumber } from '../../lib/format'

interface Props {
  registros: Registro[]
  clientes: Cliente[]
  moneda: string
}

type FiltroEstado = 'todos' | 'pagado' | 'pendiente' | 'mora'

const ESTADO_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pagado:    { bg: '#dcfce7', color: '#166534', label: '✓ Pagado' },
  pendiente: { bg: '#fef3c7', color: '#b45309', label: '⏳ Pendiente' },
  mora:      { bg: '#fee2e2', color: '#991b1b', label: '⚠ Mora' },
}

interface RowVm {
  registro: Registro
  cliente?: Cliente
}

export function AdminHistoryTab({ registros, clientes, moneda }: Props) {
  const [searchTerm, setSearchTerm] = useState('')
  const [filterEstado, setFilterEstado] = useState<FiltroEstado>('todos')

  // Index clientes por id para evitar el O(N×M) original que buscaba por
  // cliente_id en cada render de fila + cada sort + cada filter.
  const clientesById = useMemo(
    () => new Map(clientes.map(c => [c.id, c])),
    [clientes]
  )

  const filtrados: RowVm[] = useMemo(() => {
    const needle = searchTerm.toLowerCase().trim()
    return registros
      .filter(r => filterEstado === 'todos' || r.estado === filterEstado)
      .filter(r => {
        if (!needle) return true
        const cliente = clientesById.get(r.cliente_id ?? '')
        return (
          (cliente?.nombre?.toLowerCase().includes(needle) ?? false) ||
          (cliente?.codigo?.toLowerCase().includes(needle) ?? false) ||
          r.id.includes(needle)
        )
      })
      .map(registro => ({ registro, cliente: clientesById.get(registro.cliente_id ?? '') }))
  }, [registros, filterEstado, searchTerm, clientesById])

  const stats = useMemo(() => ({
    total: filtrados.length,
    consumoTotal: filtrados.reduce((acc, r) => acc + r.registro.consumo, 0),
    recaudoTotal: filtrados.reduce((acc, r) => acc + (r.registro.monto_calculado ?? 0), 0),
  }), [filtrados])

  const columns: DataTableColumn<RowVm>[] = useMemo(() => [
    {
      key: 'fecha',
      header: 'Fecha',
      sortable: true,
      accessor: r => r.registro.fecha,
      render: r => formatDate(r.registro.fecha),
    },
    {
      key: 'cliente',
      header: 'Cliente',
      sortable: true,
      accessor: r => r.cliente?.nombre ?? '',
      render: r => (
        <div>
          <div style={{ fontWeight: 600, color: '#15291F' }}>{r.cliente?.nombre ?? '—'}</div>
          <div style={{ fontSize: '12px', color: '#7E9389' }}>{r.cliente?.codigo ?? ''}</div>
        </div>
      ),
    },
    {
      key: 'consumo',
      header: 'Consumo',
      sortable: true,
      align: 'right',
      accessor: r => r.registro.consumo,
      render: r => (
        <span style={{ color: '#1B3B36', fontWeight: 600 }}>
          {formatNumber(r.registro.consumo)} m³
        </span>
      ),
    },
    {
      key: 'monto',
      header: 'Monto',
      sortable: true,
      align: 'right',
      accessor: r => r.registro.monto_calculado ?? 0,
      render: r => (
        <span style={{ color: '#10b981', fontWeight: 600 }}>
          {formatCurrency(r.registro.monto_calculado, moneda)}
        </span>
      ),
    },
    {
      key: 'estado',
      header: 'Estado',
      sortable: true,
      align: 'center',
      accessor: r => r.registro.estado,
      render: r => {
        const style = ESTADO_STYLES[r.registro.estado] ?? { bg: '#EAE6D8', color: '#3E5A4C', label: r.registro.estado }
        return (
          <span style={{
            display: 'inline-block',
            padding: '6px 12px',
            background: style.bg,
            color: style.color,
            borderRadius: '6px',
            fontSize: '12px',
            fontWeight: 600,
          }}>
            {style.label}
          </span>
        )
      },
    },
  ], [moneda])

  return (
    <div>
      {/* Filtros — controlados por el padre para poder calcular los stats */}
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
            border: '2px solid var(--at-line)',
            fontSize: '14px',
            fontFamily: 'inherit',
          }}
        />
        <select
          value={filterEstado}
          onChange={(e) => setFilterEstado(e.target.value as FiltroEstado)}
          aria-label="Filtrar por estado"
          style={{
            padding: '12px 16px',
            borderRadius: '8px',
            border: '2px solid var(--at-line)',
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

      {/* Stats — derivados del set filtrado */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '12px',
        marginBottom: '24px',
      }}>
        <StatCard
          label="Total Registros"
          value={String(stats.total)}
          bg="#EEF2EC" border="#C2D2CA" labelColor="#102622" valueColor="#102622"
        />
        <StatCard
          label="Consumo Total"
          value={`${formatNumber(stats.consumoTotal)} m³`}
          bg="#f0fdf4" border="#bbf7d0" labelColor="#166534" valueColor="#15803d"
        />
        <StatCard
          label="Recaudo Total"
          value={formatCurrency(stats.recaudoTotal, moneda)}
          bg="#f7fee7" border="#dcfce7" labelColor="#4d7c0f" valueColor="#65a30d"
        />
      </div>

      <DataTable<RowVm>
        data={filtrados}
        columns={columns}
        rowKey={r => r.registro.id}
        defaultSort={{ key: 'fecha', direction: 'desc' }}
        pageSize={50}
        emptyState={{
          icon: '📋',
          title: 'No se encontraron registros',
          description: searchTerm || filterEstado !== 'todos'
            ? 'Prueba con otros filtros o limpia la búsqueda.'
            : 'Aún no hay lecturas registradas.',
        }}
      />
    </div>
  )
}

// Sub-componente local — los KPI cards de AdminHistoryTab tienen su propio
// look (fondo pastel claro con borde), distinto a los <KpiCard> gradient.
// Se queda local hasta que decidamos si unificarlos.
function StatCard({
  label, value, bg, border, labelColor, valueColor,
}: {
  label: string
  value: string
  bg: string
  border: string
  labelColor: string
  valueColor: string
}) {
  return (
    <div style={{
      padding: '16px',
      background: bg,
      borderRadius: '12px',
      border: `1px solid ${border}`,
    }}>
      <div style={{ fontSize: '12px', color: labelColor, marginBottom: '4px' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: 700, color: valueColor }}>{value}</div>
    </div>
  )
}
