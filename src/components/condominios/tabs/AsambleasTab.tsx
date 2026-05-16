import { useState } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'
import type { Asamblea, PuntoAsamblea, VotoAsamblea, Unidad, TipoAsamblea, EstadoAsamblea, TipoPunto, TipoVoto } from '../../../types'

interface Props {
  asambleas: Asamblea[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_CONFIG: Record<EstadoAsamblea, { label: string; bg: string; color: string }> = {
  programada: { label: 'Programada', bg: '#eff6ff', color: '#2563eb' },
  en_curso:   { label: 'En curso',   bg: '#f0fdf4', color: '#16a34a' },
  finalizada: { label: 'Finalizada', bg: '#f8fafc', color: '#64748b' },
  cancelada:  { label: 'Cancelada',  bg: '#fef2f2', color: '#dc2626' },
}

const VOTO_CONFIG: Record<TipoVoto, { label: string; bg: string; color: string }> = {
  a_favor:    { label: 'A favor',    bg: '#f0fdf4', color: '#16a34a' },
  en_contra:  { label: 'En contra',  bg: '#fef2f2', color: '#dc2626' },
  abstencion: { label: 'Abstención', bg: '#f8fafc', color: '#64748b' },
}

export function AsambleasTab({ asambleas, unidades, proyectoId, companyId, userId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [puntos, setPuntos] = useState<(PuntoAsamblea & { votos: VotoAsamblea[] })[]>([])
  const [loadingPuntos, setLoadingPuntos] = useState(false)
  const [showPuntoForm, setShowPuntoForm] = useState(false)
  const [filtroEstado, setFiltroEstado] = useState<EstadoAsamblea | 'todos'>('todos')

  const [form, setForm] = useState({
    titulo: '', tipo: 'ordinaria' as TipoAsamblea,
    fecha: '', hora_inicio: '', hora_fin: '', lugar: '',
    quorum_requerido: '50',
  })
  const [puntoForm, setPuntoForm] = useState({ titulo: '', descripcion: '', tipo: 'informativo' as TipoPunto })

  const filtradas = filtroEstado === 'todos' ? asambleas : asambleas.filter(a => a.estado === filtroEstado)
  const proximas = asambleas.filter(a => a.estado === 'programada').length
  const selectedAsamblea = asambleas.find(a => a.id === selectedId)

  function resetForm() {
    setForm({ titulo: '', tipo: 'ordinaria', fecha: '', hora_inicio: '', hora_fin: '', lugar: '', quorum_requerido: '50' })
    setShowForm(false)
  }

  async function handleGuardar() {
    if (!form.titulo.trim()) { toast.error('Ingrese el título.'); return }
    if (!form.fecha || !form.hora_inicio) { toast.error('Ingrese fecha y hora de inicio.'); return }
    setSaving(true)
    const { error } = await supabase.from('asambleas').insert({
      company_id: companyId, project_id: proyectoId,
      titulo: form.titulo.trim(), tipo: form.tipo,
      fecha: form.fecha, hora_inicio: form.hora_inicio,
      hora_fin: form.hora_fin || null, lugar: form.lugar.trim() || null,
      quorum_requerido: Number(form.quorum_requerido),
      estado: 'programada', convocado_por: userId,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Asamblea convocada')
    resetForm(); onRefresh()
  }

  async function cambiarEstado(id: string, estado: EstadoAsamblea) {
    await supabase.from('asambleas').update({ estado }).eq('id', id)
    onRefresh()
  }

  async function cargarPuntos(asambleaId: string) {
    setSelectedId(asambleaId)
    setLoadingPuntos(true)
    const { data: puntosData } = await supabase
      .from('puntos_asamblea')
      .select('*, votos_asamblea(*, unidades(nombre))')
      .eq('asamblea_id', asambleaId)
      .order('orden')
    setPuntos((puntosData ?? []).map((p: Record<string, unknown>) => ({
      ...p,
      votos: ((p.votos_asamblea as Record<string, unknown>[]) ?? []).map((v: Record<string, unknown>) => ({
        ...v,
        unidad_nombre: (v.unidades as { nombre: string } | null)?.nombre,
      } as VotoAsamblea)),
    } as PuntoAsamblea & { votos: VotoAsamblea[] })))
    setLoadingPuntos(false)
  }

  async function agregarPunto() {
    if (!puntoForm.titulo.trim() || !selectedId) return
    const maxOrden = puntos.length > 0 ? Math.max(...puntos.map(p => p.orden)) + 1 : 1
    const { error } = await supabase.from('puntos_asamblea').insert({
      asamblea_id: selectedId, orden: maxOrden,
      titulo: puntoForm.titulo.trim(), descripcion: puntoForm.descripcion.trim() || null, tipo: puntoForm.tipo,
    })
    if (error) { toast.error(error.message); return }
    setPuntoForm({ titulo: '', descripcion: '', tipo: 'informativo' })
    setShowPuntoForm(false)
    cargarPuntos(selectedId)
  }

  async function registrarVoto(puntoId: string, unidadId: string, voto: TipoVoto) {
    await supabase.from('votos_asamblea').upsert({
      punto_id: puntoId, unidad_id: unidadId, voto, registrado_por: userId,
    }, { onConflict: 'punto_id,unidad_id' })
    if (selectedId) cargarPuntos(selectedId)
  }

  async function guardarActa(id: string, acta: string) {
    await supabase.from('asambleas').update({ acta }).eq('id', id)
    onRefresh()
  }

  async function eliminar(id: string) {
    const r = await Swal.fire({ title: '¿Eliminar asamblea?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#ef4444', confirmButtonText: 'Eliminar', cancelButtonText: 'Cancelar' })
    if (!r.isConfirmed) return
    await supabase.from('asambleas').delete().eq('id', id)
    if (selectedId === id) setSelectedId(null)
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Asambleas y Votaciones</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13.5px' }}>
            {asambleas.length} asambleas · <span style={{ color: '#2563eb', fontWeight: 600 }}>{proximas} programadas</span>
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
            + Convocar asamblea
          </button>
        )}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['todos', 'programada', 'en_curso', 'finalizada', 'cancelada'] as const).map(e => (
          <button key={e} onClick={() => setFiltroEstado(e)}
            style={{ padding: '7px 14px', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid', borderColor: filtroEstado === e ? '#0ea5e9' : '#e2e8f0', background: filtroEstado === e ? '#eff6ff' : 'white', color: filtroEstado === e ? '#0ea5e9' : '#64748b' }}>
            {e === 'todos' ? 'Todas' : ESTADO_CONFIG[e as EstadoAsamblea].label}
          </button>
        ))}
      </div>

      {/* Form nueva asamblea */}
      {showForm && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Convocar asamblea</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Título *</label>
              <input value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Ej. Asamblea Ordinaria Abril 2026"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Tipo</label>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value as TipoAsamblea }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                <option value="ordinaria">Ordinaria</option>
                <option value="extraordinaria">Extraordinaria</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Quórum requerido (%)</label>
              <input type="number" value={form.quorum_requerido} onChange={e => setForm(f => ({ ...f, quorum_requerido: e.target.value }))} min="1" max="100"
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Fecha *</label>
              <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Hora inicio *</label>
              <input type="time" value={form.hora_inicio} onChange={e => setForm(f => ({ ...f, hora_inicio: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Hora fin</label>
              <input type="time" value={form.hora_fin} onChange={e => setForm(f => ({ ...f, hora_fin: e.target.value }))}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Lugar</label>
              <input value={form.lugar} onChange={e => setForm(f => ({ ...f, lugar: e.target.value }))} placeholder="Salón de reuniones, Área BBQ..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={handleGuardar} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : '📅 Convocar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selectedId ? '1fr 1.4fr' : '1fr', gap: '16px' }}>
        {/* Lista asambleas */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtradas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🏛️</div>
              <p style={{ fontWeight: 600, color: '#64748b' }}>No hay asambleas</p>
            </div>
          ) : filtradas.map(a => {
            const ec = ESTADO_CONFIG[a.estado]
            const isSelected = a.id === selectedId
            return (
              <div key={a.id} onClick={() => cargarPuntos(a.id)}
                style={{ background: 'white', border: `1.5px solid ${isSelected ? '#0ea5e9' : '#e2e8f0'}`, borderRadius: '14px', padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.15s' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{a.titulo}</span>
                      <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: '#f1f5f9', color: '#64748b' }}>{a.tipo}</span>
                    </div>
                    <div style={{ fontSize: '12.5px', color: '#64748b', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <span>📅 {a.fecha} {a.hora_inicio}</span>
                      {a.lugar && <span>📍 {a.lugar}</span>}
                      <span>Quórum: {a.quorum_requerido}%</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end', flexShrink: 0 }}>
                    {canEdit ? (
                      <select value={a.estado} onClick={e => e.stopPropagation()} onChange={e => cambiarEstado(a.id, e.target.value as EstadoAsamblea)}
                        style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, border: 'none', cursor: 'pointer', background: ec.bg, color: ec.color }}>
                        {(Object.entries(ESTADO_CONFIG) as [EstadoAsamblea, typeof ESTADO_CONFIG[EstadoAsamblea]][]).map(([v, c]) => (
                          <option key={v} value={v}>{c.label}</option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ padding: '3px 8px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                    )}
                    <button onClick={e => { e.stopPropagation(); eliminar(a.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '14px' }}>🗑</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Panel de puntos y votación */}
        {selectedId && selectedAsamblea && (
          <div style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '16px', padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Agenda: {selectedAsamblea.titulo}</h3>
                <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: '#64748b' }}>{puntos.length} puntos · {unidades.filter(u => u.activo).length} unidades</p>
              </div>
              {canEdit && <button onClick={() => setShowPuntoForm(v => !v)} style={{ padding: '7px 14px', background: '#f1f5f9', border: '1.5px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600, color: '#374151' }}>+ Punto</button>}
            </div>

            {showPuntoForm && (
              <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '14px', marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <input value={puntoForm.titulo} onChange={e => setPuntoForm(f => ({ ...f, titulo: e.target.value }))} placeholder="Título del punto"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13.5px', background: 'white' }} />
                <input value={puntoForm.descripcion} onChange={e => setPuntoForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción (opcional)"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13.5px', background: 'white' }} />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select value={puntoForm.tipo} onChange={e => setPuntoForm(f => ({ ...f, tipo: e.target.value as TipoPunto }))}
                    style={{ flex: 1, padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13.5px', background: 'white' }}>
                    <option value="informativo">Informativo</option>
                    <option value="votacion">Votación</option>
                    <option value="debate">Debate</option>
                  </select>
                  <button onClick={agregarPunto} style={{ padding: '8px 16px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>Agregar</button>
                  <button onClick={() => setShowPuntoForm(false)} style={{ padding: '8px 12px', background: '#f1f5f9', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px' }}>✕</button>
                </div>
              </div>
            )}

            {loadingPuntos ? (
              <p style={{ color: '#94a3b8', fontSize: '13px' }}>Cargando...</p>
            ) : puntos.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', padding: '20px' }}>No hay puntos en la agenda. Agrega el primero.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '500px', overflowY: 'auto' }}>
                {puntos.map((p, idx) => {
                  const votosMap = Object.fromEntries((p.votos ?? []).map(v => [v.unidad_id, v.voto]))
                  const conteo = { a_favor: 0, en_contra: 0, abstencion: 0 }
                  Object.values(votosMap).forEach(v => { if (v in conteo) conteo[v as TipoVoto]++ })
                  const totalVotos = Object.values(conteo).reduce((a, b) => a + b, 0)

                  return (
                    <div key={p.id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden' }}>
                      <div style={{ background: '#f8fafc', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ width: 22, height: 22, borderRadius: '50%', background: '#0ea5e9', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: 800, flexShrink: 0 }}>{idx + 1}</span>
                        <div style={{ flex: 1 }}>
                          <span style={{ fontWeight: 700, fontSize: '13.5px', color: '#0f172a' }}>{p.titulo}</span>
                          {p.descripcion && <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '8px' }}>{p.descripcion}</span>}
                        </div>
                        <span style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '20px', background: p.tipo === 'votacion' ? '#eff6ff' : '#f1f5f9', color: p.tipo === 'votacion' ? '#2563eb' : '#64748b', fontWeight: 600 }}>{p.tipo}</span>
                      </div>

                      {p.tipo === 'votacion' && (
                        <div style={{ padding: '12px 14px' }}>
                          {/* Resultados */}
                          {totalVotos > 0 && (
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                              {(['a_favor', 'en_contra', 'abstencion'] as TipoVoto[]).map(v => (
                                <span key={v} style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: VOTO_CONFIG[v].bg, color: VOTO_CONFIG[v].color }}>
                                  {VOTO_CONFIG[v].label}: {conteo[v]}
                                </span>
                              ))}
                              <span style={{ fontSize: '12px', color: '#94a3b8', alignSelf: 'center' }}>Total: {totalVotos}/{unidades.filter(u => u.activo).length}</span>
                            </div>
                          )}
                          {/* Registro de votos por unidad */}
                          {canEdit && selectedAsamblea.estado === 'en_curso' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                              {unidades.filter(u => u.activo).map(u => (
                                <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px' }}>
                                  <span style={{ flex: 1, color: '#374151' }}>{u.nombre}</span>
                                  {(['a_favor', 'en_contra', 'abstencion'] as TipoVoto[]).map(v => (
                                    <button key={v} onClick={() => registrarVoto(p.id, u.id, v)}
                                      style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', border: '1px solid',
                                        borderColor: votosMap[u.id] === v ? VOTO_CONFIG[v].color : '#e2e8f0',
                                        background: votosMap[u.id] === v ? VOTO_CONFIG[v].bg : 'white',
                                        color: votosMap[u.id] === v ? VOTO_CONFIG[v].color : '#94a3b8' }}>
                                      {v === 'a_favor' ? '✓' : v === 'en_contra' ? '✗' : '—'}
                                    </button>
                                  ))}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Acta */}
            {canEdit && selectedAsamblea.estado === 'finalizada' && (
              <div style={{ marginTop: '16px', borderTop: '1px solid #e2e8f0', paddingTop: '14px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '6px' }}>📝 Acta de la asamblea</label>
                <textarea defaultValue={selectedAsamblea.acta ?? ''} onBlur={e => guardarActa(selectedAsamblea.id, e.target.value)} rows={4} placeholder="Redacta el acta de la asamblea..."
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13.5px', background: '#f8fafc', resize: 'vertical' }} />
              </div>
            )}
            {selectedAsamblea.acta && selectedAsamblea.estado !== 'en_curso' && !canEdit && (
              <div style={{ marginTop: '14px', borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
                <p style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>📝 Acta</p>
                <p style={{ fontSize: '13.5px', color: '#374151', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{selectedAsamblea.acta}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
