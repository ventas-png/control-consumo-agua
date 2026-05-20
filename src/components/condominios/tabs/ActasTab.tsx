import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { ActaReunion, TipoActa } from '../../../types'
import Swal from 'sweetalert2'

interface Props {
  actas: ActaReunion[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_LABELS: Record<TipoActa, { label: string; icon: string; color: string }> = {
  ordinaria:    { label: 'Ordinaria',    icon: '📋', color: '#1B3B36' },
  extraordinaria:{ label: 'Extraordinaria', icon: '⚡', color: '#f59e0b' },
  junta:        { label: 'Junta Directiva', icon: '👑', color: '#B96A3F' },
  comite:       { label: 'Comité',       icon: '👥', color: '#10b981' },
  otro:         { label: 'Otro',         icon: '📁', color: '#7E9389' },
}

interface AsistenteFila { nombre: string; unidad: string; rol: string }
interface PuntoAgenda   { punto: string; descripcion: string; acuerdo: string }

const BLANK_FORM = {
  titulo: '', tipo: 'ordinaria' as TipoActa, fecha: new Date().toISOString().slice(0,10),
  hora_inicio: '', hora_fin: '', lugar: '', quorum: '', quorum_requerido: '',
  acuerdos: '', observaciones: '', redactada_por: '', aprobada: false,
}

export function ActasTab({ actas, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...BLANK_FORM })
  const [asistentes, setAsistentes] = useState<AsistenteFila[]>([{ nombre: '', unidad: '', rol: '' }])
  const [puntos, setPuntos] = useState<PuntoAgenda[]>([{ punto: '', descripcion: '', acuerdo: '' }])
  const [saving, setSaving] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)

