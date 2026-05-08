import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { PropuestaInversion, CategoriaPropuesta, EstadoPropuesta, PrioridadPropuesta } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  propuestas: PropuestaInversion[]
  proyectoId: string
  companyId: string
  userId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const CATEGORIAS: { value: CategoriaPropuesta; label: string; icon: string }[] = [
  { value: 'mejora',       label: 'Mejora',       icon: '⬆️' },
  { value: 'reparacion',   label: 'Reparación',   icon: '🔨' },
  { value: 'expansion',    label: 'Expansión',    icon: '📐' },
  { value: 'tecnologia',   label: 'Tecnología',   icon: '💻' },
  { value: 'seguridad',    label: 'Seguridad',    icon: '🛡️' },
  { value: 'otro',         label: 'Otro',         icon: '📋' },
]

const PRIORIDAD_CONFIG: Record<PrioridadPropuesta, { label: string; color: string; bg: string }> = {
  baja:  { label: 'Baja',  color: '#64748b', bg: '#f1f5f9' },
  media: { label: 'Media', color: '#f59e0b', bg: '#fef3c7' },
  alta:  { label: 'Alta',  color: '#ef4444', bg: '#fee2e2' },
}

const ESTADO_CONFIG: Record<EstadoPropuesta, { label: string; color: string; bg: string }> = {
  propuesta:     { label: 'Propuesta',     color: '#64748b', bg: '#f1f5f9' },
  en_evaluacion: { label: 'En Evaluación', color: '#0ea5e9', bg: '#e0f2fe' },
  aprobada:      { label: 'Aprobada',      color: '#10b981', bg: '#d1fae5' },
  rechazada:     { label: 'Rechazada',     color: '#ef4444', bg: '#fee2e2' },
  en_ejecucion:  { label: 'En Ejecución',  color: '#8b5cf6', bg: '#ede9fe' },
  completada:    { label: 'Completada',    color: '#0f172a', bg: '#e2e8f0' },
}

const blank = (): Partial<PropuestaInversion> => ({
  titulo: '', descripcion: '', categoria: 'mejora', monto_estimado: undefined,
  prioridad: 'media', estado: 'propuesta', fecha_propuesta: new Date().toISOString().slice(0, 10),
  votos_favor: 0, votos_contra: 0, notas: '',
})

