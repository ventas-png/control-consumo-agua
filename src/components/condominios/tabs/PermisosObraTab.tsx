import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { PermisoObraUnidad, Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  permisos: PermisoObraUnidad[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_STYLE: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  remodelacion: { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', label: 'Remodelación', icon: '🔨' },
  ampliacion:   { bg: '#fef3c7', color: '#92400e', label: 'Ampliación',   icon: '📐' },
  reparacion:   { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', label: 'Reparación',   icon: '🔧' },
  pintura:      { bg: '#dcfce7', color: '#16a34a', label: 'Pintura',      icon: '🎨' },
  otro:         { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Otro',         icon: '📋' },
}

const ESTADO_FLOW: Record<string, { bg: string; color: string; label: string; next?: string; nextLabel?: string }> = {
  solicitado:   { bg: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', label: 'Solicitado',   next: 'aprobado',      nextLabel: 'Aprobar' },
  aprobado:     { bg: '#dcfce7', color: '#16a34a', label: 'Aprobado',     next: 'en_ejecucion',  nextLabel: 'Iniciar Ejecución' },
  en_ejecucion: { bg: '#fef3c7', color: '#92400e', label: 'En Ejecución', next: 'completado',    nextLabel: 'Marcar Completado' },
  completado:   { bg: '#f0fdf4', color: '#166534', label: 'Completado' },
  rechazado:    { bg: '#fee2e2', color: '#ef4444', label: 'Rechazado' },
}

const BLANK = {
  unidad_id: '', tipo_obra: 'remodelacion', descripcion: '',
  fecha_inicio: '', fecha_fin_estimada: '', horario_permitido: '',
  fianza: '', estado: 'solicitado', aprobado_por: '', observaciones: '',
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)',
  borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box',
}

export function PermisosObraTab({ permisos, unidades, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<PermisoObraUnidad | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({ ...BLANK })
  const [filterEstado, setFilterEstado] = useState('')
  const [filterTipo, setFilterTipo] = useState('')
  const [saving, setSaving] = useState(false)

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const openNew = () => { setForm({ ...BLANK }); setEditId(null); setShowForm(true); setSelected(null) }
  const openEdit = (p: PermisoObraUnidad) => {
    setForm({
      unidad_id: p.unidad_id ?? '', tipo_obra: p.tipo_obra, descripcion: p.descripcion,
      fecha_inicio: p.fecha_inicio ?? '', fecha_fin_estimada: p.fecha_fin_estimada ?? '',
      horario_permitido: p.horario_permitido ?? '', fianza: p.fianza != null ? String(p.fianza) : '',
      estado: p.estado, aprobado_por: p.aprobado_por ?? '', observaciones: p.observaciones ?? '',
    })
    setEditId(p.id); setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.descripcion.trim()) return Swal.fire('Campo requerido', 'La descripción es obligatoria.', 'warning')
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      unidad_id: form.unidad_id || null,
      tipo_obra: form.tipo_obra, descripcion: form.descripcion.trim(),
      fecha_inicio: form.fecha_inicio || null,
      fecha_fin_estimada: form.fecha_fin_estimada || null,
      horario_permitido: form.horario_permitido || null,
      fianza: form.fianza ? parseFloat(form.fianza) : null,
      estado: form.estado,
      aprobado_por: form.aprobado_por || null,
      observaciones: form.observaciones || null,
    }
    const { error } = editId
      ? await supabase.from('permisos_obra_unidad').update(payload).eq('id', editId)
      : await supabase.from('permisos_obra_unidad').insert(payload)
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); onRefresh()
  }

  const avanzarEstado = async (p: PermisoObraUnidad) => {
    const cfg = ESTADO_FLOW[p.estado]
    if (!cfg.next) return
    const { error } = await supabase.from('permisos_obra_unidad').update({ estado: cfg.next }).eq('id', p.id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
    setSelected(sel => sel?.id === p.id ? { ...sel, estado: cfg.next as PermisoObraUnidad['estado'] } : sel)
  }

  const rechazar = async (p: PermisoObraUnidad) => {
    const r = await Swal.fire({ title: '¿Rechazar permiso?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Rechazar' })
    if (!r.isConfirmed) return
    await supabase.from('permisos_obra_unidad').update({ estado: 'rechazado' }).eq('id', p.id)
    onRefresh()
  }

  const handleDelete = async (p: PermisoObraUnidad) => {
    const r = await Swal.fire({ title: '¿Eliminar permiso?', text: p.descripcion, icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('permisos_obra_unidad').delete().eq('id', p.id)
    if (selected?.id === p.id) setSelected(null)
    onRefresh()
  }

  const filtered = permisos.filter(p =>
    (!filterEstado || p.estado === filterEstado) &&
    (!filterTipo || p.tipo_obra === filterTipo)
  )

  const kpiEstados = ['solicitado', 'aprobado', 'en_ejecucion', 'completado', 'rechazado']

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* LEFT */}
      <div style={{ width: '360px', flexShrink: 0, borderRight: '1.5px solid var(--at-line)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px', borderBottom: '1px solid var(--at-line)', background: 'var(--at-surface-2)' }}>
          {/* KPIs */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {kpiEstados.map(e => {
              const cnt = permisos.filter(p => p.estado === e).length
              const cfg = ESTADO_FLOW[e]
              return (
                <div key={e} style={{ flex: 1, minWidth: '60px', background: cfg.bg, borderRadius: '8px', padding: '6px', textAlign: 'center' }}>
                  <div style={{ fontWeight: 800, fontSize: '16px', color: cfg.color }}>{cnt}</div>
                  <div style={{ fontSize: '10px', color: cfg.color, fontWeight: 600 }}>{cfg.label}</div>
                </div>
              )
            })}
          </div>
          {canCreate && (
            <button onClick={openNew} style={{ width: '100%', padding: '8px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px', marginBottom: '8px' }}>
              + Nuevo permiso
            </button>
          )}
          <div style={{ display: 'flex', gap: '6px' }}>
            <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              <option value="">Todos estados</option>
              {kpiEstados.map(e => <option key={e} value={e}>{ESTADO_FLOW[e].label}</option>)}
            </select>
            <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              <option value="">Todos tipos</option>
              {Object.entries(TIPO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--at-ink-3)', fontSize: '13px' }}>Sin permisos</div>
          )}
          {filtered.map(p => {
            const ts = TIPO_STYLE[p.tipo_obra]
            const es = ESTADO_FLOW[p.estado]
            const unidad = unidades.find(u => u.id === p.unidad_id)
            return (
              <div key={p.id} onClick={() => { setSelected(p); setShowForm(false) }}
                style={{ padding: '12px 14px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === p.id ? 'var(--at-primary-tint)' : 'var(--at-surface)', borderLeft: selected?.id === p.id ? '3px solid var(--at-primary)' : '3px solid transparent' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span>{ts.icon}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.descripcion}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                      {unidad?.nombre ?? 'Sin unidad'} · {p.fecha_inicio ?? 'Sin fecha'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0, alignItems: 'flex-end' }}>
                    <span style={{ padding: '2px 7px', borderRadius: '99px', fontSize: '10px', fontWeight: 700, background: ts.bg, color: ts.color }}>{ts.label}</span>
                    <span style={{ padding: '2px 7px', borderRadius: '99px', fontSize: '10px', fontWeight: 600, background: es.bg, color: es.color }}>{es.label}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* RIGHT */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {/* Form */}
        {showForm && (
          <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar permiso' : 'Nuevo permiso de obra'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Unidad</label>
                <select style={inputStyle} value={form.unidad_id} onChange={e => setF('unidad_id', e.target.value)}>
                  <option value="">— Sin unidad —</option>
                  {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Tipo de obra *</label>
                <select style={inputStyle} value={form.tipo_obra} onChange={e => setF('tipo_obra', e.target.value)}>
                  {Object.entries(TIPO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Descripción *</label>
                <input style={inputStyle} value={form.descripcion} onChange={e => setF('descripcion', e.target.value)} placeholder="Detalle de la obra solicitada" autoFocus />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha inicio</label>
                <input style={inputStyle} type="date" value={form.fecha_inicio} onChange={e => setF('fecha_inicio', e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha fin estimada</label>
                <input style={inputStyle} type="date" value={form.fecha_fin_estimada} onChange={e => setF('fecha_fin_estimada', e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Horario permitido</label>
                <input style={inputStyle} value={form.horario_permitido} onChange={e => setF('horario_permitido', e.target.value)} placeholder="Ej. Lun-Vie 8:00-17:00" />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fianza ({moneda})</label>
                <input style={inputStyle} type="number" min="0" step="0.01" value={form.fianza} onChange={e => setF('fianza', e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Estado</label>
                <select style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value)}>
                  {Object.entries(ESTADO_FLOW).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Aprobado por</label>
                <input style={inputStyle} value={form.aprobado_por} onChange={e => setF('aprobado_por', e.target.value)} placeholder="Administrador" />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Observaciones</label>
                <input style={inputStyle} value={form.observaciones} onChange={e => setF('observaciones', e.target.value)} placeholder="Condiciones, restricciones, notas" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
              <button onClick={() => setShowForm(false)} style={{ padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Detail */}
        {!showForm && selected && (() => {
          const ts = TIPO_STYLE[selected.tipo_obra]
          const es = ESTADO_FLOW[selected.estado]
          const unidad = unidades.find(u => u.id === selected.unidad_id)
          return (
            <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '22px' }}>{ts.icon}</span>
                    <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>{selected.descripcion}</h2>
                    <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '12px', fontWeight: 700, background: ts.bg, color: ts.color }}>{ts.label}</span>
                    <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '12px', fontWeight: 700, background: es.bg, color: es.color }}>{es.label}</span>
                  </div>
                  <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>Unidad: {unidad?.nombre ?? '—'}</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {canEdit && <button onClick={() => openEdit(selected)} style={{ padding: '6px 14px', background: 'var(--at-chip)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>✏️ Editar</button>}
                  <button onClick={() => handleDelete(selected)} style={{ padding: '6px 14px', background: '#fef2f2', color: '#ef4444', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>🗑 Eliminar</button>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
                {[
                  { label: 'Fecha inicio', val: selected.fecha_inicio ?? '—' },
                  { label: 'Fecha fin estimada', val: selected.fecha_fin_estimada ?? '—' },
                  { label: 'Horario permitido', val: selected.horario_permitido ?? '—' },
                  { label: 'Fianza', val: selected.fianza != null ? `${moneda} ${selected.fianza.toFixed(2)}` : '—' },
                  { label: 'Aprobado por', val: selected.aprobado_por ?? '—' },
                ].map(row => (
                  <div key={row.label} style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '2px' }}>{row.label}</div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)' }}>{row.val}</div>
                  </div>
                ))}
              </div>

              {selected.observaciones && (
                <div style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '12px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px' }}>Observaciones</div>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-2)' }}>{selected.observaciones}</p>
                </div>
              )}

              {/* Estado actions */}
              {canEdit && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {es.next && (
                    <button onClick={() => avanzarEstado(selected)} style={{ padding: '8px 18px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
                      → {es.nextLabel}
                    </button>
                  )}
                  {(selected.estado === 'solicitado' || selected.estado === 'aprobado') && (
                    <button onClick={() => rechazar(selected)} style={{ padding: '8px 18px', background: '#fef2f2', color: '#ef4444', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
                      ✗ Rechazar
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })()}

        {!showForm && !selected && (
          <div style={{ textAlign: 'center', padding: '60px', color: 'var(--at-ink-3)' }}>
            <div style={{ fontSize: '40px', marginBottom: '10px' }}>🔨</div>
            <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>Selecciona un permiso o crea uno nuevo</p>
          </div>
        )}
      </div>
    </div>
  )
}