  function setF<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }))
  }

  function addAsistente() { setAsistentes(prev => [...prev, { nombre: '', unidad: '', rol: '' }]) }
  function removeAsistente(i: number) { setAsistentes(prev => prev.filter((_, j) => j !== i)) }
  function updateAsistente(i: number, k: keyof AsistenteFila, v: string) {
    setAsistentes(prev => prev.map((a, j) => j === i ? { ...a, [k]: v } : a))
  }
  function addPunto() { setPuntos(prev => [...prev, { punto: '', descripcion: '', acuerdo: '' }]) }
  function removePunto(i: number) { setPuntos(prev => prev.filter((_, j) => j !== i)) }
  function updatePunto(i: number, k: keyof PuntoAgenda, v: string) {
    setPuntos(prev => prev.map((p, j) => j === i ? { ...p, [k]: v } : p))
  }

  function startNew() {
    setEditId(null); setForm({ ...BLANK_FORM })
    setAsistentes([{ nombre: '', unidad: '', rol: '' }])
    setPuntos([{ punto: '', descripcion: '', acuerdo: '' }])
    setShowForm(true); setViewId(null)
  }

  function startEdit(a: ActaReunion) {
    setEditId(a.id)
    setForm({
      titulo: a.titulo, tipo: a.tipo, fecha: a.fecha,
      hora_inicio: a.hora_inicio ?? '', hora_fin: a.hora_fin ?? '',
      lugar: a.lugar ?? '', quorum: a.quorum != null ? String(a.quorum) : '',
      quorum_requerido: a.quorum_requerido != null ? String(a.quorum_requerido) : '',
      acuerdos: a.acuerdos ?? '', observaciones: a.observaciones ?? '',
      redactada_por: a.redactada_por ?? '', aprobada: a.aprobada,
    })
    setAsistentes((a.asistentes as AsistenteFila[]).length > 0 ? a.asistentes as AsistenteFila[] : [{ nombre: '', unidad: '', rol: '' }])
    setPuntos((a.orden_del_dia as PuntoAgenda[]).length > 0 ? a.orden_del_dia as PuntoAgenda[] : [{ punto: '', descripcion: '', acuerdo: '' }])
    setShowForm(true); setViewId(null)
  }

  async function handleSave() {
    if (!form.titulo.trim() || !form.fecha) return Swal.fire('Campos requeridos', 'Título y fecha son obligatorios.', 'warning')
    setSaving(true)
    const payload = {
      titulo: form.titulo.trim(), tipo: form.tipo, fecha: form.fecha,
      hora_inicio: form.hora_inicio || null, hora_fin: form.hora_fin || null,
      lugar: form.lugar || null,
      quorum: form.quorum ? parseInt(form.quorum) : null,
      quorum_requerido: form.quorum_requerido ? parseInt(form.quorum_requerido) : null,
      asistentes: asistentes.filter(a => a.nombre.trim()),
      orden_del_dia: puntos.filter(p => p.punto.trim()),
      acuerdos: form.acuerdos || null, observaciones: form.observaciones || null,
      redactada_por: form.redactada_por || null, aprobada: form.aprobada,
    }
    let error
    if (editId) {
      ({ error } = await supabase.from('actas_reunion').update(payload).eq('id', editId))
    } else {
      ({ error } = await supabase.from('actas_reunion').insert({ ...payload, company_id: companyId, project_id: proyectoId }))
    }
    setSaving(false)
    if (error) return Swal.fire('Error', error.message, 'error')
    setShowForm(false); setEditId(null); onRefresh()
  }

  async function handleDelete(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar acta?', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('actas_reunion').delete().eq('id', id)
    if (viewId === id) setViewId(null)
    onRefresh()
  }

  async function toggleAprobada(a: ActaReunion) {
    await supabase.from('actas_reunion').update({ aprobada: !a.aprobada }).eq('id', a.id)
    onRefresh()
  }

  function handlePrint(a: ActaReunion) {
    const win = window.open('', '_blank')
    if (!win) return
    const asist = (a.asistentes as AsistenteFila[]).map(x => `<li>${x.nombre}${x.unidad ? ` — ${x.unidad}` : ''}${x.rol ? ` (${x.rol})` : ''}</li>`).join('')
    const agenda = (a.orden_del_dia as PuntoAgenda[]).map((p, i) => `
      <div style="margin-bottom:14px"><strong>${i+1}. ${p.punto}</strong>
      ${p.descripcion ? `<p style="margin:4px 0;color:#444">${p.descripcion}</p>` : ''}
      ${p.acuerdo ? `<p style="margin:4px 0;background:#f0fdf4;padding:6px;border-left:3px solid #22c55e"><strong>Acuerdo:</strong> ${p.acuerdo}</p>` : ''}
      </div>`).join('')
    win.document.write(`<html><head><title>${a.titulo}</title>
    <style>body{font-family:serif;max-width:750px;margin:40px auto;font-size:13px;line-height:1.7}h1{font-size:17px;text-align:center}h2{font-size:14px;border-bottom:1px solid #ccc;padding-bottom:4px}ul{margin:0;padding-left:20px}.meta{color:#666;font-size:12px;text-align:center;margin-bottom:24px}</style>
    </head><body>
    <h1>${a.titulo}</h1>
    <div class="meta">${TIPO_LABELS[a.tipo].label} — ${a.fecha}${a.lugar ? ` — ${a.lugar}` : ''}${a.hora_inicio ? ` — ${a.hora_inicio}` : ''}${a.quorum != null ? ` — Quórum: ${a.quorum}/${a.quorum_requerido ?? '?'}` : ''}</div>
    ${asist ? `<h2>Asistentes</h2><ul>${asist}</ul>` : ''}
    ${agenda ? `<h2>Orden del Día</h2>${agenda}` : ''}
    ${a.acuerdos ? `<h2>Acuerdos Generales</h2><p>${a.acuerdos}</p>` : ''}
    ${a.observaciones ? `<h2>Observaciones</h2><p>${a.observaciones}</p>` : ''}
    ${a.redactada_por ? `<div style="margin-top:40px;text-align:right;color:#666;font-size:12px">Redactada por: ${a.redactada_por}</div>` : ''}
    ${a.aprobada ? '<div style="margin-top:10px;text-align:center;color:#16a34a;font-weight:bold">✓ ACTA APROBADA</div>' : ''}
    </body></html>`)
    win.document.close(); win.print()
  }

  const viewed = viewId ? actas.find(a => a.id === viewId) : null
  const inputStyle: CSSProperties = { width: '100%', padding: '7px 10px', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', color: '#15291F', background: '#FAF7EF', boxSizing: 'border-box' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#15291F' }}>Actas de Reunión</h2>
        {canCreate && !showForm && (
          <button onClick={startNew}
            style={{ padding: '8px 16px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
            + Nueva Acta
          </button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: '#FAF7EF', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar acta' : 'Nueva acta'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '14px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Título *</label>
              <input style={inputStyle} value={form.titulo} onChange={e => setF('titulo', e.target.value)} placeholder="Ej: Asamblea Ordinaria Q1 2026" autoFocus />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Tipo</label>
              <select style={inputStyle} value={form.tipo} onChange={e => setF('tipo', e.target.value as TipoActa)}>
                {(Object.keys(TIPO_LABELS) as TipoActa[]).map(t => <option key={t} value={t}>{TIPO_LABELS[t].label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Fecha *</label>
              <input style={inputStyle} type="date" value={form.fecha} onChange={e => setF('fecha', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Hora inicio</label>
              <input style={inputStyle} type="time" value={form.hora_inicio} onChange={e => setF('hora_inicio', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Hora fin</label>
              <input style={inputStyle} type="time" value={form.hora_fin} onChange={e => setF('hora_fin', e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Lugar</label>
              <input style={inputStyle} value={form.lugar} onChange={e => setF('lugar', e.target.value)} placeholder="Salón de usos múltiples" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Quórum asistente</label>
              <input style={inputStyle} type="number" min="0" value={form.quorum} onChange={e => setF('quorum', e.target.value)} placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Quórum requerido</label>
              <input style={inputStyle} type="number" min="0" value={form.quorum_requerido} onChange={e => setF('quorum_requerido', e.target.value)} placeholder="0" />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Redactada por</label>
              <input style={inputStyle} value={form.redactada_por} onChange={e => setF('redactada_por', e.target.value)} placeholder="Nombre del secretario" />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '18px' }}>
              <input type="checkbox" checked={form.aprobada} onChange={e => setF('aprobada', e.target.checked)} id="aprobada_chk" />
              <label htmlFor="aprobada_chk" style={{ fontSize: '12px', color: '#7E9389', cursor: 'pointer' }}>Acta aprobada</label>
            </div>
          </div>

          {/* Asistentes */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#15291F' }}>Asistentes</label>
              <button onClick={addAsistente} style={{ padding: '2px 8px', background: '#D9E2DC', color: '#102622', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>+ Agregar</button>
            </div>
            {asistentes.map((a, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: '6px', marginBottom: '4px' }}>
                <input style={{ ...inputStyle, fontSize: '12px' }} value={a.nombre} onChange={e => updateAsistente(i, 'nombre', e.target.value)} placeholder="Nombre" />
                <input style={{ ...inputStyle, fontSize: '12px' }} value={a.unidad} onChange={e => updateAsistente(i, 'unidad', e.target.value)} placeholder="Unidad" />
                <input style={{ ...inputStyle, fontSize: '12px' }} value={a.rol} onChange={e => updateAsistente(i, 'rol', e.target.value)} placeholder="Rol" />
                <button onClick={() => removeAsistente(i)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>✕</button>
              </div>
            ))}
          </div>

          {/* Orden del día */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#15291F' }}>Orden del Día</label>
              <button onClick={addPunto} style={{ padding: '2px 8px', background: '#D9E2DC', color: '#102622', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>+ Punto</button>
            </div>
            {puntos.map((p, i) => (
              <div key={i} style={{ background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '8px', padding: '10px', marginBottom: '6px' }}>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                  <input style={{ ...inputStyle, flex: 1, fontSize: '12px' }} value={p.punto} onChange={e => updatePunto(i, 'punto', e.target.value)} placeholder={`Punto ${i+1}`} />
                  <button onClick={() => removePunto(i)} style={{ padding: '4px 8px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>✕</button>
                </div>
                <input style={{ ...inputStyle, fontSize: '12px', marginBottom: '4px' }} value={p.descripcion} onChange={e => updatePunto(i, 'descripcion', e.target.value)} placeholder="Descripción (opcional)" />
                <input style={{ ...inputStyle, fontSize: '12px', background: '#f0fdf4', borderColor: '#bbf7d0' }} value={p.acuerdo} onChange={e => updatePunto(i, 'acuerdo', e.target.value)} placeholder="Acuerdo tomado (opcional)" />
              </div>
            ))}
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Acuerdos generales</label>
            <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical', fontFamily: 'inherit' }} value={form.acuerdos} onChange={e => setF('acuerdos', e.target.value)} placeholder="Resumen de acuerdos generales…" />
          </div>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#7E9389', display: 'block', marginBottom: '3px' }}>Observaciones</label>
            <textarea style={{ ...inputStyle, minHeight: '50px', resize: 'vertical', fontFamily: 'inherit' }} value={form.observaciones} onChange={e => setF('observaciones', e.target.value)} placeholder="Notas adicionales…" />
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '7px 18px', background: '#1B3B36', color: 'white', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => { setShowForm(false); setEditId(null) }}
              style={{ padding: '7px 12px', background: 'white', border: '1.5px solid var(--at-line)', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', color: '#7E9389' }}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* List + detail */}
      <div style={{ display: 'grid', gridTemplateColumns: viewed ? '1fr 380px' : '1fr', gap: '16px' }}>
        <div>
          {actas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#7E9389', fontSize: '13px' }}>No hay actas registradas.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {actas.map(a => {
                const tl = TIPO_LABELS[a.tipo]
                return (
                  <div key={a.id} style={{ background: viewId === a.id ? '#EEF2EC' : 'white', border: `1.5px solid ${viewId === a.id ? '#C2D2CA' : '#E1DDD0'}`, borderLeft: `4px solid ${tl.color}`, borderRadius: '8px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setViewId(viewId === a.id ? null : a.id)}>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: '13px', color: '#15291F' }}>{tl.icon} {a.titulo}</span>
                          {a.aprobada && <span style={{ fontSize: '10px', fontWeight: 700, color: '#10b981', background: '#dcfce7', padding: '2px 6px', borderRadius: '20px' }}>✓ Aprobada</span>}
                        </div>
                        <div style={{ fontSize: '11px', color: '#7E9389', marginTop: '2px' }}>
                          {tl.label} — {a.fecha}{a.lugar ? ` — ${a.lugar}` : ''}{a.hora_inicio ? ` — ${a.hora_inicio}` : ''}
                          {a.quorum != null ? ` — Quórum: ${a.quorum}/${a.quorum_requerido ?? '?'}` : ''}
                          {(a.asistentes as unknown[]).length > 0 ? ` — ${(a.asistentes as unknown[]).length} asistentes` : ''}
                        </div>
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0, marginLeft: '8px' }}>
                          <button onClick={() => handlePrint(a)} style={{ padding: '3px 7px', background: '#EAE6D8', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>🖨️</button>
                          <button onClick={() => toggleAprobada(a)} style={{ padding: '3px 7px', background: a.aprobada ? '#fef3c7' : '#dcfce7', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>
                            {a.aprobada ? '↩' : '✓'}
                          </button>
                          <button onClick={() => startEdit(a)} style={{ padding: '3px 7px', background: '#D9E2DC', color: '#102622', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                          <button onClick={() => handleDelete(a.id)} style={{ padding: '3px 7px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {viewed && (
          <div style={{ border: '1.5px solid var(--at-line)', borderRadius: '12px', overflow: 'hidden', alignSelf: 'start', maxHeight: '70vh', overflowY: 'auto' }}>
            <div style={{ padding: '10px 14px', background: '#FAF7EF', borderBottom: '1px solid var(--at-line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0 }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#7E9389' }}>Detalle del acta</span>
              <button onClick={() => setViewId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7E9389', fontSize: '16px' }}>×</button>
            </div>
            <div style={{ padding: '14px', fontSize: '12px', lineHeight: '1.6' }}>
              {(viewed.asistentes as AsistenteFila[]).length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontWeight: 700, color: '#15291F', marginBottom: '4px' }}>Asistentes ({(viewed.asistentes as AsistenteFila[]).length})</div>
                  {(viewed.asistentes as AsistenteFila[]).map((a, i) => (
                    <div key={i} style={{ padding: '3px 0', color: '#7E9389' }}>• {a.nombre}{a.unidad ? ` — ${a.unidad}` : ''}{a.rol ? ` (${a.rol})` : ''}</div>
                  ))}
                </div>
              )}
              {(viewed.orden_del_dia as PuntoAgenda[]).length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <div style={{ fontWeight: 700, color: '#15291F', marginBottom: '6px' }}>Orden del Día</div>
                  {(viewed.orden_del_dia as PuntoAgenda[]).map((p, i) => (
                    <div key={i} style={{ marginBottom: '8px', paddingLeft: '8px', borderLeft: '3px solid var(--at-line)' }}>
                      <div style={{ fontWeight: 600 }}>{i+1}. {p.punto}</div>
                      {p.descripcion && <div style={{ color: '#7E9389', marginTop: '2px' }}>{p.descripcion}</div>}
                      {p.acuerdo && <div style={{ background: '#f0fdf4', padding: '4px 6px', borderRadius: '4px', marginTop: '4px', color: '#16a34a', fontWeight: 600 }}>✓ {p.acuerdo}</div>}
                    </div>
                  ))}
                </div>
              )}
              {viewed.acuerdos && <div style={{ marginBottom: '10px' }}><div style={{ fontWeight: 700, color: '#15291F', marginBottom: '3px' }}>Acuerdos generales</div><div style={{ color: '#7E9389', whiteSpace: 'pre-wrap' }}>{viewed.acuerdos}</div></div>}
              {viewed.observaciones && <div><div style={{ fontWeight: 700, color: '#15291F', marginBottom: '3px' }}>Observaciones</div><div style={{ color: '#7E9389', whiteSpace: 'pre-wrap' }}>{viewed.observaciones}</div></div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
