import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { confirm } from '../../shared/Dialog'
import type { CuotaCondominio, Unidad } from '../../../types'
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
  pagado:   { color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  pendiente:{ color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  moroso:   { color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
}

export function EstadoCuentaTab({ cuotas, unidades, moneda, canEdit, onRefresh }: Props) {
  const [selectedUnidad, setSelectedUnidad] = useState<string>('all')
  const [searchPeriodo, setSearchPeriodo] = useState('')

  const filtered = cuotas
    .filter(c => selectedUnidad === 'all' || c.unidad_id === selectedUnidad)
    .filter(c => !searchPeriodo || c.periodo.includes(searchPeriodo))
    .sort((a, b) => b.periodo.localeCompare(a.periodo))

  const totals = {
    total:    filtered.reduce((s, c) => s + c.monto, 0),
    pagado:   filtered.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0),
    pendiente:filtered.filter(c => c.estado === 'pendiente').reduce((s, c) => s + c.monto, 0),
    moroso:   filtered.filter(c => c.estado === 'moroso').reduce((s, c) => s + c.monto, 0),
  }
  const saldo = totals.total - totals.pagado

  async function marcarPagada(id: string) {
    const r = await confirm({ title: '¿Marcar como pagada?', icon: 'question', confirmText: 'Sí, pagada' })
    if (!r.isConfirmed) return
    await supabase.from('cuotas_condominio').update({ estado: 'pagado' }).eq('id', id)
    onRefresh()
  }

  async function marcarMorosa(id: string) {
    const r = await confirm({ title: '¿Marcar como morosa?', icon: 'warning', variant: 'danger', confirmText: 'Sí, morosa' })
    if (!r.isConfirmed) return
    await supabase.from('cuotas_condominio').update({ estado: 'moroso' }).eq('id', id)
    onRefresh()
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Estado de Cuenta</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={selectedUnidad} onChange={e => setSelectedUnidad(e.target.value)}
            style={{ padding: '6px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface)', cursor: 'pointer' }}>
            <option value="all">Todas las unidades</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <input value={searchPeriodo} onChange={e => setSearchPeriodo(e.target.value)}
            placeholder="Filtrar período…" style={{ padding: '6px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', width: '130px' }} />
          <button onClick={() => window.print()}
            style={{ padding: '6px 12px', background: 'var(--at-ink)', color: 'white', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
            🖨️ Imprimir
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total asignado', value: totals.total,    color: 'var(--at-primary)' },
          { label: 'Recaudado',      value: totals.pagado,   color: 'var(--at-success)' },
          { label: 'Saldo pendiente',value: saldo,           color: saldo > 0 ? 'var(--at-warning)' : 'var(--at-success)' },
          { label: 'Moroso',         value: totals.moroso,   color: totals.moroso > 0 ? 'var(--at-danger)' : 'var(--at-success)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: k.color }}>{moneda} {k.value.toFixed(2)}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Unidad detail card when a specific unit is selected */}
      {selectedUnidad !== 'all' && (() => {
        const u = unidades.find(x => x.id === selectedUnidad)
        const cuotasU = filtered
        const pagadas = cuotasU.filter(c => c.estado === 'pagado').length
        const totalU = cuotasU.length
        return u ? (
          <div style={{ background: 'var(--at-primary-tint)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: '22px' }}>🏠</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--at-ink)' }}>{u.nombre}</div>
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{pagadas}/{totalU} cuotas pagadas — Cumplimiento: {totalU > 0 ? Math.round((pagadas/totalU)*100) : 0}%</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: '18px', fontWeight: 800, color: saldo > 0 ? 'var(--at-warning)' : 'var(--at-success)' }}>Saldo: {moneda} {saldo.toFixed(2)}</div>
            </div>
          </div>
        ) : null
      })()}

      {/* Table — F3.9: migrado a <DataTable> shared */}
      <DataTable<CuotaCondominio>
        data={filtered}
        rowKey="id"
        pageSize={50}
        emptyState={{ icon: '📋', title: 'No hay cuotas para mostrar' }}
        columns={[
          { key: 'periodo', header: 'Período', sortable: true,
            render: (c) => <span style={{ fontWeight: 600 }}>{c.periodo}</span> },
          { key: 'unidad_nombre', header: 'Unidad', sortable: true,
            accessor: (c) => c.unidad_nombre ?? '',
            render: (c) => <span style={{ color: 'var(--at-ink-3)' }}>{c.unidad_nombre ?? '—'}</span> },
          { key: 'concepto', header: 'Concepto', sortable: true, hideOnMobile: true,
            render: (c) => <span style={{ color: 'var(--at-ink-3)' }}>{c.concepto}</span> },
          { key: 'fecha_vencimiento', header: 'Vencimiento', hideOnMobile: true, sortable: true,
            accessor: (c) => c.fecha_vencimiento ?? '',
            render: (c) => <span style={{ color: 'var(--at-ink-3)', fontSize: 12 }}>{c.fecha_vencimiento ?? '—'}</span> },
          { key: 'monto', header: 'Monto', align: 'right', sortable: true,
            render: (c) => <span style={{ fontWeight: 700 }}>{moneda} {c.monto.toFixed(2)}</span> },
          { key: 'estado', header: 'Estado', sortable: true,
            render: (c) => {
              const es = ESTADO_STYLE[c.estado] ?? ESTADO_STYLE.pendiente
              return <span style={{ background: es.bg, color: es.color, padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>{c.estado}</span>
            } },
          { key: 'actions', header: '', align: 'right',
            render: (c) => (canEdit && c.estado !== 'pagado') ? (
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                <button onClick={(e) => { e.stopPropagation(); marcarPagada(c.id) }}
                  style={{ padding: '3px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  ✓ Pagada
                </button>
                {c.estado === 'pendiente' && (
                  <button onClick={(e) => { e.stopPropagation(); marcarMorosa(c.id) }}
                    style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
                    Morosa
                  </button>
                )}
              </div>
            ) : null },
        ] satisfies DataTableColumn<CuotaCondominio>[]}
      />
    </div>
  )
}
