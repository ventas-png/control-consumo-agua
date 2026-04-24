import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import type {
  BloqueTurno, TareaBloque, RevisionTarea,
  PersonalCondominio, EstadoRevision,
} from '../../../types'

interface Props {
  bloques: BloqueTurno[]
  tareas: TareaBloque[]
  revisiones: RevisionTarea[]
  personal: PersonalCondominio[]
  userId: string
  canEdit: boolean
  onRefresh: () => void
}

const ESTADO_REV: Record<EstadoRevision, { label: string; icon: string; bg: string; color: string; border: string }> = {
  pendiente: { label: 'Pendiente revisión', icon: '⏳', bg: '#f8fafc', color: '#64748b', border: '#e2e8f0' },
  aprobado:  { label: 'Aprobado',           icon: '✅', bg: '#f0fdf4', color: '#16a34a', border: '#86efac' },
  rechazado: { label: 'Rechazado',          icon: '❌', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
}

export function RevisionTareasTab({ bloques, tareas, revisiones, personal, userId, canEdit, onRefresh }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [selectedFecha, setSelectedFecha] = useState(hoy)
  const [selectedPersonalId, setSelectedPersonalId] = useState('todos')
  const [bloqueAbierto, setBloqueAbierto] = useState<string | null>(null)

  // Solo bloques cerrados (completado/incompleto)
  const bloquesCerrados = bloques.filter(b =>
    (b.estado === 'completado' || b.estado === 'incompleto') &&
    (!selectedFecha || b.fecha === selectedFecha) &&
    (selectedPersonalId === 'todos' || b.personal_id === selectedPersonalId)
  )

  const tareasDeBloque = (bloqueId: string) =>
    tareas.filter(t => t.bloque_id === bloqueId).sort((a, b) => a.orden - b.orden)

  const revisionDeTarea = (tareaId: string): RevisionTarea | undefined =>
    revisiones.find(r => r.tarea_id === tareaId)

  const personalActivo = personal.filter(p => p.estado !== 'inactivo').sort((a, b) => a.nombre.localeCompare(b.nombre))

  async function revisar(tareaId: string, bloqueId: string, estado: EstadoRevision) {
    let comentario: string | null = null
    if (estado === 'rechazado') {
      const { value } = await (window as Window & typeof globalThis & { Swal?: typeof import('sweetalert2')['default'] }).Swal?.fire?.({
        title: '¿Por qué rechazas esta tarea?',
        input: 'textarea', inputPlaceholder: 'Describe el motivo del rechazo...',
        showCancelButton: true, confirmButtonText: 'Rechazar', cancelButtonText: 'Cancelar',
        confirmButtonColor: '#ef4444',
      }) ?? { value: undefined }
      if (value === undefined) return
      comentario = value as string || null
    }

    const existing = revisionDeTarea(tareaId)
    if (existing) {
      await supabase.from('revisiones_tarea').update({
        estado, comentario, revisado_por: userId, revisado_en: new Date().toISOString(),
      }).eq('id', existing.id)
    } else {
      await supabase.from('revisiones_tarea').insert({
        tarea_id: tareaId, bloque_id: bloqueId,
        revisado_por: userId, estado, comentario,
      })
    }
    onRefresh()
  }

  // Cálculo del estado global de revisión de un bloque
  function estadoRevisionBloque(bloqueId: string): { total: number; aprobadas: number; rechazadas: number; pendientes: number } {
    const ts = tareasDeBloque(bloqueId).filter(t => t.estado === 'completada' || t.estado === 'con_observacion')
    const aprobadas = ts.filter(t => revisionDeTarea(t.id)?.estado === 'aprobado').length
    const rechazadas = ts.filter(t => revisionDeTarea(t.id)?.estado === 'rechazado').length
    const pendientes = ts.filter(t => !revisionDeTarea(t.id) || revisionDeTarea(t.id)?.estado === 'pendiente').length
    return { total: ts.length, aprobadas, rechazadas, pendientes }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Revisión de turnos</h2>
        <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '13.5px' }}>
          Ronda del administrador · aprueba o rechaza el trabajo realizado por el personal
        </p>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={selectedPersonalId} onChange={e => setSelectedPersonalId(e.target.value)}
          style={{ padding: '7px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', background: 'white' }}>
          <option value="todos">Todos los empleados</option>
          {personalActivo.map(p => <option key={p.id} value={p.id}>{p.nombre} — {p.cargo}</option>)}
        </select>
        <input type="date" value={selectedFecha} onChange={e => setSelectedFecha(e.target.value)}
          style={{ padding: '7px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', background: 'white' }} />
        {selectedFecha !== hoy && (
          <button onClick={() => setSelectedFecha(hoy)} style={{ padding: '7px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: '#374151' }}>
            Hoy
          </button>
        )}
      </div>

      {bloquesCerrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '56px', color: '#94a3b8' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔍</div>
          <p style={{ fontWeight: 700, color: '#64748b' }}>Sin turnos cerrados para revisar</p>
          <p style={{ fontSize: '13px' }}>Los turnos aparecen aquí cuando el operativo cierra su bloque de trabajo.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {bloquesCerrados.map(bloque => {
            const empleado = personal.find(p => p.id === bloque.personal_id)
            const ts = tareasDeBloque(bloque.id)
            const rev = estadoRevisionBloque(bloque.id)
            const isOpen = bloqueAbierto === bloque.id
            const revisionCompleta = rev.pendientes === 0 && rev.total > 0

            return (
              <div key={bloque.id} style={{ background: 'white', border: `1.5px solid ${isOpen ? '#6366f1' : '#e2e8f0'}`, borderRadius: '16px', overflow: 'hidden' }}>
                {/* Header del bloque */}
                <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', background: isOpen ? '#eef2ff' : 'white' }}
                  onClick={() => setBloqueAbierto(isOpen ? null : bloque.id)}>
                  <span style={{ fontSize: '22px' }}>🔍</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '14.5px', color: '#0f172a' }}>
                      {empleado?.nombre ?? 'Empleado'} — {empleado?.cargo ?? ''}
                    </div>
                    <div style={{ fontSize: '12.5px', color: '#64748b', display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '2px' }}>
                      <span>{new Date(bloque.fecha + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short' })}</span>
                      {bloque.turno === 'manana' && <span>🌅 Mañana</span>}
                      {bloque.turno === 'tarde'  && <span>☀️ Tarde</span>}
                      {bloque.turno === 'noche'  && <span>🌙 Noche</span>}
                      {bloque.puntaje_completitud !== null && bloque.puntaje_completitud !== undefined && (
                        <span style={{ fontWeight: 700, color: bloque.puntaje_completitud >= 80 ? '#16a34a' : bloque.puntaje_completitud >= 50 ? '#ea580c' : '#dc2626' }}>
                          Completitud: {bloque.puntaje_completitud}%
                        </span>
                      )}
                      {rev.total > 0 && (
                        <>
                          {rev.aprobadas > 0 && <span style={{ color: '#16a34a' }}>✅ {rev.aprobadas} aprobadas</span>}
                          {rev.rechazadas > 0 && <span style={{ color: '#dc2626' }}>❌ {rev.rechazadas} rechazadas</span>}
                          {rev.pendientes > 0 && <span style={{ color: '#64748b' }}>⏳ {rev.pendientes} por revisar</span>}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Badge revisión */}
                  {rev.total > 0 && (
                    <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, flexShrink: 0,
                      background: revisionCompleta ? (rev.rechazadas > 0 ? '#fef2f2' : '#f0fdf4') : '#eff6ff',
                      color: revisionCompleta ? (rev.rechazadas > 0 ? '#dc2626' : '#16a34a') : '#2563eb' }}>
                      {revisionCompleta ? (rev.rechazadas > 0 ? '⚠ Con rechazos' : '✓ Revisado') : 'Pendiente revisión'}
                    </span>
                  )}
                  <span style={{ color: '#94a3b8', fontSize: '16px', transition: 'transform .2s', transform: isOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
                </div>

                {/* Detalle de tareas para revisar */}
                {isOpen && (
                  <div style={{ borderTop: '1px solid #c7d2fe', padding: '16px 18px', background: '#eef2ff' }}>
                    {ts.length === 0 ? (
                      <p style={{ color: '#94a3b8', fontSize: '13px' }}>Este turno no tenía tareas asignadas.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {ts.map((t, idx) => {
                          const rev = revisionDeTarea(t.id)
                          const revEstado: EstadoRevision = rev?.estado ?? 'pendiente'
                          const rc = ESTADO_REV[revEstado]
                          const esCompletada = t.estado === 'completada' || t.estado === 'con_observacion'

                          return (
                            <div key={t.id} style={{ padding: '12px 14px', background: rc.bg, borderRadius: '10px', border: `1px solid ${rc.border}` }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                <span style={{ fontSize: '12px', fontWeight: 800, color: '#6366f1', width: '18px', flexShrink: 0, marginTop: '2px', textAlign: 'center' }}>{idx + 1}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '3px' }}>
                                    <span style={{ fontWeight: 700, fontSize: '13.5px', color: '#0f172a' }}>{t.titulo}</span>
                                    <span style={{ fontSize: '11.5px', padding: '1px 7px', borderRadius: '20px', background: t.estado === 'completada' ? '#dcfce7' : t.estado === 'con_observacion' ? '#fef3c7' : t.estado === 'omitida' ? '#ede9fe' : '#f1f5f9', color: t.estado === 'completada' ? '#16a34a' : t.estado === 'con_observacion' ? '#92400e' : '#64748b', fontWeight: 600 }}>
                                      {t.estado === 'completada' ? '✅ Completada' : t.estado === 'con_observacion' ? '⚠️ Con observación' : t.estado === 'omitida' ? '⏭ Omitida' : '⏳ Pendiente'}
                                    </span>
                                  </div>
                                  {t.descripcion && <div style={{ fontSize: '12px', color: '#64748b' }}>{t.descripcion}</div>}
                                  {t.notas_operativo && (
                                    <div style={{ fontSize: '12.5px', color: '#ea580c', marginTop: '3px' }}>💬 {t.notas_operativo}</div>
                                  )}
                                  {t.completada_en && (
                                    <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '2px' }}>
                                      Completada a las {new Date(t.completada_en).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                  )}
                                  {rev?.comentario && (
                                    <div style={{ fontSize: '12.5px', color: rev.estado === 'rechazado' ? '#dc2626' : '#16a34a', marginTop: '4px', fontStyle: 'italic' }}>
                                      {rev.estado === 'rechazado' ? '❌' : '✅'} {rev.comentario}
                                    </div>
                                  )}
                                </div>
                                {/* Botones de revisión */}
                                {canEdit && esCompletada && (
                                  <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                                    <button onClick={() => revisar(t.id, bloque.id, 'aprobado')}
                                      style={{ padding: '6px 12px', background: revEstado === 'aprobado' ? '#16a34a' : '#f0fdf4', color: revEstado === 'aprobado' ? 'white' : '#16a34a', border: '1.5px solid #86efac', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>
                                      ✓ Aprobar
                                    </button>
                                    <button onClick={() => revisar(t.id, bloque.id, 'rechazado')}
                                      style={{ padding: '6px 12px', background: revEstado === 'rechazado' ? '#dc2626' : '#fef2f2', color: revEstado === 'rechazado' ? 'white' : '#dc2626', border: '1.5px solid #fecaca', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>
                                      ✕ Rechazar
                                    </button>
                                  </div>
                                )}
                                {!esCompletada && (
                                  <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic', flexShrink: 0 }}>No aplica</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Resumen del bloque revisado */}
                    {rev.total > 0 && (
                      <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        <div style={{ padding: '10px 16px', background: '#f0fdf4', borderRadius: '10px', textAlign: 'center' }}>
                          <div style={{ fontSize: '20px', fontWeight: 800, color: '#16a34a' }}>{rev.aprobadas}</div>
                          <div style={{ fontSize: '11.5px', color: '#64748b' }}>Aprobadas</div>
                        </div>
                        <div style={{ padding: '10px 16px', background: '#fef2f2', borderRadius: '10px', textAlign: 'center' }}>
                          <div style={{ fontSize: '20px', fontWeight: 800, color: '#dc2626' }}>{rev.rechazadas}</div>
                          <div style={{ fontSize: '11.5px', color: '#64748b' }}>Rechazadas</div>
                        </div>
                        <div style={{ padding: '10px 16px', background: '#f8fafc', borderRadius: '10px', textAlign: 'center' }}>
                          <div style={{ fontSize: '20px', fontWeight: 800, color: '#64748b' }}>{rev.pendientes}</div>
                          <div style={{ fontSize: '11.5px', color: '#64748b' }}>Por revisar</div>
                        </div>
                        {rev.total > 0 && (
                          <div style={{ padding: '10px 16px', background: '#eff6ff', borderRadius: '10px', textAlign: 'center' }}>
                            <div style={{ fontSize: '20px', fontWeight: 800, color: '#2563eb' }}>
                              {rev.total > 0 ? Math.round((rev.aprobadas / rev.total) * 100) : 0}%
                            </div>
                            <div style={{ fontSize: '11.5px', color: '#64748b' }}>Tasa aprobación</div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
