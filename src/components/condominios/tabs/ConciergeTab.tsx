import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { SolicitudConcierge, EstadoConcierge, TipoConcierge, Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  solicitudes: SolicitudConcierge[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoConcierge, { label: string; color: string; bg: string }> = {
  pendiente:  { label: 'Pendiente',  color: '#f59e0b', bg: '#fef3c7' },
  en_proceso: { label: 'En proceso', color: '#1B3B36', bg: '#D9E2DC' },
  completado: { label: 'Completado', color: '#10b981', bg: '#d1fae5' },
  cancelado:  { label: 'Cancelado',  color: '#ef4444', bg: '#fee2e2' },
}

const TIPO_CONFIG: Record<TipoConcierge, { label: string; icon: string }> = {
  taxi:          { label: 'Taxi / Transporte', icon: '🚗' },
  restaurante:   { label: 'Restaurante',       icon: '🍽️' },
  tour:          { label: 'Tour / Actividad',  icon: '🗺️' },
  compras:       { label: 'Compras',           icon: '🛍️' },
  mensajeria:    { label: 'Mensajería',        icon: '📦' },
  limpieza_extra:{ label: 'Limpieza Extra',    icon: '🧹' },
  otro:          { label: 'Otro',              icon: '📋' },
}

const blank = (): Partial<SolicitudConcierge> => ({
  unidad_id: undefined, tipo: 'otro', descripcion: '',
  fecha_solicitud: new Date().toISOString().slice(0, 10),
  hora_solicitud: '', estado: 'pendiente', atendido_por: '', costo: undefined, notas_staff: '',
})

export function ConciergeTab({ solicitudes, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoConcierge | 'todos'>('todos')
  const [form, setForm] = useState<Partial<SolicitudConcierge>>(blank())
  const [editId, setEditId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  const thisMonth = new Date().toISOString().slice(0, 7)
  const filtered = solicitudes.filter(s => filtroEstado === 'todos' || s.estado === filtroEstado)
  const pendientes  = solicitudes.filter(s => s.estado === 'pendiente').length
  const enProceso   = solicitudes.filter(s => s.estado === 'en_proceso').length
  const completadosMes = solicitudes.filter(s => s.estado === 'completado' && s.fecha_solicitud.startsWith(thisMonth)).length
  const costoMes = solicitudes.filter(s => s.estado === 'completado' && s.fecha_solicitud.startsWith(thisMonth)).reduce((sum, s) => sum + (s.costo ?? 0), 0)

  // Agrupar por tipo para vista
  const byTipo: Record<string, SolicitudConcierge[]> = {}
  for (const s of filtered) { byTipo[s.tipo] = byTipo[s.tipo] ?? []; byTipo[s.tipo].push(s) }

  function startEdit(s: SolicitudConcierge) {
    setForm({
      unidad_id: s.unidad_id ?? undefined, tipo: s.tipo, descripcion: s.descripcion,
      fecha_solicitud: s.fecha_solicitud, hora_solicitud: s.hora_solicitud ?? '',
      estado: s.estado, atendido_por: s.atendido_por ?? '', costo: s.costo ?? undefined, notas_staff: s.notas_staff ?? '',
    })
    setEditId(s.id); setShowForm(true)
  }

  function cancelForm() { setShowForm(false); setEditId(null); setForm(blank()) }

  async function handleSave() {
    if (!form.descripcion?.trim()) return Swal.fire('Campo requerido', 'Describe la solicitud.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      tipo: form.tipo ?? 'otro', descripcion: form.descripcion!.trim(),
      fecha_solicitud: form.fecha_solicitud!, hora_solicitud: form.hora_solicitud || null,
      estado: form.estado ?? 'pendiente',
      atendido_por: form.atendido_por || null, costo: form.costo ?? null,
      notas_staff: form.notas_staff || null,
    }
    const { error } = editId
      ? await supabase.from('solicitudes_concierge').update(payload).eq('id', editId)
      : await supabase.from('solicitudes_concierge').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSaving(false); return }
    setSaving(false); cancelForm(); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar solicitud?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    const { error } = await supabase.from('solicitudes_concierge').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  async function handleEstado(id: string, estado: EstadoConcierge) {
    const { error } = await supabase.from('solicitudes_concierge').update({ estado }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', color: '#15291F', background: '#FAF7EF', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#7E9389', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {[
          { label: 'Pendientes',      value: String(pendientes),                                                   icon: '⏳', color: '#f59e0b' },
          { label: 'En proceso',      value: String(enProceso),                                                    icon: '🔄', color: '#1B3B36' },
          { label: 'Completados/mes', value: String(completadosMes),                                              icon: '✅', color: '#10b981' },
          { label: 'Facturado/mes',   value: costoMes > 0 ? `${moneda} ${costoMes.toFixed(0)}` : '—',             icon: '💰', color: '#B96A3F' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: '#7E9389', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#15291F' }}>Concierge Digital</h2>
        {canCreate && !showForm && (
          <button onClick={() => setShowForm(true)} style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nueva Solicitud</button>
        )}
      </div>

      {showForm && (
        <div style={{ background: '#FAF7EF', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar Solicitud' : 'Nueva Solicitud de Concierge'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Tipo</label>
              <select style={inputStyle} value={form.tipo ?? 'otro'} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoConcierge }))}>
                {Object.entries(TIPO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Unidad</label>
              <select style={inputStyle} value={form.unidad_id ?? ''} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value || undefined }))}>
                <option value="">Sin unidad</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Fecha</label>
              <input style={inputStyle} type="date" value={form.fecha_solicitud ?? ''} onChange={e => setForm(f => ({ ...f, fecha_solicitud: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Hora</label>
              <input style={inputStyle} type="time" value={form.hora_solicitud ?? ''} onChange={e => setForm(f => ({ ...f, hora_solicitud: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.estado ?? 'pendiente'} onChange={e => setForm(f => ({ ...f, estado: e.target.value as EstadoConcierge }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Atendido por</label>
              <input style={inputStyle} value={form.atendido_por ?? ''} onChange={e => setForm(f => ({ ...f, atendido_por: e.target.value }))} placeholder="Nombre del staff" />
            </div>
            <div>
              <label style={labelStyle}>Costo ({moneda})</label>
              <input style={inputStyle} type="number" min="0" step="0.01" value={form.costo ?? ''} onChange={e => setForm(f => ({ ...f, costo: e.target.value ? Number(e.target.value) : undefined }))} placeholder="0.00" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción *</label>
              <input style={inputStyle} value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Detalle de la solicitud" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Notas del staff</label>
              <input style={inputStyle} value={form.notas_staff ?? ''} onChange={e => setForm(f => ({ ...f, notas_staff: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
            <button onClick={cancelForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#7E9389' }}>Cancelar</button>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Guardando…' : editId ? 'Actualizar' : 'Agregar'}
            </button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'pendiente', 'en_proceso', 'completado', 'cancelado'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '5px 12px', borderRadius: '20px', border: '1.5px solid', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              borderColor: filtroEstado === e ? '#1B3B36' : '#E1DDD0',
              background: filtroEstado === e ? '#D9E2DC' : 'white',
              color: filtroEstado === e ? '#1B3B36' : '#7E9389' }}>
            {e === 'todos' ? `Todas (${solicitudes.length})` : `${ESTADO_CONFIG[e as EstadoConcierge]?.label} (${solicitudes.filter(s => s.estado === e).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#7E9389' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🛎️</div>
          <p style={{ margin: 0, fontWeight: 600 }}>No hay solicitudes de concierge</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {Object.entries(byTipo).map(([tipo, items]) => {
            const tc = TIPO_CONFIG[tipo as TipoConcierge] ?? { label: tipo, icon: '📋' }
            return (
              <div key={tipo}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#7E9389', marginBottom: '10px' }}>{tc.icon} {tc.label} ({items.length})</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '10px' }}>
                  {items.map(s => {
                    const est = ESTADO_CONFIG[s.estado]
                    return (
                      <div key={s.id} style={{ background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                          <div style={{ flex: 1, marginRight: '8px', fontSize: '13px', fontWeight: 600, color: '#15291F' }}>{s.descripcion}</div>
                          <span style={{ padding: '2px 7px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color, whiteSpace: 'nowrap' }}>{est.label}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#7E9389', display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '10px' }}>
                          {s.unidad_nombre && <div>🏠 {s.unidad_nombre}</div>}
                          <div>📅 {s.fecha_solicitud}{s.hora_solicitud ? ` · ${s.hora_solicitud}` : ''}</div>
                          {s.atendido_por && <div>👤 {s.atendido_por}</div>}
                          {s.costo && <div style={{ fontWeight: 700, color: '#15291F' }}>💰 {moneda} {s.costo.toFixed(2)}</div>}
                        </div>
                        {canEdit && (
                          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {s.estado === 'pendiente' && <button onClick={() => handleEstado(s.id, 'en_proceso')} style={{ flex: 1, padding: '4px 8px', background: '#D9E2DC', color: '#102622', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Iniciar</button>}
                            {s.estado === 'en_proceso' && <button onClick={() => handleEstado(s.id, 'completado')} style={{ flex: 1, padding: '4px 8px', background: '#d1fae5', color: '#059669', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>Completar</button>}
                            <button onClick={() => startEdit(s)} style={{ padding: '4px 8px', background: '#EAE6D8', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}>✏️</button>
                            <button onClick={() => handleDelete(s.id)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
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
