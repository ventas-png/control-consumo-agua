// Bloque extraído de VisitantesTab (fase B): JSX idéntico al original.
import type { VisitantesCtx } from './ctx'
import { PLATAFORMA_LABEL, PLATAFORMA_COLOR } from './ui'

export function StrModal({ ctx }: { ctx: VisitantesCtx }) {
  const { visitantes, reservasSTR, setShowStrModal, strSearch, setStrSearch, strHuespedes, hoy, abrirRegistroSTR } = ctx
  return (
        <div onClick={e => { if (e.target === e.currentTarget) { setShowStrModal(false); setStrSearch('') } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '660px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginBottom: '16px', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg,var(--at-accent-hover),var(--at-accent-dark))', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Renta Corta</div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'white' }}>🏠 Registrar ingreso STR</h3>
              </div>
              <button onClick={() => { setShowStrModal(false); setStrSearch('') }}
                style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', fontSize: 18, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ×
              </button>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <input value={strSearch} onChange={e => setStrSearch(e.target.value)}
                placeholder="Buscar por nombre de huésped o unidad..."
                autoFocus
                style={{ width: '100%', boxSizing: 'border-box', padding: '11px 14px', border: '1.5px solid var(--at-line)', borderRadius: '10px', fontSize: '14px', background: 'var(--at-surface-2)', marginBottom: '14px' }} />
              {(() => {
                const reservasFiltradas = reservasSTR
                  .filter(r => (r.estado === 'confirmada' || r.estado === 'en_curso') && r.fecha_salida >= hoy)
                  .filter(r => !strSearch || r.huesped_nombre.toLowerCase().includes(strSearch.toLowerCase()) || (r.unidad_nombre ?? '').toLowerCase().includes(strSearch.toLowerCase()))
                  .sort((a, b) => {
                    const aHoy = a.fecha_entrada <= hoy
                    const bHoy = b.fecha_entrada <= hoy
                    if (aHoy !== bHoy) return aHoy ? -1 : 1
                    return a.fecha_entrada.localeCompare(b.fecha_entrada)
                  })
                if (reservasFiltradas.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--at-ink-3)' }}>
                      <div style={{ fontSize: '32px', marginBottom: '10px' }}>🏠</div>
                      <p style={{ fontWeight: 600, color: 'var(--at-ink-3)', margin: 0 }}>
                        {strSearch ? 'No se encontraron reservas con ese nombre' : 'No hay reservas STR activas o próximas'}
                      </p>
                    </div>
                  )
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '500px', overflowY: 'auto' }}>
                    {reservasFiltradas.map(r => {
                      const noches = Math.max(0, Math.round((new Date(r.fecha_salida).getTime() - new Date(r.fecha_entrada).getTime()) / 86400000))
                      const plat = PLATAFORMA_COLOR[r.plataforma] ?? PLATAFORMA_COLOR.otro
                      const capacidad = r.num_adultos + r.num_ninos
                      // Count only people currently in premises (exits and re-entries don't block capacity)
                      const enPremisasAhora = visitantes.filter(v => v.reserva_str_id === r.id && !v.hora_salida).length
                      const lleno = enPremisasAhora >= capacidad
                      const ingresoHabilitado = r.fecha_entrada <= hoy
                      const cuposLibres = Math.max(0, capacidad - enPremisasAhora)
                      const grupoHuespedes = strHuespedes[r.id] ?? []
                      // Classify pre-registered guests by current status
                      const noIngresados = grupoHuespedes.filter(h => !h.visitante_id)
                      const conVisitante = grupoHuespedes.filter(h => h.visitante_id).map(h => ({
                        h, v: visitantes.find(vv => vv.id === h.visitante_id),
                      }))
                      const enPremisasGrupo = conVisitante.filter(({ v }) => v && !v.hora_salida)
                      const salieronGrupo = conVisitante.filter(({ v }) => v && !!v.hora_salida)
                      return (
                        <div key={r.id} style={{ background: lleno ? 'var(--at-success-tint)' : 'var(--at-surface-2)', border: `1.5px solid ${lleno ? 'var(--at-success-border)' : 'var(--at-line)'}`, borderRadius: '12px', padding: '14px 16px' }}>
                          {/* Header */}
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px', gap: '10px' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{r.huesped_nombre}</span>
                                <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: plat.bg, color: plat.color }}>
                                  {PLATAFORMA_LABEL[r.plataforma] ?? r.plataforma}
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '3px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                {r.unidad_nombre && <span>🏠 {r.unidad_nombre}</span>}
                                <span>📅 {r.fecha_entrada} → {r.fecha_salida} · {noches}n</span>
                                <span>👥 {r.num_adultos}A{r.num_ninos > 0 ? `+${r.num_ninos}N` : ''}</span>
                              </div>
                            </div>
                            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, flexShrink: 0, background: lleno ? 'var(--at-success-tint)' : 'var(--at-warning-tint)', color: lleno ? 'var(--at-success)' : 'var(--at-warning-strong)' }}>
                              {enPremisasAhora}/{capacidad} en premisas
                            </span>
                          </div>

                          {/* Currently inside */}
                          {enPremisasGrupo.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                              {enPremisasGrupo.map(({ h }) => (
                                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: '8px' }}>
                                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink)', flex: 1 }}>{h.es_menor ? '👶 ' : ''}{h.nombre}{h.identificacion ? <span style={{ color: 'var(--at-ink-3)', fontWeight: 400 }}> · {h.identificacion}</span> : ''}</span>
                                  <span style={{ fontSize: '11px', color: 'var(--at-success)', fontWeight: 700 }}>✓ En premisas</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Exited — can re-enter */}
                          {salieronGrupo.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                              {salieronGrupo.map(({ h }) => (
                                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: '8px' }}>
                                  <div style={{ flex: 1, fontSize: '12px' }}>
                                    <span style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{h.es_menor ? '👶 ' : ''}{h.nombre}</span>
                                    {h.identificacion && <span style={{ color: 'var(--at-ink-3)' }}> · {h.identificacion}</span>}
                                    <span style={{ marginLeft: 6, fontSize: '10px', color: 'var(--at-warning-strong)', fontWeight: 600 }}>🚪 Salió</span>
                                  </div>
                                  <button
                                    onClick={() => !lleno && abrirRegistroSTR(r, h)}
                                    disabled={lleno}
                                    style={{ padding: '5px 12px', background: !lleno ? 'linear-gradient(135deg,var(--at-warning),var(--at-warning))' : 'var(--at-chip)', color: !lleno ? 'white' : 'var(--at-ink-3)', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: !lleno ? 'pointer' : 'not-allowed', fontSize: '11px', whiteSpace: 'nowrap' }}>
                                    Reingresar
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Not yet entered */}
                          {noIngresados.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                              {noIngresados.map(h => (
                                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '8px' }}>
                                  <div style={{ flex: 1, fontSize: '12px' }}>
                                    <span style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{h.es_menor ? '👶 ' : ''}{h.nombre}</span>
                                    {h.identificacion && <span style={{ color: 'var(--at-ink-3)' }}> · {h.identificacion}</span>}
                                    {h.es_menor && <span style={{ marginLeft: 4, padding: '1px 6px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: '10px', fontSize: '10px', fontWeight: 600 }}>Menor</span>}
                                  </div>
                                  <button
                                    onClick={() => ingresoHabilitado && !lleno && abrirRegistroSTR(r, h)}
                                    disabled={!ingresoHabilitado || lleno}
                                    style={{ padding: '5px 12px', background: ingresoHabilitado && !lleno ? 'linear-gradient(135deg,var(--at-accent-hover),var(--at-accent-dark))' : 'var(--at-chip)', color: ingresoHabilitado && !lleno ? 'white' : 'var(--at-ink-3)', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: ingresoHabilitado && !lleno ? 'pointer' : 'not-allowed', fontSize: '11px', whiteSpace: 'nowrap' }}>
                                    Registrar ingreso
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Empty slots / anonymous new person */}
                          {!lleno && (
                            <button
                              onClick={() => ingresoHabilitado && abrirRegistroSTR(r)}
                              disabled={!ingresoHabilitado}
                              style={{ width: '100%', padding: '8px', background: ingresoHabilitado ? 'var(--at-surface)' : 'var(--at-surface-2)', border: `1.5px dashed ${ingresoHabilitado ? 'var(--at-line-strong)' : 'var(--at-line)'}`, borderRadius: '8px', cursor: ingresoHabilitado ? 'pointer' : 'not-allowed', color: ingresoHabilitado ? 'var(--at-ink-2)' : 'var(--at-ink-3)', fontSize: '12px', fontWeight: 600, boxSizing: 'border-box' }}>
                              + Nueva persona ({cuposLibres} cupo{cuposLibres !== 1 ? 's' : ''} disponible{cuposLibres !== 1 ? 's' : ''})
                            </button>
                          )}

                          {lleno && (
                            <div style={{ textAlign: 'center', padding: '8px', background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: '8px', fontSize: '12px', color: 'var(--at-success-strong)', fontWeight: 600 }}>
                              ✓ Capacidad completa — {enPremisasAhora}/{capacidad} en premisas
                            </div>
                          )}

                          {!ingresoHabilitado && (
                            <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', textAlign: 'center', marginTop: '6px' }}>
                              Ingreso habilitado desde: {r.fecha_entrada}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
  )
}
