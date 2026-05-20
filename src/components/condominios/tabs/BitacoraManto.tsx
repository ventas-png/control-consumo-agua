import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { BitacoraManto } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  registros: BitacoraManto[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

interface TareaItem { tarea: string; completado: boolean; observaciones: string }

const TURNO_STYLE: Record<string, { bg: string; color: string; label: string; icon: string }> = {
  'mañana': { bg: '#fef3c7', color: '#92400e', label: 'Mañana',   icon: '🌅' },
  'tarde':  { bg: '#fed7aa', color: '#c2410c', label: 'Tarde',    icon: '☀️' },
  'noche':  { bg: '#EFE0D5', color: '#7E461F', label: 'Noche',    icon: '🌙' },
}

const BLANK = { fecha: new Date().toISOString().slice(0, 10), turno: 'mañana', responsable: '', area: '', observaciones: '' }
const BLANK_TAREA: TareaItem = { tarea: '', completado: false, observaciones: '' }

const TAREAS_PREDEFINIDAS = [
  'Limpieza de áreas comunes', 'Limpieza de pasillos y escaleras', 'Limpieza de lobby',
  'Revisión de bombas de agua', 'Revisión de luces de emergencia', 'Revisión de extintores',
  'Limpieza de piscina', 'Limpieza de gimnasio', 'Revisión de cámaras', 'Revisión de portones',
]

export function BitacoraManto({ registros, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [tareas, setTareas] = useState<TareaItem[]>([])
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<BitacoraManto | null>(null)
  const [filtroTurno, setFiltroTurno] = useState<'todos' | 'mañana' | 'tarde' | 'noche'>('todos')
  const [filtroFecha, setFiltroFecha] = useState('')

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) { setForm(p => ({ ...p, [k]: v })) }
  function addTarea(texto = '') { setTareas(p => [...p, { ...BLANK_TAREA, tarea: texto }]) }
  function removeTarea(i: number) { setTareas(p => p.filter((_, idx) => idx !== i)) }
  function setTarea(i: number, f: keyof TareaItem, v: string | boolean) { setTareas(p => p.map((t, idx) => idx === i ? { ...t, [f]: v } : t)) }

  function startEdit(r: BitacoraManto) {
    setEditId(r.id)
    setForm({ fecha: r.fecha, turno: r.turno, responsable: r.responsable, area: r.area ?? '', observaciones: r.observaciones ?? '' })
    setTareas((r.tareas ?? []) as TareaItem[])
    setShowForm(true)
    setSelected(null)
  }

  async function handleSave() {
    if (!form.responsable.trim()) return Swal.fire('Requerido', 'El responsable es obligatorio.', 'warning')
    const tareasValidas = tareas.filter(t => t.tarea.trim())
    setSaving(true)
    const payload = {
      fecha: form.fecha, turno: form.turno, responsable: form.responsable.trim(),
      area: form.area || null, tareas: tareasValidas, observaciones: form.observaciones || null, firmado: false,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('bitacora_manto').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('bitacora_manto').insert({ ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setEditId(null); setForm({ ...BLANK }); setTareas([]); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar registro?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('bitacora_manto').delete().eq('id', id)
    if (selected?.id === id) setSelected(null)
    onRefresh()
  }

  async function toggleFirmado(r: BitacoraManto) {
    await supabase.from('bitacora_manto').update({ firmado: !r.firmado }).eq('id', r.id)
    onRefresh()
  }

  async function toggleTareaCompletada(r: BitacoraManto, i: number) {
    const tareas = (r.tareas ?? []) as TareaItem[]
    const updated = tareas.map((t, idx) => idx === i ? { ...t, completado: !t.completado } : t)
    await supabase.from('bitacora_manto').update({ tareas: updated }).eq('id', r.id)
    onRefresh()
  }

  function handlePrint(r: BitacoraManto) {
    const ts = TURNO_STYLE[r.turno] ?? TURNO_STYLE['mañana']
    const tareasList = (r.tareas ?? []) as TareaItem[]
    const completadas = tareasList.filter(t => t.completado).length
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Bitácora Mantenimiento</title>
<style>body{font-family:Arial,sans-serif;padding:30px;font-size:13px}h1{font-size:18px}
table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #ccc;padding:6px 8px}th{background:#FAF7EF}
.check{color:${ts.color};font-weight:700}.footer{margin-top:40px;border-top:1px solid #ccc;padding-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
.sig{border-top:1px solid #000;margin-top:50px;padding-top:6px;font-size:11px}</style></head><body>
<h1>Bitácora de Mantenimiento — ${ts.icon} ${ts.label}</h1>
<p><strong>Fecha:</strong> ${r.fecha} &nbsp;&nbsp; <strong>Responsable:</strong> ${r.responsable}${r.area ? ` &nbsp;&nbsp; <strong>Área:</strong> ${r.area}` : ''}</p>
<p><strong>Tareas completadas:</strong> ${completadas}/${tareasList.length}</p>
${tareasList.length > 0 ? `<table><tr><th style="width:30px">✓</th><th>Tarea</th><th>Observaciones</th></tr>
${tareasList.map(t => `<tr><td class="check">${t.completado ? '✓' : '○'}</td><td>${t.tarea}</td><td>${t.observaciones || '—'}</td></tr>`).join('')}
</table>` : ''}
${r.observaciones ? `<p><strong>Observaciones generales:</strong> ${r.observaciones}</p>` : ''}
<div class="footer">
<div><div class="sig">Responsable de turno<br>${r.responsable}</div></div>
<div><div class="sig">Supervisión / Visto Bueno</div></div>
</div></body></html>`
    const w = window.open('', '_blank'); if (!w) return; w.document.write(html); w.document.close(); w.print()
  }

  let filtered = registros
  if (filtroTurno !== 'todos') filtered = filtered.filter(r => r.turno === filtroTurno)
  if (filtroFecha) filtered = filtered.filter(r => r.fecha === filtroFecha)

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #E1DDD0', borderRadius: '8px', fontSize: '13px', color: '#15291F', background: '#FAF7EF', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: '#15291F' }}>Bitácora de Mantenimiento</h2>
          <p style={{ margin: 0, fontSize: '12px', color: '#7E9389' }}>{registros.length} registro(s) · {registros.filter(r => r.firmado).length} firmado(s)</p>
        </div>
        {canCreate && !showForm && (
          <button onClick={() => { setEditId(null); setForm({ ...BLANK }); setTareas([]); setShowForm(true) }}
            style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nuevo Registro
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#FAF7EF', border: '1.5px solid #E1DDD0', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar registro' : 'Nuevo Registro de Mantenimiento'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Fecha</label>
              <input style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Turno</label>
              <select style={inputStyle} value={form.turno} onChange={e => setF('turno', e.target.value)}>
                {Object.entries(TURNO_STYLE).map(([v, s]) => <option key={v} value={v}>{s.icon} {s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Responsable *</label>
              <input style={inputStyle} value={form.responsable} onChange={e => setF('responsable', e.target.value)} placeholder="Nombre del técnico" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Área</label>
              <input style={inputStyle} value={form.area} onChange={e => setF('area', e.target.value)} placeholder="Zona, edificio…" />
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Observaciones generales</label>
              <textarea style={{ ...inputStyle, minHeight: '50px', resize: 'vertical', fontFamily: 'inherit' }}
                value={form.observaciones} onChange={e => setF('observaciones', e.target.value)} placeholder="Novedades, incidencias…" />
            </div>
          </div>

          {/* Tareas */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: '#7E9389' }}>Lista de tareas</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <select style={{ padding: '3px 6px', border: '1px solid #E1DDD0', borderRadius: '5px', fontSize: '11px', background: '#FAF7EF' }}
                  onChange={e => { if (e.target.value) { addTarea(e.target.value); e.target.value = '' } }}>
                  <option value="">+ Tarea predefinida</option>
                  {TAREAS_PREDEFINIDAS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <button onClick={() => addTarea()}
                  style={{ padding: '3px 9px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                  + Personalizada
                </button>
              </div>
            </div>
            {tareas.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#7E9389', padding: '8px', textAlign: 'center' }}>Sin tareas. Use los botones para agregar.</div>
            ) : tareas.map((t, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'auto 2fr 1.5fr auto', gap: '6px', marginBottom: '5px', alignItems: 'center' }}>
                <input type="checkbox" checked={t.completado} onChange={e => setTarea(i, 'completado', e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                <input style={{ ...inputStyle, fontSize: '12px', textDecoration: t.completado ? 'line-through' : 'none', color: t.completado ? '#7E9389' : '#15291F' }}
                  value={t.tarea} onChange={e => setTarea(i, 'tarea', e.target.value)} placeholder="Descripción de la tarea" />
                <input style={{ ...inputStyle, fontSize: '12px' }} value={t.observaciones} onChange={e => setTarea(i, 'observaciones', e.target.value)} placeholder="Notas…" />
                <button onClick={() => removeTarea(i)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '12px', cursor: 'pointer', color: '#ef4444' }}>✕</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null); setTareas([]) }}
              style={{ padding: '7px 12px', background: 'white', border: '1.5px solid #E1DDD0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: '#7E9389' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {(['todos', 'mañana', 'tarde', 'noche'] as const).map(f => (
          <button key={f} onClick={() => setFiltroTurno(f)}
            style={{ padding: '4px 10px', border: '1.5px solid', borderRadius: '20px', fontSize: '11px', cursor: 'pointer',
              borderColor: filtroTurno === f ? '#1B3B36' : '#E1DDD0',
              background: filtroTurno === f ? '#D9E2DC' : 'white',
              color: filtroTurno === f ? '#102622' : '#7E9389',
              fontWeight: filtroTurno === f ? 700 : 500 }}>
            {f === 'todos' ? 'Todos' : `${TURNO_STYLE[f]?.icon} ${TURNO_STYLE[f]?.label}`}
          </button>
        ))}
        <input type="date" value={filtroFecha} onChange={e => setFiltroFecha(e.target.value)}
          style={{ padding: '4px 8px', border: '1.5px solid #E1DDD0', borderRadius: '8px', fontSize: '12px', background: '#FAF7EF', color: '#15291F' }} />
        {filtroFecha && <button onClick={() => setFiltroFecha('')} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>✕ Limpiar fecha</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 1fr' : '1fr', gap: '16px' }}>
        {/* List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#7E9389', fontSize: '13px' }}>No hay registros de mantenimiento.</div>
          ) : filtered.map(r => {
            const ts = TURNO_STYLE[r.turno] ?? TURNO_STYLE['mañana']
            const tareasList = (r.tareas ?? []) as TareaItem[]
            const completadas = tareasList.filter(t => t.completado).length
            return (
              <div key={r.id} onClick={() => setSelected(selected?.id === r.id ? null : r)}
                style={{ background: 'white', border: `1.5px solid ${selected?.id === r.id ? '#1B3B36' : '#E1DDD0'}`, borderRadius: '10px', padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '3px' }}>
                      <span style={{ fontSize: '14px' }}>{ts.icon}</span>
                      <span style={{ fontWeight: 700, fontSize: '13px' }}>{r.fecha}</span>
                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: '20px', background: ts.bg, color: ts.color }}>{ts.label}</span>
                      {r.firmado && <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 6px', borderRadius: '20px', background: '#dcfce7', color: '#16a34a' }}>✓ Firmado</span>}
                    </div>
                    <div style={{ fontSize: '11px', color: '#7E9389', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <span>👤 {r.responsable}</span>
                      {r.area && <span>📍 {r.area}</span>}
                      {tareasList.length > 0 && (
                        <span style={{ color: completadas === tareasList.length ? '#10b981' : '#f59e0b', fontWeight: 600 }}>
                          ✓ {completadas}/{tareasList.length} tareas
                        </span>
                      )}
                    </div>
                    {tareasList.length > 0 && (
                      <div style={{ height: '4px', background: '#E1DDD0', borderRadius: '2px', marginTop: '5px', overflow: 'hidden', maxWidth: '200px' }}>
                        <div style={{ height: '100%', width: `${completadas / tareasList.length * 100}%`, background: completadas === tareasList.length ? '#10b981' : '#1B3B36', borderRadius: '2px' }} />
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                    <button onClick={() => handlePrint(r)}
                      style={{ padding: '3px 7px', background: '#F4EBE3', color: '#9C5733', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>🖨️</button>
                    {canEdit && <>
                      <button onClick={() => startEdit(r)}
                        style={{ padding: '3px 7px', background: '#FAF7EF', border: '1px solid #E1DDD0', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDelete(r.id)}
                        style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                    </>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Detail */}
        {selected && (() => {
          const ts = TURNO_STYLE[selected.turno] ?? TURNO_STYLE['mañana']
          const tareasList = (selected.tareas ?? []) as TareaItem[]
          return (
            <div style={{ background: '#FAF7EF', border: '1.5px solid #E1DDD0', borderRadius: '12px', padding: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 700 }}>{ts.icon} {selected.fecha} — {ts.label}</h3>
                <div style={{ display: 'flex', gap: '6px' }}>
                  {canEdit && (
                    <button onClick={() => toggleFirmado(selected)}
                      style={{ padding: '4px 9px', background: selected.firmado ? '#dcfce7' : 'white', border: `1px solid ${selected.firmado ? '#86efac' : '#E1DDD0'}`, borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600, color: selected.firmado ? '#16a34a' : '#7E9389' }}>
                      {selected.firmado ? '✓ Firmado' : 'Firmar'}
                    </button>
                  )}
                  <button onClick={() => handlePrint(selected)}
                    style={{ padding: '4px 9px', background: '#F4EBE3', color: '#9C5733', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                    🖨️ Imprimir
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '12px', color: '#3E5A4C', marginBottom: '10px' }}>
                <span style={{ fontWeight: 600 }}>Responsable:</span> {selected.responsable}
                {selected.area && <><span style={{ margin: '0 8px', color: '#E1DDD0' }}>|</span><span style={{ fontWeight: 600 }}>Área:</span> {selected.area}</>}
              </div>
              {selected.observaciones && (
                <div style={{ background: 'white', borderRadius: '8px', padding: '8px', border: '1px solid #E1DDD0', marginBottom: '10px', fontSize: '12px', color: '#3E5A4C', fontStyle: 'italic' }}>
                  {selected.observaciones}
                </div>
              )}
              {tareasList.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: '#7E9389', fontSize: '12px' }}>Sin tareas registradas.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  {tareasList.map((t, i) => (
                    <div key={i} style={{ background: 'white', borderRadius: '7px', padding: '7px 10px', border: '1px solid #E1DDD0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {canEdit ? (
                        <input type="checkbox" checked={t.completado} onChange={() => toggleTareaCompletada(selected, i)} style={{ width: '15px', height: '15px', cursor: 'pointer', flexShrink: 0 }} />
                      ) : (
                        <span style={{ fontSize: '14px', color: t.completado ? '#10b981' : '#E1DDD0' }}>{t.completado ? '✓' : '○'}</span>
                      )}
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: t.completado ? '#7E9389' : '#3E5A4C', textDecoration: t.completado ? 'line-through' : 'none' }}>{t.tarea}</div>
                        {t.observaciones && <div style={{ fontSize: '11px', color: '#7E9389' }}>{t.observaciones}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
