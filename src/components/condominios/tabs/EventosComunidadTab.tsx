import { useState, type CSSProperties} from 'react'
import { EmptyState } from '../../shared/EmptyState'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import {
  createCondominioRow,
  updateCondominioRow,
  deleteCondominioRow,
  upsertCondominioRow,
} from '../../../domain/condominios/tabMutations'
import type { EventoComunidad, RegistroAsistenteEvento } from '../../../types'
import type { Unidad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

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
  cultural:    { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', label: 'Cultural' },
  deportivo:   { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Deportivo' },
  social:      { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', label: 'Social' },
  informativo: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Informativo' },
  otro:        { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Otro' },
}

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  programado: { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', label: 'Programado' },
  en_curso:   { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'En curso' },
  realizado:  { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Realizado' },
  cancelado:  { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Cancelado' },
}

const BLANK_EVENTO = { titulo: '', descripcion: '', tipo: 'social', fecha: '', hora_inicio: '', hora_fin: '', lugar: '', capacidad_max: '', estado: 'programado', asistentes_real: '', costo_estimado: '' }
const BLANK_ASISTENTE = { unidad_id: '', nombre: '', num_personas: '1', confirmado: true }

export function EventosComunidadTab({ eventos, asistentes, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK_EVENTO })
  const [saving, setSaving] = useState(false)
  // Por id y no la fila: la ventana lee el evento vigente de `eventos` tras
  // cada refresco (la copia guardada quedaba vieja si se editaba el evento).
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

  function cerrarForm() {
    if (saving) return
    setShowForm(false)
    setEditId(null)
  }

  // Cada ventana de asistentes arranca sin el subformulario abierto (antes
  // quedaba abierto, con lo escrito, al pasar a otro evento).
  function abrirDetalle(id: string) {
    setSelectedId(id)
    cancelarAsistente()
  }

  function cerrarDetalle() {
    setSelectedId(null)
    cancelarAsistente()
  }

  function cancelarAsistente() {
    setShowAsistenteForm(false)
    setFormAsistente({ ...BLANK_ASISTENTE })
  }

  async function handleSave() {
    if (!form.titulo.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El título es obligatorio.' })
    if (!form.fecha) return notify({ variant: 'warning', title: 'Requerido', text: 'La fecha es obligatoria.' })
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
      ({ error } = await updateCondominioRow('eventos_comunidad', editId, payload))
    } else {
      ({ error } = await createCondominioRow('eventos_comunidad', { ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); setEditId(null); setForm({ ...BLANK_EVENTO }); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await confirm({ title: '¿Eliminar evento?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('eventos_comunidad', id)
    if (selectedId === id) cerrarDetalle()
    onRefresh()
  }

  async function handleSaveAsistente() {
    if (!selectedId) return
    if (!formAsistente.unidad_id) return notify({ variant: 'warning', title: 'Requerido', text: 'Seleccione una unidad.' })
    if (!formAsistente.nombre.trim()) return notify({ variant: 'warning', title: 'Requerido', text: 'El nombre es obligatorio.' })
    const { error } = await upsertCondominioRow('registro_asistentes_evento', {
      company_id: companyId, evento_id: selectedId,
      unidad_id: formAsistente.unidad_id, nombre: formAsistente.nombre.trim(),
      num_personas: parseInt(formAsistente.num_personas) || 1, confirmado: formAsistente.confirmado,
    }, 'evento_id,unidad_id')
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowAsistenteForm(false); setFormAsistente({ ...BLANK_ASISTENTE }); onRefresh()
  }

  async function marcarAsistio(asistenteId: string, asistio: boolean) {
    await updateCondominioRow('registro_asistentes_evento', asistenteId, { asistio })
    onRefresh()
  }

  async function cambiarEstado(id: string, estado: string) {
    await updateCondominioRow('eventos_comunidad', id, { estado })
    onRefresh()
  }

  const filtered = filtroEstado === 'todos' ? eventos : eventos.filter(e => e.estado === filtroEstado)
  const selected = selectedId ? eventos.find(e => e.id === selectedId) ?? null : null
  const selectedAsistentes = selected ? asistentes.filter(a => a.evento_id === selected.id) : []

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }
  const pill = (bg: string, color: string): CSSProperties => ({ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: bg, color, whiteSpace: 'nowrap' })

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Eventos Comunitarios</h2>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--at-ink-3)' }}>{eventos.filter(e => e.estado === 'programado').length} programados · {eventos.filter(e => e.estado === 'realizado').length} realizados</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK_EVENTO }); setShowForm(true) }}
            style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Evento
          </button>
        )}
      </div>

      {/* Form en ventana (antes se desplegaba arriba de la lista y en el
          teléfono empujaba todo hacia abajo). */}
      {showForm && (
        <EditModal
          title={editId ? 'Editar evento' : 'Nuevo Evento'}
          maxWidth="640px"
          fullScreenOnMobile
          closeOnBackdropClick={!saving}
          closeOnEscape={!saving}
          onClose={cerrarForm}
          footer={<>
            <Button variant="secondary" onClick={cerrarForm} disabled={saving}>Cancelar</Button>
            <Button onClick={handleSave} loading={saving} loadingText="Guardando…">Guardar</Button>
          </>}
        >
          {/* `1 / -1` y no `span 2`: en una sola columna (teléfono) el span
              creaba una columna implícita y el campo se salía de la ventana. */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="evc-titulo" style={labelStyle}>Título *</label>
              <input id="evc-titulo" style={inputStyle} value={form.titulo} onChange={e => setF('titulo', e.target.value)} placeholder="Ej: Noche de talentos" autoFocus />
            </div>
            <div>
              <label htmlFor="evc-tipo" style={labelStyle}>Tipo</label>
              <select id="evc-tipo" style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                {Object.entries(TIPO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="evc-estado" style={labelStyle}>Estado</label>
              <select id="evc-estado" style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value)}>
                {Object.entries(ESTADO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="evc-fecha" style={labelStyle}>Fecha *</label>
              <input id="evc-fecha" style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label htmlFor="evc-hora-inicio" style={labelStyle}>Hora inicio</label>
              <input id="evc-hora-inicio" style={inputStyle} type="time" value={form.hora_inicio} onChange={e => setF('hora_inicio', e.target.value)} />
            </div>
            <div>
              <label htmlFor="evc-hora-fin" style={labelStyle}>Hora fin</label>
              <input id="evc-hora-fin" style={inputStyle} type="time" value={form.hora_fin} onChange={e => setF('hora_fin', e.target.value)} />
            </div>
            <div>
              <label htmlFor="evc-lugar" style={labelStyle}>Lugar</label>
              <input id="evc-lugar" style={inputStyle} value={form.lugar} onChange={e => setF('lugar', e.target.value)} placeholder="Salón comunal…" />
            </div>
            <div>
              <label htmlFor="evc-capacidad" style={labelStyle}>Capacidad máx.</label>
              <input id="evc-capacidad" style={inputStyle} type="number" value={form.capacidad_max} onChange={e => setF('capacidad_max', e.target.value)} placeholder="50" />
            </div>
            <div>
              <label htmlFor="evc-asistentes-real" style={labelStyle}>Asistentes reales</label>
              <input id="evc-asistentes-real" style={inputStyle} type="number" value={form.asistentes_real} onChange={e => setF('asistentes_real', e.target.value)} />
            </div>
            <div>
              <label htmlFor="evc-costo" style={labelStyle}>Costo estimado</label>
              <input id="evc-costo" style={inputStyle} type="number" value={form.costo_estimado} onChange={e => setF('costo_estimado', e.target.value)} placeholder="0.00" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="evc-descripcion" style={labelStyle}>Descripción</label>
              <textarea id="evc-descripcion" style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
                value={form.descripcion} onChange={e => setF('descripcion', e.target.value)} placeholder="Detalles del evento…" />
            </div>
          </div>
        </EditModal>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: '5px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {(['todos', 'programado', 'en_curso', 'realizado', 'cancelado'] as const).map(f => (
          <button key={f} onClick={() => setFiltroEstado(f)}
            style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
              borderColor: filtroEstado === f ? 'var(--at-primary)' : 'var(--at-line)',
              background: filtroEstado === f ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: filtroEstado === f ? 'var(--at-primary-hover)' : 'var(--at-ink-3)',
              fontWeight: filtroEstado === f ? 700 : 500 }}>
            {f === 'todos' ? 'Todos' : ESTADO_STYLE[f]?.label ?? f}
          </button>
        ))}
      </div>

      {/* Lista a todo el ancho — cada evento abre sus asistentes en ventana.
          Antes el panel ocupaba media pantalla al lado y en el teléfono
          dejaba la lista en una franja. */}
      {filtered.length === 0 ? (
        <EmptyState icon="📋" title="No hay eventos" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.map(ev => {
            const ts = TIPO_STYLE[ev.tipo] ?? TIPO_STYLE.otro
            const es = ESTADO_STYLE[ev.estado] ?? ESTADO_STYLE.programado
            const asistCount = asistentes.filter(a => a.evento_id === ev.id).length
            return (
              <div key={ev.id}
                style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 8px', paddingRight: '10px' }}>
                <button type="button" className="cond-row-main" onClick={() => abrirDetalle(ev.id)}
                  style={{ flex: '1 1 240px', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: '12px 4px 12px 14px', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '13px' }}>{ev.titulo}</span>
                    <span style={pill(ts.bg, ts.color)}>{ts.label}</span>
                    <span style={pill(es.bg, es.color)}>{es.label}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <span>📅 {ev.fecha}</span>
                    {ev.hora_inicio && <span>🕐 {ev.hora_inicio}{ev.hora_fin ? ` – ${ev.hora_fin}` : ''}</span>}
                    {ev.lugar && <span>📍 {ev.lugar}</span>}
                    {asistCount > 0 && <span>👥 {asistCount} unidades registradas</span>}
                  </div>
                </button>
                {canEdit && (
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0, marginLeft: 'auto', padding: '8px 0' }}>
                    {ev.estado === 'programado' && (
                      <button onClick={() => cambiarEstado(ev.id, 'en_curso')}
                        style={{ padding: '3px 7px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>
                        Iniciar
                      </button>
                    )}
                    {ev.estado === 'en_curso' && (
                      <button onClick={() => cambiarEstado(ev.id, 'realizado')}
                        style={{ padding: '3px 7px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: 'none', borderRadius: '5px', fontSize: '10px', cursor: 'pointer', fontWeight: 600 }}>
                        Finalizar
                      </button>
                    )}
                    <button onClick={() => startEdit(ev)} aria-label={`Editar ${ev.titulo}`}
                      style={{ padding: '3px 7px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                    <button onClick={() => handleDelete(ev.id)} aria-label={`Eliminar ${ev.titulo}`}
                      style={{ padding: '3px 7px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: 'var(--at-danger)' }}>🗑️</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Asistentes en ventana: a pantalla completa en el teléfono. */}
      {selected && (() => {
        const ts = TIPO_STYLE[selected.tipo] ?? TIPO_STYLE.otro
        const es = ESTADO_STYLE[selected.estado] ?? ESTADO_STYLE.programado
        return (
          <EditModal
            title={selected.titulo}
            subtitle={<span style={{ display: 'inline-flex', gap: '4px 10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={pill(ts.bg, ts.color)}>{ts.label}</span>
              <span style={pill(es.bg, es.color)}>{es.label}</span>
              <span>📅 {selected.fecha}</span>
              {selected.hora_inicio && <span>🕐 {selected.hora_inicio}{selected.hora_fin ? ` – ${selected.hora_fin}` : ''}</span>}
              {selected.lugar && <span>📍 {selected.lugar}</span>}
            </span>}
            maxWidth="600px"
            fullScreenOnMobile
            onClose={cerrarDetalle}
            footer={showAsistenteForm ? <>
              <Button variant="secondary" onClick={cancelarAsistente}>Cancelar</Button>
              <Button onClick={handleSaveAsistente}>Guardar asistente</Button>
            </> : canCreate ? (
              <Button onClick={() => setShowAsistenteForm(true)}>+ Agregar asistente</Button>
            ) : undefined}
          >
            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>
              Asistentes ({selectedAsistentes.length})
            </div>
            {showAsistenteForm && (
              <div style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px', marginBottom: '10px', border: '1px solid var(--at-line)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
                  <div>
                    <label htmlFor="evc-asis-unidad" style={labelStyle}>Unidad</label>
                    <select id="evc-asis-unidad" style={inputStyle} value={formAsistente.unidad_id} onChange={e => setFA('unidad_id', e.target.value)} autoFocus>
                      <option value="">— Seleccionar —</option>
                      {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="evc-asis-nombre" style={labelStyle}>Nombre contacto</label>
                    <input id="evc-asis-nombre" style={inputStyle} value={formAsistente.nombre} onChange={e => setFA('nombre', e.target.value)} placeholder="Nombre del residente" />
                  </div>
                  <div>
                    <label htmlFor="evc-asis-personas" style={labelStyle}>Nº personas</label>
                    <input id="evc-asis-personas" style={inputStyle} type="number" min="1" value={formAsistente.num_personas} onChange={e => setFA('num_personas', e.target.value)} />
                  </div>
                </div>
              </div>
            )}
            {selectedAsistentes.length === 0 ? (
              <EmptyState icon="📋" title="Sin asistentes registrados" />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {selectedAsistentes.map(a => {
                  const unidad = unidades.find(u => u.id === a.unidad_id)
                  return (
                    <div key={a.id} style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '8px 10px', border: '1px solid var(--at-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>{a.nombre} <span style={{ color: 'var(--at-ink-3)', fontWeight: 400 }}>({a.num_personas} persona{a.num_personas !== 1 ? 's' : ''})</span></div>
                        {unidad && <div style={{ fontSize: '12px', color: 'var(--at-primary)' }}>🏠 {unidad.nombre}</div>}
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={() => marcarAsistio(a.id, !a.asistio)}
                            style={{ padding: '4px 8px', background: a.asistio ? 'var(--at-success-tint)' : 'var(--at-chip)', color: a.asistio ? 'var(--at-success)' : 'var(--at-ink-3)', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                            {a.asistio ? '✓ Asistió' : 'Sin confirmar'}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </EditModal>
        )
      })()}
    </div>
  )
}
