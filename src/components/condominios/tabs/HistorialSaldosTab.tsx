import React, { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Swal from 'sweetalert2'
import { HistorialSaldoUnidad, Unidad, CuotaCondominio } from '../../../types'

interface Props {
  historial: HistorialSaldoUnidad[]
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  onRefresh: () => void
}

export default function HistorialSaldosTab({ historial, cuotas, unidades, proyectoId, companyId, moneda, canCreate, onRefresh }: Props) {
  const [filtroUnidad, setFiltroUnidad] = useState('')
  const [saving, setSaving] = useState(false)

  const periodos = [...new Set(historial.map(h => h.periodo))].sort().reverse()
  const [filtroPeriodo, setFiltroPeriodo] = useState('')

  const lista = historial.filter(h =>
    (!filtroUnidad || h.unidad_id === filtroUnidad) &&
    (!filtroPeriodo || h.periodo === filtroPeriodo)
  )

  const totalDeuda = historial
    .filter(h => !filtroPeriodo || h.periodo === filtroPeriodo)
    .reduce((s, h) => s + h.saldo_final, 0)

  const totalPagos = historial
    .filter(h => !filtroPeriodo || h.periodo === filtroPeriodo)
    .reduce((s, h) => s + h.pagos_periodo, 0)

  async function generarSnapshot() {
    const { value: periodo } = await Swal.fire({
      title: 'Generar snapshot de saldos',
      html: `<p style="font-size:13px;color:#374151;margin-bottom:8px">Período (YYYY-MM):</p>
             <input id="periodo-snap" class="swal2-input" type="month" value="${new Date().toISOString().slice(0,7)}" style="font-size:14px">`,
      showCancelButton: true, confirmButtonText: 'Generar', cancelButtonText: 'Cancelar',
      preConfirm: () => (document.getElementById('periodo-snap') as HTMLInputElement)?.value,
    })
    if (!periodo) return

    setSaving(true)
    const rows = unidades.filter(u => u.activo).map(u => {
      const cuotasU = cuotas.filter(c => c.unidad_id === u.id && c.periodo === periodo)
      const cargos = cuotasU.reduce((s, c) => s + c.monto, 0)
      const pagos = cuotasU.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
      const vencidas = cuotasU.filter(c => c.estado === 'moroso').length
      const prevSnap = historial.filter(h => h.unidad_id === u.id).sort((a, b) => b.periodo.localeCompare(a.periodo))[0]
      const saldo_anterior = prevSnap?.saldo_final ?? 0
      return {
        company_id: companyId, project_id: proyectoId,
        unidad_id: u.id, periodo,
        saldo_anterior,
        cargos_periodo: cargos,
        pagos_periodo: pagos,
        saldo_final: parseFloat((saldo_anterior + cargos - pagos).toFixed(2)),
        num_cuotas_vencidas: vencidas,
      }
    })

    const { error } = await supabase.from('historial_saldos_unidad').upsert(rows, { onConflict: 'project_id,unidad_id,periodo' })
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: `Snapshot ${periodo} generado`, text: `${rows.length} unidades procesadas`, timer: 2000, showConfirmButton: false })
    onRefresh()
  }

  const inp: React.CSSProperties = { padding: '7px 10px', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 13 }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        <div style={{ background: '#fef2f2', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#ef4444' }}>{moneda} {totalDeuda.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: '#ef4444' }}>Deuda acumulada{filtroPeriodo ? ` (${filtroPeriodo})` : ' (todos los períodos)'}</div>
        </div>
        <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#16a34a' }}>{moneda} {totalPagos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: '#16a34a' }}>Pagos recibidos</div>
        </div>
        <div style={{ background: '#f9fafb', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#374151' }}>{periodos.length}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>Períodos con snapshot</div>
        </div>
      </div>

      {/* Filtros + botón */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={filtroUnidad} onChange={e => setFiltroUnidad(e.target.value)} style={inp}>
            <option value="">Todas las unidades</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
          <select value={filtroPeriodo} onChange={e => setFiltroPeriodo(e.target.value)} style={inp}>
            <option value="">Todos los períodos</option>
            {periodos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <span style={{ fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <button onClick={generarSnapshot} disabled={saving}
            style={{ padding: '8px 16px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {saving ? '⏳ Generando…' : '📸 Generar snapshot'}
          </button>
        )}
      </div>

      {/* Tabla */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          Sin snapshots de saldo — usa "Generar snapshot" para el período actual
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                {['Unidad', 'Período', 'Saldo anterior', 'Cargos', 'Pagos', 'Saldo final', 'Cuotas vencidas'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: '#6b7280', fontWeight: 600, borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.sort((a, b) => b.periodo.localeCompare(a.periodo) || (unidades.find(u => u.id === a.unidad_id)?.nombre ?? '').localeCompare(unidades.find(u => u.id === b.unidad_id)?.nombre ?? '')).map(h => {
                const unidad = unidades.find(u => u.id === h.unidad_id)
                const deudor = h.saldo_final > 0
                return (
                  <tr key={h.id} style={{ borderBottom: '1px solid #f3f4f6', background: deudor ? '#fef9f9' : '#fff' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{unidad?.nombre ?? h.unidad_nombre ?? '—'}</td>
                    <td style={{ padding: '8px 12px', color: '#6b7280' }}>{h.periodo}</td>
                    <td style={{ padding: '8px 12px', color: '#374151' }}>{moneda} {h.saldo_anterior.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', color: '#dc2626' }}>+ {moneda} {h.cargos_periodo.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', color: '#16a34a' }}>− {moneda} {h.pagos_periodo.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 700, color: deudor ? '#ef4444' : '#16a34a' }}>
                      {moneda} {h.saldo_final.toFixed(2)}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      {h.num_cuotas_vencidas > 0
                        ? <span style={{ padding: '2px 7px', borderRadius: 20, background: '#fee2e2', color: '#ef4444', fontSize: 11, fontWeight: 700 }}>{h.num_cuotas_vencidas}</span>
                        : <span style={{ color: '#9ca3af', fontSize: 12 }}>—</span>
                      }
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
