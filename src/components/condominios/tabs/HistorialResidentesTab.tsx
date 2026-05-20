import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { HistorialResidente, Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  historial: HistorialResidente[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_STYLE: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  propietario:  { bg: '#F4EBE3', color: '#9C5733', label: 'Propietario',  icon: '🏠' },
  arrendatario: { bg: '#D9E2DC', color: '#102622', label: 'Arrendatario', icon: '🔑' },
  familiar:     { bg: '#dcfce7', color: '#16a34a', label: 'Familiar',     icon: '👨‍👩‍👧' },
  otro:         { bg: '#EAE6D8', color: '#7E9389', label: 'Otro',         icon: '👤' },
}

const ESTADO_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  activo:   { bg: '#dcfce7', color: '#16a34a', label: 'Activo' },
  anterior: { bg: '#EAE6D8', color: '#7E9389', label: 'Anterior' },
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid #E1DDD0',
  borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box',
}

const BLANK = {
  unidad_id: '', nombre_completo: '', tipo: 'arrendatario',
  fecha_desde: new Date().toISOString().slice(0, 10), fecha_hasta: '',
  email: '', telefono: '', estado: 'activo', notas: '',
}

export function HistorialResidentesTab({ historial, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({ ...BLANK })
  const [filterUnidad, setFilterUnidad] = useState('')
  const [filterTipo, setFilterTipo] = useState('')
  const [filterEstado, setFilterEstado] = useState('')
  const [searchNombre, setSearchNombre] = useState('')
  const [saving, setSaving] = useState(false)

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const openNew = () => { setForm({ ...BLANK }); setEditId(null); setShowForm(true) }
  const openEdit = (h: HistorialResidente) => {
    setForm({
      unidad_id: h.unidad_id ?? '', nombre_completo: h.nombre_completo,
      tipo: h.tipo, fecha_desde: h.fecha_desde, fecha_hasta: h.fecha_hasta ?? '',
      email: h.email ?? '', telefono: h.telefono ?? '',
      estado: h.estado, notas: h.notas ?? '',
    })
    setEditId(h.id); setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.nombre_completo.trim() || !form.fecha_desde) return Swal.fire('Campos requeridos', 'Nombre y fecha de inicio son obligatorios.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      nombre_completo: form.nombre_completo.trim(),
      tipo: form.tipo, fecha_desde: form.fecha_desde,
      fecha_hasta: form.fecha_hasta || null,
      email: form.email || null, telefono: form.telefono || null,
      estado: form.estado, notas: form.notas || null,
    }
    const { error } = editId
      ? await supabase.from('historial_residentes').update(payload).eq('id', editId)
      : await supabase.from('historial_residentes').insert(payload)
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); onRefresh()
  }

  const marcarAnterior = async (h: HistorialResidente) => {
    const hoy = new Date().toISOString().slice(0, 10)
    await supabase.from('historial_residentes').update({ estado: 'anterior', fecha_hasta: h.fecha_hasta ?? hoy }).eq('id', h.id)
    onRefresh()
  }

  const handleDelete = async (h: HistorialResidente) => {
    const r = await Swal.fire({ title: '¿Eliminar registro?', text: h.nombre_completo, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('historial_residentes').delete().eq('id', h.id)
    onRefresh()
  }

  const filtered = historial.filter(h =>
    (!filterUnidad || h.unidad_id === filterUnidad) &&
    (!filterTipo || h.tipo === filterTipo) &&
    (!filterEstado || h.estado === filterEstado) &&
    (!searchNombre || h.nombre_completo.toLowerCase().includes(searchNombre.toLowerCase()))
  )

  // Group by unidad_id for the grouped view
  const grouped = filtered.reduce<Record<string, HistorialResidente[]>>((acc, h) => {
    const key = h.unidad_id ?? '__sin_unidad__'
    if (!acc[key]) acc[key] = []
    acc[key].push(h)
    return acc
  }, {})

  const activos = historial.filter(h => h.estado === 'activo').length
  const anteriores = historial.filter(h => h.estado === 'anterior').length

  return (
    <div style={{ padding: '20px', maxWidth: '1000px', margin: '0 auto' }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '14px', marginBottom: '20px' }}>
        {[
          { label: 'Residentes Activos', value: activos, icon: '🏠', bg: '#f0fdf4', color: '#16a34a' },
          { label: 'Anteriores', value: anteriores, icon: '📋', bg: '#EAE6D8', color: '#7E9389' },
          { label: 'Total registros', value: historial.length, icon: '👥', bg: '#D9E2DC', color: '#102622' },
        ].map(k => (
          <div key={k.label} style={{ background: k.bg, borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '24px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '12px', color: '#7E9389', fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {canCreate && (
          <button onClick={openNew} style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            + Nuevo residente
          </button>
        )}
        <input value={searchNombre} onChange={e => setSearchNombre(e.target.value)} placeholder="Buscar nombre..." style={{ ...inputStyle, width: '180px' }} />
        <select value={filterUnidad} onChange={e => setFilterUnidad(e.target.value)} style={{ ...inputStyle, width: '160px' }}>
          <option value="">Todas las unidades</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
        <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} style={{ ...inputStyle, width: '140px' }}>
          <option value="">Todos los tipos</option>
          {Object.entries(TIPO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
        </select>
        <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)} style={{ ...inputStyle, width: '130px' }}>
          <option value="">Todos</option>
          <option value="activo">Activos</option>
          <option value="anterior">Anteriores</option>
        </select>
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#FAF7EF', border: '1.5px solid #E1DDD0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar residente' : 'Nuevo residente'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Unidad</label>
              <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                <option value="">— Sin unidad —</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Nombre completo *</label>
              <input style={inputStyle} value={form.nombre_completo} onChange={e => setF('nombre_completo', e.target.value)} placeholder="Nombre y apellidos" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Tipo</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                {Object.entries(TIPO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Fecha desde *</label>
              <input style={inputStyle} type="date" value={form.fecha_desde} onChange={e => setF('fecha_desde', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Fecha hasta</label>
              <input style={inputStyle} type="date" value={form.fecha_hasta} onChange={e => setF('fecha_hasta', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Estado</label>
              <select style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value)}>
                <option value="activo">Activo</option>
                <option value="anterior">Anterior</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Email</label>
              <input style={inputStyle} type="email" value={form.email} onChange={e => setF('email', e.target.value)} placeholder="correo@ejemplo.com" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Teléfono</label>
              <input style={inputStyle} value={form.telefono} onChange={e => setF('telefono', e.target.value)} placeholder="+502 1234-5678" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Referencias, observaciones" />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', background: '#EAE6D8', color: '#3E5A4C', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Grouped list */}
      {Object.keys(grouped).length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#7E9389' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>👥</div>
          <p style={{ fontWeight: 600, color: '#7E9389' }}>Sin historial de residentes registrado</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {Object.entries(grouped).map(([unidadId, residentes]) => {
            const unidad = unidades.find(u => u.id === unidadId)
            const activo = residentes.find(r => r.estado === 'activo')
            return (
              <div key={unidadId} style={{ background: 'white', border: '1.5px solid #E1DDD0', borderRadius: '12px', overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', background: '#FAF7EF', borderBottom: '1px solid #E1DDD0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: '#15291F' }}>
                    {unidad?.nombre ?? 'Sin unidad asignada'}
                  </div>
                  {activo && (
                    <span style={{ padding: '2px 10px', borderRadius: '99px', fontSize: '11px', fontWeight: 700, background: '#dcfce7', color: '#16a34a' }}>
                      Activo: {activo.nombre_completo}
                    </span>
                  )}
                </div>
                <div>
                  {residentes.sort((a, b) => b.fecha_desde.localeCompare(a.fecha_desde)).map(h => {
                    const ts = TIPO_STYLE[h.tipo]
                    const es = ESTADO_STYLE[h.estado]
                    return (
                      <div key={h.id} style={{ padding: '12px 16px', borderBottom: '1px solid #FAF7EF', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: ts.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>
                          {ts.icon}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 700, fontSize: '13px', color: '#15291F' }}>{h.nombre_completo}</span>
                            <span style={{ padding: '1px 7px', borderRadius: '99px', fontSize: '10px', fontWeight: 700, background: ts.bg, color: ts.color }}>{ts.label}</span>
                            <span style={{ padding: '1px 7px', borderRadius: '99px', fontSize: '10px', fontWeight: 600, background: es.bg, color: es.color }}>{es.label}</span>
                          </div>
                          <div style={{ fontSize: '11px', color: '#7E9389', marginTop: '2px' }}>
                            {h.fecha_desde} → {h.fecha_hasta ?? 'presente'}
                            {h.telefono ? ` · ${h.telefono}` : ''}
                            {h.email ? ` · ${h.email}` : ''}
                          </div>
                          {h.notas && <div style={{ fontSize: '11px', color: '#7E9389', marginTop: '2px', fontStyle: 'italic' }}>{h.notas}</div>}
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                          {canEdit && (
                            <>
                              <button onClick={() => openEdit(h)} style={{ padding: '4px 8px', background: '#EAE6D8', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✏️</button>
                              {h.estado === 'activo' && (
                                <button onClick={() => marcarAnterior(h)} title="Marcar como anterior" style={{ padding: '4px 8px', background: '#fef3c7', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>📤</button>
                              )}
                            </>
                          )}
                          <button onClick={() => handleDelete(h)} style={{ padding: '4px 8px', background: '#fef2f2', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: '#ef4444' }}>🗑</button>
                        </div>
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
