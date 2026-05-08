import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { EventoComunidad, RegistroAsistenteEvento } from '../../../types'
import type { Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  eventos: EventoComunidad[]
  asistentes: RegistroAsistenteEvento[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  cultural:    { bg: '#f3e8ff', color: '#7c3aed', label: 'Cultural' },
  deportivo:   { bg: '#dcfce7', color: '#16a34a', label: 'Deportivo' },
  social:      { bg: '#e0f2fe', color: '#0369a1', label: 'Social' },
  informativo: { bg: '#fef3c7', color: '#92400e', label: 'Informativo' },
  otro:        { bg: '#f1f5f9', color: '#64748b', label: 'Otro' },
}

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  programado: { bg: '#e0f2fe', color: '#0369a1', label: 'Programado' },
  en_curso:   { bg: '#dcfce7', color: '#16a34a', label: 'En curso' },
  realizado:  { bg: '#f1f5f9', color: '#64748b', label: 'Realizado' },
  cancelado:  { bg: '#fee2e2', color: '#ef4444', label: 'Cancelado' },
}

const BLANK_EVENTO = { titulo: '', descripcion: '', tipo: 'social', fecha: '', hora_inicio: '', hora_fin: '', lugar: '', capacidad_max: '', estado: 'programado', asistentes_real: '', costo_estimado: '' }
const BLANK_ASISTENTE = { unidad_id: '', nombre: '', num_personas: '1', confirmado: true }

