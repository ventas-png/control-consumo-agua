// Ficha de la reserva en ventana (EditModal, pantalla completa en el
// teléfono): datos en tarjetas, el seguimiento (aprobación, check-in, equipo,
// check-out, depósito) y las acciones en el pie junto a Cerrar. Antes era un
// panel propio sin Escape ni foco atrapado, y las acciones iban en la lista.
import type { ReactNode } from 'react'
import type { AmenidadesCtx } from './ctx'
import { updateCondominioRow } from '../../../../domain/condominios/tabMutations'
import { btnAction, chipStyle } from './ui'
import { ImageUploader } from '../../../shared/ImageUploader'
import { SecureImage } from '../../../shared/SecureImage'
import { CheckoutForm } from './comunes'
import { EditModal } from '../../../shared/EditModal'
import { Button } from '../../../shared/Button'
import { formatFechaCalendario } from '../../../../lib/format'
import { tint } from '../../../shared/statusTone'
import { EquiposReserva } from './EquiposReserva'
import { prestamosDeReserva, rentaDeReserva, resumenEquiposReserva, totalCobroReserva } from '../../../../lib/prestamosEquipo'

export function ReservaDetalle({ ctx }: { ctx: AmenidadesCtx }) {
  const { amenidades, moneda, canEdit, onRefresh, reservaDetalle, prestamos, amenidadInventario, setReservaDetalle, registrarCheckin, registrarCheckout, actualizarEstadoDeposito, retenerDeposito, aprobarReserva, rechazarReserva, cancelarReserva, marcarNoShow, marcarTarifaPagada, hoy } = ctx
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
        // Equipo pedido con la reserva (20261108000000): entrega al check-in,
        // recepción al check-out. Sólo aparece si se pidió algo o si la
        // amenidad presta equipo (para poder agregarlo).
        {
          const equiposR = prestamosDeReserva(r.id, prestamos)
          const prestaEquipo = amenidadInventario.some(l => l.amenidad_id === r.amenidad_id)
          if (equiposR.length > 0 || (prestaEquipo && r.estado !== 'cancelada')) {
            const res = resumenEquiposReserva(equiposR)
            const hay = equiposR.length > 0
            steps.push({
              id: 'equipo',
              label: !hay ? 'Equipo' : res.pendienteEntrega ? 'Equipo por entregar' : res.pendienteRecepcion ? 'Equipo por recibir' : 'Equipo recibido',
              done: hay && !res.pendienteEntrega && !res.pendienteRecepcion,
              current: res.pendienteEntrega || res.pendienteRecepcion,
              meta: !hay
                ? 'Sin equipo solicitado'
                : [
                    res.solicitados > 0 ? `${res.solicitados} por entregar` : null,
                    res.prestados > 0 ? `${res.prestados} en préstamo` : null,
                    res.cerrados > 0 ? `${res.cerrados} recibido${res.cerrados === 1 ? '' : 's'}` : null,
                    res.cancelados > 0 ? `${res.cancelados} sin entregar` : null,
                    res.reposicion > 0 ? `reposición ${moneda} ${res.reposicion.toFixed(2)}` : null,
                  ].filter(Boolean).join(' · '),
              render: <EquiposReserva ctx={ctx} reserva={r} />,
            })
          }
        }
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
        const tarifa = Number(r.monto_tarifa ?? 0)
        const renta = rentaDeReserva(r.id, prestamos)
        const cobro = totalCobroReserva(r, prestamos)
        const estadoPago = r.metodo_pago_tarifa === 'cargar_unidad' ? 'cargado a unidad' : (r.tarifa_pagada ? 'pagado en sitio' : 'por cobrar en sitio')
        const pendientePago = cobro > 0 && r.metodo_pago_tarifa === 'pagar_momento' && !r.tarifa_pagada && r.estado !== 'cancelada'
        const DEPOSITO_LABEL: Record<string, string> = { no_aplica: 'No aplica', pendiente: 'Pendiente', cobrado: 'Cobrado', devuelto: 'Devuelto', retenido: 'Retenido' }
        const datos: { label: string; value: string; color?: string }[] = [
          { label: 'Unidad', value: r.unidad_nombre ?? '—' },
          { label: 'Fecha', value: formatFechaCalendario(r.fecha, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }, 'es', r.fecha) },
          { label: 'Horario', value: `${r.hora_inicio}–${r.hora_fin}` },
          { label: 'Invitados', value: r.num_invitados > 0 ? String(r.num_invitados) : '—' },
        ]
        if (tarifa > 0) datos.push({ label: 'Tarifa', value: `${moneda} ${tarifa.toFixed(2)}`, color: 'var(--at-success)' })
        if (renta > 0) datos.push({ label: 'Renta de equipo', value: `${moneda} ${renta.toFixed(2)}`, color: 'var(--at-success)' })
        if (cobro > 0) datos.push({ label: tarifa > 0 && renta > 0 ? 'Total' : 'Cobro', value: `${moneda} ${cobro.toFixed(2)} · ${estadoPago}`, color: pendientePago ? 'var(--at-warning-strong)' : undefined })
        if (amen?.requiere_deposito) datos.push({ label: 'Depósito', value: `${DEPOSITO_LABEL[r.deposito_estado] ?? r.deposito_estado}${amen.monto_deposito != null ? ` · ${moneda} ${Number(amen.monto_deposito).toFixed(2)}` : ''}` })
        datos.push({ label: 'Solicitud creada', value: new Date(r.created_at).toLocaleString('es') })
        return (
          <EditModal
            title={r.amenidad_nombre ?? 'Reserva'}
            subtitle={
              <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={chipStyle(r.estado)}>{r.estado === 'confirmada' ? '✓ Confirmada' : r.estado === 'pendiente' ? '⏳ Pendiente' : '✗ Cancelada'}</span>
                {r.no_show && <span style={chipStyle('no_show')}>👻 No show</span>}
                {cobro > 0 && <span style={chipStyle(pendientePago ? 'cobro_pendiente' : 'pagado')}>🎟 {moneda} {cobro.toFixed(2)}</span>}
                <span>🏠 {r.unidad_nombre} · 📅 {formatFechaCalendario(r.fecha, { weekday: 'long', day: '2-digit', month: 'long' }, 'es', '—')} · ⏰ {r.hora_inicio}–{r.hora_fin}</span>
              </span>
            }
            size="lg"
            fullScreenOnMobile
            onClose={() => setReservaDetalle(null)}
            footer={
              <div className="at-ficha-acciones" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
                <Button variant="secondary" onClick={() => setReservaDetalle(null)}>Cerrar</Button>
                {canEdit && r.estado !== 'cancelada' && (
                  <Button variant="outline-danger" onClick={() => void cancelarReserva(r.id)}>✕ Cancelar reserva</Button>
                )}
                {canEdit && r.fecha < hoy && r.estado === 'confirmada' && (
                  <Button variant="secondary" onClick={() => void marcarNoShow(r)}>{r.no_show ? '↶ Quitar no-show' : '👻 No show'}</Button>
                )}
                {canEdit && pendientePago && (
                  <Button variant="success" onClick={() => void marcarTarifaPagada(r)}>💵 Marcar pagado</Button>
                )}
                {canEdit && r.estado === 'pendiente' && (
                  <>
                    <Button variant="outline-danger" onClick={() => void rechazarReserva(r)}>✗ Rechazar</Button>
                    <Button variant="success" onClick={() => void aprobarReserva(r)}>✓ Aprobar</Button>
                  </>
                )}
              </div>
            }
          >
            {r.rechazada_motivo && (
              <div style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', color: 'var(--at-danger-strong)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12.5 }}>
                ↩ Rechazada: {r.rechazada_motivo}
              </div>
            )}

            {/* Datos de la reserva en tarjetas */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
              {datos.map(d => (
                <div key={d.label} style={{ background: 'var(--at-surface-2)', borderRadius: 7, padding: 8, border: '1px solid var(--at-line)', minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{d.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: d.color ?? 'var(--at-ink-2)', overflowWrap: 'anywhere' }}>{d.value}</div>
                </div>
              ))}
            </div>

            {r.notas && (
              <div style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: 10, border: '1px solid var(--at-line)', marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 4 }}>Notas</div>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--at-ink-2)' }}>{r.notas}</p>
              </div>
            )}

            {/* Seguimiento (stepper): aprobación, check-in, equipo, check-out, depósito */}
            <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 8 }}>Seguimiento</div>
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
                      background: s.done ? 'var(--at-success-tint)' : s.current ? tint(accent, 13) : 'var(--at-chip)',
                      border: `2px solid ${dotColor}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: dotColor, fontWeight: 800, fontSize: 13,
                      flexShrink: 0, zIndex: 1, position: 'relative',
                      boxShadow: s.current ? `0 0 0 4px ${tint(accent, 13)}` : 'none',
                    }}>
                      {s.done ? '✓' : i + 1}
                    </div>
                    {/* Contenido */}
                    <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: s.done ? 'var(--at-ink)' : s.current ? 'var(--at-ink)' : 'var(--at-ink-3)' }}>{s.label}</div>
                      {s.meta && <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>{s.meta}</div>}
                      {s.render && <div>{s.render}</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </EditModal>
        )
}
