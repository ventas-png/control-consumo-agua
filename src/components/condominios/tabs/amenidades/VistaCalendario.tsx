// Vista extraída de AmenidadesTab (fase B): JSX idéntico al original.
import type { AmenidadesCtx } from './ctx'
import { Fragment } from 'react'
import { addMinutosToTime, lunesDeSemana, DIAS_ES } from '../../../../lib/amenidadesReglas'
import { MOTIVO_LABEL, ESTADO_COLORS, RESERVA_CAL_COLORS } from './ui'
import { EmptyState } from './comunes'

export function VistaCalendario({ ctx }: { ctx: AmenidadesCtx }) {
  const { reservas, bloqueos, canCreate, canEdit, setSemana, selectedReserva, setSelectedReserva, hoy, amenidadesActivas, dias, abrirReservaDesdeCalendario, cancelarReserva } = ctx
  return (
        <div>
          {/* Navegación de semana */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <button onClick={() => setSemana(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n })}
              style={{ padding: '6px 14px', border: '1.5px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: 'var(--at-surface-2)', fontWeight: 600 }}>← Ant.</button>
            <div style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: 14, color: 'var(--at-ink)' }}>
              Semana del {dias[0].toLocaleDateString('es', { day: 'numeric', month: 'long' })} al {dias[6].toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <button onClick={() => setSemana(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n })}
              style={{ padding: '6px 14px', border: '1.5px solid var(--at-line)', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: 'var(--at-surface-2)', fontWeight: 600 }}>Sig. →</button>
            <button onClick={() => setSemana(lunesDeSemana(new Date()))}
              style={{ padding: '6px 12px', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: 8, cursor: 'pointer', fontSize: 12, background: 'var(--at-primary-tint)', color: 'var(--at-primary)', fontWeight: 600 }}>Hoy</button>
          </div>

          {amenidadesActivas.length === 0 ? (
            <EmptyState icon="📆" title="No hay amenidades activas"
              hint="Activa al menos una amenidad desde la pestaña Amenidades para ver el calendario semanal con horarios y reservas." />
          ) : (() => {
            // Rango horario global
            const minH = Math.min(...amenidadesActivas.map(a => a.horario_inicio ? parseInt(a.horario_inicio.slice(0, 2)) : 8), 8)
            const maxH = Math.max(...amenidadesActivas.map(a => a.horario_fin ? parseInt(a.horario_fin.slice(0, 2)) + (parseInt(a.horario_fin.slice(3, 5)) > 0 ? 1 : 0) : 22), 22)
            const horas = Array.from({ length: maxH - minH + 1 }, (_, i) => minH + i)
            const ROW_H = 220                      // alto de cada fila amenidad
            const minutosTotal = (maxH - minH) * 60
            const toPct = (hhmm: string) => {
              const [h, m] = hhmm.split(':').map(Number)
              return Math.max(0, Math.min(100, ((h - minH) * 60 + m) / minutosTotal * 100))
            }
            return (
              <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: 14, padding: 16, overflowX: 'auto' }}>
                {/* Header de días */}
                <div style={{ display: 'grid', gridTemplateColumns: `140px repeat(7, minmax(120px,1fr))`, gap: 4, marginBottom: 8, minWidth: 980 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', alignSelf: 'end', paddingBottom: 6 }}>Amenidad / Día</div>
                  {dias.map((d, i) => {
                    const fechaStr = d.toISOString().slice(0, 10)
                    const esHoy = fechaStr === hoy
                    return (
                      <div key={i} style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 10, background: esHoy ? 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))' : 'var(--at-surface-2)', color: esHoy ? 'white' : 'var(--at-ink-2)' }}>
                        <div style={{ fontSize: 10.5, fontWeight: 700, opacity: esHoy ? 0.9 : 1 }}>{DIAS_ES[i]}</div>
                        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>{d.getDate()}</div>
                        <div style={{ fontSize: 9.5, opacity: 0.8, textTransform: 'capitalize' }}>{d.toLocaleDateString('es', { month: 'short' })}</div>
                      </div>
                    )
                  })}
                </div>

                {/* Filas amenidad */}
                {amenidadesActivas.map((a, ai) => {
                  const paleta = RESERVA_CAL_COLORS[ai % RESERVA_CAL_COLORS.length]
                  return (
                    <div key={a.id} style={{ display: 'grid', gridTemplateColumns: `140px repeat(7, minmax(120px,1fr))`, gap: 4, marginBottom: 6, minWidth: 980 }}>
                      {/* Etiqueta de amenidad */}
                      <div style={{ background: 'linear-gradient(135deg,var(--at-surface-2),var(--at-chip))', borderRadius: 10, padding: '10px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderLeft: `4px solid ${paleta.color}` }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--at-ink)' }}>{a.nombre}</div>
                        {a.horario_inicio && <div style={{ fontSize: 10, color: 'var(--at-ink-3)', fontWeight: 600 }}>⏰ {a.horario_inicio}–{a.horario_fin}</div>}
                      </div>
                      {dias.map((d, di) => {
                        const fechaStr = d.toISOString().slice(0, 10)
                        const esHoy = fechaStr === hoy
                        const resDia = reservas.filter(r => r.amenidad_id === a.id && r.fecha === fechaStr && r.estado !== 'cancelada')
                        const bloqDia = bloqueos.filter(b => b.amenidad_id === a.id && fechaStr >= b.fecha_inicio && fechaStr <= b.fecha_fin)
                        const bloqDiaCompleto = bloqDia.some(b => !b.hora_inicio || !b.hora_fin)
                        return (
                          <div key={di} style={{
                            position: 'relative',
                            height: ROW_H,
                            background: bloqDiaCompleto
                              ? 'repeating-linear-gradient(45deg,var(--at-warning-tint),var(--at-warning-tint) 6px,var(--at-warning-border) 6px,var(--at-warning-border) 12px)'
                              : esHoy ? 'var(--at-primary-tint)' : 'var(--at-surface-2)',
                            border: `1px solid ${esHoy ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`,
                            borderRadius: 10,
                            overflow: 'hidden',
                            cursor: canCreate && !bloqDiaCompleto ? 'pointer' : 'default',
                          }}
                          onClick={(e) => {
                            // sólo si no es click en una reserva
                            if (canCreate && !bloqDiaCompleto && (e.target as HTMLElement).dataset.role !== 'reserva') {
                              abrirReservaDesdeCalendario(a.id, fechaStr)
                            }
                          }}>
                            {/* Líneas de hora horizontales */}
                            {horas.slice(1).map((h, hi) => (
                              <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: `${((h - minH) / (maxH - minH)) * 100}%`, height: 1, background: hi % 2 === 0 ? 'var(--at-line)' : 'var(--at-chip)' }} />
                            ))}
                            {/* Etiquetas de hora a la izquierda (solo en primera celda de día) */}
                            {di === 0 && horas.map((h, hi) => (
                              <div key={h} style={{ position: 'absolute', left: 2, top: `${(hi / (maxH - minH)) * 100}%`, fontSize: 8.5, color: 'var(--at-line-strong)', fontWeight: 600, transform: 'translateY(-3px)', pointerEvents: 'none' }}>
                                {String(h).padStart(2, '0')}
                              </div>
                            ))}
                            {/* Bloqueos por horario */}
                            {bloqDia.filter(b => b.hora_inicio && b.hora_fin).map(b => {
                              const top = toPct(b.hora_inicio!)
                              const bottom = toPct(b.hora_fin!)
                              return (
                                <div key={b.id} title={b.notas || MOTIVO_LABEL[b.motivo]}
                                  style={{ position: 'absolute', left: 4, right: 4, top: `${top}%`, height: `${bottom - top}%`, borderRadius: 6, background: 'repeating-linear-gradient(45deg,var(--at-warning-tint),var(--at-warning-tint) 4px,var(--at-warning-border) 4px,var(--at-warning-border) 8px)', border: '1px solid #fcd34d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: 'var(--at-warning-strong)' }}>
                                  🚫 {MOTIVO_LABEL[b.motivo]}
                                </div>
                              )
                            })}
                            {/* Reservas */}
                            {resDia.map(r => {
                              const pend = r.estado === 'pendiente'
                              const top = toPct(r.hora_inicio)
                              const bottom = toPct(r.hora_fin)
                              const prepPrevia = a.minutos_preparacion_previa ?? 0
                              const prepPost = a.minutos_preparacion_posterior ?? 0
                              const topPrevia = prepPrevia > 0 ? toPct(addMinutosToTime(r.hora_inicio, -prepPrevia)) : null
                              const bottomPost = prepPost > 0 ? toPct(addMinutosToTime(r.hora_fin, prepPost)) : null
                              return (
                                <Fragment key={r.id}>
                                  {topPrevia !== null && (
                                    <div title={`Preparación previa: ${prepPrevia} min`} style={{ position: 'absolute', left: 6, right: 6, top: `${topPrevia}%`, height: `${top - topPrevia}%`, borderRadius: '6px 6px 0 0', background: `${paleta.color}22`, border: `1px dashed ${paleta.border}`, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: paleta.color, fontWeight: 700 }}>
                                      🔧 {prepPrevia}m
                                    </div>
                                  )}
                                  <div data-role="reserva"
                                    onClick={(e) => { e.stopPropagation(); setSelectedReserva(selectedReserva?.id === r.id ? null : r) }}
                                    title={`${r.unidad_nombre} · ${r.hora_inicio}–${r.hora_fin}${pend ? ' (pendiente)' : ''}`}
                                    style={{
                                      position: 'absolute', left: 6, right: 6,
                                      top: `${top}%`, height: `${Math.max(bottom - top, 4)}%`,
                                      borderRadius: 8, padding: '4px 8px',
                                      background: pend ? 'var(--at-surface)' : `linear-gradient(135deg, ${paleta.bg}, ${paleta.border})`,
                                      border: `${pend ? '1.5px dashed' : '1px solid'} ${paleta.border}`,
                                      color: paleta.color, cursor: 'pointer',
                                      boxShadow: pend ? 'none' : '0 2px 6px -2px rgba(0,0,0,0.15)',
                                      overflow: 'hidden', transition: 'transform 0.12s ease',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.03)' }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}>
                                    <div style={{ fontSize: 10.5, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pend && '⏳ '}{r.unidad_nombre}</div>
                                    <div style={{ fontSize: 9.5, opacity: 0.85, fontWeight: 600 }}>{r.hora_inicio}–{r.hora_fin}</div>
                                  </div>
                                  {bottomPost !== null && (
                                    <div title={`Preparación posterior: ${prepPost} min`} style={{ position: 'absolute', left: 6, right: 6, top: `${bottom}%`, height: `${bottomPost - bottom}%`, borderRadius: '0 0 6px 6px', background: `${paleta.color}22`, border: `1px dashed ${paleta.border}`, borderTop: 'none', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: paleta.color, fontWeight: 700 }}>
                                      🔧 {prepPost}m
                                    </div>
                                  )}
                                </Fragment>
                              )
                            })}
                            {/* Hover para crear */}
                            {canCreate && !bloqDiaCompleto && resDia.length === 0 && bloqDia.length === 0 && (
                              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--at-line-strong)', fontSize: 22, pointerEvents: 'none' }}>+</div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}

                {/* Leyenda */}
                <div style={{ display: 'flex', gap: 14, marginTop: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--at-ink-3)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 10, borderRadius: 4, background: 'var(--at-primary-soft)', border: '1px solid var(--at-accent-2)' }} /> Confirmada
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 10, borderRadius: 4, background: 'var(--at-surface)', border: '1.5px dashed var(--at-accent-2)' }} /> Pendiente
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 10, borderRadius: 4, background: 'repeating-linear-gradient(45deg,var(--at-warning-tint),var(--at-warning-tint) 3px,var(--at-warning-border) 3px,var(--at-warning-border) 6px)', border: '1px solid #fcd34d' }} /> Bloqueado
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 10, borderRadius: 4, background: '#E6CDBB44', border: '1px dashed var(--at-accent-light)' }} /> Preparación
                  </span>
                </div>
              </div>
            )
          })()}

          {/* Detalle de reserva seleccionada */}
          {selectedReserva && (
            <div style={{ marginTop: 16, background: 'var(--at-surface)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: 12, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--at-ink)' }}>{selectedReserva.amenidad_nombre}</div>
                <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>
                  {selectedReserva.unidad_nombre} · {selectedReserva.fecha} · {selectedReserva.hora_inicio}–{selectedReserva.hora_fin}
                  {selectedReserva.num_invitados > 0 && ` · ${selectedReserva.num_invitados} invitados`}
                </div>
                {selectedReserva.notas && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{selectedReserva.notas}</div>}
              </div>
              <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: ESTADO_COLORS[selectedReserva.estado]?.bg, color: ESTADO_COLORS[selectedReserva.estado]?.color }}>
                {selectedReserva.estado}
              </span>
              {selectedReserva.estado !== 'cancelada' && canEdit && (
                <button onClick={() => cancelarReserva(selectedReserva.id)}
                  style={{ padding: '5px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                  Cancelar
                </button>
              )}
              <button onClick={() => setSelectedReserva(null)}
                style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: 'var(--at-ink-3)' }}>✕</button>
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--at-ink-3)' }}>
            Haz clic en una reserva para ver detalles · Haz clic en <strong>+</strong> para crear una nueva reserva en esa fecha y amenidad.
          </div>
        </div>
  )
}
