import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import { openPromptDialog } from '../../shared/PromptDialog'
import { toast } from '../../../lib/toast'
import { HistorialSaldoUnidad, Unidad, CuotaCondominio } from '../../../types'
import { StatusBadge } from '../../shared/StatusBadge'

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
    // F3.4d: PromptDialog con input type='month' accesible
    const result = await openPromptDialog({
      title: 'Generar snapshot de saldos',
      fields: [
        {
          name: 'periodo',
          label: 'Período (YYYY-MM)',
          type: 'month',
          required: true,
          initialValue: new Date().toISOString().slice(0, 7),
          autoFocus: true,
        },
      ],
      submitText: 'Generar',
    })
    if (!result) return
    const periodo = result.periodo

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
    if (error) { toast.error(error.message); return }
    toast.success(`Snapshot ${periodo} generado`, { description: `${rows.length} unidades procesadas` })
    onRefresh()
  }

  const inp: CSSProperties = { padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        <div style={{ background: 'var(--at-danger-tint)', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-danger)' }}>{moneda} {totalDeuda.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: 'var(--at-danger)' }}>Deuda acumulada{filtroPeriodo ? ` (${filtroPeriodo})` : ' (todos los períodos)'}</div>
        </div>
        <div style={{ background: 'var(--at-success-tint)', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-success)' }}>{moneda} {totalPagos.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: 'var(--at-success)' }}>Pagos recibidos</div>
        </div>
        <div style={{ background: 'var(--at-surface-2)', borderRadius: 10, padding: '12px 16px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--at-ink-2)' }}>{periodos.length}</div>
          <div style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Períodos con snapshot</div>
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
          <span style={{ fontSize: 12, color: 'var(--at-ink-3)', alignSelf: 'center' }}>{lista.length} registros</span>
        </div>
        {canCreate && (
          <button onClick={generarSnapshot} disabled={saving}
            style={{ padding: '8px 16px', background: 'var(--at-accent-2)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            {saving ? '⏳ Generando…' : '📸 Generar snapshot'}
          </button>
        )}
      </div>

      {/* Tabla */}
      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          Sin snapshots de saldo — usa "Generar snapshot" para el período actual
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--at-surface-2)' }}>
                {['Unidad', 'Período', 'Saldo anterior', 'Cargos', 'Pagos', 'Saldo final', 'Cuotas vencidas'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 600, borderBottom: '1px solid var(--at-line)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.sort((a, b) => b.periodo.localeCompare(a.periodo) || (unidades.find(u => u.id === a.unidad_id)?.nombre ?? '').localeCompare(unidades.find(u => u.id === b.unidad_id)?.nombre ?? '')).map(h => {
                const unidad = unidades.find(u => u.id === h.unidad_id)
                const deudor = h.saldo_final > 0
                return (
                  <tr key={h.id} style={{ borderBottom: '1px solid var(--at-chip)', background: deudor ? 'var(--at-danger-tint)' : 'var(--at-surface)' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{unidad?.nombre ?? h.unidad_nombre ?? '—'}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--at-ink-3)' }}>{h.periodo}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--at-ink-2)' }}>{moneda} {h.saldo_anterior.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--at-danger)' }}>+ {moneda} {h.cargos_periodo.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', color: 'var(--at-success)' }}>− {moneda} {h.pagos_periodo.toFixed(2)}</td>
                    <td style={{ padding: '8px 12px', fontWeight: 700, color: deudor ? 'var(--at-danger)' : 'var(--at-success)' }}>
                      {moneda} {h.saldo_final.toFixed(2)}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      {h.num_cuotas_vencidas > 0
                        ? <StatusBadge tone="danger">{h.num_cuotas_vencidas}</StatusBadge>
                        : <span style={{ color: 'var(--at-ink-3)', fontSize: 12 }}>—</span>
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
