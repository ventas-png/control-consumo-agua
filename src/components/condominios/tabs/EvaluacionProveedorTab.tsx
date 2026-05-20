import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { EvaluacionProveedor, ContratoProveedor } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  evaluaciones: EvaluacionProveedor[]
  proveedores: ContratoProveedor[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const BLANK = { proveedor_id: '', nombre_proveedor: '', calificacion: 5, puntualidad: 5, calidad: 5, precio: 5, comentarios: '', evaluado_por: '', fecha: new Date().toISOString().slice(0, 10) }

function Stars({ value, onChange, readOnly = false }: { value: number; onChange?: (n: number) => void; readOnly?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '2px' }}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} onClick={() => !readOnly && onChange?.(n)}
          style={{ fontSize: readOnly ? '14px' : '18px', cursor: readOnly ? 'default' : 'pointer', color: n <= value ? '#f59e0b' : '#E1DDD0', lineHeight: 1 }}>
          ★
        </span>
      ))}
    </div>
  )
}

function avg(values: (number | undefined | null)[]): number {
  const valid = values.filter(v => v != null) as number[]
  if (!valid.length) return 0
  return Math.round(valid.reduce((s, v) => s + v, 0) / valid.length * 10) / 10
}

export function EvaluacionProveedorTab({ evaluaciones, proveedores, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [filtroProveedor, setFiltroProveedor] = useState('')
  const [view, setView] = useState<'lista' | 'ranking'>('lista')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  function startEdit(e: EvaluacionProveedor) {
    setEditId(e.id)
    setForm({ proveedor_id: e.proveedor_id ?? '', nombre_proveedor: e.nombre_proveedor, calificacion: e.calificacion, puntualidad: e.puntualidad ?? 5, calidad: e.calidad ?? 5, precio: e.precio ?? 5, comentarios: e.comentarios ?? '', evaluado_por: e.evaluado_por ?? '', fecha: e.fecha })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.nombre_proveedor.trim()) return Swal.fire('Requerido', 'El nombre del proveedor es obligatorio.', 'warning')
    setSaving(true)
    const payload = {
      proveedor_id: form.proveedor_id || null, nombre_proveedor: form.nombre_proveedor.trim(),
      calificacion: form.calificacion, puntualidad: form.puntualidad, calidad: form.calidad, precio: form.precio,
      comentarios: form.comentarios || null, evaluado_por: form.evaluado_por || null, fecha: form.fecha,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('evaluaciones_proveedor').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('evaluaciones_proveedor').insert({ ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar evaluación?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('evaluaciones_proveedor').delete().eq('id', id)
    onRefresh()
  }

  let filtered = evaluaciones
  if (filtroProveedor) filtered = filtered.filter(e => e.nombre_proveedor.toLowerCase().includes(filtroProveedor.toLowerCase()))

  // Ranking: group by proveedor_nombre, compute avg
  const ranking = Object.values(
    evaluaciones.reduce<Record<string, { nombre: string; evals: EvaluacionProveedor[] }>>((acc, e) => {
      const key = e.nombre_proveedor
      if (!acc[key]) acc[key] = { nombre: key, evals: [] }
      acc[key].evals.push(e)
      return acc
    }, {})
  ).map(g => ({
    nombre: g.nombre,
    count: g.evals.length,
    promedio: avg(g.evals.map(e => e.calificacion)),
    puntualidad: avg(g.evals.map(e => e.puntualidad)),
    calidad: avg(g.evals.map(e => e.calidad)),
    precio: avg(g.evals.map(e => e.precio)),
  })).sort((a, b) => b.promedio - a.promedio)

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: '#15291F', background: '#FAF7EF', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: '#15291F' }}>Evaluación de Proveedores</h2>
          <p style={{ margin: 0, fontSize: '12px', color: '#7E9389' }}>{evaluaciones.length} evaluaciones · {ranking.length} proveedores</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ display: 'flex', border: '1.5px solid var(--at-line)', borderRadius: '8px', overflow: 'hidden' }}>
            {(['lista', 'ranking'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                style={{ padding: '6px 12px', border: 'none', fontSize: '12px', cursor: 'pointer', fontWeight: view === v ? 700 : 500,
                  background: view === v ? '#1B3B36' : 'white', color: view === v ? 'white' : '#7E9389' }}>
                {v === 'lista' ? '📋 Lista' : '🏆 Ranking'}
              </button>
            ))}
          </div>
          {canCreate && !showForm && (
            <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setShowForm(true) }}
              style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              + Evaluar
            </button>
          )}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#FAF7EF', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar evaluación' : 'Nueva Evaluación'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Proveedor (contrato)</label>
              <select style={inputStyle} value={form.proveedor_id} onChange={e => {
                const p = proveedores.find(p => p.id === e.target.value)
                setF('proveedor_id', e.target.value)
                if (p) setF('nombre_proveedor', p.proveedor_nombre)
              }}>
                <option value="">— Seleccionar o escribir —</option>
                {proveedores.map(p => <option key={p.id} value={p.id}>{p.proveedor_nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Nombre proveedor *</label>
              <input style={inputStyle} value={form.nombre_proveedor} onChange={e => setF('nombre_proveedor', e.target.value)} placeholder="Nombre de la empresa" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Fecha evaluación</label>
              <input style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Evaluado por</label>
              <input style={inputStyle} value={form.evaluado_por} onChange={e => setF('evaluado_por', e.target.value)} placeholder="Nombre del evaluador" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '12px' }}>
            {([
              { k: 'calificacion' as const, label: 'Calificación general' },
              { k: 'puntualidad' as const, label: 'Puntualidad' },
              { k: 'calidad' as const, label: 'Calidad del trabajo' },
              { k: 'precio' as const, label: 'Precio / valor' },
            ]).map(({ k, label }) => (
              <div key={k}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '5px' }}>{label}</label>
                <Stars value={form[k] as number} onChange={n => setF(k, n)} />
                <div style={{ fontSize: '10px', color: '#7E9389', marginTop: '2px' }}>{form[k]}/5</div>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Comentarios</label>
            <textarea style={{ ...inputStyle, minHeight: '55px', resize: 'vertical', fontFamily: 'inherit' }}
              value={form.comentarios} onChange={e => setF('comentarios', e.target.value)} placeholder="Observaciones, recomendaciones, aspectos positivos/negativos…" />
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar evaluación'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              style={{ padding: '7px 12px', background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: '#7E9389' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {view === 'ranking' ? (
        /* Ranking view */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {ranking.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#7E9389', fontSize: '13px' }}>Sin evaluaciones.</div>
          ) : ranking.map((r, i) => (
            <div key={r.nombre} style={{ background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontSize: '16px', fontWeight: 800, color: i === 0 ? '#f59e0b' : i === 1 ? '#7E9389' : i === 2 ? '#b45309' : '#7E9389' }}>#{i + 1}</span>
                    <span style={{ fontWeight: 700, fontSize: '14px' }}>{r.nombre}</span>
                    <span style={{ fontSize: '10px', color: '#7E9389' }}>{r.count} evaluación(es)</span>
                  </div>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    {[
                      { label: 'General', val: r.promedio },
                      { label: 'Puntualidad', val: r.puntualidad },
                      { label: 'Calidad', val: r.calidad },
                      { label: 'Precio', val: r.precio },
                    ].map(f => (
                      <div key={f.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: '10px', color: '#7E9389' }}>{f.label}</div>
                        <Stars value={Math.round(f.val)} readOnly />
                        <div style={{ fontSize: '10px', fontWeight: 700, color: f.val >= 4 ? '#10b981' : f.val >= 3 ? '#f59e0b' : '#ef4444' }}>{f.val}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* List view */
        <>
          <div style={{ marginBottom: '10px' }}>
            <input style={{ ...inputStyle, maxWidth: '220px' }} value={filtroProveedor} onChange={e => setFiltroProveedor(e.target.value)} placeholder="Buscar proveedor…" />
          </div>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#7E9389', fontSize: '13px' }}>No hay evaluaciones.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filtered.map(e => (
                <div key={e.id} style={{ background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700, fontSize: '13px' }}>{e.nombre_proveedor}</span>
                        <Stars value={e.calificacion} readOnly />
                        <span style={{ fontSize: '11px', fontWeight: 700, color: e.calificacion >= 4 ? '#10b981' : e.calificacion >= 3 ? '#f59e0b' : '#ef4444' }}>{e.calificacion}/5</span>
                      </div>
                      <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#7E9389', flexWrap: 'wrap' }}>
                        {e.puntualidad != null && <span>⏱ Puntualidad: {e.puntualidad}/5</span>}
                        {e.calidad != null && <span>⭐ Calidad: {e.calidad}/5</span>}
                        {e.precio != null && <span>💰 Precio: {e.precio}/5</span>}
                        <span>📅 {e.fecha}</span>
                        {e.evaluado_por && <span>👤 {e.evaluado_por}</span>}
                      </div>
                      {e.comentarios && <div style={{ fontSize: '12px', color: '#3E5A4C', marginTop: '4px', fontStyle: 'italic' }}>{e.comentarios}</div>}
                    </div>
                    {canEdit && (
                      <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
                        <button onClick={() => startEdit(e)}
                          style={{ padding: '3px 7px', background: '#FAF7EF', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                        <button onClick={() => handleDelete(e.id)}
                          style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
