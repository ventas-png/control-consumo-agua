// Vista extraída de AmenidadesTab (fase B): JSX idéntico al original.
import type { ReactNode } from 'react'
import type { AmenidadesCtx } from './ctx'
import { updateCondominioRow } from '../../../../domain/condominios/tabMutations'
import { btnAction } from './ui'
import { ImageUploader } from '../../../shared/ImageUploader'
import { SecureImage } from '../../../shared/SecureImage'
import { CheckoutForm } from './comunes'
import { ModalPortal } from '../../../shared/ModalPortal'
import { formatFechaCalendario } from '../../../../lib/format'

export function ReservaDetalle({ ctx }: { ctx: AmenidadesCtx }) {
  const { amenidades, moneda, canEdit, onRefresh, reservaDetalle, setReservaDetalle, registrarCheckin, registrarCheckout, actualizarEstadoDeposito, retenerDeposito, aprobarReserva, rechazarReserva } = ctx
  if (!reservaDetalle) return null
        const r = reservaDetalle
        const amen = amenidades.find(a => a.id === r.amenidad_id)
        // Pasos del ciclo de la reserva
        const steps: { id: string; label: string; done: boolean; current: boolean; meta?: string; render?: ReactNode }[] = []
        steps.push({
          id: 'creada', label: 'Solicitud creada', done: true, current: false,
          meta: new Date(r.created_at).toLocaleString('es'),
        })
        if (amen?.requiere_aprobacion || r.estado === 'pendiente' || r.aprobada_at || r.rechazada_motivo) {
          const apr = !!r.aprobada_at
          const rch = !!r.rechazada_motivo
          steps.push({
            id: 'aprobacion',
            label: rch ? 'Rechazada' : apr ? 'Aprobada' : 'En aprobación',
            done: apr || rch,
            current: !apr && !rch,
            meta: apr && r.aprobada_at ? new Date(r.aprobada_at).toLocaleString('es') : (rch ? r.rechazada_motivo! : 'Esperando admin'),
          })
        }
        // Check-in
        steps.push({
          id: 'checkin', label: 'Check-in', done: !!r.checkin_at,
          current: !r.checkin_at && r.estado === 'confirmada',
          meta: r.checkin_at ? new Date(r.checkin_at).toLocaleString('es') : 'Pendiente',
          render: (
            <>
              {r.checkin_foto_url && (
                <SecureImage src={r.checkin_foto_url} alt="check-in" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10, marginTop: 8 }} />
              )}
              {!r.checkin_at && canEdit && r.estado === 'confirmada' && (
                <div style={{ marginTop: 10 }}>
                  <ImageUploader value={null} onChange={(url) => registrarCheckin(r, url)} folder="amenidades-checkin" label="Foto del estado inicial" />
                  <button onClick={() => registrarCheckin(r, null)} style={{ marginTop: 6, padding: '6px 12px', background: 'transparent', color: 'var(--at-primary)', border: '1px dashed var(--at-primary-mint)', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                    Registrar sin foto
                  </button>
                </div>
              )}
              {r.checkin_at && canEdit && !r.checkin_foto_url && !r.checkout_at && (
                <div style={{ marginTop: 8 }}>
                  <ImageUploader value={null} onChange={async (url) => {
                    if (!url) return
                    await updateCondominioRow('reservas_amenidades', r.id, { checkin_foto_url: url })
                    onRefresh()
                    setReservaDetalle(d => d ? { ...d, checkin_foto_url: url } : d)
                  }} folder="amenidades-checkin" label="Agregar foto" />
                </div>
              )}
            </>
          ),
        })
        // Check-out
        steps.push({
          id: 'checkout', label: 'Check-out', done: !!r.checkout_at,
          current: !!r.checkin_at && !r.checkout_at,
          meta: r.checkout_at ? new Date(r.checkout_at).toLocaleString('es') : (r.checkin_at ? 'Pendiente' : '—'),
          render: r.checkin_at ? (
            <>
              {r.checkout_foto_url && (
                <SecureImage src={r.checkout_foto_url} alt="check-out" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 10, marginTop: 8 }} />
              )}
              {r.observaciones_uso && (
                <div style={{ fontSize: 12.5, color: 'var(--at-ink-2)', background: 'var(--at-surface-2)', borderRadius: 8, padding: 8, marginTop: 8 }}>
                  <strong>Observaciones:</strong> {r.observaciones_uso}
                </div>
              )}
              {!r.checkout_at && canEdit && (
                <div style={{ marginTop: 10 }}>
                  <CheckoutForm onSave={(foto, obs) => registrarCheckout(r, foto, obs)} />
                </div>
              )}
            </>
          ) : null,
        })
        // Depósito
        if (amen?.requiere_deposito) {
          const cerrado = r.deposito_estado === 'devuelto' || r.deposito_estado === 'retenido'
          steps.push({
            id: 'deposito',
            label: r.deposito_estado === 'devuelto' ? 'Depósito devuelto'
              : r.deposito_estado === 'retenido' ? 'Depósito retenido'
              : r.deposito_estado === 'cobrado' ? 'Depósito cobrado'
              : 'Depósito pendiente',
            done: cerrado,
            current: !cerrado,
            meta: r.deposito_estado === 'retenido' && r.deposito_retenido_motivo
              ? `${moneda} ${Number(r.deposito_retenido_monto || 0).toFixed(2)} retenido — ${r.deposito_retenido_motivo}`
              : r.deposito_devuelto_at ? `Devuelto el ${new Date(r.deposito_devuelto_at).toLocaleDateString('es')}`
              : `${moneda} ${amen.monto_deposito?.toFixed(2)} en garantía`,
            render: canEdit ? (
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {r.deposito_estado === 'pendiente' && (
                  <button onClick={() => actualizarEstadoDeposito(r, 'cobrado')} style={btnAction('var(--at-primary-soft)', 'var(--at-accent-2)', 'var(--at-primary-hover)')}>💵 Marcar cobrado</button>
                )}
                {r.deposito_estado === 'cobrado' && (
                  <>
                    <button onClick={() => actualizarEstadoDeposito(r, 'devuelto')} style={btnAction('var(--at-success-tint)', 'var(--at-success-border)', 'var(--at-success-strong)')}>↩ Devolver completo</button>
                    <button onClick={() => retenerDeposito(r)} style={btnAction('var(--at-danger-tint)', 'var(--at-danger-border)', 'var(--at-danger-strong)')}>⚠ Retener por daños</button>
                  </>
                )}
              </div>
            ) : null,
          })
        }
        const accent = r.estado === 'confirmada' ? 'var(--at-accent-2)' : r.estado === 'pendiente' ? 'var(--at-warning)' : 'var(--at-ink-3)'
        return (
          <ModalPortal>
          <div onClick={() => setReservaDetalle(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, animation: 'fadeIn 0.15s ease' }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: 'var(--at-surface)', borderRadius: 18, maxWidth: 700, width: '100%', maxHeight: '92vh', overflow: 'auto', boxShadow: '0 30px 60px -20px rgba(0,0,0,0.4)' }}>
              {/* Header gradiente */}
              <div style={{ padding: '20px 24px', background: `linear-gradient(135deg, ${accent}, ${accent}dd)`, color: 'white', borderRadius: '18px 18px 0 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.85, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Reserva · {r.estado}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2 }}>{r.amenidad_nombre}</div>
                  <div style={{ fontSize: 13, opacity: 0.92, marginTop: 4 }}>
                    🏠 {r.unidad_nombre} · 📅 {formatFechaCalendario(r.fecha, { weekday: 'long', day: '2-digit', month: 'long' }, 'es', '—')} · ⏰ {r.hora_inicio}–{r.hora_fin}
                  </div>
                </div>
                <button onClick={() => setReservaDetalle(null)} style={{ background: 'rgba(255,255,255,0.18)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>✕</button>
              </div>

              {/* Stepper */}
              <div style={{ padding: 24 }}>
                <div style={{ position: 'relative' }}>
                  {steps.map((s, i) => {
                    const isLast = i === steps.length - 1
                    const dotColor = s.done ? 'var(--at-success)' : s.current ? accent : 'var(--at-line-strong)'
                    const lineColor = s.done ? 'var(--at-success-border)' : 'var(--at-line)'
                    return (
                      <div key={s.id} style={{ display: 'flex', gap: 14, position: 'relative', paddingBottom: isLast ? 0 : 18 }}>
                        {/* Línea vertical */}
                        {!isLast && (
                          <div style={{ position: 'absolute', left: 13, top: 28, bottom: 0, width: 2, background: lineColor }} />
                        )}
                        {/* Bullet */}
                        <div style={{
                          width: 28, height: 28, borderRadius: '50%',
                          background: s.done ? 'var(--at-success-tint)' : s.current ? `${accent}22` : 'var(--at-chip)',
                          border: `2px solid ${dotColor}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: dotColor, fontWeight: 800, fontSize: 13,
                          flexShrink: 0, zIndex: 1, position: 'relative',
                          boxShadow: s.current ? `0 0 0 4px ${accent}22` : 'none',
                        }}>
                          {s.done ? '✓' : i + 1}
                        </div>
                        {/* Contenido */}
                        <div style={{ flex: 1, paddingTop: 2 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <div style={{ fontWeight: 800, fontSize: 14, color: s.done ? 'var(--at-ink)' : s.current ? 'var(--at-ink)' : 'var(--at-ink-3)' }}>{s.label}</div>
                            {s.id === 'aprobacion' && r.estado === 'pendiente' && canEdit && (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => aprobarReserva(r)} style={btnAction('var(--at-success-tint)', 'var(--at-success-border)', 'var(--at-success-strong)')}>✓ Aprobar</button>
                                <button onClick={() => rechazarReserva(r)} style={btnAction('var(--at-danger-tint)', 'var(--at-danger-border)', 'var(--at-danger-strong)')}>✗ Rechazar</button>
                              </div>
                            )}
                          </div>
                          {s.meta && <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>{s.meta}</div>}
                          {s.render && <div>{s.render}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Datos extra: tarifa y notas */}
                {(r.monto_tarifa || r.notas) && (
                  <div style={{ marginTop: 18, padding: 14, background: 'var(--at-surface-2)', borderRadius: 12 }}>
                    {r.monto_tarifa != null && r.monto_tarifa > 0 && (
                      <div style={{ fontSize: 12.5, color: 'var(--at-ink-2)', marginBottom: r.notas ? 6 : 0 }}>
                        🎟 <strong>Tarifa:</strong> {moneda} {Number(r.monto_tarifa).toFixed(2)} ·
                        {r.metodo_pago_tarifa === 'cargar_unidad' ? ' cargado a unidad' : (r.tarifa_pagada ? ' pagado en sitio' : ' por cobrar en sitio')}
                      </div>
                    )}
                    {r.notas && <div style={{ fontSize: 12.5, color: 'var(--at-ink-2)' }}>📝 {r.notas}</div>}
                  </div>
                )}
              </div>
            </div>
          </div>
          </ModalPortal>
        )
}
