// Bloque extraído de VisitantesTab (fase B): JSX idéntico al original.
import type { PrioridadNovedad, TipoNovedad, VisitantesCtx } from './ctx'
import { MultiImageUploader } from '../../../shared/ImageUploader'

export function SalidaPanel({ ctx }: { ctx: VisitantesCtx }) {
  const { visitantes, salidaPendiente, modoSalida, setModoSalida, guardandoSalida, novedadForm, setNovedadForm, fotosNovedad, setFotosNovedad, salidaConAcomp, setSalidaConAcomp, cancelarSalida, confirmarSalida } = ctx
  if (!salidaPendiente) return null
        const acompsActivos = visitantes.filter(v => v.visitante_principal_id === salidaPendiente.id && !v.hora_salida)
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div style={{ background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '480px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--at-chip)' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)' }}>Registrar salida</div>
                <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                  {salidaPendiente.nombre}
                  {salidaPendiente.unidad_nombre ? ` · ${salidaPendiente.unidad_nombre}` : ''}
                  {salidaPendiente.es_menor && <span style={{ marginLeft: 6, padding: '1px 7px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Menor</span>}
                  {salidaPendiente.visitante_principal_id && <span style={{ marginLeft: 6, padding: '1px 7px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Acompañante</span>}
                  {salidaPendiente.reserva_str_id && <span style={{ marginLeft: 6, padding: '1px 7px', background: 'var(--at-accent-tint-2)', color: 'var(--at-accent-hover)', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>STR</span>}
                  {salidaPendiente.solicitud_mudanza_id && <span style={{ marginLeft: 6, padding: '1px 7px', background: 'var(--at-warning-tint)', color: 'var(--at-warning)', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Mudanza</span>}
                </div>
              </div>
              <div style={{ padding: '20px 24px' }}>
                <p style={{ margin: '0 0 14px', fontSize: '13.5px', color: 'var(--at-ink-2)', fontWeight: 600 }}>¿Cómo fue la salida?</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                  <button onClick={() => setModoSalida('sin_novedad')}
                    style={{ padding: '14px 12px', borderRadius: '10px', border: `2px solid ${modoSalida === 'sin_novedad' ? 'var(--at-success)' : 'var(--at-line)'}`, background: modoSalida === 'sin_novedad' ? 'var(--at-success-tint)' : 'var(--at-surface-2)', color: modoSalida === 'sin_novedad' ? 'var(--at-success-strong)' : 'var(--at-ink-2)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', textAlign: 'center' }}>
                    ✅ Sin novedad
                    <div style={{ fontSize: '11px', fontWeight: 400, marginTop: '4px', color: modoSalida === 'sin_novedad' ? 'var(--at-success)' : 'var(--at-ink-3)' }}>Todo en orden</div>
                  </button>
                  <button onClick={() => setModoSalida('con_novedad')}
                    style={{ padding: '14px 12px', borderRadius: '10px', border: `2px solid ${modoSalida === 'con_novedad' ? 'var(--at-danger)' : 'var(--at-line)'}`, background: modoSalida === 'con_novedad' ? 'var(--at-danger-tint)' : 'var(--at-surface-2)', color: modoSalida === 'con_novedad' ? 'var(--at-danger)' : 'var(--at-ink-2)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', textAlign: 'center' }}>
                    ⚠️ Con novedad
                    <div style={{ fontSize: '11px', fontWeight: 400, marginTop: '4px', color: modoSalida === 'con_novedad' ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>Registrar incidencia</div>
                  </button>
                </div>

                {acompsActivos.length > 0 && (
                  <div style={{ marginBottom: '16px', padding: '12px 14px', background: 'var(--at-primary-tint)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-primary-hover)', fontWeight: 600 }}>
                      <input type="checkbox" checked={salidaConAcomp} onChange={e => setSalidaConAcomp(e.target.checked)} style={{ marginTop: '2px' }} />
                      <span>
                        También dar salida a {acompsActivos.length} acompañante{acompsActivos.length > 1 ? 's' : ''} en premisas
                        <div style={{ fontWeight: 400, fontSize: '11.5px', color: 'var(--at-primary-2)', marginTop: '2px' }}>
                          {acompsActivos.map(a => a.nombre + (a.es_menor ? ' (menor)' : '')).join(', ')}
                        </div>
                      </span>
                    </label>
                  </div>
                )}

                {modoSalida === 'con_novedad' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', background: 'var(--at-warning-tint)', border: '1.5px solid var(--at-warning-border)', borderRadius: '10px', marginBottom: '16px' }}>
                    <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--at-warning-strong)' }}>Detalle de la novedad</div>
                    <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-warning-border)', borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--at-warning-strong)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Datos del registro (incluidos automáticamente)</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
                        <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>👤 <b>{salidaPendiente.nombre}</b></span>
                        {salidaPendiente.identificacion && <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>🪪 {salidaPendiente.identificacion}</span>}
                        {salidaPendiente.unidad_nombre && <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>📍 {salidaPendiente.unidad_nombre}</span>}
                        {salidaPendiente.placa_vehiculo && <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>🚗 {salidaPendiente.placa_vehiculo}</span>}
                        {salidaPendiente.motivo && <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>· {salidaPendiente.motivo}</span>}
                        <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                          Entrada: {new Date(salidaPendiente.hora_entrada).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Tipo</label>
                        <select value={novedadForm.tipo} onChange={e => setNovedadForm(f => ({ ...f, tipo: e.target.value as TipoNovedad }))}
                          style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)' }}>
                          <option value="incidente">Incidente</option>
                          <option value="observacion">Observación</option>
                          <option value="alarma">Alarma</option>
                          <option value="acceso">Acceso</option>
                          <option value="otro">Otro</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Prioridad</label>
                        <select value={novedadForm.prioridad} onChange={e => setNovedadForm(f => ({ ...f, prioridad: e.target.value as PrioridadNovedad }))}
                          style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)' }}>
                          <option value="normal">Normal</option>
                          <option value="alta">Alta</option>
                          <option value="critica">Crítica</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Ubicación</label>
                      <input value={novedadForm.ubicacion} onChange={e => setNovedadForm(f => ({ ...f, ubicacion: e.target.value }))}
                        placeholder={`Ej. ${salidaPendiente.unidad_nombre ?? 'Entrada principal'}`}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Comentarios / descripción *</label>
                      <textarea value={novedadForm.comentarios} onChange={e => setNovedadForm(f => ({ ...f, comentarios: e.target.value }))}
                        placeholder="Describe con detalle lo ocurrido durante la salida..."
                        rows={3}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)', resize: 'vertical' }} />
                    </div>
                    <div>
                      <MultiImageUploader values={fotosNovedad} onChange={setFotosNovedad} folder="novedades" label="Fotografías de evidencia" capture maxFiles={10} />
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button onClick={cancelarSalida} disabled={guardandoSalida}
                    style={{ padding: '9px 18px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
                    Cancelar
                  </button>
                  <button onClick={confirmarSalida} disabled={guardandoSalida || modoSalida === 'idle'}
                    style={{ padding: '9px 20px', background: modoSalida === 'idle' ? 'var(--at-line)' : modoSalida === 'sin_novedad' ? 'linear-gradient(135deg,var(--at-success),var(--at-success-strong))' : 'linear-gradient(135deg,var(--at-danger),var(--at-danger-strong))', color: modoSalida === 'idle' ? 'var(--at-ink-3)' : 'white', border: 'none', borderRadius: '8px', cursor: modoSalida === 'idle' ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '13px' }}>
                    {guardandoSalida ? 'Registrando...' : modoSalida === 'con_novedad' ? '⚠️ Registrar salida y novedad' : '✓ Confirmar salida'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
}
