import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { IncidenteSeguridad } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'

interface Props {
  incidentes: IncidenteSeguridad[]
  proyectoId: string
  companyId: string
  proyectoNombre?: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_STYLE: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  robo:       { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Robo',       icon: '🚨' },
  vandalismo: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Vandalismo', icon: '🔨' },
  accidente:  { bg: 'var(--at-warning-border)', color: 'var(--at-warning-strong)', label: 'Accidente',  icon: '🩺' },
  incendio:   { bg: 'var(--at-danger-border)', color: 'var(--at-danger-strong)', label: 'Incendio',   icon: '🔥' },
  pelea:      { bg: 'var(--at-accent-tint)', color: 'var(--at-accent-hover)', label: 'Pelea',      icon: '⚡' },
  otro:       { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Otro',       icon: '📋' },
}

const ESTADO_FLOW: Record<string, { bg: string; color: string; label: string; next?: string; nextLabel?: string }> = {
  reportado:    { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', label: 'Reportado',    next: 'investigando', nextLabel: 'Iniciar Investigación' },
  investigando: { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', label: 'Investigando', next: 'resuelto',     nextLabel: 'Marcar Resuelto' },
  resuelto:     { bg: 'var(--at-success-tint)', color: 'var(--at-success)', label: 'Resuelto',     next: 'cerrado',      nextLabel: 'Cerrar' },
  cerrado:      { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', label: 'Cerrado' },
}

const BLANK = {
  fecha: new Date().toISOString().slice(0, 10), hora: '',
  tipo: 'otro', descripcion: '', area: '',
  reportado_por: '', estado: 'reportado', involucrados: '', seguimiento: '',
}

const inputStyle: CSSProperties = {
  width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)',
  borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box',
}

export function IncidentesTab({ incidentes, proyectoId, companyId, proyectoNombre = 'Condominio', canCreate, canEdit, onRefresh }: Props) {
  const [selected, setSelected] = useState<IncidenteSeguridad | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({ ...BLANK })
  const [filterTipo, setFilterTipo] = useState('')
  const [filterEstado, setFilterEstado] = useState('')
  const [searchArea, setSearchArea] = useState('')
  const [saving, setSaving] = useState(false)

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const openNew = () => { setForm({ ...BLANK }); setEditId(null); setShowForm(true); setSelected(null) }
  const openEdit = (i: IncidenteSeguridad) => {
    setForm({
      fecha: i.fecha, hora: i.hora ?? '',
      tipo: i.tipo, descripcion: i.descripcion, area: i.area ?? '',
      reportado_por: i.reportado_por ?? '', estado: i.estado,
      involucrados: i.involucrados ?? '', seguimiento: i.seguimiento ?? '',
    })
    setEditId(i.id); setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.descripcion.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'La descripción es obligatoria.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      fecha: form.fecha, hora: form.hora || null,
      tipo: form.tipo, descripcion: form.descripcion.trim(),
      area: form.area || null, reportado_por: form.reportado_por || null,
      estado: form.estado, involucrados: form.involucrados || null,
      seguimiento: form.seguimiento || null,
    }
    const { error } = editId
      ? await supabase.from('incidentes_seguridad').update(payload).eq('id', editId)
      : await supabase.from('incidentes_seguridad').insert(payload)
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); onRefresh()
  }

  const avanzarEstado = async (i: IncidenteSeguridad) => {
    const cfg = ESTADO_FLOW[i.estado]
    if (!cfg.next) return
    const { error } = await supabase.from('incidentes_seguridad').update({ estado: cfg.next }).eq('id', i.id)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    onRefresh()
    setSelected(sel => sel?.id === i.id ? { ...sel, estado: cfg.next as IncidenteSeguridad['estado'] } : sel)
  }

  const handleDelete = async (i: IncidenteSeguridad) => {
    const r = await confirm({ title: '¿Eliminar incidente?', text: i.descripcion, icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await supabase.from('incidentes_seguridad').delete().eq('id', i.id)
    if (selected?.id === i.id) setSelected(null)
    onRefresh()
  }

  const filtered = incidentes.filter(i =>
    (!filterTipo || i.tipo === filterTipo) &&
    (!filterEstado || i.estado === filterEstado) &&
    (!searchArea || (i.area ?? '').toLowerCase().includes(searchArea.toLowerCase()))
  )

  function exportarPDF() {
    exportarPDFTabla({
      titulo: 'Registro de Incidentes de Seguridad',
      proyectoNombre,
      headers: ['Fecha', 'Hora', 'Tipo', 'Área', 'Descripción', 'Reportado por', 'Estado'],
      rows: filtered.map(i => [i.fecha, i.hora ?? '—', TIPO_STYLE[i.tipo]?.label ?? i.tipo, i.area ?? '—', i.descripcion, i.reportado_por ?? '—', ESTADO_FLOW[i.estado]?.label ?? i.estado]),
      filename: `incidentes-${new Date().toISOString().slice(0, 10)}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`incidentes-${new Date().toISOString().slice(0, 10)}`, [{
      name: 'Incidentes',
      headers: ['Fecha', 'Hora', 'Tipo', 'Área', 'Descripción', 'Reportado por', 'Estado', 'Involucrados', 'Seguimiento'],
      rows: filtered.map(i => [i.fecha, i.hora ?? '', TIPO_STYLE[i.tipo]?.label ?? i.tipo, i.area ?? '', i.descripcion, i.reportado_por ?? '', ESTADO_FLOW[i.estado]?.label ?? i.estado, i.involucrados ?? '', i.seguimiento ?? '']),
    }])
  }

  const kpiTipos = Object.keys(TIPO_STYLE)
  const abiertos = incidentes.filter(i => i.estado === 'reportado' || i.estado === 'investigando').length

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {/* LEFT */}
      <div style={{ width: '360px', flexShrink: 0, borderRight: '1.5px solid var(--at-line)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '14px', borderBottom: '1px solid var(--at-line)', background: 'var(--at-surface-2)' }}>
          {/* KPI strip */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '60px', background: abiertos > 0 ? 'var(--at-danger-tint)' : 'var(--at-success-tint)', borderRadius: '8px', padding: '6px', textAlign: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: '18px', color: abiertos > 0 ? 'var(--at-danger)' : 'var(--at-success)' }}>{abiertos}</div>
              <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', fontWeight: 600 }}>Abiertos</div>
            </div>
            <div style={{ flex: 1, minWidth: '60px', background: 'var(--at-chip)', borderRadius: '8px', padding: '6px', textAlign: 'center' }}>
              <div style={{ fontWeight: 800, fontSize: '18px', color: 'var(--at-ink)' }}>{incidentes.length}</div>
              <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', fontWeight: 600 }}>Total</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            {canCreate && (
              <button onClick={openNew} style={{ flex: 1, padding: '8px', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
                🚨 Registrar
              </button>
            )}
            <button onClick={exportarPDF} disabled={incidentes.length === 0} style={{ padding: '8px 10px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }} title="PDF">📄</button>
            <button onClick={exportarXlsx} disabled={incidentes.length === 0} style={{ padding: '8px 10px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1px solid var(--at-success-border)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }} title="Excel">📊</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <input value={searchArea} onChange={e => setSearchArea(e.target.value)} placeholder="Buscar por área..." style={inputStyle} />
            <div style={{ display: 'flex', gap: '6px' }}>
              <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                <option value="">Todos tipos</option>
                {kpiTipos.map(k => <option key={k} value={k}>{TIPO_STYLE[k].icon} {TIPO_STYLE[k].label}</option>)}
              </select>
              <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                <option value="">Todos estados</option>
                {Object.entries(ESTADO_FLOW).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--at-ink-3)', fontSize: '13px' }}>Sin incidentes</div>
          )}
          {filtered.map(i => {
            const ts = TIPO_STYLE[i.tipo]
            const es = ESTADO_FLOW[i.estado]
            return (
              <div key={i.id} onClick={() => { setSelected(i); setShowForm(false) }}
                style={{ padding: '12px 14px', borderBottom: '1px solid var(--at-chip)', cursor: 'pointer', background: selected?.id === i.id ? 'var(--at-danger-tint)' : 'var(--at-surface)', borderLeft: selected?.id === i.id ? '3px solid var(--at-danger)' : '3px solid transparent' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <span style={{ fontSize: '16px' }}>{ts.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.descripcion}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                      {i.fecha}{i.hora ? ` ${i.hora}` : ''}{i.area ? ` · ${i.area}` : ''}
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
            <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar incidente' : 'Registrar incidente'}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Tipo *</label>
                <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value)}>
                  {Object.entries(TIPO_STYLE).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Fecha</label>
                <input style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Hora</label>
                <input style={inputStyle} type="time" value={form.hora} onChange={e => setF('hora', e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Área</label>
                <input style={inputStyle} value={form.area} onChange={e => setF('area', e.target.value)} placeholder="Ej. Lobby, Parqueo 3" />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Descripción *</label>
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} value={form.descripcion} onChange={e => setF('descripcion', e.target.value)} placeholder="Descripción detallada del incidente" autoFocus />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Reportado por</label>
                <input style={inputStyle} value={form.reportado_por} onChange={e => setF('reportado_por', e.target.value)} placeholder="Nombre o cargo" />
              </div>
              <div>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Estado</label>
                <select style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value)}>
                  {Object.entries(ESTADO_FLOW).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Involucrados</label>
                <input style={inputStyle} value={form.involucrados} onChange={e => setF('involucrados', e.target.value)} placeholder="Personas o unidades involucradas" />
              </div>
              <div style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', display: 'block', marginBottom: '3px' }}>Seguimiento</label>
                <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: '60px' }} value={form.seguimiento} onChange={e => setF('seguimiento', e.target.value)} placeholder="Acciones tomadas, estado de la investigación..." />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleSave} disabled={saving} style={{ padding: '8px 20px', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
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
          const ts = TIPO_STYLE[selected.tipo]
          const es = ESTADO_FLOW[selected.estado]
          return (
            <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '28px' }}>{ts.icon}</span>
                    <div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '12px', fontWeight: 700, background: ts.bg, color: ts.color }}>{ts.label}</span>
                        <span style={{ padding: '3px 10px', borderRadius: '99px', fontSize: '12px', fontWeight: 700, background: es.bg, color: es.color }}>{es.label}</span>
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--at-ink-3)' }}>
                        {selected.fecha}{selected.hora ? ` a las ${selected.hora}` : ''}{selected.area ? ` · ${selected.area}` : ''}
                      </p>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {canEdit && <button onClick={() => openEdit(selected)} style={{ padding: '6px 14px', background: 'var(--at-chip)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>✏️ Editar</button>}
                  <button onClick={() => handleDelete(selected)} style={{ padding: '6px 14px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>🗑 Eliminar</button>
                </div>
              </div>

              <div style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '14px', marginBottom: '14px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '6px' }}>Descripción</div>
                <p style={{ margin: 0, fontSize: '14px', color: 'var(--at-ink)', lineHeight: 1.6 }}>{selected.descripcion}</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '14px' }}>
                {[
                  { label: 'Reportado por', val: selected.reportado_por ?? '—' },
                  { label: 'Involucrados', val: selected.involucrados ?? '—' },
                ].map(row => (
                  <div key={row.label} style={{ background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px 12px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '2px' }}>{row.label}</div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)' }}>{row.val}</div>
                  </div>
                ))}
              </div>

              {selected.seguimiento && (
                <div style={{ background: 'var(--at-warning-tint)', borderRadius: '8px', padding: '12px', marginBottom: '16px', border: '1px solid var(--at-warning-border)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-warning-strong)', marginBottom: '4px' }}>Seguimiento</div>
                  <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-2)' }}>{selected.seguimiento}</p>
                </div>
              )}

              {/* Estado actions */}
              {canEdit && es.next && (
                <button onClick={() => avanzarEstado(selected)} style={{ padding: '9px 20px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 700, cursor: 'pointer', fontSize: '13px' }}>
                  → {es.nextLabel}
                </button>
              )}
            </div>
          )
        })()}

        {!showForm && !selected && (
          <div style={{ textAlign: 'center', padding: '60px', color: 'var(--at-ink-3)' }}>
            <div style={{ fontSize: '40px', marginBottom: '10px' }}>🚨</div>
            <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>Selecciona un incidente o registra uno nuevo</p>
          </div>
        )}
      </div>
    </div>
  )
}
