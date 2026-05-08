import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { CierreMensual, CuotaCondominio, GastoCondominio } from '../../../types'
import Swal from 'sweetalert2'
import { exportarPDFTabla } from '../exportUtils'

interface Props {
  cierres: CierreMensual[]
  cuotas: CuotaCondominio[]
  gastos: GastoCondominio[]
  proyectoId: string
  companyId: string
  moneda: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

function getPeriodo(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function calcCierre(periodo: string, cuotas: CuotaCondominio[], gastos: GastoCondominio[]) {
  const cuotasPeriodo = cuotas.filter(c => c.periodo === periodo)
  const gastosPeriodo = gastos.filter(g => g.fecha.startsWith(periodo) && g.estado === 'pagado')
  const totalEmitidas = cuotasPeriodo.reduce((s, c) => s + c.monto, 0)
  const totalCobradas = cuotasPeriodo.filter(c => c.estado === 'pagado').reduce((s, c) => s + c.monto, 0)
  const totalGastos   = gastosPeriodo.reduce((s, g) => s + g.monto, 0)
  const unidadesMorosas = new Set(cuotasPeriodo.filter(c => c.estado === 'moroso').map(c => c.unidad_id)).size
  return { totalEmitidas, totalCobradas, totalGastos, saldo: totalCobradas - totalGastos, unidadesMorosas }
}

export function CierresMensualesTab({ cierres, cuotas, gastos, proyectoId, companyId, moneda, proyectoNombre = 'Condominio', canCreate, canEdit, onRefresh }: Props) {
  const now = new Date()
  const [periodoNuevo, setPeriodoNuevo] = useState(getPeriodo(new Date(now.getFullYear(), now.getMonth() - 1)))
  const [notas, setNotas] = useState('')
  const [cerradoPor, setCerradoPor] = useState('')
  const [saving, setSaving] = useState(false)
  const [previewing, setPreviewing] = useState(false)

  const sorted = [...cierres].sort((a, b) => b.periodo.localeCompare(a.periodo))
  const periodosCerrados = new Set(cierres.map(c => c.periodo))
  const preview = previewing ? calcCierre(periodoNuevo, cuotas, gastos) : null

  async function handleGenerar() {
    if (!periodoNuevo) return Swal.fire('Requerido', 'Selecciona el período a cerrar.', 'warning')
    if (periodosCerrados.has(periodoNuevo)) return Swal.fire('Ya existe', `El período ${periodoNuevo} ya tiene cierre.`, 'info')
    const calc = calcCierre(periodoNuevo, cuotas, gastos)
    const r = await Swal.fire({
      title: `Generar cierre ${periodoNuevo}`,
      html: `<div style="text-align:left;font-size:13px">
        <p>Cuotas emitidas: <b>${moneda} ${calc.totalEmitidas.toFixed(2)}</b></p>
        <p>Cuotas cobradas: <b>${moneda} ${calc.totalCobradas.toFixed(2)}</b></p>
        <p>Gastos del mes: <b>${moneda} ${calc.totalGastos.toFixed(2)}</b></p>
        <p>Saldo: <b style="color:${calc.saldo >= 0 ? '#10b981' : '#ef4444'}">${moneda} ${calc.saldo.toFixed(2)}</b></p>
        <p>Unidades morosas: <b>${calc.unidadesMorosas}</b></p>
      </div>`,
      icon: 'question', showCancelButton: true, confirmButtonText: 'Confirmar Cierre', confirmButtonColor: '#0ea5e9',
    })
    if (!r.isConfirmed) return
    setSaving(true)
    const { error } = await supabase.from('cierres_mensuales').insert({
      company_id: companyId, project_id: proyectoId, periodo: periodoNuevo,
      total_cuotas_emitidas: calc.totalEmitidas, total_cuotas_cobradas: calc.totalCobradas,
      total_gastos: calc.totalGastos, saldo_periodo: calc.saldo,
      unidades_morosas: calc.unidadesMorosas,
      notas: notas || null, cerrado_por: cerradoPor || null, estado: 'borrador',
    })
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setNotas(''); setCerradoPor(''); setPreviewing(false); onRefresh()
  }

  function exportarPDF(c: CierreMensual) {
    exportarPDFTabla({
      titulo: `Cierre Mensual — ${c.periodo}`,
      subtitulo: `Estado: ${c.estado === 'cerrado' ? 'Cerrado' : 'Borrador'}${c.cerrado_por ? ` · ${c.cerrado_por}` : ''}`,
      proyectoNombre,
      headers: ['Indicador', 'Valor'],
      rows: [
        ['Cuotas emitidas',  `${moneda} ${c.total_cuotas_emitidas.toFixed(2)}`],
        ['Cuotas cobradas',  `${moneda} ${c.total_cuotas_cobradas.toFixed(2)}`],
        ['Total gastos',     `${moneda} ${c.total_gastos.toFixed(2)}`],
        ['Saldo del período', `${c.saldo_periodo >= 0 ? '+' : ''}${moneda} ${c.saldo_periodo.toFixed(2)}`],
        ['Unidades morosas', String(c.unidades_morosas)],
        ['Estado',           c.estado === 'cerrado' ? 'Cerrado' : 'Borrador'],
        ['Notas',            c.notas ?? '—'],
      ],
      rightAlignCols: [1],
      filename: `cierre-${c.periodo}`,
    })
  }

  async function toggleEstado(c: CierreMensual) {
    const nuevoEstado = c.estado === 'cerrado' ? 'borrador' : 'cerrado'
    if (nuevoEstado === 'cerrado') {
      const r = await Swal.fire({ title: `¿Cerrar período ${c.periodo}?`, text: 'Un cierre finalizado bloquea modificaciones.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Cerrar período', confirmButtonColor: '#ef4444' })
      if (!r.isConfirmed) return
    }
    await supabase.from('cierres_mensuales').update({ estado: nuevoEstado }).eq('id', c.id)
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar cierre?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('cierres_mensuales').delete().eq('id', id)
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: 'white', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Cierres Mensuales</h2>
      </div>

      {/* Generate new close */}
      {canCreate && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Generar nuevo cierre</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Período *</label>
              <input style={inputStyle} type="month" value={periodoNuevo} onChange={e => { setPeriodoNuevo(e.target.value); setPreviewing(false) }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Cerrado por</label>
              <input style={inputStyle} value={cerradoPor} onChange={e => setCerradoPor(e.target.value)} placeholder="Administración" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Observaciones del período (opcional)" />
            </div>
          </div>

          {/* Preview */}
          {periodoNuevo && (
            <div>
              <button onClick={() => setPreviewing(v => !v)} style={{ padding: '6px 12px', background: '#e0f2fe', color: '#0369a1', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', marginRight: '8px' }}>
                {previewing ? '▾ Ocultar' : '▸ Vista previa'}
              </button>
              <button onClick={handleGenerar} disabled={saving || periodosCerrados.has(periodoNuevo)}
                style={{ padding: '6px 18px', background: periodosCerrados.has(periodoNuevo) ? '#e2e8f0' : '#0ea5e9', color: periodosCerrados.has(periodoNuevo) ? '#94a3b8' : 'white', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: periodosCerrados.has(periodoNuevo) ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Generando…' : periodosCerrados.has(periodoNuevo) ? '✓ Ya existe' : '⚡ Generar cierre'}
              </button>
            </div>
          )}

          {previewing && preview && (
            <div style={{ marginTop: '12px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
                {[
                  { label: 'Cuotas emitidas', value: preview.totalEmitidas,    color: '#0ea5e9' },
                  { label: 'Cuotas cobradas', value: preview.totalCobradas,    color: '#10b981' },
                  { label: 'Gastos del mes',  value: preview.totalGastos,      color: '#ef4444' },
                  { label: 'Saldo neto',      value: preview.saldo,            color: preview.saldo >= 0 ? '#10b981' : '#ef4444' },
                ].map(k => (
                  <div key={k.label} style={{ textAlign: 'center', padding: '8px' }}>
                    <div style={{ fontSize: '15px', fontWeight: 800, color: k.color }}>{moneda} {k.value.toFixed(2)}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>{k.label}</div>
                  </div>
                ))}
              </div>
              {preview.unidadesMorosas > 0 && <div style={{ marginTop: '8px', fontSize: '12px', color: '#ef4444', fontWeight: 600 }}>⚠️ {preview.unidadesMorosas} unidad(es) con cuotas morosas</div>}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {sorted.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>No hay cierres mensuales registrados.</div>
      ) : (
        <div style={{ border: '1.5px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Período','Cuotas emitidas','Cuotas cobradas','Gastos','Saldo','Morosas','Estado',''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: h === 'Período' || h === 'Estado' || h === '' ? 'left' : 'right', fontSize: '11px', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((c, i) => (
                <tr key={c.id} style={{ background: i % 2 === 0 ? 'white' : '#fafafa', borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 700 }}>{c.periodo}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#64748b' }}>{moneda} {c.total_cuotas_emitidas.toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#10b981', fontWeight: 600 }}>{moneda} {c.total_cuotas_cobradas.toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: '#ef4444' }}>{moneda} {c.total_gastos.toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: c.saldo_periodo >= 0 ? '#10b981' : '#ef4444' }}>
                    {c.saldo_periodo >= 0 ? '+' : ''}{moneda} {c.saldo_periodo.toFixed(2)}
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'right', color: c.unidades_morosas > 0 ? '#ef4444' : '#94a3b8', fontWeight: c.unidades_morosas > 0 ? 700 : 400 }}>{c.unidades_morosas}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
                      background: c.estado === 'cerrado' ? '#dcfce7' : '#fef3c7',
                      color: c.estado === 'cerrado' ? '#16a34a' : '#92400e' }}>
                      {c.estado === 'cerrado' ? '✓ Cerrado' : 'Borrador'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button onClick={() => exportarPDF(c)}
                        style={{ padding: '3px 7px', background: '#eff6ff', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#2563eb', fontWeight: 600 }} title="Exportar PDF">
                        📄
                      </button>
                      {canEdit && (
                        <>
                          <button onClick={() => toggleEstado(c)}
                            style={{ padding: '3px 8px', background: c.estado === 'cerrado' ? '#fef3c7' : '#dcfce7', color: c.estado === 'cerrado' ? '#92400e' : '#16a34a', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                            {c.estado === 'cerrado' ? '↩ Reabrir' : '✓ Cerrar'}
                          </button>
                          <button onClick={() => handleDelete(c.id)}
                            style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