export function EventosComunidadTab({ eventos, asistentes, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK_EVENTO })
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<EventoComunidad | null>(null)
  const [showAsistenteForm, setShowAsistenteForm] = useState(false)
  const [formAsistente, setFormAsistente] = useState({ ...BLANK_ASISTENTE })
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'programado' | 'en_curso' | 'realizado' | 'cancelado'>('todos')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }
  function setFA<K extends keyof typeof formAsistente>(k: K, v: typeof formAsistente[K]) { setFormAsistente(p => ({ ...p, [k]: v })) }

  function startEdit(e: EventoComunidad) {
    setEditId(e.id)
    setForm({ titulo: e.titulo, descripcion: e.descripcion ?? '', tipo: e.tipo, fecha: e.fecha, hora_inicio: e.hora_inicio ?? '', hora_fin: e.hora_fin ?? '', lugar: e.lugar ?? '', capacidad_max: e.capacidad_max ? String(e.capacidad_max) : '', estado: e.estado, asistentes_real: e.asistentes_real ? String(e.asistentes_real) : '', costo_estimado: e.costo_estimado ? String(e.costo_estimado) : '' })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.titulo.trim()) return Swal.fire('Requerido', 'El título es obligatorio.', 'warning')
    if (!form.fecha) return Swal.fire('Requerido', 'La fecha es obligatoria.', 'warning')
    setSaving(true)
    const payload = {
      titulo: form.titulo.trim(), descripcion: form.descripcion || null, tipo: form.tipo, fecha: form.fecha,
      hora_inicio: form.hora_inicio || null, hora_fin: form.hora_fin || null, lugar: form.lugar || null,
      capacidad_max: form.capacidad_max ? parseInt(form.capacidad_max) : null, estado: form.estado,
      asistentes_real: form.asistentes_real ? parseInt(form.asistentes_real) : null,
      costo_estimado: form.costo_estimado ? parseFloat(form.costo_estimado) : null,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('eventos_comunidad').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('eventos_comunidad').insert({ ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setEditId(null); setForm({ ...BLANK_EVENTO }); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar evento?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('eventos_comunidad').delete().eq('id', id)
    if (selected?.id === id) setSelected(null)
    onRefresh()
  }

  async function handleSaveAsistente() {
    if (!selected) return
    if (!formAsistente.unidad_id) return Swal.fire('Requerido', 'Seleccione una unidad.', 'warning')
    if (!formAsistente.nombre.trim()) return Swal.fire('Requerido', 'El nombre es obligatorio.', 'warning')
    const { error } = await supabase.from('registro_asistentes_evento').upsert({
      company_id: companyId, evento_id: selected.id,
      unidad_id: formAsistente.unidad_id, nombre: formAsistente.nombre.trim(),
      num_personas: parseInt(formAsistente.num_personas) || 1, confirmado: formAsistente.confirmado,
    }, { onConflict: 'evento_id,unidad_id' })
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowAsistenteForm(false); setFormAsistente({ ...BLANK_ASISTENTE }); onRefresh()
  }

  async function marcarAsistio(asistenteId: string, asistio: boolean) {
    await supabase.from('registro_asistentes_evento').update({ asistio }).eq('id', asistenteId)
    onRefresh()
  }

  async function cambiarEstado(id: string, estado: string) {
    await supabase.from('eventos_comunidad').update({ estado }).eq('id', id)
    onRefresh()
  }

  const filtered = filtroEstado === 'todos' ? eventos : eventos.filter(e => e.estado === filtroEstado)
  const selectedAsistentes = selected ? asistentes.filter(a => a.evento_id === selected.id) : []

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Eventos Comunitarios</h2>
          <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>{eventos.filter(e => e.estado === 'programado').length} programados · {eventos.filter(e => e.estado === 'realizado').length} realizados</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK_EVENTO }); setShowForm(true) }}
            style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Evento
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar evento' : 'Nuevo Evento'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Título *</label>
              <input style={inputStyle} value={form.titulo} onChange={e => setF('titulo', e.target.value)} placeholder="Ej: Noche de talentos" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Tipo</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                {Object.entries(TIPO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Estado</label>
              <select style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value)}>
                {Object.entries(ESTADO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha *</label>
              <input style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Hora inicio</label>
              <input style={inputStyle} type="time" value={form.hora_inicio} onChange={e => setF('hora_inicio', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Hora fin</label>
              <input style={inputStyle} type="time" value={form.hora_fin} onChange={e => setF('hora_fin', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Lugar</label>
              <input style={inputStyle} value={form.lugar} onChange={e => setF('lugar', e.target.value)} placeholder="Salón comunal…" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Capacidad máx.</label>
              <input style={inputStyle} type="number" value={form.capacidad_max} onChange={e => setF('capacidad_max', e.target.value)} placeholder="50" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Asistentes reales</label>
              <input style={inputStyle} type="number" value={form.asistentes_real} onChange={e => setF('asistentes_real', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Costo estimado</label>
              <input style={inputStyle} type="number" value={form.costo_estimado} onChange={e => setF('costo_estimado', e.target.value)} placeholder="0.00" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Descripción</label>
              <textarea style={{ ...inputStyle, minHeight: '55px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.descripcion} onChange={e => setF('descripcion', e.target.value)} placeholder="Detalles del evento…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              style={{ padding: '7px 12px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: '5px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {(['todos', 'programado', 'en_curso', 'realizado', 'cancelado'] as const).map(f => (
          <button key={f} onClick={() => setFiltroEstado(f)}
            style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
              borderColor: filtroEstado === f ? '#0ea5e9' : '#e2e8f0',
              background: filtroEstado === f ? '#e0f2fe' : 'white',
              color: filtroEstado === f ? '#0369a1' : '#64748b',
              fontWeight: filtroEstado === f ? 700 : 500 }}>
            {f === 'todos' ? 'Todos' : ESTADO_STYLE[f]?.label ?? f}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '16px' }}>
        {/* Events list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>No hay eventos.</div>
          ) : filtered.map(ev => {
            const ts = TIPO_STYLE[ev.tipo] ?? TIPO_STYLE.otro
            const es = ESTADO_STYLE[ev.estado] ?? ESTADO_STYLE.programado
            const asistCount = asistentes.filter(a => a.evento_id === ev.id).length
            return (
              <div key={ev.id} onClick={() => setSelected(selected?.id === ev.id ? null : ev)}
                style={{ background: 'white', border: `1.5px solid ${selected?.id === ev.id ? '#0ea5e9' : '#e2e8f0'}`, borderRadius: '10px', padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px' }}>{ev.titulo}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: ts.bg, color: ts.color }}>{ts.label}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: es.bg, color: es.color }}>{es.label}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <span>📅 {ev.fecha}</span>
                      {ev.hora_inicio && <span>🕐 {ev.hora_inicio}{ev.hora_fin ? ` – ${ev.hora_fin}` : ''}</span>}
                      {ev.lugar && <span>📍 {ev.lugar}</span>}
                      {asistCount > 0 && <span>👥 {asistCount} unidades registradas</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                      {ev.estado === 'programado' && (
                        <button onClick={() => cambiarEstado(ev.id, 'en_curso')}
                          style={{ padding: '3px 7px', background: '#dcfce7', color: '#16a34a', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>
                          Iniciar
                        </button>
                      )}
                      {ev.estado === 'en_curso' && (
                        <button onClick={() => cambiarEstado(ev.id, 'realizado')}
                          style={{ padding: '3px 7px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>
                          Finalizar
                        </button>
                      )}
                      <button onClick={() => startEdit(ev)}
                        style={{ padding: '3px 7px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDelete(ev.id)}
                        style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Asistentes panel */}
        {selected && (
          <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>Asistentes — {selected.titulo}</h3>
              {canCreate && !showAsistenteForm && (
                <button onClick={() => setShowAsistenteForm(true)}
                  style={{ padding: '4px 10px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                  + Agregar
                </button>
              )}
            </div>
            {showAsistenteForm && (
              <div style={{ background: 'white', borderRadius: '8px', padding: '10px', marginBottom: '10px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                  <div>
                    <label style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '2px' }}>Unidad</label>
                    <select style={{ ...inputStyle, fontSize: '12px' }} value={formAsistente.unidad_id} onChange={e => setFA('unidad_id', e.target.value)}>
                      <option value="">— Seleccionar —</option>
                      {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '2px' }}>Nombre contacto</label>
                    <input style={{ ...inputStyle, fontSize: '12px' }} value={formAsistente.nombre} onChange={e => setFA('nombre', e.target.value)} placeholder="Nombre del residente" />
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '2px' }}>Nº personas</label>
                    <input style={{ ...inputStyle, fontSize: '12px' }} type="number" min="1" value={formAsistente.num_personas} onChange={e => setFA('num_personas', e.target.value)} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={handleSaveAsistente} style={{ padding: '5px 12px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>Guardar</button>
                  <button onClick={() => { setShowAsistenteForm(false); setFormAsistente({ ...BLANK_ASISTENTE }) }} style={{ padding: '5px 10px', background: 'white', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#64748b' }}>Cancelar</button>
                </div>
              </div>
            )}
            {selectedAsistentes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '12px' }}>Sin asistentes registrados.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {selectedAsistentes.map(a => {
                  const unidad = unidades.find(u => u.id === a.unidad_id)
                  return (
                    <div key={a.id} style={{ background: 'white', borderRadius: '8px', padding: '8px 10px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '12px' }}>{a.nombre} <span style={{ color: '#94a3b8', fontWeight: 400 }}>({a.num_personas} persona{a.num_personas !== 1 ? 's' : ''})</span></div>
                        {unidad && <div style={{ fontSize: '11px', color: '#0ea5e9' }}>🏠 {unidad.nombre}</div>}
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={() => marcarAsistio(a.id, !a.asistio)}
                            style={{ padding: '3px 7px', background: a.asistio ? '#dcfce7' : '#f1f5f9', color: a.asistio ? '#16a34a' : '#94a3b8', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>
                            {a.asistio ? '✓ Asistió' : 'Sin confirmar'}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
