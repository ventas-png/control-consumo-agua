// Bloque extraído de VisitantesTab (fase B): JSX idéntico al original.
import type { VisitantesCtx } from './ctx'
import { TIPO_MUDANZA_LABEL } from './ui'

export function MudanzaModal({ ctx }: { ctx: VisitantesCtx }) {
  const { visitantes, setShowMudanzaModal, mudanzaSearch, setMudanzaSearch, hoy, mudanzasElegibles, abrirRegistroMudanza } = ctx
  return (
        <div onClick={e => { if (e.target === e.currentTarget) { setShowMudanzaModal(false); setMudanzaSearch('') } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '660px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginBottom: '16px', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg,var(--at-warning),var(--at-warning))', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Mudanza autorizada</div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'white' }}>🚛 Registrar ingreso de mudanza</h3>
              </div>
              <button onClick={() => { setShowMudanzaModal(false); setMudanzaSearch('') }}
                style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', fontSize: 18, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ×
              </button>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <input value={mudanzaSearch} onChange={e => setMudanzaSearch(e.target.value)}
                placeholder="Buscar por unidad o empresa de mudanza..."
                autoFocus
                style={{ width: '100%', boxSizing: 'border-box', padding: '11px 14px', border: '1.5px solid var(--at-line)', borderRadius: '10px', fontSize: '14px', background: 'var(--at-surface-2)', marginBottom: '14px' }} />
              {(() => {
                const lista = mudanzasElegibles
                  .filter(s => {
                    if (!mudanzaSearch) return true
                    const q = mudanzaSearch.toLowerCase()
                    return (s.unidad_nombre ?? '').toLowerCase().includes(q)
                      || (s.empresa_mudanza ?? '').toLowerCase().includes(q)
                  })
                  .sort((a, b) => {
                    const fa = a.fecha_autorizada ?? a.fecha_solicitada ?? ''
                    const fb = b.fecha_autorizada ?? b.fecha_solicitada ?? ''
                    return fa.localeCompare(fb)
                  })
                if (lista.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--at-ink-3)' }}>
                      <div style={{ fontSize: '32px', marginBottom: '10px' }}>🚛</div>
                      <p style={{ fontWeight: 600, color: 'var(--at-ink-3)', margin: 0 }}>
                        {mudanzaSearch ? 'No se encontraron mudanzas con ese criterio' : 'No hay mudanzas autorizadas pendientes'}
                      </p>
                    </div>
                  )
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '500px', overflowY: 'auto' }}>
                    {lista.map(s => {
                      const fechaEfectiva = s.fecha_autorizada ?? s.fecha_solicitada ?? ''
                      const horaEfectiva = s.hora_autorizada ?? s.hora_solicitada ?? ''
                      const ingresoHabilitado = fechaEfectiva === hoy || s.estado === 'en_curso'
                      const enCurso = s.estado === 'en_curso'
                      const personasDentro = visitantes.filter(v => v.solicitud_mudanza_id === s.id && !v.hora_salida).length
                      return (
                        <div key={s.id} style={{ background: 'var(--at-warning-tint)', border: '1.5px solid var(--at-warning-border)', borderRadius: '12px', padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px', gap: '10px' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>
                                  {TIPO_MUDANZA_LABEL[s.tipo_mudanza] ?? s.tipo_mudanza}
                                </span>
                                <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: enCurso ? 'var(--at-success-tint)' : 'var(--at-warning-tint)', color: enCurso ? 'var(--at-success)' : 'var(--at-warning-strong)' }}>
                                  {enCurso ? 'En curso' : (s.estado === 'programada' ? 'Programada' : 'Aprobada')}
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '3px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                {s.unidad_nombre && <span>🏠 {s.unidad_nombre}</span>}
                                <span>📅 {fechaEfectiva}{horaEfectiva ? ` ${horaEfectiva}` : ''}{s.hora_fin ? ` → ${s.hora_fin}` : ''}</span>
                                {s.empresa_mudanza && <span>🚚 {s.empresa_mudanza}</span>}
                              </div>
                              {(s.telefono || s.ascensor_reservado) && (
                                <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '3px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                  {s.telefono && <span>📞 {s.telefono}</span>}
                                  {s.ascensor_reservado && <span>🛗 Ascensor reservado</span>}
                                </div>
                              )}
                            </div>
                            {personasDentro > 0 && (
                              <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, flexShrink: 0, background: 'var(--at-success-tint)', color: 'var(--at-success)' }}>
                                {personasDentro} en premisas
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => ingresoHabilitado && abrirRegistroMudanza(s)}
                            disabled={!ingresoHabilitado}
                            style={{ width: '100%', padding: '8px', background: ingresoHabilitado ? 'linear-gradient(135deg,var(--at-warning),var(--at-warning))' : 'var(--at-chip)', color: ingresoHabilitado ? 'white' : 'var(--at-ink-3)', border: 'none', borderRadius: '8px', cursor: ingresoHabilitado ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '12px', boxSizing: 'border-box' }}>
                            {ingresoHabilitado ? '+ Registrar ingreso de mudanza' : `Habilitado el ${fechaEfectiva}`}
                          </button>
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
