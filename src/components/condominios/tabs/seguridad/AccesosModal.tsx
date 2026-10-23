// Modal de verificación/registro de accesos (DPI y renta corta) (P1 #3,
// extraído de SeguridadTab). En ventana a pantalla completa en el teléfono, que
// es donde se usa en la garita; Esc la cierra, salvo mientras registra.
import { hoyLocalISO } from '../../../../lib/format'
import { SecureImage } from '../../../shared/SecureImage'
import { ImageUploader } from '../../../shared/ImageUploader'
import type { SeguridadCtx } from './ctx'
import { filtrarReservasSTRAcceso, nochesReserva } from '../../../../lib/seguridadReglas'
import { PLATAFORMA_COLOR, PLATAFORMA_LABEL } from './ui'
import { EditModal } from '../../../shared/EditModal'

export function AccesosModal({ ctx }: { ctx: SeguridadCtx }) {
  const {
    unidades, reservasSTR, proyectoId, canCreate,
    modoModal, strSearch, setStrSearch, dpiSearch, setDpiSearch,
    searchResult, setSearchResult, searchResultVisitantes, setSearchResultVisitantes,
    searching, showRegForm, setShowRegForm, regSaving,
    fotoPersonaUrl, setFotoPersonaUrl, fotoDocumentoUrl, setFotoDocumentoUrl,
    fotoVehiculoUrl, setFotoVehiculoUrl, fotosExpiradas, regForm, setRegForm,
    strIngresados,
    resetAccesos, cambiarModo, precargarDesdeSTR, buscarPorDpi, handleRegistrarAcceso,
  } = ctx

  const cerrar = () => { if (!regSaving) resetAccesos() }

  return (
    <EditModal
      title="🚪 Registro de acceso"
      subtitle={modoModal === 'dpi' ? 'Busque por DPI para ver historial o registrar entrada' : 'Seleccione una reserva STR para registrar el ingreso'}
      maxWidth="680px"
      fullScreenOnMobile
      onClose={cerrar}
      closeOnBackdropClick={!regSaving}
      closeOnEscape={!regSaving}
    >
        <div>

          {/* Tabs de modo */}
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1.5px solid var(--at-chip)', paddingBottom: '16px', flexWrap: 'wrap' }}>
            <button onClick={() => cambiarModo('dpi')} aria-pressed={modoModal === 'dpi'}
              style={{ padding: '8px 16px', borderRadius: '9px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: '1.5px solid', borderColor: modoModal === 'dpi' ? 'var(--at-accent-hover)' : 'var(--at-line)', background: modoModal === 'dpi' ? 'var(--at-accent-tint-2)' : 'var(--at-surface)', color: modoModal === 'dpi' ? 'var(--at-accent-hover)' : 'var(--at-ink-3)' }}>
              🔍 Verificar por DPI
            </button>
            <button onClick={() => cambiarModo('str')} aria-pressed={modoModal === 'str'}
              style={{ padding: '8px 16px', borderRadius: '9px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: '1.5px solid', borderColor: modoModal === 'str' ? 'var(--at-accent-hover)' : 'var(--at-line)', background: modoModal === 'str' ? 'var(--at-accent-tint-2)' : 'var(--at-surface)', color: modoModal === 'str' ? 'var(--at-accent-hover)' : 'var(--at-ink-3)' }}>
              🏠 Renta corta
            </button>
          </div>

          {/* ── MODO DPI ── */}
          {modoModal === 'dpi' && (
            <>
          {/* Buscador DPI */}
          <div style={{ marginBottom: '20px' }}>
            <label htmlFor="accesos-dpi" style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>DPI / Identificación</label>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input
                id="accesos-dpi"
                value={dpiSearch}
                onChange={e => setDpiSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void buscarPorDpi() }}
                placeholder="Ingrese número de DPI o identificación..."
                autoFocus
                style={{ flex: '1 1 200px', minWidth: 0, boxSizing: 'border-box', padding: '11px 14px', border: '1.5px solid var(--at-line)', borderRadius: '10px', fontSize: '14px', background: 'var(--at-surface-2)', color: 'var(--at-ink)' }}
              />
              <button
                onClick={buscarPorDpi}
                disabled={searching || !dpiSearch.trim()}
                style={{ padding: '11px 20px', background: 'linear-gradient(135deg,var(--at-accent-hover),var(--at-accent-dark))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: searching || !dpiSearch.trim() ? 'not-allowed' : 'pointer', opacity: searching || !dpiSearch.trim() ? 0.65 : 1, minWidth: '110px', fontSize: '13.5px' }}>
                {searching ? 'Buscando...' : '🔍 Buscar'}
              </button>
              {searchResult !== 'idle' && (
                <button onClick={() => { setDpiSearch(''); setSearchResult('idle'); setSearchResultVisitantes([]); setShowRegForm(false); }}
                  style={{ padding: '11px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: '1.5px solid var(--at-line)', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
                  Limpiar
                </button>
              )}
            </div>
          </div>

          {/* Resultado: visitante encontrado */}
          {searchResult === 'found' && (
            <div>
              <div style={{ background: 'var(--at-success-tint)', border: '1.5px solid var(--at-success-border)', borderRadius: '12px', padding: '14px 16px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  {searchResultVisitantes[0]?.foto_url
                    ? <SecureImage src={searchResultVisitantes[0].foto_url} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--at-success-border)', flexShrink: 0 }} />
                    : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg,var(--at-success),var(--at-success-strong))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--at-on-status)', fontWeight: 800, fontSize: '18px', flexShrink: 0 }}>
                        {searchResultVisitantes[0]?.nombre.charAt(0).toUpperCase()}
                      </div>
                  }
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-success-strong)', overflowWrap: 'anywhere' }}>
                      {searchResultVisitantes[0]?.nombre}
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                      DPI: {dpiSearch} · {searchResultVisitantes.length} visita{searchResultVisitantes.length !== 1 ? 's' : ''} registrada{searchResultVisitantes.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                </div>
                {canCreate && (
                  <button onClick={() => setShowRegForm(true)}
                    style={{ padding: '8px 16px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13px', flexShrink: 0 }}>
                    + Registrar nueva entrada
                  </button>
                )}
              </div>

              {/* Historial */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', maxHeight: showRegForm ? '160px' : '280px', overflowY: 'auto', marginBottom: showRegForm ? '16px' : '0' }}>
                {searchResultVisitantes.map(v => {
                  const enPremisa = !v.hora_salida
                  return (
                    <div key={v.id} style={{ background: enPremisa ? 'var(--at-success-tint)' : 'var(--at-surface-2)', border: `1.5px solid ${enPremisa ? 'var(--at-success-border)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '10px 14px', display: 'flex', gap: '6px 10px', alignItems: 'center', flexWrap: 'wrap' }}>
                      {v.foto_url && <SecureImage src={v.foto_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />}
                      <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--at-ink)' }}>
                          {new Date(v.hora_entrada).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                          {' · '}
                          {new Date(v.hora_entrada).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                        <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '8px', marginTop: '1px', flexWrap: 'wrap' }}>
                          {v.unidad_nombre && <span>📍 {v.unidad_nombre}</span>}
                          {v.motivo && <span>· {v.motivo}</span>}
                          {v.placa_vehiculo && <span>· 🚗 {v.placa_vehiculo}</span>}
                          {v.project_id !== proyectoId && <span style={{ color: 'var(--at-accent-hover)', fontWeight: 600 }}>· Otro proyecto</span>}
                        </div>
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        {enPremisa
                          ? <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', background: 'var(--at-success-tint)', color: 'var(--at-success)', fontWeight: 700 }}>En premisas</span>
                          : <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
                              Salida {new Date(v.hora_salida!).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        }
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Resultado: no encontrado */}
          {searchResult === 'not_found' && (
            <div style={{ background: 'var(--at-danger-tint)', border: '1.5px solid var(--at-danger-border)', borderRadius: '12px', padding: '14px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-danger)' }}>No se encontró ningún visitante con ese DPI</div>
                <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>Complete el formulario para registrarlo como nuevo visitante.</div>
              </div>
              {canCreate && !showRegForm && (
                <button onClick={() => setShowRegForm(true)}
                  style={{ padding: '8px 16px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1.5px solid var(--at-danger-border)', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13px', flexShrink: 0 }}>
                  + Registrar nuevo
                </button>
              )}
            </div>
          )}

            </>
          )}

          {/* ── MODO STR ── */}
          {modoModal === 'str' && (
            <>
              {/* Buscador de huésped */}
              <div style={{ marginBottom: '16px' }}>
                <input
                  aria-label="Buscar reserva"
                  value={strSearch}
                  onChange={e => setStrSearch(e.target.value)}
                  placeholder="Buscar por nombre de huésped o unidad..."
                  autoFocus
                  style={{ width: '100%', boxSizing: 'border-box', padding: '11px 14px', border: '1.5px solid var(--at-line)', borderRadius: '10px', fontSize: '14px', background: 'var(--at-surface-2)' }}
                />
              </div>

              {/* Lista de reservas STR activas/próximas */}
              {(() => {
                const hoy = hoyLocalISO()
                const reservasFiltradas = filtrarReservasSTRAcceso(reservasSTR, hoy, strSearch, strIngresados)

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
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: showRegForm ? '140px' : '320px', overflowY: 'auto' }}>
                    {reservasFiltradas.map(r => {
                      const noches = nochesReserva(r.fecha_entrada, r.fecha_salida)
                      const plat = PLATAFORMA_COLOR[r.plataforma] ?? PLATAFORMA_COLOR.otro
                      const enCurso = r.estado === 'en_curso'
                      return (
                        <div key={r.id} style={{ background: enCurso ? 'var(--at-success-tint)' : 'var(--at-surface-2)', border: `1.5px solid ${enCurso ? 'var(--at-success-border)' : 'var(--at-line)'}`, borderRadius: '12px', padding: '12px 14px', display: 'flex', gap: '8px 12px', alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{r.huesped_nombre}</span>
                              <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: plat.bg, color: plat.color }}>
                                {PLATAFORMA_LABEL[r.plataforma] ?? r.plataforma}
                              </span>
                              {enCurso && <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'var(--at-success-tint)', color: 'var(--at-success)' }}>En curso</span>}
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '3px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                              {r.unidad_nombre && <span>🏠 {r.unidad_nombre}</span>}
                              <span>📅 {r.fecha_entrada} → {r.fecha_salida}</span>
                              <span>· {noches} noche{noches !== 1 ? 's' : ''}</span>
                              {r.num_adultos > 0 && <span>· 👥 {r.num_adultos + r.num_ninos}</span>}
                            </div>
                          </div>
                          {canCreate && (() => {
                            const ingresoHabilitado = r.fecha_entrada <= hoy
                            return (
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                                <button onClick={() => ingresoHabilitado && precargarDesdeSTR(r)}
                                  title={!ingresoHabilitado ? `Ingreso habilitado desde: ${r.fecha_entrada}` : undefined}
                                  style={{ padding: '7px 14px', background: ingresoHabilitado ? 'linear-gradient(135deg,var(--at-accent-hover),var(--at-accent-dark))' : 'var(--at-chip)', color: ingresoHabilitado ? 'white' : 'var(--at-ink-3)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: ingresoHabilitado ? 'pointer' : 'not-allowed', fontSize: '12.5px', whiteSpace: 'nowrap' }}>
                                  Registrar ingreso
                                </button>
                                {!ingresoHabilitado && <span style={{ fontSize: '10.5px', color: 'var(--at-ink-3)' }}>Desde {r.fecha_entrada}</span>}
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </>
          )}

          {/* Formulario de registro (compartido entre modos DPI y STR) */}
          {showRegForm && canCreate && (
            <div style={{ borderTop: '1.5px solid var(--at-line)', paddingTop: '18px', marginTop: '16px' }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)' }}>
                {modoModal === 'str' ? 'Registrar ingreso del huésped' : searchResult === 'found' ? 'Registrar nueva entrada' : 'Registrar nuevo visitante'}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '12px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="acceso-nombre" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Nombre completo *</label>
                  <input id="acceso-nombre" value={regForm.nombre} onChange={e => setRegForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre del visitante"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label htmlFor="acceso-unidad" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Unidad a visitar *</label>
                  <select id="acceso-unidad" value={regForm.unidad_id} onChange={e => setRegForm(f => ({ ...f, unidad_id: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                    <option value="">Seleccionar...</option>
                    {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="acceso-identificacion" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>DPI / Identificación</label>
                  <input id="acceso-identificacion" value={regForm.identificacion} onChange={e => setRegForm(f => ({ ...f, identificacion: e.target.value }))} placeholder="Número de documento"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label htmlFor="acceso-placa" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Placa de vehículo</label>
                  <input id="acceso-placa" value={regForm.placa_vehiculo} onChange={e => setRegForm(f => ({ ...f, placa_vehiculo: e.target.value }))} placeholder="Ej. ABC-123"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label htmlFor="acceso-motivo" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Motivo de visita</label>
                  <input id="acceso-motivo" value={regForm.motivo} onChange={e => setRegForm(f => ({ ...f, motivo: e.target.value }))} placeholder="Ej. Entrega, Social..."
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label htmlFor="acceso-notas" style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Notas</label>
                  <input id="acceso-notas" value={regForm.notas} onChange={e => setRegForm(f => ({ ...f, notas: e.target.value }))} placeholder="Opcional"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  {(fotosExpiradas.foto || fotosExpiradas.documento || fotosExpiradas.vehiculo) && (
                    <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--at-warning-strong)', marginBottom: 10 }}>
                      ⚠️ Una o más fotos tienen más de 90 días. Se recomienda renovarlas.
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '12px' }}>
                    <div>
                      <ImageUploader value={fotoPersonaUrl} onChange={setFotoPersonaUrl} folder="visitantes" label="Foto del visitante" capture />
                      {fotosExpiradas.foto && <div style={{ fontSize: 11, color: 'var(--at-warning)', marginTop: 3 }}>⚠️ Mayor a 90 días — renovar</div>}
                    </div>
                    <div>
                      <ImageUploader value={fotoDocumentoUrl} onChange={setFotoDocumentoUrl} folder="visitantes" label="Foto DPI / Documento" capture />
                      {fotosExpiradas.documento && <div style={{ fontSize: 11, color: 'var(--at-warning)', marginTop: 3 }}>⚠️ Mayor a 90 días — renovar</div>}
                    </div>
                    <div>
                      <ImageUploader value={fotoVehiculoUrl} onChange={setFotoVehiculoUrl} folder="visitantes" label="Foto del vehículo" capture />
                      {fotosExpiradas.vehiculo && <div style={{ fontSize: 11, color: 'var(--at-warning)', marginTop: 3 }}>⚠️ Mayor a 90 días — renovar</div>}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
                <button onClick={() => void handleRegistrarAcceso()} disabled={regSaving}
                  style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: regSaving ? 'not-allowed' : 'pointer', opacity: regSaving ? 0.7 : 1 }}>
                  {regSaving ? 'Registrando...' : '✓ Registrar entrada'}
                </button>
                <button onClick={() => setShowRegForm(false)} disabled={regSaving}
                  style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: regSaving ? 'default' : 'pointer', fontWeight: 600 }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </div>
    </EditModal>
  )
}
