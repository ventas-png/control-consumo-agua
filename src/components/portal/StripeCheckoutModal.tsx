import { useState, useMemo } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'
import type { Registro, UserSession } from '../../types'
import { calcularTotalPagar } from '../../lib/business'

interface Props {
  registro: Registro
  moneda: string
  stripePublicKey: string
  currentUser: UserSession
  onClose: () => void
  onSuccess: () => void
}

// Inner form — must be inside <Elements>
function CheckoutForm({
  registro,
  moneda,
  currentUser,
  onClose,
  onSuccess,
}: Omit<Props, 'stripePublicKey'>) {
  const stripe = useStripe()
  const elements = useElements()

  const total = registro.monto_calculado
    ?? calcularTotalPagar(registro.consumo, registro.tarifa_aplicada, registro.canon_aplicado ?? 20).total
  const abonado = registro.monto_pagado ?? 0
  const saldo = Math.max(0, total - abonado)

  const [monto, setMonto] = useState(saldo.toFixed(2))
  const [loading, setLoading] = useState(false)

  async function handlePay() {
    if (!stripe || !elements) return

    const montoNum = parseFloat(monto) || 0
    if (montoNum <= 0 || montoNum > saldo + 0.001) {
      void Swal.fire({ icon: 'warning', title: 'Monto inválido', text: `Ingresa un monto entre 0.01 y ${saldo.toFixed(2)}` })
      return
    }

    const card = elements.getElement(CardElement)
    if (!card) return

    setLoading(true)

    try {
      // Create PaymentIntent server-side
      const { data, error: fnError } = await supabase.functions.invoke('create-payment-intent', {
        body: {
          cliente_id: registro.cliente_id,
          registro_id: registro.id,
          company_id: currentUser.company_id,
          monto: montoNum,
        },
      })

      if (fnError || !data?.clientSecret) {
        throw new Error(data?.error || fnError?.message || 'No se pudo iniciar el pago')
      }

      // Confirm card payment using Stripe.js
      const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(data.clientSecret, {
        payment_method: { card },
      })

      if (stripeError) {
        throw new Error(stripeError.message || 'Pago rechazado')
      }

      if (paymentIntent?.status === 'succeeded') {
        void Swal.fire({
          icon: 'success',
          title: '¡Pago completado!',
          html: `<p>Tu pago de <strong>${moneda} ${montoNum.toFixed(2)}</strong> fue procesado correctamente.</p><p style="font-size:12px;color:#64748b;margin-top:8px;">El comprobante se registrará en unos momentos.</p>`,
          timer: 3500,
          showConfirmButton: false,
        })
        onSuccess()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido'
      void Swal.fire({ icon: 'error', title: 'Error al procesar', text: msg })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
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

      {/* Monto */}
      <div style={{ marginBottom: '18px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
          Monto a pagar ({moneda}) *
        </label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          max={saldo}
          value={monto}
          onChange={e => setMonto(e.target.value)}
          disabled={loading}
          style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1.5px solid #e2e8f0', fontSize: '18px', fontWeight: 700, fontFamily: 'inherit', boxSizing: 'border-box' }}
        />
      </div>

      {/* Card Element */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#475569', marginBottom: '8px' }}>
          Datos de la tarjeta *
        </label>
        <div style={{ padding: '14px', borderRadius: '8px', border: '1.5px solid #e2e8f0', background: loading ? '#f8fafc' : 'white' }}>
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '15px',
                  color: '#0f172a',
                  fontFamily: 'system-ui, sans-serif',
                  '::placeholder': { color: '#94a3b8' },
                },
                invalid: { color: '#ef4444' },
              },
              hidePostalCode: true,
            }}
          />
        </div>
        <div style={{ marginTop: '6px', fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
          🔒 Pago seguro procesado por Stripe. No almacenamos datos de tu tarjeta.
        </div>
      </div>

      {/* Botones */}
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={onClose}
          disabled={loading}
          style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1.5px solid #e2e8f0', background: 'white', color: '#64748b', fontWeight: 700, fontSize: '14px', cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          Cancelar
        </button>
        <button
          onClick={handlePay}
          disabled={loading || !stripe}
          style={{ flex: 2, padding: '12px', borderRadius: '8px', border: 'none', background: loading || !stripe ? '#cbd5e1' : 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', fontWeight: 700, fontSize: '14px', cursor: loading || !stripe ? 'not-allowed' : 'pointer' }}
        >
          {loading ? '⏳ Procesando...' : `💳 Pagar ${moneda} ${parseFloat(monto || '0').toFixed(2)}`}
        </button>
      </div>
    </>
  )
}

export function StripeCheckoutModal({ registro, moneda, stripePublicKey, currentUser, onClose, onSuccess }: Props) {
  // loadStripe result is memoized — won't re-run on every render
  const stripePromise = useMemo(() => loadStripe(stripePublicKey), [stripePublicKey])

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '16px' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: 'white', borderRadius: '16px', padding: '32px', width: '100%', maxWidth: '460px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: 0 }}>💳 Pagar con Stripe</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
        </div>

        <Elements stripe={stripePromise}>
          <CheckoutForm
            registro={registro}
            moneda={moneda}
            currentUser={currentUser}
            onClose={onClose}
            onSuccess={onSuccess}
          />
        </Elements>
      </div>
    </div>
  )
}
