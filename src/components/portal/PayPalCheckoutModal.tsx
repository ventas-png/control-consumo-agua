import { useState, useEffect, useRef } from 'react'
import { loadScript } from '@paypal/paypal-js'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'
import type { Registro, UserSession } from '../../types'
import { calcularTotalPagar } from '../../lib/business'

interface Props {
  registro: Registro
  moneda: string
  paypalClientId: string
  paypalCurrencyCode: string
  currentUser: UserSession
  onClose: () => void
  onSuccess: () => void
}

export function PayPalCheckoutModal({
  registro,
  moneda,
  paypalClientId,
  paypalCurrencyCode,
  currentUser,
  onClose,
  onSuccess,
}: Props) {
  const total = registro.monto_calculado ?? calcularTotalPagar(registro.consumo, registro.tarifa_aplicada, registro.canon_aplicado ?? 20).total
  const abonado = registro.monto_pagado ?? 0
  const saldo = Math.max(0, total - abonado)

  const [monto, setMonto] = useState(saldo.toFixed(2))
  const [step, setStep] = useState<'amount' | 'pay'>('amount')
  const [sdkError, setSdkError] = useState('')
  const montoRef = useRef(saldo)
  const btnsRendered = useRef(false)

  useEffect(() => {
    if (step !== 'pay') return
    btnsRendered.current = false
    setSdkError('')

    let cancelled = false

    loadScript({ clientId: paypalClientId, currency: paypalCurrencyCode })
      .then(paypal => {
        if (cancelled || !paypal?.Buttons) {
          setSdkError('No se pudo cargar el SDK de PayPal. Verifica el Client ID.')
          return
        }

        const buttons = paypal.Buttons({
          style: { layout: 'vertical', color: 'blue', shape: 'rect', label: 'pay' },
          createOrder: (_data, actions) =>
            actions.order!.create({
              intent: 'CAPTURE',
              purchase_units: [
                {
                  amount: {
                    currency_code: paypalCurrencyCode,
                    value: montoRef.current.toFixed(2),
                  },
                  description: `Pago agua - ${new Date(registro.fecha).toLocaleDateString('es-GT')}`,
                },
              ],
            }),
          onApprove: async (_data, actions) => {
            try {
              const order = await actions.order!.capture()
              const capture = order.purchase_units?.[0]?.payments?.captures?.[0]
              const { error } = await supabase.from('pagos').insert({
                registro_id: registro.id,
                cliente_id: registro.cliente_id,
                project_id: null,
                monto: montoRef.current,
                metodo: 'paypal',
                paypal_order_id: order.id ?? null,
                paypal_transaction_id: capture?.id ?? null,
                numero_documento: order.id ?? null,
                estado: 'pagado',
                verification_status: 'verificado',
                tipo_aplicacion: 'pago_total',
                created_by: currentUser.user_id,
              })
              if (error) throw error
              void Swal.fire({
                icon: 'success',
                title: '¡Pago completado!',
                html: `<p>Tu pago de <strong>${moneda} ${montoRef.current.toFixed(2)}</strong> fue procesado por PayPal.</p>`,
                timer: 3000,
                showConfirmButton: false,
              })
              onSuccess()
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : 'Error desconocido'
              void Swal.fire({ icon: 'error', title: 'Error al registrar el pago', text: msg })
            }
          },
          onError: (err) => {
            console.error('PayPal error:', err)
            setSdkError('El pago fue cancelado o hubo un error en PayPal.')
            setStep('amount')
          },
          onCancel: () => {
            setStep('amount')
          },
        })

        if (!btnsRendered.current) {
          btnsRendered.current = true
          void buttons.render('#paypal-btn-container')
        }
      })
      .catch(() => {
        if (!cancelled) setSdkError('No se pudo cargar PayPal. Verifica tu conexión.')
      })

    return () => { cancelled = true }
  }, [step])

  function handleContinuar() {
    const val = parseFloat(monto) || 0
    if (val <= 0 || val > saldo + 0.001) {
      void Swal.fire({ icon: 'warning', title: 'Monto inválido', text: `Ingresa un monto entre 0.01 y ${saldo.toFixed(2)}` })
      return
    }
    montoRef.current = val
    setStep('pay')
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'white', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '420px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: 0 }}>
            <img src="https://www.paypalobjects.com/webstatic/mktg/logo/pp_cc_mark_37x23.jpg" alt="PayPal" style={{ height: '22px', verticalAlign: 'middle', marginRight: '8px' }} />
            Pagar con PayPal
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
        </div>

        {/* Resumen */}
        <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '16px', marginBottom: '20px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
            <div>
              <div style={{ color: '#94a3b8', marginBottom: '2px' }}>Total Cargo</div>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>{moneda} {total.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: '#94a3b8', marginBottom: '2px' }}>Saldo Pendiente</div>
              <div style={{ fontWeight: 700, color: '#ef4444', fontSize: '16px' }}>{moneda} {saldo.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {step === 'amount' && (
          <>
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
                Monto a pagar ({paypalCurrencyCode}) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={saldo}
                value={monto}
                onChange={e => setMonto(e.target.value)}
                style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1.5px solid #e2e8f0', fontSize: '18px', fontWeight: 700, fontFamily: 'inherit', boxSizing: 'border-box' }}
              />
              {sdkError && (
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#dc2626' }}>{sdkError}</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1.5px solid #e2e8f0', background: 'white', color: '#64748b', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}>
                Cancelar
              </button>
              <button
                onClick={handleContinuar}
                style={{ flex: 2, padding: '12px', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg,#0070ba,#003d7a)', color: 'white', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}
              >
                Continuar con PayPal →
              </button>
            </div>
          </>
        )}

        {step === 'pay' && (
          <>
            <div style={{ marginBottom: '16px', padding: '10px 14px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0', fontSize: '13px', color: '#15803d' }}>
              Monto: <strong>{paypalCurrencyCode} {montoRef.current.toFixed(2)}</strong>
              <button onClick={() => setStep('amount')} style={{ float: 'right', background: 'none', border: 'none', color: '#0ea5e9', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}>
                Cambiar
              </button>
            </div>
            <div id="paypal-btn-container" style={{ minHeight: '60px' }}>
              {!sdkError && <div style={{ textAlign: 'center', padding: '16px', color: '#94a3b8', fontSize: '13px' }}>Cargando PayPal...</div>}
            </div>
            {sdkError && (
              <div style={{ marginTop: '12px', padding: '10px', background: '#fef2f2', borderRadius: '8px', fontSize: '13px', color: '#dc2626' }}>
                {sdkError}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
