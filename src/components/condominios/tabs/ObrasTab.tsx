import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type { ObraMejora, EstadoObra } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  obras: ObraMejora[]
  proyectoId: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_STYLE: Record<EstadoObra, { bg: string; color: string; label: string }> = {
  planificada:    { bg: '#f3e8ff', color: '#7c3aed', label: 'Planificada' },
  en_ejecucion:  { bg: '#fef3c7', color: '#92400e', label: 'En ejecución' },
  completada:    { bg: '#dcfce7', color: '#16a34a', label: 'Completada' },
  pausada:       { bg: '#e0f2fe', color: '#0369a1', label: 'Pausada' },
  cancelada:     { bg: '#fee2e2', color: '#ef4444', label: 'Cancelada' },
}

const BLANK = { titulo: '', descripcion: '', area: '', contratista: '', monto_contrato: '', fecha_inicio: '', fecha_fin_estimada: '', fecha_fin_real: '', estado: 'planificada' as EstadoObra, progreso: '0', notas: '' }

function fmt(n: number, moneda: string) { return `${moneda} ${n.toLocaleString('es', { minimumFractionDigits: 2 })}` }

export function ObrasTab({ obras, proyectoId, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<ObraMejora | null>(null)
  const [filtroEstado, setFiltroEstado] = useState<'todos' | EstadoObra>('todos')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }

  function startEdit(o: ObraMejora) {
    setEditId(o.id)
    setForm({ titulo: o.titulo, descripcion: o.descripcion ?? '', area: o.area ?? '', contratista: o.contratista ?? '', monto_contrato: o.monto_contrato ? String(o.monto_contrato) : '', fecha_inicio: o.fecha_inicio ?? '', fecha_fin_estimada: o.fecha_fin_estimada ?? '', fecha_fin_real: o.fecha_fin_real ?? '', estado: o.estado, progreso: String(o.progreso), notas: o.notas ?? '' })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.titulo.trim()) return Swal.fire('Requerido', 'El título es obligatorio.', 'warning')
    const progreso = Math.max(0, Math.min(100, parseInt(form.progreso) || 0))
    setSaving(true)
    const payload = {
      titulo: form.titulo.trim(), descripcion: form.descripcion || null, area: form.area || null,
      contratista: form.contratista || null, monto_contrato: form.monto_contrato ? parseFloat(form.monto_contrato) : null,
      fecha_inicio: form.fecha_inicio || null, fecha_fin_estimada: form.fecha_fin_estimada || null,
      fecha_fin_real: form.fecha_fin_real || null, estado: form.estado, progreso, notas: form.notas || null,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('obras_mejoras').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('obras_mejoras').insert({ ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar obra?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('obras_mejoras').delete().eq('id', id)
    if (selected?.id === id) setSelected(null)
    onRefresh()
  }

  async function actualizarProgreso(id: string, progreso: number) {
    const autoEstado = progreso === 100 ? 'completada' : undefined
    const update: Record<string, unknown> = { progreso }
    if (autoEstado) update.estado = autoEstado
    await supabase.from('obras_mejoras').update(update).eq('id', id)
    onRefresh()
  }

  const filtered = filtroEstado === 'todos' ? obras : obras.filter(o => o.estado === filtroEstado)

  const totalPresupuestado = obras.reduce((s, o) => s + Number(o.monto_contrato ?? 0), 0)
  const enEjecucion = obras.filter(o => o.estado === 'en_ejecucion').length
  const completadas = obras.filter(o => o.estado === 'completada').length

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Obras y Mejoras</h2>
          <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>{enEjecucion} en ejecución · {completadas} completadas</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setShowForm(true) }}
            style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva Obra
          </button>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px', marginBottom: '16px' }}>
        {[
          { label: 'Total', value: String(obras.length), color: '#64748b' },
          { label: 'En ejecución', value: String(enEjecucion), color: '#f59e0b' },
          { label: 'Completadas', value: String(completadas), color: '#10b981' },
          { label: 'Presupuestado', value: fmt(totalPresupuestado, moneda), color: '#0ea5e9' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '10px', textAlign: 'center' }}>
            <div style={{ fontSize: k.label === 'Presupuestado' ? '12px' : '22px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar obra' : 'Nueva Obra'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Título *</label>
              <input style={inputStyle} value={form.titulo} onChange={e => setF('titulo', e.target.value)} placeholder="Ej: Remodelación salón comunal" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Área</label>
              <input style={inputStyle} value={form.area} onChange={e => setF('area', e.target.value)} placeholder="Salón, Piscina, Exteriores…" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Contratista</label>
              <input style={inputStyle} value={form.contratista} onChange={e => setF('contratista', e.target.value)} placeholder="Empresa / persona" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Monto contrato ({moneda})</label>
              <input style={inputStyle} type="number" step="0.01" value={form.monto_contrato} onChange={e => setF('monto_contrato', e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha inicio</label>
              <input style={inputStyle} type="date" value={form.fecha_inicio} onChange={e => setF('fecha_inicio', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha fin estimada</label>
              <input style={inputStyle} type="date" value={form.fecha_fin_estimada} onChange={e => setF('fecha_fin_estimada', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Fecha fin real</label>
              <input style={inputStyle} type="date" value={form.fecha_fin_real} onChange={e => setF('fecha_fin_real', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Estado</label>
              <select style={inputStyle} value={form.estado} onChange={e => setF('estado', e.target.value as EstadoObra)}>
                {Object.entries(ESTADO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Progreso ({form.progreso}%)</label>
              <input style={inputStyle} type="range" min="0" max="100" value={form.progreso} onChange={e => setF('progreso', e.target.value)} />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '3px' }}>Descripción / Notas</label>
              <textarea style={{ ...inputStyle, minHeight: '55px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Detalles, observaciones…" />
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
        {(['todos', 'planificada', 'en_ejecucion', 'completada', 'pausada', 'cancelada'] as const).map(f => (
          <button key={f} onClick={() => setFiltroEstado(f)}
            style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
              borderColor: filtroEstado === f ? '#0ea5e9' : '#e2e8f0',
              background: filtroEstado === f ? '#e0f2fe' : 'white',
              color: filtroEstado === f ? '#0369a1' : '#64748b',
              fontWeight: filtroEstado === f ? 700 : 500 }}>
            {f === 'todos' ? 'Todas' : ESTADO_STYLE[f as EstadoObra]?.label ?? f}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '16px' }}>
        {/* List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>No hay obras registradas.</div>
          ) : filtered.map(o => {
            const es = ESTADO_STYLE[o.estado]
            const progreso = o.progreso ?? 0
            return (
              <div key={o.id} onClick={() => setSelected(selected?.id === o.id ? null : o)}
                style={{ background: 'white', border: `1.5px solid ${selected?.id === o.id ? '#0ea5e9' : '#e2e8f0'}`, borderRadius: '10px', padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '13px' }}>{o.titulo}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: es.bg, color: es.color }}>{es.label}</span>
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      {o.area && <span>📍 {o.area}</span>}
                      {o.contratista && <span>👷 {o.contratista}</span>}
                      {o.monto_contrato && <span>💰 {fmt(Number(o.monto_contrato), moneda)}</span>}
                      {o.fecha_fin_estimada && <span>📅 Est: {o.fecha_fin_estimada}</span>}
                    </div>
                    {/* Progress bar */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={{ flex: 1, height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${progreso}%`, background: progreso === 100 ? '#10b981' : progreso > 50 ? '#0ea5e9' : '#f59e0b', borderRadius: '3px', transition: 'width 0.3s' }} />
                      </div>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#374151', minWidth: '30px' }}>{progreso}%</span>
                    </div>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0, marginLeft: '8px' }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => startEdit(o)}
                        style={{ padding: '3px 7px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDelete(o.id)}
                        style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{selected.titulo}</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
              {[
                { label: 'Estado', value: ESTADO_STYLE[selected.estado]?.label },
                { label: 'Área', value: selected.area ?? '—' },
                { label: 'Contratista', value: selected.contratista ?? '—' },
                { label: 'Monto contrato', value: selected.monto_contrato ? fmt(Number(selected.monto_contrato), moneda) : '—' },
                { label: 'Fecha inicio', value: selected.fecha_inicio ?? '—' },
                { label: 'Fecha fin estimada', value: selected.fecha_fin_estimada ?? '—' },
                { label: 'Fecha fin real', value: selected.fecha_fin_real ?? '—' },
              ].map(f => (
                <div key={f.label} style={{ background: 'white', borderRadius: '7px', padding: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '10px', color: '#94a3b8' }}>{f.label}</div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>{f.value}</div>
                </div>
              ))}
            </div>

            {/* Progress adjuster */}
            {canEdit && selected.estado !== 'completada' && selected.estado !== 'cancelada' && (
              <div style={{ marginBottom: '12px' }}>
                <label style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '4px' }}>Actualizar progreso: {selected.progreso}%</label>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <input type="range" min="0" max="100" defaultValue={selected.progreso ?? 0}
                    style={{ flex: 1 }}
                    onMouseUp={e => actualizarProgreso(selected.id, parseInt((e.target as HTMLInputElement).value))}
                    onTouchEnd={e => actualizarProgreso(selected.id, parseInt((e.target as HTMLInputElement).value))}
                  />
                  <div style={{ height: '8px', width: '120px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${selected.progreso ?? 0}%`, background: '#0ea5e9', borderRadius: '4px' }} />
                  </div>
                </div>
              </div>
            )}

            {selected.notas && (
              <div style={{ background: 'white', borderRadius: '8px', padding: '10px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}>Notas</div>
                <div style={{ fontSize: '12px', color: '#374151' }}>{selected.notas}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
