import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type { CuotaCondominio, Unidad } from '../../../types'
import Swal from 'sweetalert2'

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

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#15291F' }}>Estado de Cuenta</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={selectedUnidad} onChange={e => setSelectedUnidad(e.target.value)}
            style={{ padding: '6px 10px', border: '1.5px solid #E1DDD0', borderRadius: '8px', fontSize: '13px', color: '#15291F', background: 'white', cursor: 'pointer' }}>
            <option value="all">Todas las unidades</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <input value={searchPeriodo} onChange={e => setSearchPeriodo(e.target.value)}
            placeholder="Filtrar período…" style={{ padding: '6px 10px', border: '1.5px solid #E1DDD0', borderRadius: '8px', fontSize: '13px', width: '130px' }} />
          <button onClick={() => window.print()}
            style={{ padding: '6px 12px', background: '#15291F', color: 'white', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
            🖨️ Imprimir
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total asignado', value: totals.total,    color: '#1B3B36' },
          { label: 'Recaudado',      value: totals.pagado,   color: '#10b981' },
          { label: 'Saldo pendiente',value: saldo,           color: saldo > 0 ? '#f59e0b' : '#10b981' },
          { label: 'Moroso',         value: totals.moroso,   color: totals.moroso > 0 ? '#ef4444' : '#10b981' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid #E1DDD0', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '16px', fontWeight: 800, color: k.color }}>{moneda} {k.value.toFixed(2)}</div>
            <div style={{ fontSize: '11px', color: '#7E9389', fontWeight: 500 }}>{k.label}</div>
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
          <div style={{ background: '#EEF2EC', border: '1.5px solid #C2D2CA', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ fontSize: '22px' }}>🏠</div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '14px', color: '#15291F' }}>{u.nombre}</div>
              <div style={{ fontSize: '12px', color: '#7E9389' }}>{pagadas}/{totalU} cuotas pagadas — Cumplimiento: {totalU > 0 ? Math.round((pagadas/totalU)*100) : 0}%</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontSize: '18px', fontWeight: 800, color: saldo > 0 ? '#f59e0b' : '#10b981' }}>Saldo: {moneda} {saldo.toFixed(2)}</div>
            </div>
          </div>
        ) : null
      })()}

      {/* Table */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#7E9389', fontSize: '13px' }}>No hay cuotas para mostrar.</div>
      ) : (
        <div style={{ border: '1.5px solid #E1DDD0', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#FAF7EF' }}>
                {['Período', 'Unidad', 'Concepto', 'Vencimiento', 'Monto', 'Estado', ''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: h === 'Monto' ? 'right' : 'left', fontSize: '11px', fontWeight: 700, color: '#7E9389', borderBottom: '1px solid #E1DDD0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => {
                const es = ESTADO_STYLE[c.estado] ?? ESTADO_STYLE.pendiente
                return (
                  <tr key={c.id} style={{ background: i % 2 === 0 ? 'white' : '#FAF7EF', borderBottom: '1px solid #EAE6D8' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{c.periodo}</td>
                    <td style={{ padding: '10px 12px', color: '#7E9389' }}>{c.unidad_nombre ?? '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#7E9389' }}>{c.concepto}</td>
                    <td style={{ padding: '10px 12px', color: '#7E9389', fontSize: '12px' }}>{c.fecha_vencimiento ?? '—'}</td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{moneda} {c.monto.toFixed(2)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ background: es.bg, color: es.color, padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>{c.estado}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {canEdit && c.estado !== 'pagado' && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={() => marcarPagada(c.id)}
                            style={{ padding: '3px 8px', background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                            ✓ Pagada
                          </button>
                          {c.estado === 'pendiente' && (
                            <button onClick={() => marcarMorosa(c.id)}
                              style={{ padding: '3px 7px', background: '#fee2e2', color: '#ef4444', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>
                              Morosa
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <style>{`@media print { button { display: none !important; } }`}</style>
    </div>
  )
}
