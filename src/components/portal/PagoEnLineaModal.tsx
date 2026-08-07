import { useState } from 'react'
import { notify } from '../shared/Dialog'
import type { Registro } from '../../types'
import { calcularTotalPagar } from '../../lib/business'
import { calcularRecargoTarjeta, type RecargoTarjetaRow } from '../../lib/businessPagos'
import { iniciarPagoRegistro, confirmarPago } from '../../domain/portal/mutations'
import { ModalPortal } from '../shared/ModalPortal'

interface Props {
  registro: Registro
  moneda: string
  /** Config de recargo por pago con tarjeta del tenant (desglose pre-pago).
   *  El cobro real lo calcula y sella el edge server-side. */
  recargoRows?: RecargoTarjetaRow[]
  /** Canal efectivo del cobro (proveedor_pago) para elegir la fila de recargo. */
  canalPago?: string
  onClose: () => void
  /** Pago aplicado (inmediato/sandbox): cerrar + refrescar la lista de recibos. */
  onPagado: () => void
}

/**
 * F2 pago en línea de un RECIBO de agua con el payfac EFECTIVO del tenant (pluggable:
 * sandbox/qpaypro/…). No pasa datos de tarjeta por la app. Dos caminos:
 *   • Aprobación inmediata (sandbox) → confirma+concilia server-side al instante.
 *   • Checkout hospedado (qpaypro) → guarda el payment_request y redirige; el retorno
 *     (?pago=ok) lo concilia CustomerPortal. Permite ABONOS parciales.
 */
export function PagoEnLineaModal({ registro, moneda, recargoRows, canalPago, onClose, onPagado }: Props) {
  const total = registro.monto_calculado ?? calcularTotalPagar(registro.consumo, registro.tarifa_aplicada, registro.canon_aplicado ?? 20).total
  const abonado = registro.monto_pagado ?? 0
  const saldo = Math.max(0, total - abonado)

  const [monto, setMonto] = useState(saldo > 0 ? saldo.toFixed(2) : '')
  const [loading, setLoading] = useState(false)

  // Desglose pre-pago: el recargo se recalcula en vivo con el monto capturado
  // (el valor autoritativo lo sella el edge; este espejo solo informa).
  const montoNum = parseFloat(monto) || 0
  const recargo = calcularRecargoTarjeta(montoNum, canalPago ?? 'default', recargoRows)

  async function handlePagar() {
    const montoNum = parseFloat(monto) || 0
    if (montoNum <= 0) {
      notify({ variant: 'warning', title: 'Monto inválido', text: 'Ingresá un monto mayor a 0.' })
      return
    }
    // Tolerancia de medio centavo (el input se prellena con saldo.toFixed(2)).
    if (montoNum > saldo + 0.005) {
      notify({ variant: 'warning', title: 'Monto excede el saldo', text: `El saldo pendiente es ${moneda} ${saldo.toFixed(2)}` })
      return
    }

    setLoading(true)
    try {
      const res = await iniciarPagoRegistro(registro.id, montoNum)
      if (res.error) {
        notify({ variant: 'error', title: 'No se pudo iniciar el pago', text: res.error })
        return
      }
      // Checkout hospedado (payfac real): guardamos la solicitud y redirigimos.
      if (res.redirectUrl && res.paymentRequestId) {
        try { sessionStorage.setItem('pago_pr_id', res.paymentRequestId) } catch { /* no-op */ }
        window.location.href = res.redirectUrl
        return
      }
      // Aprobación inmediata (sandbox): confirmar+conciliar ya.
      if (res.estado === 'aprobado' && res.paymentRequestId) {
        const conf = await confirmarPago(res.paymentRequestId)
        if (conf.error) {
          notify({ variant: 'error', title: 'Pago no confirmado', text: conf.error })
          return
        }
        notify({
          variant: 'success',
          title: conf.liquidado ? 'Recibo pagado' : 'Abono registrado',
          text: conf.liquidado
            ? 'Tu recibo quedó al día.'
            : `Abono aplicado. Saldo restante: ${moneda} ${(conf.saldoRestante ?? 0).toFixed(2)}`,
        })
        onPagado()
        return
      }
      notify({ variant: 'info', title: 'Pago en proceso', text: 'Tu pago se está procesando; se reflejará en unos momentos.' })
      onClose()
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message || 'No se pudo procesar el pago' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalPortal>
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px',
      }}
      onClick={e => e.target === e.currentTarget && !loading && onClose()}
    >
      <div
        style={{
          background: 'var(--at-surface)',
          borderRadius: '16px',
          padding: '32px',
          width: '100%',
          maxWidth: '480px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)', margin: 0 }}>💳 Pagar en línea</h2>
          <button
            onClick={onClose}
            disabled={loading}
            style={{ background: 'none', border: 'none', fontSize: '20px', cursor: loading ? 'not-allowed' : 'pointer', color: 'var(--at-ink-3)' }}
          >
            ✕
          </button>
        </div>

        <div style={{ background: 'var(--at-surface-2)', borderRadius: '12px', padding: '16px', marginBottom: '24px', border: '1px solid var(--at-line)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
            <div>
              <div style={{ color: 'var(--at-ink-3)', marginBottom: '2px' }}>Total Cargo</div>
              <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{moneda} {total.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: 'var(--at-ink-3)', marginBottom: '2px' }}>Saldo Pendiente</div>
              <div style={{ fontWeight: 700, color: 'var(--at-danger)', fontSize: '16px' }}>{moneda} {saldo.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '8px' }}>
            Monto a Pagar ({moneda}) <span style={{ fontWeight: 400, color: 'var(--at-ink-3)' }}>— podés abonar un monto menor</span>
          </label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max={saldo}
            inputMode="decimal"
            value={monto}
            onChange={e => setMonto(e.target.value)}
            autoFocus
            placeholder={saldo.toFixed(2)}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '1.5px solid var(--at-line)',
              fontSize: '16px',
              fontWeight: 700,
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
          {recargo != null && (
            <div style={{
              marginTop: '10px', padding: '10px 12px', borderRadius: '8px',
              background: 'var(--at-surface-2)', border: '1px solid var(--at-line)',
              fontSize: '12.5px', color: 'var(--at-ink-2)',
            }}>
              Recargo por pago con tarjeta: <strong>{moneda} {recargo.toFixed(2)}</strong>
              <span style={{ color: 'var(--at-ink-3)' }}> · </span>
              Total a pagar: <strong>{moneda} {(montoNum + recargo).toFixed(2)}</strong>
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                El abono a tu recibo es {moneda} {montoNum.toFixed(2)}; el recargo cubre el fee del procesador de tarjeta.
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '8px',
              border: '1.5px solid var(--at-line)',
              background: 'var(--at-surface)',
              color: 'var(--at-ink-3)',
              fontWeight: 700,
              fontSize: '14px',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={() => void handlePagar()}
            disabled={loading}
            style={{
              flex: 2,
              padding: '12px',
              borderRadius: '8px',
              border: 'none',
              background: loading ? 'var(--at-line-strong)' : 'linear-gradient(135deg, var(--at-primary), var(--at-primary-hover))',
              color: 'white',
              fontWeight: 700,
              fontSize: '14px',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '⏳ Procesando...' : '💳 Pagar'}
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}
