import { hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties } from 'react'
import type { CuotaCondominio, EstadoCuota } from '../../../types'
import { notify } from '../../shared/Dialog'
import { iniciarPagoCuota, confirmarPagoCuota } from '../../../domain/portal/mutations'
import { calcularRecargoTarjeta, type RecargoTarjetaRow } from '../../../lib/businessPagos'
import { ResponsableCuotaBadge } from './CuotasUi'
import { ModalPortal } from '../../shared/ModalPortal'

interface Props {
  cuotas: CuotaCondominio[]
  moneda: string
  unidadNombre: string
  /** Config de recargo por pago con tarjeta del tenant (desglose pre-pago;
   *  el cobro real lo calcula y sella el edge server-side). */
  recargoRows?: RecargoTarjetaRow[]
  /** Canal efectivo del cobro (proveedor_pago a nivel empresa). */
  canalPago?: string
  /** F1 pago en línea: refrescar la cuenta tras un pago/abono. */
  onPagado?: () => void
}

const ESTADO_CONFIG: Record<EstadoCuota, { label: string; bg: string; color: string; border: string }> = {
  pendiente: { label: 'Pendiente', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', border: 'var(--at-warning-border)' },
  pagado:    { label: 'Pagado',    bg: 'var(--at-success-tint)', color: 'var(--at-success-strong)', border: 'var(--at-success-border)' },
  moroso:    { label: 'Vencida',   bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'var(--at-danger-border)' },
}

export function PortalMiCuentaTab({ cuotas, moneda, unidadNombre, recargoRows, canalPago, onPagado }: Props) {
  const pendientes  = cuotas.filter(c => c.estado === 'pendiente' || c.estado === 'moroso')
  const pagadas     = cuotas.filter(c => c.estado === 'pagado')
  const totalDeuda  = pendientes.reduce((s, c) => s + c.monto, 0)
  const totalPagado = pagadas.reduce((s, c) => s + c.monto, 0)
  const hoy         = hoyLocalISO()
  const vencidas    = pendientes.filter(c => c.fecha_vencimiento && c.fecha_vencimiento < hoy)

  // F1 pago en línea: modal de pago sobre una cuota (permite abono parcial).
  const [pagando, setPagando]       = useState<CuotaCondominio | null>(null)
  const [montoInput, setMontoInput] = useState('')
  const [procesando, setProcesando] = useState(false)

  function abrirPago(c: CuotaCondominio) {
    setPagando(c)
    setMontoInput(c.monto != null ? String(c.monto) : '')
  }

  async function handlePagar() {
    if (!pagando) return
    const montoNum = parseFloat(montoInput)
    if (!(montoNum > 0)) { notify({ variant: 'warning', title: 'Monto inválido', text: 'Ingresá un monto mayor a 0.' }); return }
    setProcesando(true)
    try {
      const res = await iniciarPagoCuota(pagando.id, montoNum)
      if (res.error) { notify({ variant: 'error', title: 'No se pudo iniciar el pago', text: res.error }); return }
      // Hosted checkout (payfac real): guardamos la solicitud y redirigimos.
      if (res.redirectUrl && res.paymentRequestId) {
        try { sessionStorage.setItem('pago_pr_id', res.paymentRequestId) } catch { /* no-op */ }
        window.location.href = res.redirectUrl
        return
      }
      // Aprobación inmediata (sandbox): confirmar+conciliar ya.
      if (res.estado === 'aprobado' && res.paymentRequestId) {
        const conf = await confirmarPagoCuota(res.paymentRequestId)
        if (conf.error) { notify({ variant: 'error', title: 'Pago no confirmado', text: conf.error }); return }
        notify({
          variant: 'success',
          title: conf.cuotaLiquidada ? 'Cuota pagada' : 'Abono registrado',
          text: conf.cuotaLiquidada
            ? 'Tu cuota quedó al día.'
            : `Abono aplicado. Saldo restante: ${moneda} ${(conf.saldoRestante ?? 0).toFixed(2)}`,
        })
        setPagando(null)
        onPagado?.()
        return
      }
      notify({ variant: 'info', title: 'Pago en proceso', text: 'Tu pago se está procesando; se reflejará en unos momentos.' })
      setPagando(null)
    } finally {
      setProcesando(false)
    }
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 18px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>Mi cuenta — {unidadNombre}</h3>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        <div style={{ background: totalDeuda > 0 ? 'var(--at-danger-tint)' : 'var(--at-success-tint)', borderRadius: '14px', padding: '16px', border: `1.5px solid ${totalDeuda > 0 ? 'var(--at-danger-border)' : 'var(--at-success-border)'}` }}>
          <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px' }}>SALDO PENDIENTE</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: totalDeuda > 0 ? 'var(--at-danger)' : 'var(--at-success)' }}>{moneda} {totalDeuda.toFixed(2)}</div>
          {vencidas.length > 0 && <div style={{ fontSize: '11.5px', color: 'var(--at-danger)', marginTop: '3px' }}>{vencidas.length} cuota{vencidas.length > 1 ? 's' : ''} vencida{vencidas.length > 1 ? 's' : ''}</div>}
        </div>
        <div style={{ background: 'var(--at-success-tint)', borderRadius: '14px', padding: '16px', border: '1.5px solid var(--at-success-border)' }}>
          <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px' }}>TOTAL PAGADO</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--at-success)' }}>{moneda} {totalPagado.toFixed(2)}</div>
          <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '3px' }}>{pagadas.length} pago{pagadas.length !== 1 ? 's' : ''}</div>
        </div>
        <div style={{ background: 'var(--at-primary-tint)', borderRadius: '14px', padding: '16px', border: '1.5px solid var(--at-primary-soft-2)' }}>
          <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px' }}>CUOTAS PENDIENTES</div>
          <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--at-primary)' }}>{pendientes.length}</div>
          <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '3px' }}>de {cuotas.length} en total</div>
        </div>
      </div>

      {/* Cuotas pendientes */}
      {pendientes.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h4 style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: 700, color: 'var(--at-ink-2)' }}>Cuotas por pagar</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {pendientes.sort((a, b) => (a.periodo < b.periodo ? -1 : 1)).map(c => {
              const ec = ESTADO_CONFIG[c.estado]
              const esVencida = c.fecha_vencimiento && c.fecha_vencimiento < hoy
              return (
                <div key={c.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${esVencida ? 'var(--at-danger-border)' : 'var(--at-warning-border)'}`, borderRadius: '12px', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{c.concepto.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} — {c.periodo}</div>
                    {c.rol_responsable && <div style={{ marginTop: '4px' }}><ResponsableCuotaBadge rol={c.rol_responsable} /></div>}
                    {c.fecha_vencimiento && (
                      <div style={{ fontSize: '12.5px', color: esVencida ? 'var(--at-danger)' : 'var(--at-ink-3)', marginTop: '2px' }}>
                        {esVencida ? '⚠ Vencida el ' : 'Vence el '}{new Date(c.fecha_vencimiento + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })}
                      </div>
                    )}
                    {c.notas && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{c.notas}</div>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: '16px', color: 'var(--at-ink)' }}>{moneda} {c.monto.toFixed(2)}</div>
                    <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: ec.bg, color: ec.color }}>{ec.label}</span>
                  </div>
                  <button onClick={() => abrirPago(c)} style={payBtn}>💳 Pagar</button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Historial de pagos */}
      {pagadas.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: 700, color: 'var(--at-ink-2)' }}>Historial de pagos</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {pagadas.sort((a, b) => (b.fecha_pago ?? b.created_at) < (a.fecha_pago ?? a.created_at) ? -1 : 1).map(c => (
              <div key={c.id} style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '10px', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>✅</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--at-ink-2)' }}>{c.concepto.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())} — {c.periodo}</div>
                  {c.fecha_pago && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>Pagado el {new Date(c.fecha_pago + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}{c.metodo_pago ? ` · ${c.metodo_pago}` : ''}</div>}
                </div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-success)', flexShrink: 0 }}>{moneda} {c.monto.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {cuotas.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '10px' }}>💳</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay cuotas registradas para esta unidad</p>
        </div>
      )}

      {/* Modal de pago en línea (F1) */}
      {pagando && (
        <ModalPortal>
        <div
          role="dialog"
          aria-modal="true"
          onClick={e => e.target === e.currentTarget && !procesando && setPagando(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
        >
          <div style={{ background: 'var(--at-surface)', borderRadius: 16, padding: 28, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <h2 style={{ margin: '0 0 4px', fontSize: 19, fontWeight: 800, color: 'var(--at-ink)' }}>Pagar cuota</h2>
            <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--at-ink-2)' }}>
              {pagando.concepto.replace(/_/g, ' ')} — {pagando.periodo}
            </p>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: 6 }}>
              Monto a pagar ({moneda}) <span style={{ fontWeight: 400, color: 'var(--at-ink-3)' }}>— podés abonar un monto menor</span>
            </label>
            <input
              type="number" step="0.01" min="0.01" inputMode="decimal"
              value={montoInput}
              onChange={e => setMontoInput(e.target.value)}
              autoFocus
              style={{ width: '100%', padding: '12px', borderRadius: 10, border: '1.5px solid var(--at-line-strong)', fontSize: 18, fontWeight: 700, boxSizing: 'border-box', marginBottom: 18 }}
            />
            {(() => {
              // Desglose pre-pago (espejo del cálculo que sella el edge).
              const montoNum = parseFloat(montoInput) || 0
              const recargo = calcularRecargoTarjeta(montoNum, canalPago ?? 'default', recargoRows)
              if (recargo == null) return null
              return (
                <div style={{ margin: '-8px 0 18px', padding: '10px 12px', borderRadius: 8, background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', fontSize: 12.5, color: 'var(--at-ink-2)' }}>
                  Recargo por pago con tarjeta: <strong>{moneda} {recargo.toFixed(2)}</strong>
                  <span style={{ color: 'var(--at-ink-3)' }}> · </span>
                  Total a pagar: <strong>{moneda} {(montoNum + recargo).toFixed(2)}</strong>
                  <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>
                    El abono a tu cuota es {moneda} {montoNum.toFixed(2)}; el recargo cubre el fee del procesador de tarjeta.
                  </div>
                </div>
              )
            })()}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setPagando(null)} disabled={procesando} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', color: 'var(--at-ink-2)', fontWeight: 700, fontSize: 14, cursor: procesando ? 'not-allowed' : 'pointer' }}>
                Cancelar
              </button>
              <button onClick={() => void handlePagar()} disabled={procesando} style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: procesando ? 'var(--at-line-strong)' : 'linear-gradient(135deg, var(--at-primary), var(--at-primary-hover))', color: '#fff', fontWeight: 800, fontSize: 14, cursor: procesando ? 'not-allowed' : 'pointer' }}>
                {procesando ? 'Procesando…' : '💳 Pagar'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  )
}

const payBtn: CSSProperties = {
  padding: '8px 14px', borderRadius: 10, border: 'none',
  background: 'linear-gradient(135deg, var(--at-primary), var(--at-primary-hover))',
  color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0,
}
