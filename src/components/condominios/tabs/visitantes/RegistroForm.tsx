// Bloque extraído de VisitantesTab (fase B): JSX idéntico al original.
import type { VisitantesCtx } from './ctx'
import { ImageUploader } from '../../../shared/ImageUploader'
import { defaultAcompForm } from './ctx'
import { ModalPortal } from '../../../shared/ModalPortal'

export function RegistroForm({ ctx }: { ctx: VisitantesCtx }) {
  const { unidades, saving, fotoUrl, setFotoUrl, fotoDocumentoUrl, setFotoDocumentoUrl, fotoVehiculoUrl, setFotoVehiculoUrl, fotosExpiradas, strCtx, mudanzaCtx, form, setForm, formEsMenor, setFormEsMenor, formFechaNacimiento, setFormFechaNacimiento, acompanantes, showAcompForm, setShowAcompForm, acompForm, setAcompForm, sugerencias, acompSugerencias, resetForm, autocompletar, autocompletarAcompanante, agregarAcompanante, quitarAcompanante, handleRegistrar } = ctx
  return (
        <ModalPortal>
        <div
          onClick={e => { if (e.target === e.currentTarget) resetForm() }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '640px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Registrar visitante</h3>
                {strCtx && (
                  <div style={{ fontSize: '11px', color: 'var(--at-accent-hover)', fontWeight: 600, marginTop: '2px' }}>🏠 Renta corta — ingreso al grupo</div>
                )}
                {mudanzaCtx && (
                  <div style={{ fontSize: '11px', color: 'var(--at-warning)', fontWeight: 600, marginTop: '2px' }}>🚛 Mudanza autorizada — ingreso al grupo</div>
                )}
              </div>
              <button onClick={resetForm}
                style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--at-chip)', border: 'none', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--at-ink-3)', lineHeight: 1 }}>
                ×
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Nombre completo *</label>
                <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre del visitante"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                {sugerencias.length > 0 && (
                  <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Frecuente:</span>
                    {sugerencias.map((v, i) => (
                      <button key={i} type="button" onClick={() => autocompletar(v)}
                        style={{ padding: '3px 10px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                        {v.nombre}{v.identificacion ? ` · ${v.identificacion}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Unidad a visitar *</label>
                <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                  <option value="">Seleccionar...</option>
                  {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={formEsMenor} onChange={e => setFormEsMenor(e.target.checked)} />
                    Es menor de edad
                  </label>
                  {formEsMenor && (
                    <span style={{ padding: '2px 8px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Menor</span>
                  )}
                </div>
                {formEsMenor ? (
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha de nacimiento (opcional)</label>
                    <input type="date" value={formFechaNacimiento} onChange={e => setFormFechaNacimiento(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                  </div>
                ) : (
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>DPI / Identificación</label>
                    <input value={form.identificacion} onChange={e => setForm(f => ({ ...f, identificacion: e.target.value }))}
                      placeholder="Número de documento"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                    {sugerencias.length > 0 && (
                      <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Frecuente:</span>
                        {sugerencias.map((v, i) => (
                          <button key={i} type="button" onClick={() => autocompletar(v)}
                            style={{ padding: '3px 10px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                            {v.nombre}{v.identificacion ? ` · ${v.identificacion}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Placa de vehículo</label>
                <input value={form.placa_vehiculo} onChange={e => setForm(f => ({ ...f, placa_vehiculo: e.target.value }))}
                  placeholder="Ej. ABC-123"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Motivo de visita</label>
                <input value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
                  placeholder="Ej. Entrega, Social, Mantenimiento..."
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Notas</label>
                <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Opcional"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                {(fotosExpiradas.foto || fotosExpiradas.documento || fotosExpiradas.vehiculo) && (
                  <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--at-warning-strong)', marginBottom: 10 }}>
                    ⚠️ Una o más fotos tienen más de 90 días. Se recomienda renovarlas.
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
                  <div>
                    <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="visitantes" label="Foto del visitante" capture />
                    {fotosExpiradas.foto && <div style={{ fontSize: 11, color: 'var(--at-warning)', marginTop: 3 }}>⚠️ Mayor a 90 días — renovar</div>}
                  </div>
                  <div>
                    {!formEsMenor && (
                      <>
                        <ImageUploader value={fotoDocumentoUrl} onChange={setFotoDocumentoUrl} folder="visitantes" label="Foto del DPI / Documento" capture />
                        {fotosExpiradas.documento && <div style={{ fontSize: 11, color: 'var(--at-warning)', marginTop: 3 }}>⚠️ Mayor a 90 días — renovar</div>}
                      </>
                    )}
                  </div>
                  <div>
                    <ImageUploader value={fotoVehiculoUrl} onChange={setFotoVehiculoUrl} folder="visitantes" label="Foto del vehículo" capture />
                    {fotosExpiradas.vehiculo && <div style={{ fontSize: 11, color: 'var(--at-warning)', marginTop: 3 }}>⚠️ Mayor a 90 días — renovar</div>}
                  </div>
                </div>
              </div>
            </div>

            {/* Companions section */}
            <div style={{ marginTop: '20px', borderTop: '1.5px solid var(--at-chip)', paddingTop: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  👥 Acompañantes
                  {acompanantes.length > 0 && (
                    <span style={{ padding: '2px 8px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>
                      {acompanantes.length}
                    </span>
                  )}
                </div>
                {!showAcompForm && (
                  <button type="button" onClick={() => setShowAcompForm(true)}
                    style={{ padding: '5px 12px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', border: '1.5px solid var(--at-line)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                    + Agregar acompañante
                  </button>
                )}
              </div>

              {acompanantes.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                  {acompanantes.map(a => (
                    <div key={a.tempId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '8px' }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: a.es_menor ? 'var(--at-warning-tint)' : 'var(--at-primary-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', flexShrink: 0 }}>
                        {a.es_menor ? '👶' : '👤'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink)' }}>{a.nombre}</div>
                        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
                          {a.es_menor
                            ? `Menor${a.fecha_nacimiento ? ` · Nac. ${a.fecha_nacimiento}` : ''}`
                            : a.identificacion ? `DPI: ${a.identificacion}` : 'Sin documento'}
                        </div>
                      </div>
                      <button type="button" onClick={() => quitarAcompanante(a.tempId)}
                        style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--at-danger-tint)', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--at-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showAcompForm && (
                <div style={{ padding: '14px', background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)' }}>Datos del acompañante</div>
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '3px' }}>Nombre *</label>
                    <input value={acompForm.nombre} onChange={e => setAcompForm(f => ({ ...f, nombre: e.target.value }))}
                      placeholder="Nombre completo"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)' }} />
                    {acompSugerencias.length > 0 && (
                      <div style={{ marginTop: '5px', display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Frecuente:</span>
                        {acompSugerencias.map((v, i) => (
                          <button key={i} type="button" onClick={() => autocompletarAcompanante(v)}
                            style={{ padding: '3px 10px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                            {v.nombre}{v.identificacion ? ` · ${v.identificacion}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--at-ink-2)', cursor: 'pointer', fontWeight: 600 }}>
                    <input type="checkbox" checked={acompForm.es_menor} onChange={e => setAcompForm(f => ({ ...f, es_menor: e.target.checked, identificacion: '' }))} />
                    Es menor de edad
                    {acompForm.es_menor && <span style={{ padding: '2px 8px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: '20px', fontSize: '11px' }}>Menor</span>}
                  </label>
                  {acompForm.es_menor ? (
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '3px' }}>Fecha de nacimiento (opcional)</label>
                      <input type="date" value={acompForm.fecha_nacimiento} onChange={e => setAcompForm(f => ({ ...f, fecha_nacimiento: e.target.value }))}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)' }} />
                    </div>
                  ) : (
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '3px' }}>DPI / Identificación (opcional)</label>
                      <input value={acompForm.identificacion} onChange={e => setAcompForm(f => ({ ...f, identificacion: e.target.value }))}
                        placeholder="Número de documento"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)' }} />
                      {acompSugerencias.length > 0 && (
                        <div style={{ marginTop: '5px', display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Frecuente:</span>
                          {acompSugerencias.map((v, i) => (
                            <button key={i} type="button" onClick={() => autocompletarAcompanante(v)}
                              style={{ padding: '3px 10px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                              {v.nombre}{v.identificacion ? ` · ${v.identificacion}` : ''}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fotografías (opcional)</label>
                    <div style={{ display: 'grid', gridTemplateColumns: acompForm.es_menor ? '1fr' : '1fr 1fr', gap: '10px' }}>
                      <div>
                        <div style={{ fontSize: '10.5px', color: 'var(--at-ink-3)', marginBottom: '3px' }}>Foto de la persona</div>
                        <ImageUploader value={acompForm.foto_url} onChange={v => setAcompForm(f => ({ ...f, foto_url: v }))} folder="visitantes" label="Foto" capture />
                      </div>
                      {!acompForm.es_menor && (
                        <div>
                          <div style={{ fontSize: '10.5px', color: 'var(--at-ink-3)', marginBottom: '3px' }}>Foto del documento / DPI</div>
                          <ImageUploader value={acompForm.foto_documento_url} onChange={v => setAcompForm(f => ({ ...f, foto_documento_url: v }))} folder="visitantes" label="DPI" capture />
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={agregarAcompanante}
                      style={{ padding: '7px 16px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                      + Agregar
                    </button>
                    <button type="button" onClick={() => { setShowAcompForm(false); setAcompForm(defaultAcompForm()) }}
                      style={{ padding: '7px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={handleRegistrar} disabled={saving}
                style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Registrando...' : `✓ Registrar entrada${acompanantes.length > 0 ? ` (+${acompanantes.length})` : ''}`}
              </button>
              <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
            </div>
          </div>
        </div>
        </ModalPortal>
  )
}
