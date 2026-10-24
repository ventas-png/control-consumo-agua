// Registro de entrada de un visitante (bloque extraído de VisitantesTab), en
// ventana: pantalla completa en el teléfono, Cancelar y Registrar al pie.
// Cerrar descarta lo capturado (fotos y acompañantes incluidos), así que no
// se cierra con un toque fuera de la ventana ni a mitad del guardado.
import type { VisitantesCtx } from './ctx'
import { ImageUploader } from '../../../shared/ImageUploader'
import { EditModal } from '../../../shared/EditModal'
import { Button } from '../../../shared/Button'
import { defaultAcompForm } from './ctx'
import { PreautorizacionPanel } from './PreautorizacionPanel'
import { ETIQUETA_VISITA_LABEL, etiquetaVisita, relacionLabel } from '../../../../lib/visitasFrecuentes'

export function RegistroForm({ ctx }: { ctx: VisitantesCtx }) {
  const { unidades, saving, fotoUrl, setFotoUrl, fotoDocumentoUrl, setFotoDocumentoUrl, fotoVehiculoUrl, setFotoVehiculoUrl, fotosExpiradas, strCtx, mudanzaCtx, form, setForm, formEsMenor, setFormEsMenor, formFechaNacimiento, setFormFechaNacimiento, acompanantes, showAcompForm, setShowAcompForm, acompForm, setAcompForm, sugerencias, acompSugerencias, resetForm, autocompletar, autocompletarAcompanante, agregarAcompanante, quitarAcompanante, handleRegistrar } = ctx
  const { frecuentesSugeridas, visitaFrecuenteSel, evaluacionFrecuente, requiereAutorizacionResidente, autorizacionResidente, seleccionarFrecuente } = ctx
  const cerrar = () => { if (!saving) resetForm() }
  const sufijoAcomp = acompanantes.length > 0 ? ` (+${acompanantes.length})` : ''
  // El botón dice lo que va a pasar: pre-autorizado, con autorización del
  // residente, denegado (no entra) o el registro común. Sin respuesta del
  // residente cuando hace falta, no hay botón que apretar.
  const deniega = requiereAutorizacionResidente && autorizacionResidente.decision === 'deniega'
  const faltaRespuesta = requiereAutorizacionResidente && autorizacionResidente.decision === ''
  const etiquetaRegistrar = visitaFrecuenteSel && evaluacionFrecuente?.cumple
    ? `✓ Registrar ingreso pre-autorizado${sufijoAcomp}`
    : deniega
      ? '⛔ Registrar ingreso denegado'
      : requiereAutorizacionResidente
        ? `✓ Registrar con autorización del residente${sufijoAcomp}`
        : `✓ Registrar entrada${sufijoAcomp}`
  const unidadDe = (id: string) => unidades.find(u => u.id === id)?.nombre
  return (
    <EditModal
      title="Registrar visitante"
      subtitle={strCtx ? '🏠 Renta corta — ingreso al grupo' : mudanzaCtx ? '🚛 Mudanza autorizada — ingreso al grupo' : visitaFrecuenteSel ? '👨‍👩‍👧 Visita frecuente — verificación de pre-autorización' : undefined}
      maxWidth="640px"
      fullScreenOnMobile
      onClose={cerrar}
      closeOnBackdropClick={false}
      closeOnEscape={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={cerrar} disabled={saving}>Cancelar</Button>
          <Button variant={deniega ? 'danger' : 'primary'} onClick={() => void handleRegistrar()} loading={saving} loadingText="Registrando…" disabled={faltaRespuesta}
            title={faltaRespuesta ? 'Confirme con el residente si autoriza el ingreso' : undefined}>
            {etiquetaRegistrar}
          </Button>
        </>
      }
    >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="visita-nombre" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Nombre completo *</label>
                <input id="visita-nombre" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre del visitante"
                  style={{ width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                {frecuentesSugeridas.length > 0 && (
                  <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Pre-autorizados:</span>
                    {frecuentesSugeridas.map(vf => {
                      const etiqueta = etiquetaVisita(vf)
                      const vigente = etiqueta === 'aprobada'
                      return (
                        <button key={vf.id} type="button" onClick={() => seleccionarFrecuente(vf)}
                          aria-label={`Visita frecuente ${vf.nombre}`}
                          style={{ padding: '3px 10px', background: vigente ? 'var(--at-success-tint)' : 'var(--at-warning-tint)', color: vigente ? 'var(--at-success)' : 'var(--at-warning-strong)', border: `1px solid ${vigente ? 'var(--at-success-border)' : 'var(--at-warning-border)'}`, borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                          {vigente ? '✅' : '⚠️'} {vf.nombre}{unidadDe(vf.unidad_id) ? ` · ${unidadDe(vf.unidad_id)}` : ''} · {relacionLabel(vf.relacion)}
                          {!vigente && <span style={{ fontWeight: 400 }}> · {ETIQUETA_VISITA_LABEL[etiqueta].toLowerCase()}</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
                {sugerencias.length > 0 && (
                  <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Anteriores:</span>
                    {sugerencias.map((v, i) => (
                      <button key={i} type="button" onClick={() => autocompletar(v)}
                        style={{ padding: '3px 10px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                        {v.nombre}{v.identificacion ? ` · ${v.identificacion}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {visitaFrecuenteSel && <PreautorizacionPanel ctx={ctx} />}
              <div>
                <label htmlFor="visita-unidad" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Unidad a visitar *</label>
                <select id="visita-unidad" value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                  style={{ width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
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
                    <label htmlFor="visita-nacimiento" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha de nacimiento (opcional)</label>
                    <input id="visita-nacimiento" type="date" value={formFechaNacimiento} onChange={e => setFormFechaNacimiento(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                  </div>
                ) : (
                  <div>
                    <label htmlFor="visita-identificacion" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>DPI / Identificación</label>
                    <input id="visita-identificacion" value={form.identificacion} onChange={e => setForm(f => ({ ...f, identificacion: e.target.value }))}
                      placeholder="Número de documento"
                      style={{ width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                    {sugerencias.length > 0 && (
                      <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Anteriores:</span>
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
                <label htmlFor="visita-placa" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Placa de vehículo</label>
                <input id="visita-placa" value={form.placa_vehiculo} onChange={e => setForm(f => ({ ...f, placa_vehiculo: e.target.value }))}
                  placeholder="Ej. ABC-123"
                  style={{ width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
              </div>
              <div>
                <label htmlFor="visita-motivo" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Motivo de visita</label>
                <input id="visita-motivo" value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
                  placeholder="Ej. Entrega, Social, Mantenimiento..."
                  style={{ width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
              </div>
              <div>
                <label htmlFor="visita-notas" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Notas</label>
                <input id="visita-notas" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Opcional"
                  style={{ width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                {(fotosExpiradas.foto || fotosExpiradas.documento || fotosExpiradas.vehiculo) && (
                  <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--at-warning-strong)', marginBottom: 10 }}>
                    ⚠️ Una o más fotos tienen más de 90 días. Se recomienda renovarlas.
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '14px' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
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
                      <button type="button" onClick={() => quitarAcompanante(a.tempId)} aria-label={`Quitar a ${a.nombre}`}
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
                    <label htmlFor="acomp-nombre" style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '3px' }}>Nombre *</label>
                    <input id="acomp-nombre" value={acompForm.nombre} onChange={e => setAcompForm(f => ({ ...f, nombre: e.target.value }))}
                      placeholder="Nombre completo"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)' }} />
                    {acompSugerencias.length > 0 && (
                      <div style={{ marginTop: '5px', display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Anteriores:</span>
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
                      <label htmlFor="acomp-nacimiento" style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '3px' }}>Fecha de nacimiento (opcional)</label>
                      <input id="acomp-nacimiento" type="date" value={acompForm.fecha_nacimiento} onChange={e => setAcompForm(f => ({ ...f, fecha_nacimiento: e.target.value }))}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)' }} />
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="acomp-identificacion" style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '3px' }}>DPI / Identificación (opcional)</label>
                      <input id="acomp-identificacion" value={acompForm.identificacion} onChange={e => setAcompForm(f => ({ ...f, identificacion: e.target.value }))}
                        placeholder="Número de documento"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)' }} />
                      {acompSugerencias.length > 0 && (
                        <div style={{ marginTop: '5px', display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>Anteriores:</span>
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
                    <div style={{ display: 'grid', gridTemplateColumns: acompForm.es_menor ? '1fr' : 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: '10px' }}>
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
    </EditModal>
  )
}