export function PropuestasTab({ propuestas, proyectoId, companyId, userId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoPropuesta | 'todos'>('todos')
  const [form, setForm] = useState<Partial<PropuestaInversion>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = propuestas.filter(p => filtroEstado === 'todos' || p.estado === filtroEstado)
    .sort((a, b) => {
      const prioOrden: Record<PrioridadPropuesta, number> = { alta: 0, media: 1, baja: 2 }
      return prioOrden[a.prioridad] - prioOrden[b.prioridad]
    })

  const montoTotal = propuestas.filter(p => p.estado === 'aprobada' || p.estado === 'en_ejecucion')
    .reduce((s, p) => s + (p.monto_estimado ?? 0), 0)

  function startEdit(p: PropuestaInversion) {
    setForm({
      titulo: p.titulo, descripcion: p.descripcion ?? '', categoria: p.categoria,
      monto_estimado: p.monto_estimado ?? undefined, prioridad: p.prioridad,
      estado: p.estado, fecha_propuesta: p.fecha_propuesta,
      fecha_aprobacion: p.fecha_aprobacion ?? '', fecha_ejecucion: p.fecha_ejecucion ?? '',
      votos_favor: p.votos_favor, votos_contra: p.votos_contra, notas: p.notas ?? '',
    })
    setEditId(p.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.titulo?.trim()) return Swal.fire('Campo requerido', 'Ingresa el título.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      titulo: form.titulo!.trim(), descripcion: form.descripcion || null,
      categoria: form.categoria ?? 'mejora', monto_estimado: form.monto_estimado ?? null,
      prioridad: form.prioridad ?? 'media', estado: form.estado ?? 'propuesta',
      fecha_propuesta: form.fecha_propuesta!, votos_favor: form.votos_favor ?? 0,
      votos_contra: form.votos_contra ?? 0,
      fecha_aprobacion: form.fecha_aprobacion || null, fecha_ejecucion: form.fecha_ejecucion || null,
      propuesto_por: userId || null, notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('propuestas_inversion').update(payload).eq('id', editId)
      : await supabase.from('propuestas_inversion').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleVoto(id: string, tipo: 'favor' | 'contra') {
    const p = propuestas.find(x => x.id === id)
    if (!p) return
    const upd = tipo === 'favor' ? { votos_favor: p.votos_favor + 1 } : { votos_contra: p.votos_contra + 1 }
    const { error } = await supabase.from('propuestas_inversion').update(upd).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoPropuesta) {
    const updates: Partial<PropuestaInversion> = { estado }
    if (estado === 'aprobada') updates.fecha_aprobacion = new Date().toISOString().slice(0, 10)
    if (estado === 'en_ejecucion') updates.fecha_ejecucion = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('propuestas_inversion').update(updates).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar propuesta?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('propuestas_inversion').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const catInfo = (c: CategoriaPropuesta) => CATEGORIAS.find(x => x.value === c) ?? CATEGORIAS[CATEGORIAS.length - 1]

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Propuestas de Inversión</h2>
          {montoTotal > 0 && <span style={{ fontSize: '12px', color: '#64748b' }}>Comprometido (aprobadas + ejecución): <strong style={{ color: '#0ea5e9' }}>{moneda} {montoTotal.toLocaleString()}</strong></span>}
        </div>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nueva Propuesta</button>
        )}
      </div>

      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Propuesta' : 'Nueva Propuesta'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Título *</label>
              <input style={inputStyle} value={form.titulo ?? ''} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Título de la propuesta" />
            </div>
            <div>
              <label style={labelStyle}>Categoría</label>
              <select style={inputStyle} value={form.categoria ?? 'mejora'} onChange={e => setForm(f => ({ ...f, categoria: e.target.value as CategoriaPropuesta }))}>
                {CATEGORIAS.map(c => <option key={c.value} value={c.value}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Prioridad</label>
              <select style={inputStyle} value={form.prioridad ?? 'media'} onChange={e => setForm(f => ({ ...f, prioridad: e.target.value as PrioridadPropuesta }))}>
                {Object.entries(PRIORIDAD_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'propuesta'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoPropuesta }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Monto estimado ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="100" value={form.monto_estimado ?? ''} onChange={e => setForm(f => ({ ...f, monto_estimado: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div>
              <label style={labelStyle}>Fecha propuesta</label>
              <input style={inputStyle} type="date" value={form.fecha_propuesta ?? ''} onChange={e => setForm(f => ({ ...f, fecha_propuesta: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Votos a favor</label>
              <input style={inputStyle} type="number" min="0" value={form.votos_favor ?? 0} onChange={e => setForm(f => ({ ...f, votos_favor: Number(e.target.value) }))} />
            </div>
            <div>
              <label style={labelStyle}>Votos en contra</label>
              <input style={inputStyle} type="number" min="0" value={form.votos_contra ?? 0} onChange={e => setForm(f => ({ ...f, votos_contra: Number(e.target.value) }))} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción detallada de la propuesta…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button onClick={() => setFiltroEstado('todos')} style={{ padding: '5px 10px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer', borderColor: filtroEstado === 'todos' ? '#0ea5e9' : '#e2e8f0', background: filtroEstado === 'todos' ? '#e0f2fe' : 'white', color: filtroEstado === 'todos' ? '#0ea5e9' : '#64748b' }}>
          Todas ({propuestas.length})
        </button>
        {(Object.entries(ESTADO_CONFIG) as [EstadoPropuesta, typeof ESTADO_CONFIG[EstadoPropuesta]][]).map(([k, v]) => {
          const cnt = propuestas.filter(p => p.estado === k).length
          if (cnt === 0) return null
          return (
            <button key={k} onClick={() => setFiltroEstado(k)} style={{ padding: '5px 10px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer', borderColor: filtroEstado === k ? v.color : '#e2e8f0', background: filtroEstado === k ? v.bg : 'white', color: filtroEstado === k ? v.color : '#64748b' }}>
              {v.label} ({cnt})
            </button>
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>💡</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay propuestas registradas</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map(p => {
            const cat = catInfo(p.categoria)
            const prio = PRIORIDAD_CONFIG[p.prioridad]
            const est = ESTADO_CONFIG[p.estado]
            const totalVotos = p.votos_favor + p.votos_contra
            return (
              <div key={p.id} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '18px' }}>{cat.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{p.titulo}</span>
                      <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, background: prio.bg, color: prio.color }}>{prio.label}</span>
                      <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color }}>{est.label}</span>
                    </div>
                    {p.descripcion && <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>{p.descripcion}</div>}
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                      {p.fecha_propuesta}
                      {p.monto_estimado && <span style={{ marginLeft: '8px', fontWeight: 600, color: '#0f172a' }}>{moneda} {p.monto_estimado.toLocaleString()}</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    {canEdit && (
                      <select value={p.estado} onChange={e => handleEstado(p.id, e.target.value as EstadoPropuesta)}
                        style={{ padding: '4px 8px', border: '1.5px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', fontWeight: 600, color: est.color, background: 'white', cursor: 'pointer' }}>
                        {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    )}
                    {canEdit && <button onClick={() => startEdit(p)} style={{ padding: '4px 8px', background: '#f1f5f9', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>}
                    {canEdit && <button onClick={() => handleDelete(p.id)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>}
                  </div>
                </div>

                {/* Votación */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button onClick={() => handleVoto(p.id, 'favor')} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 12px', background: '#d1fae5', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, color: '#059669', cursor: 'pointer' }}>
                    👍 {p.votos_favor}
                  </button>
                  <button onClick={() => handleVoto(p.id, 'contra')} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 12px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '13px', fontWeight: 700, color: '#ef4444', cursor: 'pointer' }}>
                    👎 {p.votos_contra}
                  </button>
                  {totalVotos > 0 && (
                    <div style={{ flex: 1, height: '6px', background: '#fee2e2', borderRadius: '3px', overflow: 'hidden', maxWidth: '120px' }}>
                      <div style={{ height: '100%', width: `${(p.votos_favor / totalVotos) * 100}%`, background: '#10b981', borderRadius: '3px' }} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
