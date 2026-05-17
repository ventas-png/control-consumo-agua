import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type { CuotaCondominio, Unidad } from '../../../types'
import Swal from 'sweetalert2'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'

interface Props {
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  moneda: string
  proyectoId: string
  companyId: string
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_STYLE: Record<string, { color: string; bg: string }> = {
  pagado:   { color: '#10b981', bg: '#dcfce7' },
  pendiente:{ color: '#f59e0b', bg: '#fef3c7' },
  moroso:   { color: '#ef4444', bg: '#fee2e2' },
}

export function EstadoCuentaTab({ cuotas, unidades, moneda, canEdit, onRefresh }: Props) {
  const [selectedUnidad, setSelectedUnidad] = useState<string>('all')

  const filtered = cuotas.filter(c => selectedUnidad === 'all' || c.unidad_id === selectedUnidad)

  const totals = {
    total:    filtered.reduce((s, c) => s + c.monto, 0),
    pagado:   filtered.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0),
    pendiente:filtered.filter(c => c.estado === 'pendiente').reduce((s, c) => s + c.monto, 0),
    moroso:   filtered.filter(c => c.estado === 'moroso').reduce((s, c) => s + c.monto, 0),
  }
  const saldo = totals.total - totals.pagado

  async function marcarPagada(id: string) {
    const r = await Swal.fire({ title: '¿Marcar como pagada?', icon: 'question', showCancelButton: true, confirmButtonText: 'Sí, pagada', confirmButtonColor: '#10b981' })
    if (!r.isConfirmed) return
    await supabase.from('cuotas_condominio').update({ estado: 'pagado' }).eq('id', id)
    onRefresh()
  }

  async function marcarMorosa(id: string) {
    const r = await Swal.fire({ title: '¿Marcar como morosa?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Sí, morosa', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('cuotas_condominio').update({ estado: 'moroso' }).eq('id', id)
    onRefresh()
  }

  const columns: DataTableColumn<CuotaCondominio>[] = [
    {
      key: 'periodo',
      header: 'Período',
      sortable: true,
      render: row => <span style={{ fontWeight: 600 }}>{row.periodo}</span>,
    },
    {
      key: 'unidad_nombre',
      header: 'Unidad',
      sortable: true,
      render: row => <span style={{ color: '#64748b' }}>{row.unidad_nombre ?? '—'}</span>,
    },
    {
      key: 'concepto',
      header: 'Concepto',
      sortable: true,
      render: row => <span style={{ color: '#64748b' }}>{row.concepto}</span>,
    },
    {
      key: 'fecha_vencimiento',
      header: 'Vencimiento',
      sortable: true,
      render: row => <span style={{ color: '#94a3b8', fontSize: '12px' }}>{row.fecha_vencimiento ?? '—'}</span>,
    },
    {
      key: 'monto',
      header: 'Monto',
      sortable: true,
      align: 'right',
      render: row => <span style={{ fontWeight: 700 }}>{moneda} {row.monto.toFixed(2)}</span>,
    },
    {
      key: 'estado',
      header: 'Estado',
      sortable: true,
      render: row => {
        const es = ESTADO_STYLE[row.estado] ?? ESTADO_STYLE.pendiente
        return <span style={{ background: es.bg, color: es.color, padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>{row.estado}</span>
      },
    },
    {
      key: 'acciones',
      header: '',
      render: row => canEdit && row.estado !== 'pagado' ? (
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={() => marcarPagada(row.id)}
            style={{ padding: '3px 8px', background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
            ✓ Pagada
          </button>
          {row.estado === 'pendiente' && (
            <button onClick={() => marcarMorosa(row.id)}
              style={{ padding: '3px 7px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>
              Morosa
            </button>
          )}
        </div>
      ) : null,
    },
  ]

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Estado de Cuenta</h2>
        <button onClick={() => window.print()}
          style={{ padding: '6px 12px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
          🖨️ Imprimir
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total asignado', value: totals.total,    color: '#0ea5e9' },
          { label: 'Recaudado',      value: totals.pagado,   color: '#10b981' },
          { label: 'Saldo pendiente',value: saldo,           color: saldo > 0 ? '#f59e0b' : '#10b981' },
          { label: 'Moroso',         value: totals.moroso,   color: totals.moroso > 0 ? '#ef4444' : '#10b981' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: k.color }}>{moneda} {k.value.toFixed(2)}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Unidad detail card cuando una unidad específica está seleccionada */}
      {selectedUnidad !== 'all' && (() => {
        const u = unidades.find(x => x.id === selectedUnidad)
        const cuotasU = filtered
        const pagadas = cuotasU.filter(c => c.estado === 'pagado').length
        const totalU = cuotasU.length
        return u ? (
          <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: '22px' }}>🏠</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '14px', color: '#0f172a' }}>{u.nombre}</div>
              <div style={{ fontSize: '12px', color: '#64748b' }}>{pagadas}/{totalU} cuotas pagadas — Cumplimiento: {totalU > 0 ? Math.round((pagadas/totalU)*100) : 0}%</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: '18px', fontWeight: 800, color: saldo > 0 ? '#f59e0b' : '#10b981' }}>Saldo: {moneda} {saldo.toFixed(2)}</div>
            </div>
          </div>
        ) : null
      })()}

      <DataTable
        data={filtered}
        columns={columns}
        rowKey="id"
        searchableKeys={['periodo', 'concepto', row => row.unidad_nombre ?? '']}
        searchPlaceholder="Filtrar período, concepto o unidad…"
        filters={[
          {
            key: 'unidad',
            value: selectedUnidad,
            onChange: setSelectedUnidad,
            options: [{ value: 'all', label: 'Todas las unidades' }, ...unidades.map(u => ({ value: u.id, label: u.nombre }))],
          },
        ]}
        pageSizeOptions={[25, 50, 100, 200]}
        defaultSort={{ key: 'periodo', direction: 'desc' }}
        emptyState={{ icon: '💰', title: 'No hay cuotas para mostrar' }}
      />
      <style>{`@media print { button { display: none !important; } }`}</style>
    </div>
  )
}
