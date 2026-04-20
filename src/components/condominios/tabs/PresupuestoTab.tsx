import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type { PresupuestoCondominio, GastoCondominio, CategoriaGasto } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  presupuestos: PresupuestoCondominio[]
  gastos: GastoCondominio[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CAT_LABELS: Record<CategoriaGasto, { label: string; icon: string }> = {
  mantenimiento: { label: 'Mantenimiento', icon: '🔧' },
  servicios:     { label: 'Servicios',     icon: '💡' },
  administrativo:{ label: 'Administrativo',icon: '📋' },
  seguridad:     { label: 'Seguridad',     icon: '🛡️' },
  limpieza:      { label: 'Limpieza',      icon: '🧹' },
  obras:         { label: 'Obras',         icon: '🏗️' },
  otros:         { label: 'Otros',         icon: '📁' },
}

const CATEGORIAS = Object.keys(CAT_LABELS) as CategoriaGasto[]

function pct(exec: number, budget: number) {
  return budget > 0 ? Math.min(999, Math.round((exec / budget) * 100)) : 0
}

function barColor(p: number) {
  if (p >= 100) return '#ef4444'
  if (p >= 80)  return '#f59e0b'
  return '#10b981'
}

export function PresupuestoTab({ presupuestos, gastos, proyectoId, companyId, moneda, canEdit, onRefresh }: Props) {
  const currentYear = new Date().getFullYear()
  const [anio, setAnio] = useState(currentYear)
  const [editCat, setEditCat] = useState<CategoriaGasto | null>(null)
  const [editMonto, setEditMonto] = useState('')
  const [editNotas, setEditNotas] = useState('')
  const [saving, setSaving] = useState(false)

  const years = Array.from(new Set([currentYear - 1, currentYear, currentYear + 1,
    ...presupuestos.map(p => p.anio)])).sort((a, b) => b - a)

  // Gastos pagados del año seleccionado por categoría
  const gastosAnio = gastos.filter(g => g.estado === 'pagado' && g.fecha.startsWith(String(anio)))
  const ejecutadoPorCat: Partial<Record<CategoriaGasto, number>> = {}
  for (const g of gastosAnio) {
    ejecutadoPorCat[g.categoria] = (ejecutadoPorCat[g.categoria] ?? 0) + g.monto
  }

  // Presupuestos del año
  const presAnio = presupuestos.filter(p => p.anio === anio)
  const presMap: Partial<Record<CategoriaGasto, PresupuestoCondominio>> = {}
  for (const p of presAnio) presMap[p.categoria as CategoriaGasto] = p

  const totalPresupuestado = presAnio.reduce((s, p) => s + p.monto_presupuestado, 0)
  const totalEjecutado = CATEGORIAS.reduce((s, c) => s + (ejecutadoPorCat[c] ?? 0), 0)

  function startEdit(cat: CategoriaGasto) {
    const p = presMap[cat]
    setEditCat(cat)
    setEditMonto(p ? String(p.monto_presupuestado) : '')
    setEditNotas(p?.notas ?? '')
  }

  async function handleSave() {
    if (!editCat) return
    const monto = parseFloat(editMonto)
    if (isNaN(monto) || monto < 0) return Swal.fire('Valor inválido', 'Ingresa un monto válido.', 'warning')
    setSaving(true)
    const existing = presMap[editCat]
    if (existing) {
      const { error } = await supabase.from('presupuesto_condominio').update({ monto_presupuestado: monto, notas: editNotas || null }).eq('id', existing.id)
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    } else {
      const { error } = await supabase.from('presupuesto_condominio').insert({
        company_id: companyId, project_id: proyectoId,
        anio, categoria: editCat, monto_presupuestado: monto, notas: editNotas || null,
      })
      if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    }
    setSaving(false); setEditCat(null); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar presupuesto?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('presupuesto_condominio').delete().eq('id', id)
    onRefresh()
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Presupuesto Anual</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Año:</span>
          <select value={anio} onChange={e => setAnio(Number(e.target.value))}
            style={{ padding: '6px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', fontWeight: 700, color: '#0f172a', background: 'white', cursor: 'pointer' }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Total presupuestado', value: `${moneda} ${totalPresupuestado.toFixed(0)}`,   icon: '📋', color: '#0ea5e9' },
          { label: 'Total ejecutado',     value: `${moneda} ${totalEjecutado.toFixed(0)}`,       icon: '💰', color: pct(totalEjecutado, totalPresupuestado) >= 100 ? '#ef4444' : '#10b981' },
          { label: 'Disponible',          value: `${moneda} ${Math.max(0, totalPresupuestado - totalEjecutado).toFixed(0)}`, icon: '✅', color: '#8b5cf6' },
          { label: '% Ejecución',         value: `${pct(totalEjecutado, totalPresupuestado)}%`,  icon: '📈', color: barColor(pct(totalEjecutado, totalPresupuestado)) },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '16px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Tabla presupuesto */}
      <div style={{ border: '1.5px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              {['Categoría', 'Presupuestado', 'Ejecutado', 'Varianza', '% Ejec.', ''].map(h => (
                <th key={h} style={{ padding: '12px 14px', textAlign: h === 'Categoría' ? 'left' : 'right', fontSize: '11px', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CATEGORIAS.map((cat, i) => {
              const cl = CAT_LABELS[cat]
              const p = presMap[cat]
              const presupuestado = p?.monto_presupuestado ?? 0
              const ejecutado = ejecutadoPorCat[cat] ?? 0
              const varianza = presupuestado - ejecutado
              const pcEjec = pct(ejecutado, presupuestado)

              if (editCat === cat) {
                return (
                  <tr key={cat} style={{ background: '#eff6ff', borderBottom: '1px solid #bfdbfe' }}>
                    <td colSpan={6} style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 700 }}>{cl.icon} {cl.label}</span>
                        <input style={{ ...inputStyle, width: '140px' }} type="number" min="0" step="0.01" value={editMonto}
                          onChange={e => setEditMonto(e.target.value)} placeholder={`Monto (${moneda})`} autoFocus />
                        <input style={{ ...inputStyle, flex: 1, minWidth: '150px' }} value={editNotas}
                          onChange={e => setEditNotas(e.target.value)} placeholder="Notas opcionales" />
                        <button onClick={handleSave} disabled={saving} style={{ padding: '7px 14px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '7px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>
                          {saving ? '…' : 'Guardar'}
                        </button>
                        <button onClick={() => setEditCat(null)} style={{ padding: '7px 12px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '7px', fontSize: '12px', cursor: 'pointer', color: '#64748b' }}>✕</button>
                      </div>
                    </td>
                  </tr>
                )
              }

              return (
                <tr key={cat} style={{ background: i % 2 === 0 ? 'white' : '#fafafa', borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px 14px', fontWeight: 600 }}>{cl.icon} {cl.label}</td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', color: '#64748b' }}>
                    {presupuestado > 0 ? `${moneda} ${presupuestado.toFixed(0)}` : <span style={{ color: '#cbd5e1', fontSize: '12px' }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: ejecutado > 0 ? 700 : 400, color: ejecutado > 0 ? '#0f172a' : '#cbd5e1' }}>
                    {ejecutado > 0 ? `${moneda} ${ejecutado.toFixed(0)}` : '—'}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: presupuestado > 0 ? (varianza < 0 ? '#ef4444' : '#10b981') : '#cbd5e1' }}>
                    {presupuestado > 0 ? `${varianza >= 0 ? '+' : ''}${moneda} ${varianza.toFixed(0)}` : '—'}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                    {presupuestado > 0 ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end' }}>
                        <div style={{ width: '60px', background: '#f1f5f9', borderRadius: '4px', height: '6px' }}>
                          <div style={{ width: `${Math.min(100, pcEjec)}%`, background: barColor(pcEjec), height: '6px', borderRadius: '4px' }} />
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: barColor(pcEjec) }}>{pcEjec}%</span>
                      </div>
                    ) : <span style={{ color: '#cbd5e1', fontSize: '12px' }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                    {canEdit && (
                      <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                        <button onClick={() => startEdit(cat)} style={{ padding: '3px 8px', background: '#e0f2fe', color: '#0369a1', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                          {presupuestado > 0 ? '✏️' : '+ Asignar'}
                        </button>
                        {p && <button onClick={() => handleDelete(p.id)} style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>}
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {/* Total row */}
            <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
              <td style={{ padding: '12px 14px', fontWeight: 800, color: '#0f172a' }}>TOTAL</td>
              <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: '#0f172a' }}>{moneda} {totalPresupuestado.toFixed(0)}</td>
              <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: '#0f172a' }}>{moneda} {totalEjecutado.toFixed(0)}</td>
              <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: totalPresupuestado - totalEjecutado < 0 ? '#ef4444' : '#10b981' }}>
                {totalPresupuestado > 0 ? `${totalPresupuestado - totalEjecutado >= 0 ? '+' : ''}${moneda} ${(totalPresupuestado - totalEjecutado).toFixed(0)}` : '—'}
              </td>
              <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: barColor(pct(totalEjecutado, totalPresupuestado)) }}>
                {totalPresupuestado > 0 ? `${pct(totalEjecutado, totalPresupuestado)}%` : '—'}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
