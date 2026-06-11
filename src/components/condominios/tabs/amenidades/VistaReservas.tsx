// Vista extraída de AmenidadesTab (fase B): JSX idéntico al original.
import type { AmenidadesCtx } from './ctx'
import { esFinDeSemana, tarifaAplicable } from '../../../../lib/amenidadesReglas'
import { chipStyle, btnAction } from './ui'
import { EmptyState } from './comunes'

export function VistaReservas({ ctx }: { ctx: AmenidadesCtx }) {
  const { amenidades, reservas, unidades, moneda, canCreate, canEdit, showReservaForm, setShowReservaForm, saving, reservaForm, setReservaForm, reservaDetalle, setReservaDetalle, hoy, amenidadesActivas, guardarReserva, cancelarReserva, marcarNoShow, marcarTarifaPagada, aprobarReserva, rechazarReserva } = ctx
  return (
        <>
          {showReservaForm && (
            <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nueva reserva</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Amenidad *</label>
                  <select value={reservaForm.amenidad_id} onChange={e => setReservaForm(f => ({ ...f, amenidad_id: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                    <option value="">Seleccionar...</option>
                    {amenidadesActivas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Unidad *</label>
                  <select value={reservaForm.unidad_id} onChange={e => setReservaForm(f => ({ ...f, unidad_id: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                    <option value="">Seleccionar...</option>
                    {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fecha *</label>
                  <input type="date" value={reservaForm.fecha} onChange={e => setReservaForm(f => ({ ...f, fecha: e.target.value }))} min={hoy}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>N° invitados</label>
                  <input type="number" value={reservaForm.num_invitados} onChange={e => setReservaForm(f => ({ ...f, num_invitados: e.target.value }))} min="0"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Hora inicio *</label>
                  <input type="time" value={reservaForm.hora_inicio} onChange={e => setReservaForm(f => ({ ...f, hora_inicio: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Hora fin *</label>
                  <input type="time" value={reservaForm.hora_fin} onChange={e => setReservaForm(f => ({ ...f, hora_fin: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                {(() => {
                  const am = amenidades.find(a => a.id === reservaForm.amenidad_id)
                  if (!am?.requiere_tarifa) return null
                  const tarifa = tarifaAplicable(am, reservaForm.fecha)
                  if (tarifa <= 0) return null
                  const finde = esFinDeSemana(reservaForm.fecha) && am.tarifa_uso_finde != null
                  return (
                    <div style={{ gridColumn: '1 / -1', background: 'var(--at-warning-tint)', border: '1.5px solid var(--at-warning-border)', borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-warning-strong)', marginBottom: 8 }}>
                        🎟 Tarifa por uso: {moneda} {tarifa.toFixed(2)} {finde && <span style={{ fontSize: 11, fontWeight: 600 }}>(fin de semana)</span>}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                          <input type="radio" name="metodo_pago_admin" checked={reservaForm.metodo_pago_tarifa === 'cargar_unidad'}
                            onChange={() => setReservaForm(f => ({ ...f, metodo_pago_tarifa: 'cargar_unidad' }))} />
                          Cargar a la unidad
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                          <input type="radio" name="metodo_pago_admin" checked={reservaForm.metodo_pago_tarifa === 'pagar_momento'}
                            onChange={() => setReservaForm(f => ({ ...f, metodo_pago_tarifa: 'pagar_momento' }))} />
                          Pagar en sitio
                        </label>
                        {reservaForm.metodo_pago_tarifa === 'pagar_momento' && (
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--at-ink-2)', cursor: 'pointer', marginLeft: 'auto' }}>
                            <input type="checkbox" checked={reservaForm.tarifa_pagada}
                              onChange={e => setReservaForm(f => ({ ...f, tarifa_pagada: e.target.checked }))} />
                            Ya pagado
                          </label>
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={guardarReserva} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Guardando...' : 'Confirmar reserva'}
                </button>
                <button onClick={() => setShowReservaForm(false)} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}
          {(() => {
            const pendientesAprob = reservas.filter(r => r.estado === 'pendiente' && r.fecha >= hoy).length
            if (pendientesAprob === 0) return null
            return (
              <div style={{ background: 'var(--at-warning-tint)', border: '1.5px solid var(--at-warning-border)', borderRadius: 12, padding: '12px 16px', marginBottom: 12, fontSize: 13, color: 'var(--at-warning-strong)', fontWeight: 600 }}>
                ⚠ {pendientesAprob} reserva{pendientesAprob > 1 ? 's' : ''} esperando aprobación.
              </div>
            )
          })()}
          {reservas.length === 0 ? (
            <EmptyState
              icon="📅"
              title="Aún no hay reservas"
              hint="Las reservas que se hagan desde esta vista o desde el portal del residente aparecerán aquí. Puedes crear una manualmente para una unidad."
              action={canCreate ? (
                <button onClick={() => setShowReservaForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 13.5 }}>
                  + Crear reserva manual
                </button>
              ) : null}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {reservas.sort((a, b) => b.fecha.localeCompare(a.fecha)).map(r => {
                const tieneTarifa = r.monto_tarifa != null && r.monto_tarifa > 0
                const pendientePago = tieneTarifa && r.metodo_pago_tarifa === 'pagar_momento' && !r.tarifa_pagada && r.estado !== 'cancelada'
                const accent = r.estado === 'confirmada' ? 'var(--at-success)' : r.estado === 'pendiente' ? 'var(--at-warning)' : 'var(--at-ink-3)'
                return (
                <div key={r.id}
                  style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: 14, padding: '14px 18px 14px 22px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', position: 'relative', overflow: 'hidden', transition: 'box-shadow 0.15s ease, border-color 0.15s ease' }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 18px -8px rgba(15,23,42,0.18)'; e.currentTarget.style.borderColor = 'var(--at-line-strong)' }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = 'var(--at-line)' }}>
                  {/* barra acento lateral */}
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: accent }} />
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 800, fontSize: 14.5, color: 'var(--at-ink)' }}>{r.amenidad_nombre}</div>
                      <span style={chipStyle(r.estado)}>{r.estado === 'confirmada' ? '✓ Confirmada' : r.estado === 'pendiente' ? '⏳ Pendiente' : '✗ Cancelada'}</span>
                      {r.no_show && <span style={chipStyle('no_show')}>👻 No show</span>}
                      {tieneTarifa && (
                        <span style={chipStyle(pendientePago ? 'cobro_pendiente' : 'pagado')}>
                          🎟 {moneda} {Number(r.monto_tarifa).toFixed(2)}
                          {r.metodo_pago_tarifa === 'cargar_unidad' ? ' · unidad' : (r.tarifa_pagada ? ' · pagado' : ' · pendiente')}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 4 }}>
                      🏠 {r.unidad_nombre} · 📅 {r.fecha} · ⏰ {r.hora_inicio}–{r.hora_fin}
                      {r.num_invitados > 0 && ` · 👥 ${r.num_invitados} invitados`}
                    </div>
                    {r.rechazada_motivo && (
                      <div style={{ fontSize: 11.5, color: 'var(--at-danger-strong)', marginTop: 4, fontStyle: 'italic', background: 'var(--at-danger-tint)', padding: '4px 8px', borderRadius: 6, display: 'inline-block' }}>↩ {r.rechazada_motivo}</div>
                    )}
                  </div>
                  {r.estado === 'pendiente' && canEdit && (
                    <>
                      <button onClick={() => aprobarReserva(r)} style={btnAction('var(--at-success-tint)', 'var(--at-success-border)', 'var(--at-success-strong)')}>✓ Aprobar</button>
                      <button onClick={() => rechazarReserva(r)} style={btnAction('var(--at-danger-tint)', 'var(--at-danger-border)', 'var(--at-danger-strong)')}>✗ Rechazar</button>
                    </>
                  )}
                  {pendientePago && canEdit && (
                    <button onClick={() => marcarTarifaPagada(r)} style={btnAction('var(--at-success-tint)', 'var(--at-success-border)', 'var(--at-success)')}>Marcar pagado</button>
                  )}
                  {r.fecha < hoy && r.estado === 'confirmada' && canEdit && (
                    <button onClick={() => marcarNoShow(r)} style={btnAction(r.no_show ? 'var(--at-chip)' : 'var(--at-warning-tint)', r.no_show ? 'var(--at-line-strong)' : 'var(--at-warning-border)', r.no_show ? 'var(--at-ink-3)' : 'var(--at-warning-strong)')}>
                      {r.no_show ? '↶ Quitar no-show' : 'No show'}
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => setReservaDetalle(reservaDetalle?.id === r.id ? null : r)} style={btnAction('var(--at-primary-tint)', 'var(--at-primary-soft-2)', 'var(--at-primary)')}>
                      {reservaDetalle?.id === r.id ? 'Cerrar' : '⋯ Detalle'}
                    </button>
                  )}
                  {r.estado !== 'cancelada' && canEdit && (
                    <button onClick={() => cancelarReserva(r.id)} style={btnAction('var(--at-danger-tint)', 'var(--at-danger-border)', 'var(--at-danger)')}>Cancelar</button>
                  )}
                </div>
              )})}
            </div>
          )}
        </>
  )
}
