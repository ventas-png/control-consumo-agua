import { useState, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { Encuesta, RespuestaEncuesta, EstadoEncuesta, Unidad } from '../../../types'
import Swal from 'sweetalert2'

interface PreguntaItem { id: string; texto: string; tipo: 'texto' | 'rating_5' | 'si_no' }
interface Props {
  encuestas: Encuesta[]
  respuestas: RespuestaEncuesta[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoEncuesta, { label: string; color: string; bg: string }> = {
  borrador: { label: 'Borrador', color: '#64748b', bg: '#f1f5f9' },
  activa:   { label: 'Activa',   color: '#10b981', bg: '#d1fae5' },
  cerrada:  { label: 'Cerrada',  color: '#94a3b8', bg: '#f8fafc' },
}

function newPregId() { return Math.random().toString(36).slice(2, 9) }

const blankEncuesta = (): Partial<Encuesta> => ({
  titulo: '', descripcion: '', preguntas: [], fecha_inicio: '', fecha_fin: '', estado: 'borrador',
})

export function EncuestasTab({ encuestas, respuestas, unidades, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showEncuestaForm, setShowEncuestaForm] = useState(false)
  const [editEncuestaId, setEditEncuestaId] = useState<string | null>(null)
  const [formEnc, setFormEnc] = useState<Partial<Encuesta>>(blankEncuesta())
  const [preguntas, setPreguntas] = useState<PreguntaItem[]>([])
  const [savingEnc, setSavingEnc] = useState(false)

  const [showRespForm, setShowRespForm] = useState(false)
  const [respForm, setRespForm] = useState<{ unidad_id: string; nombre: string; answers: Record<string, string> }>({ unidad_id: '', nombre: '', answers: {} })
  const [savingResp, setSavingResp] = useState(false)

  const selectedEncuesta = encuestas.find(e => e.id === selectedId)
  const encuestaRespuestas = respuestas.filter(r => r.encuesta_id === selectedId)

  function startEditEncuesta(enc: Encuesta) {
    setFormEnc({ titulo: enc.titulo, descripcion: enc.descripcion ?? '', preguntas: enc.preguntas, fecha_inicio: enc.fecha_inicio ?? '', fecha_fin: enc.fecha_fin ?? '', estado: enc.estado })
    setPreguntas((enc.preguntas as PreguntaItem[]) ?? [])
    setEditEncuestaId(enc.id); setShowEncuestaForm(true)
  }

  function cancelEncuestaForm() { setShowEncuestaForm(false); setEditEncuestaId(null); setFormEnc(blankEncuesta()); setPreguntas([]) }

  function addPregunta() { setPreguntas(p => [...p, { id: newPregId(), texto: '', tipo: 'texto' }]) }
  function updatePregunta(idx: number, partial: Partial<PreguntaItem>) {
    setPreguntas(p => p.map((x, i) => i === idx ? { ...x, ...partial } : x))
  }
  function removePregunta(idx: number) { setPreguntas(p => p.filter((_, i) => i !== idx)) }

  async function handleSaveEncuesta() {
    if (!formEnc.titulo?.trim()) return Swal.fire('Campo requerido', 'Ingresa el título.', 'warning')
    if (preguntas.some(p => !p.texto.trim())) return Swal.fire('Campo requerido', 'Todas las preguntas deben tener texto.', 'warning')
    setSavingEnc(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      titulo: formEnc.titulo!.trim(), descripcion: formEnc.descripcion || null,
      preguntas: preguntas, fecha_inicio: formEnc.fecha_inicio || null,
      fecha_fin: formEnc.fecha_fin || null, estado: formEnc.estado ?? 'borrador',
    }
    const { error } = editEncuestaId
      ? await supabase.from('encuestas').update(payload).eq('id', editEncuestaId)
      : await supabase.from('encuestas').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSavingEnc(false); return }
    setSavingEnc(false); cancelEncuestaForm(); onRefresh()
  }

  async function handleDeleteEncuesta(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar encuesta?', text: 'Se borrarán también las respuestas.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Eliminar', confirmButtonColor: '#ef4444' })
    if (!r.isConfirmed) return
    await supabase.from('respuestas_encuesta').delete().eq('encuesta_id', id)
    const { error } = await supabase.from('encuestas').delete().eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    if (selectedId === id) setSelectedId(null)
    onRefresh()
  }

  async function handleEstadoEncuesta(id: string, estado: EstadoEncuesta) {
    const { error } = await supabase.from('encuestas').update({ estado }).eq('id', id)
    if (error) return Swal.fire('Error', error.message, 'error')
    onRefresh()
  }

  function startRespForm() {
    if (!selectedEncuesta) return
    const initial: Record<string, string> = {}
    for (const p of (selectedEncuesta.preguntas as PreguntaItem[])) initial[p.id] = ''
    setRespForm({ unidad_id: '', nombre: '', answers: initial })
    setShowRespForm(true)
  }

  async function handleSaveRespuesta() {
    if (!selectedId) return
    setSavingResp(true)
    const payload = {
      company_id: companyId, project_id: proyectoId, encuesta_id: selectedId,
      unidad_id: respForm.unidad_id || null,
      nombre_respondente: respForm.nombre || null,
      respuestas: respForm.answers,
    }
    const { error } = await supabase.from('respuestas_encuesta').insert(payload)
    if (error) { Swal.fire('Error', error.message, 'error'); setSavingResp(false); return }
    setSavingResp(false); setShowRespForm(false); onRefresh()
  }

  const inputStyle: CSSProperties = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', color: '#1e293b', background: '#f8fafc', boxSizing: 'border-box' }
  const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '4px', display: 'block' }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Encuestas de Satisfacción</h2>
        {canCreate && !showEncuestaForm && (
          <button onClick={() => { setShowEncuestaForm(true); setEditEncuestaId(null); setFormEnc(blankEncuesta()); setPreguntas([]) }}
            style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>+ Nueva Encuesta</button>
        )}
      </div>

      {/* Formulario encuesta */}
      {showEncuestaForm && (
        <div style={{ background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700 }}>{editEncuestaId ? 'Editar Encuesta' : 'Nueva Encuesta'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Título *</label>
              <input style={inputStyle} value={formEnc.titulo ?? ''} onChange={e => setFormEnc(f => ({ ...f, titulo: e.target.value }))} placeholder="Ej: Satisfacción servicios Q1 2026" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción</label>
              <input style={inputStyle} value={formEnc.descripcion ?? ''} onChange={e => setFormEnc(f => ({ ...f, descripcion: e.target.value }))} placeholder="Instrucciones o contexto" />
            </div>
            <div>
              <label style={labelStyle}>Fecha inicio</label>
              <input style={inputStyle} type="date" value={formEnc.fecha_inicio ?? ''} onChange={e => setFormEnc(f => ({ ...f, fecha_inicio: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Fecha fin</label>
              <input style={inputStyle} type="date" value={formEnc.fecha_fin ?? ''} onChange={e => setFormEnc(f => ({ ...f, fecha_fin: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={formEnc.estado ?? 'borrador'} onChange={e => setFormEnc(f => ({ ...f, estado: e.target.value as EstadoEncuesta }))}>
                {Object.entries(ESTADO_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
          </div>

          {/* Constructor de preguntas */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>Preguntas ({preguntas.length})</span>
              <button onClick={addPregunta} style={{ padding: '4px 12px', background: '#e0f2fe', color: '#0369a1', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>+ Agregar</button>
            </div>
            {preguntas.length === 0 && (
              <div style={{ textAlign: 'center', padding: '16px', color: '#94a3b8', fontSize: '12px', background: 'white', borderRadius: '8px', border: '1px dashed #e2e8f0' }}>Agrega al menos una pregunta</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {preguntas.map((p, i) => (
                <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr 160px auto', gap: '8px', alignItems: 'center', background: 'white', padding: '10px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <input style={{ ...inputStyle, background: 'white' }} value={p.texto} onChange={e => updatePregunta(i, { texto: e.target.value })} placeholder={`Pregunta ${i + 1}`} />
                  <select style={{ ...inputStyle, background: 'white' }} value={p.tipo} onChange={e => updatePregunta(i, { tipo: e.target.value as PreguntaItem['tipo'] })}>
                    <option value="texto">Respuesta libre</option>
                    <option value="rating_5">Puntuación 1-5</option>
                    <option value="si_no">Sí / No</option>
                  </select>
                  <button onClick={() => removePregunta(i)} style={{ padding: '6px 10px', background: '#fee2e2', border: 'none', borderRadius: '6px', color: '#ef4444', cursor: 'pointer' }}>🗑️</button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button onClick={cancelEncuestaForm} style={{ padding: '8px 16px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: '#64748b' }}>Cancelar</button>
            <button onClick={handleSaveEncuesta} disabled={savingEnc} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', opacity: savingEnc ? 0.7 : 1 }}>
              {savingEnc ? 'Guardando…' : editEncuestaId ? 'Actualizar' : 'Crear Encuesta'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selectedEncuesta ? '280px 1fr' : '1fr', gap: '20px' }}>
        {/* Lista encuestas */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {encuestas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📊</div>
              <p style={{ margin: 0, fontWeight: 600 }}>No hay encuestas</p>
            </div>
          ) : (
            encuestas.map(enc => {
              const est = ESTADO_CONFIG[enc.estado]
              const numResp = respuestas.filter(r => r.encuesta_id === enc.id).length
              return (
                <div key={enc.id} onClick={() => setSelectedId(enc.id === selectedId ? null : enc.id)}
                  style={{ background: enc.id === selectedId ? '#eff6ff' : 'white', border: `1.5px solid ${enc.id === selectedId ? '#93c5fd' : '#e2e8f0'}`, borderRadius: '10px', padding: '14px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a', flex: 1, marginRight: '8px' }}>{enc.titulo}</div>
                    <span style={{ padding: '2px 7px', borderRadius: '5px', fontSize: '11px', fontWeight: 700, background: est.bg, color: est.color, whiteSpace: 'nowrap' }}>{est.label}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    {(enc.preguntas as PreguntaItem[]).length} preguntas · {numResp} respuestas
                    {enc.fecha_inicio && ` · ${enc.fecha_inicio}`}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: '5px', marginTop: '8px' }} onClick={e => e.stopPropagation()}>
                      {enc.estado === 'borrador' && <button onClick={() => handleEstadoEncuesta(enc.id, 'activa')} style={{ padding: '3px 8px', background: '#d1fae5', color: '#059669', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Activar</button>}
                      {enc.estado === 'activa'   && <button onClick={() => handleEstadoEncuesta(enc.id, 'cerrada')} style={{ padding: '3px 8px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '5px', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>Cerrar</button>}
                      <button onClick={() => startEditEncuesta(enc)} style={{ padding: '3px 8px', background: '#f1f5f9', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer' }}>✏️</button>
                      <button onClick={() => handleDeleteEncuesta(enc.id)} style={{ padding: '3px 8px', background: '#fee2e2', border: 'none', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', color: '#ef4444' }}>🗑️</button>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Detalle encuesta + respuestas */}
        {selectedEncuesta && (
          <div style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>{selectedEncuesta.titulo}</h3>
                {selectedEncuesta.descripcion && <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#64748b' }}>{selectedEncuesta.descripcion}</p>}
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {(selectedEncuesta.preguntas as PreguntaItem[]).length} preguntas · {encuestaRespuestas.length} respuestas
                </div>
              </div>
              {selectedEncuesta.estado === 'activa' && (
                <button onClick={startRespForm} style={{ padding: '7px 14px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>+ Respuesta</button>
              )}
            </div>

            {/* Formulario de respuesta */}
            {showRespForm && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 12px', fontSize: '13px', fontWeight: 700 }}>Registrar Respuesta</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                  <div>
                    <label style={labelStyle}>Unidad</label>
                    <select style={inputStyle} value={respForm.unidad_id} onChange={e => setRespForm(f => ({ ...f, unidad_id: e.target.value }))}>
                      <option value="">Sin unidad</option>
                      {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Nombre respondente</label>
                    <input style={inputStyle} value={respForm.nombre} onChange={e => setRespForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Opcional" />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '12px' }}>
                  {(selectedEncuesta.preguntas as PreguntaItem[]).map(p => (
                    <div key={p.id}>
                      <label style={labelStyle}>{p.texto}</label>
                      {p.tipo === 'texto' && (
                        <input style={inputStyle} value={respForm.answers[p.id] ?? ''} onChange={e => setRespForm(f => ({ ...f, answers: { ...f.answers, [p.id]: e.target.value } }))} placeholder="Respuesta libre" />
                      )}
                      {p.tipo === 'rating_5' && (
                        <div style={{ display: 'flex', gap: '6px' }}>
                          {[1,2,3,4,5].map(n => (
                            <button key={n} onClick={() => setRespForm(f => ({ ...f, answers: { ...f.answers, [p.id]: String(n) } }))}
                              style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1.5px solid', fontSize: '14px', fontWeight: 700, cursor: 'pointer',
                                background: respForm.answers[p.id] === String(n) ? '#0ea5e9' : 'white',
                                color: respForm.answers[p.id] === String(n) ? 'white' : '#64748b',
                                borderColor: respForm.answers[p.id] === String(n) ? '#0ea5e9' : '#e2e8f0' }}>
                              {n}
                            </button>
                          ))}
                        </div>
                      )}
                      {p.tipo === 'si_no' && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {['si', 'no'].map(v => (
                            <button key={v} onClick={() => setRespForm(f => ({ ...f, answers: { ...f.answers, [p.id]: v } }))}
                              style={{ padding: '6px 16px', borderRadius: '8px', border: '1.5px solid', fontSize: '13px', fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize',
                                background: respForm.answers[p.id] === v ? '#0ea5e9' : 'white',
                                color: respForm.answers[p.id] === v ? 'white' : '#64748b',
                                borderColor: respForm.answers[p.id] === v ? '#0ea5e9' : '#e2e8f0' }}>
                              {v === 'si' ? 'Sí' : 'No'}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowRespForm(false)} style={{ padding: '7px 14px', background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', color: '#64748b' }}>Cancelar</button>
                  <button onClick={handleSaveRespuesta} disabled={savingResp} style={{ padding: '7px 14px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', opacity: savingResp ? 0.7 : 1 }}>
                    {savingResp ? 'Guardando…' : 'Guardar Respuesta'}
                  </button>
                </div>
              </div>
            )}

            {/* Lista de respuestas */}
            {encuestaRespuestas.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8', fontSize: '12px' }}>Aún no hay respuestas</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#64748b', marginBottom: '4px' }}>Respuestas recibidas ({encuestaRespuestas.length})</div>
                {encuestaRespuestas.map((r, idx) => (
                  <div key={r.id} style={{ background: '#f8fafc', borderRadius: '8px', padding: '12px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                      #{idx + 1} {r.unidad_nombre ? `🏠 ${r.unidad_nombre}` : ''} {r.nombre_respondente ? `· ${r.nombre_respondente}` : ''}
                      <span style={{ fontWeight: 400, color: '#94a3b8', marginLeft: '8px' }}>{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      {(selectedEncuesta.preguntas as PreguntaItem[]).map(p => {
                        const ans = (r.respuestas as Record<string, string>)[p.id]
                        if (!ans) return null
                        return (
                          <div key={p.id} style={{ fontSize: '12px', color: '#64748b' }}>
                            <span style={{ fontWeight: 600, color: '#475569' }}>{p.texto}:</span>{' '}
                            {p.tipo === 'rating_5' ? '⭐'.repeat(Number(ans)) : p.tipo === 'si_no' ? (ans === 'si' ? '✅ Sí' : '❌ No') : ans}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
