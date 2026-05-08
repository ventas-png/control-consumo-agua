import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { SancionCondominio, Unidad, InfraccionCondominio } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  sanciones: SancionCondominio[]
  unidades: Unidad[]
  infracciones: InfraccionCondominio[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const BLANK = {
  unidad_id: '', infraccion_id: '', concepto: '', monto: 0,
  fecha_emision: new Date().toISOString().slice(0, 10),
  fecha_vencimiento: '', observaciones: '',
}

const ESTADO: Record<string, { bg: string; color: string; label: string }> = {
  pendiente: { bg: '#fef3c7', color: '#92400e', label: 'Pendiente' },
  pagado:    { bg: '#dcfce7', color: '#16a34a', label: 'Pagado' },
  anulado:   { bg: '#f1f5f9', color: '#94a3b8', label: 'Anulado' },
  apelado:   { bg: '#e0f2fe', color: '#0369a1', label: 'En apelación' },
}

export function SancionesTab({ sanciones, unidades, infracciones, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtro, setFiltro] = useState<'todos' | 'pendiente' | 'pagado' | 'anulado' | 'apelado'>('todos')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  async function handleSave() {
    if (!form.unidad_id || !form.concepto.trim()) return Swal.fire('Requerido', 'Unidad y concepto son obligatorios.', 'warning')
    if (form.monto <= 0) return Swal.fire('Requerido', 'El monto debe ser mayor a 0.', 'warning')
    setSaving(true)
    const { error } = await supabase.from('sanciones_condominio').insert({
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id, infraccion_id: form.infraccion_id || null,
      concepto: form.concepto.trim(), monto: form.monto,
      fecha_emision: form.fecha_emision, fecha_vencimiento: form.fecha_vencimiento || null,
      observaciones: form.observaciones || null, estado: 'pendiente',
    })
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setForm({ ...BLANK }); onRefresh()
  }

  async function cambiarEstado(id: string, estado: string, msg?: string) {
    if (msg) {
      const r = await Swal.fire({ title: msg, icon: 'question', showCancelButton: true, confirmButtonText: 'Confirmar' })
      if (!r.isConfirmed) return
    }
    await supabase.from('sanciones_condominio').update({ estado }).eq('id', id)
    onRefresh()
  }

  const today = new Date().toISOString().slice(0, 10)
  const filtered = filtro === 'todos' ? sanciones : sanciones.filter(s => s.estado === filtro)
  const pendientes = sanciones.filter(s => s.estado === 'pendiente')
  const vencidas = pendientes.filter(s => s.fecha_vencimiento && s.fecha_vencimiento < today)
  const totalPendiente = pendientes.reduce((s, x) => s + x.monto, 0)

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Sanciones</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)}
            style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva Sanción
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Total',            value: String(sanciones.length),              color: '#0f172a' },
          { label: 'Pendientes',       value: String(pendientes.length),             color: '#f59e0b' },
          { label: 'Monto pendiente',  value: `${moneda} ${totalPendiente.toFixed(2)}`, color: '#ef4444' },
          { label: 'Vencidas',         value: String(vencidas.length),              color: '#ef4444' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>Nueva Sanción</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Unidad *</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Seleccionar —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Infracción relacionada</label>
              <select style={inputStyle} value={form.infraccion_id} onChange={e => setF('infraccion_id', e.target.value)}>
                <option value="">— Ninguna —</option>
                {infracciones.filter(i => !form.unidad_id || i.unidad_id === form.unidad_id).map(i => (
                  <option key={i.id} value={i.id}>{i.descripcion.slice(0, 45)}</option>
                ))}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Concepto *</label>
              <input style={inputStyle} value={form.concepto} onChange={e => setF('concepto', e.target.value)} placeholder="Ej: Multa por ruido nocturno" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Monto ({moneda}) *</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.monto} onChange={e => setF('monto', parseFloat(e.target.value) || 0)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha emisión</label>
              <input style={inputStyle} type="date" value={form.fecha_emision} onChange={e => setF('fecha_emision', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha vencimiento</label>
              <input style={inputStyle} type="date" value={form.fecha_vencimiento} onChange={e => setF('fecha_vencimiento', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Observaciones</label>
              <input style={inputStyle} value={form.observaciones} onChange={e => setF('observaciones', e.target.value)} placeholder="Opcional" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)}
              style={{ padding: '7px 12px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {(['todos', 'pendiente', 'pagado', 'apelado', 'anulado'] as const).map(f => (
          <button key={f} onClick={() => setFiltro(f)}
            style={{ padding: '5px 12px', border: '1.5px solid', borderRadius: '20px', fontSize: '12px', fontWeight: filtro === f ? 700 : 500, cursor: 'pointer',
              borderColor: filtro === f ? '#0ea5e9' : '#e2e8f0',
              background: filtro === f ? '#e0f2fe' : 'white',
              color: filtro === f ? '#0369a1' : '#64748b' }}>
            {f === 'todos' ? 'Todos' : ESTADO[f]?.label ?? f}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>No hay sanciones.</div>
      ) : (
        <div style={{ border: '1.5px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['Unidad', 'Concepto', 'Monto', 'Emisión', 'Vencimiento', 'Estado', ''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700, color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => {
                const est = ESTADO[s.estado]
                const vencida = s.estado === 'pendiente' && s.fecha_vencimiento && s.fecha_vencimiento < today
                return (
                  <tr key={s.id} style={{ background: i % 2 === 0 ? 'white' : '#fafafa', borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{s.unidad_nombre ?? '—'}</td>
                    <td style={{ padding: '10px 12px', color: '#374151' }}>{s.concepto}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: '#ef4444' }}>{moneda} {s.monto.toFixed(2)}</td>
                    <td style={{ padding: '10px 12px', color: '#64748b', fontSize: '12px' }}>{s.fecha_emision}</td>
                    <td style={{ padding: '10px 12px', fontSize: '12px', fontWeight: vencida ? 700 : 400, color: vencida ? '#ef4444' : '#64748b' }}>
                      {s.fecha_vencimiento ?? '—'}{vencida ? ' ⚠️' : ''}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: est?.bg, color: est?.color }}>
                        {est?.label}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      {canEdit && s.estado === 'pendiente' && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={() => cambiarEstado(s.id, 'pagado', '¿Marcar como pagada?')}
                            style={{ padding: '3px 8px', background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
                            Pagado
                          </button>
                          <button onClick={() => cambiarEstado(s.id, 'apelado')}
                            style={{ padding: '3px 7px', background: '#e0f2fe', color: '#0369a1', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>
                            Apelar
                          </button>
                          <button onClick={() => cambiarEstado(s.id, 'anulado', '¿Anular sanción?')}
                            style={{ padding: '3px 7px', background: '#f1f5f9', color: '#94a3b8', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>
                            Anular
                          </button>
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
    </div>
  )
}
