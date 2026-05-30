import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { AgendaItem, TipoAgenda, EstadoAgenda } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'

interface Props {
  agenda: AgendaItem[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_CONFIG: Record<TipoAgenda, { label: string; icon: string; color: string }> = {
  tarea:         { label: 'Tarea',         icon: '✅', color: 'var(--at-primary)' },
  evento:        { label: 'Evento',        icon: '🎉', color: 'var(--at-accent)' },
  mantenimiento: { label: 'Mantenimiento', icon: '🔧', color: 'var(--at-warning)' },
  reunion:       { label: 'Reunión',       icon: '👥', color: 'var(--at-success)' },
  otro:          { label: 'Otro',          icon: '📋', color: 'var(--at-ink-3)' },
}

const ESTADO_CONFIG: Record<EstadoAgenda, { label: string; color: string; bg: string }> = {
  pendiente:  { label: 'Pendiente',  color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  en_curso:   { label: 'En Curso',   color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  completado: { label: 'Completado', color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  cancelado:  { label: 'Cancelado',  color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
}

const blank = (): Partial<AgendaItem> => ({
  titulo: '',
  descripcion: '',
  tipo: 'tarea',
  fecha: new Date().toISOString().slice(0, 10),
  hora_inicio: '',
  hora_fin: '',
  estado: 'pendiente',
  recurrente: false,
  notas: '',
})

export function AgendaTab({ agenda, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [vistaMode, setVistaMode] = useState<'proximos' | 'todos' | 'completados'>('proximos')
  const [filtroTipo, setFiltroTipo] = useState<TipoAgenda | 'todos'>('todos')
  const [form, setForm] = useState<Partial<AgendaItem>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const filtered = agenda.filter(a => {
    if (filtroTipo !== 'todos' && a.tipo !== filtroTipo) return false
    if (vistaMode === 'proximos') return a.estado !== 'completado' && a.estado !== 'cancelado'
    if (vistaMode === 'completados') return a.estado === 'completado' || a.estado === 'cancelado'
    return true
  }).sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.hora_inicio ?? '').localeCompare(b.hora_inicio ?? ''))

  const vencidos = agenda.filter(a => a.fecha < hoy && a.estado === 'pendiente')
  const proximos7 = agenda.filter(a =>
    a.estado === 'pendiente' && a.fecha >= hoy &&
    new Date(a.fecha).getTime() - Date.now() < 7 * 24 * 3600 * 1000
  )

  function startEdit(a: AgendaItem) {
    setForm({
      titulo: a.titulo,
      descripcion: a.descripcion ?? '',
      tipo: a.tipo,
      fecha: a.fecha,
      hora_inicio: a.hora_inicio ?? '',
      hora_fin: a.hora_fin ?? '',
      estado: a.estado,
      recurrente: a.recurrente,
      notas: a.notas ?? '',
    })
    setEditId(a.id)
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditId(null)
    setForm(blank())
  }

  async function handleSave() {
    if (!form.titulo?.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa el título.' })
    if (!form.fecha) return notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa la fecha.' })
    setSaving(true)
    const payload = {
      company_id: companyId,
      project_id: proyectoId,
      titulo: form.titulo!.trim(),
      descripcion: form.descripcion || null,
      tipo: form.tipo ?? 'tarea',
      fecha: form.fecha!,
      hora_inicio: form.hora_inicio || null,
      hora_fin: form.hora_fin || null,
      estado: form.estado ?? 'pendiente',
      asignado_a: userId || null,
      recurrente: form.recurrente ?? false,
      notas: form.notas || null,
    }
    if (editId) {
      const { error } = await supabase.from('agenda_operativa').update(payload).eq('id', editId)
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    } else {
      const { error } = await supabase.from('agenda_operativa').insert(payload)
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }
    }
    setSaving(false)
    cancelForm()
    onRefresh()
  }

  async function handleDelete(id: string) {
    const result = await confirm({ title: '¿Eliminar elemento?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!result.isConfirmed) return
    const { error } = await supabase.from('agenda_operativa').delete().eq('id', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoAgenda) {
    const { error } = await supabase.from('agenda_operativa').update({ estado }).eq('id', id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
  }

  const inputStyle: CSSProperties = {
    width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px',
    fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box',
  }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }

  const groupedByDate = filtered.reduce<Record<string, AgendaItem[]>>((acc, a) => {
    const key = a.fecha
    if (!acc[key]) acc[key] = []
    acc[key].push(a)
    return acc
  }, {})

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Alert banners */}
      {vencidos.length > 0 && (
        <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger)', borderRadius: '10px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>🚨</span>
          <span style={{ fontSize: '13px', color: 'var(--at-danger-strong)', fontWeight: 600 }}>
            {vencidos.length} tarea{vencidos.length > 1 ? 's' : ''} vencida{vencidos.length > 1 ? 's' : ''} sin completar
          </span>
        </div>
      )}
      {proximos7.length > 0 && (
        <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning)', borderRadius: '10px', padding: '10px 16px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>📅</span>
          <span style={{ fontSize: '13px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>
            {proximos7.length} elemento{proximos7.length > 1 ? 's' : ''} para los próximos 7 días
          </span>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Agenda Operativa</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Elemento
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>
            {editId ? 'Editar Elemento' : 'Nuevo Elemento de Agenda'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Título *</label>
              <input style={inputStyle} value={form.titulo ?? ''} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Título del elemento de agenda" />
            </div>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select style={inputStyle} value={form.tipo ?? 'tarea'} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoAgenda }))}>
                {(Object.entries(TIPO_CONFIG) as [TipoAgenda, typeof TIPO_CONFIG[TipoAgenda]][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'pendiente'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoAgenda }))}>
                {(Object.entries(ESTADO_CONFIG) as [EstadoAgenda, typeof ESTADO_CONFIG[EstadoAgenda]][]).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha *</label>
              <input style={inputStyle} type="date" value={form.fecha ?? ''} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Hora inicio</label>
              <input style={inputStyle} type="time" value={form.hora_inicio ?? ''} onChange={e => setForm(f => ({ ...f, hora_inicio: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Hora fin</label>
              <input style={inputStyle} type="time" value={form.hora_fin ?? ''} onChange={e => setForm(f => ({ ...f, hora_fin: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input type="checkbox" id="recurrente" checked={form.recurrente ?? false} onChange={e => setForm(f => ({ ...f, recurrente: e.target.checked }))} />
              <label htmlFor="recurrente" style={{ fontSize: '13px', color: 'var(--at-ink-2)', fontWeight: 500, cursor: 'pointer' }}>Recurrente</label>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Detalles del elemento…" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notas</label>
              <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '50px' }} value={form.notas ?? ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Notas adicionales…" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--at-ink-3)' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Vista */}
        {([
          { id: 'proximos' as const, label: 'Próximos' },
          { id: 'todos' as const, label: 'Todos' },
          { id: 'completados' as const, label: 'Historial' },
        ]).map(v => (
          <button key={v.id} onClick={() => setVistaMode(v.id)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: vistaMode === v.id ? 'var(--at-primary)' : 'var(--at-line)',
              background: vistaMode === v.id ? 'var(--at-primary-soft)' : 'var(--at-surface)',
              color: vistaMode === v.id ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
            {v.label}
          </button>
        ))}
        <div style={{ width: '1px', height: '24px', background: 'var(--at-line)', margin: '0 4px' }} />
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value as TipoAgenda | 'todos')}
          style={{ padding: '5px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '12px', background: 'var(--at-surface-2)' }}>
          <option value="todos">Todos los tipos</option>
          {(Object.entries(TIPO_CONFIG) as [TipoAgenda, typeof TIPO_CONFIG[TipoAgenda]][]).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
      </div>

      {/* Calendar-style grouped list */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>📅</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay elementos en la agenda</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {Object.entries(groupedByDate).map(([fecha, items]) => {
            const esHoy = fecha === hoy
            const esPasado = fecha < hoy
            return (
              <div key={fecha}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px',
                  padding: '6px 10px', borderRadius: '8px',
                  background: esHoy ? 'var(--at-primary)' : esPasado ? 'var(--at-chip)' : 'var(--at-surface-2)',
                  color: esHoy ? 'white' : esPasado ? 'var(--at-ink-3)' : 'var(--at-ink-2)',
                }}>
                  <span style={{ fontWeight: 700, fontSize: '13px' }}>
                    {esHoy ? '📍 HOY — ' : ''}{fecha}
                  </span>
                  <span style={{ fontSize: '12px', opacity: 0.7 }}>({items.length} elemento{items.length !== 1 ? 's' : ''})</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '8px' }}>
                  {items.map(a => {
                    const tipo = TIPO_CONFIG[a.tipo]
                    const estado = ESTADO_CONFIG[a.estado]
                    return (
                      <div key={a.id} style={{
                        background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px',
                        padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: '12px',
                        borderLeft: `4px solid ${tipo.color}`,
                        opacity: a.estado === 'completado' || a.estado === 'cancelado' ? 0.65 : 1,
                      }}>
                        <span style={{ fontSize: '20px', marginTop: '2px' }}>{tipo.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, color: 'var(--at-ink)', fontSize: '14px' }}>
                              {a.titulo}
                              {a.recurrente && <span style={{ marginLeft: '4px', fontSize: '11px', color: 'var(--at-accent)' }}>🔄 recurrente</span>}
                            </span>
                            <span style={{ padding: '2px 7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: estado.bg, color: estado.color }}>
                              {estado.label}
                            </span>
                          </div>
                          {(a.hora_inicio || a.hora_fin) && (
                            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                              🕐 {a.hora_inicio ?? ''}{a.hora_fin ? ` – ${a.hora_fin}` : ''}
                            </div>
                          )}
                          {a.descripcion && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '4px' }}>{a.descripcion}</div>}
                          {a.notas && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px', fontStyle: 'italic' }}>{a.notas}</div>}
                        </div>
                        {canEdit && (
                          <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                            {a.estado === 'pendiente' && (
                              <button onClick={() => handleEstado(a.id, 'en_curso')} style={{ padding: '4px 8px', background: 'var(--at-primary-soft)', color: 'var(--at-primary)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
                                Iniciar
                              </button>
                            )}
                            {a.estado === 'en_curso' && (
                              <button onClick={() => handleEstado(a.id, 'completado')} style={{ padding: '4px 8px', background: 'var(--at-success-tint)', color: 'var(--at-success-strong)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>
                                ✓
                              </button>
                            )}
                            <button onClick={() => startEdit(a)} style={{ padding: '4px 8px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                            <button onClick={() => handleDelete(a.id)} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>🗑️</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
