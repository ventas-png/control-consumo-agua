import { useState } from 'react'
import Swal from 'sweetalert2'
import type { Registro, UserSession } from '../../types'
import { calcularTotalPagar } from '../../lib/business'

interface Props {
  registro: Registro
  moneda: string
  currentUser: UserSession
  onClose: () => void
  onSuccess: () => void
}

export function StripeCheckoutModal({ registro, moneda, currentUser, onClose, onSuccess }: Props) {
  const [monto, setMonto] = useState('')
  const [loading, setLoading] = useState(false)

  const total = registro.monto_calculado ?? calcularTotalPagar(registro.consumo, registro.tarifa_aplicada, registro.canon_aplicado ?? 20).total
  const abonado = registro.monto_pagado ?? 0
  const saldo = Math.max(0, total - abonado)

  async function handlePay() {
    const montoNum = parseFloat(monto) || 0
    if (montoNum <= 0 || montoNum > saldo) {
      void Swal.fire({ icon: 'warning', title: 'Monto inválido' })
      return
    }

    setLoading(true)

    try {
      // Llamar Edge Function para crear PaymentIntent
      const response = await fetch('/api/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id: registro.cliente_id,
          registro_id: registro.id,
          company_id: currentUser.company_id,
          monto: montoNum,
        }),
      })

      if (!response.ok) {
        throw new Error('No se pudo crear el pago')
      }

      const { clientSecret } = await response.json()

      // Aquí iría la integración con Stripe.js (stripe-js library)
      // Por ahora mostramos un placeholder
      void Swal.fire({
        icon: 'info',
        title: 'Integración Stripe',
        html: `
          <p>Redirigiendo a Stripe para procesar el pago...</p>
          <p style="font-family: monospace; font-size: 11px; color: #666; margin-top: 12px;">
            Client Secret: ${clientSecret.substring(0, 20)}...
          </p>
        `,
      })

      onSuccess()
    } catch (err: any) {
      console.error(err)
      void Swal.fire({
        icon: 'error',
        title: 'Error',
        text: err.message || 'No se pudo procesar el pago',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
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
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          padding: '32px',
          width: '100%',
          maxWidth: '480px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#15291F', margin: 0 }}>💳 Pagar con Stripe</h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#7E9389' }}
          >
            ✕
          </button>
        </div>

        <div style={{ background: '#FAF7EF', borderRadius: '12px', padding: '16px', marginBottom: '24px', border: '1px solid #E1DDD0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px' }}>
            <div>
              <div style={{ color: '#7E9389', marginBottom: '2px' }}>Total Cargo</div>
              <div style={{ fontWeight: 700, color: '#15291F' }}>{moneda} {total.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ color: '#7E9389', marginBottom: '2px' }}>Saldo Pendiente</div>
              <div style={{ fontWeight: 700, color: '#ef4444', fontSize: '16px' }}>{moneda} {saldo.toFixed(2)}</div>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 700, color: '#3E5A4C', marginBottom: '8px' }}>
            Monto a Pagar ({moneda}) *
          </label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max={saldo}
            value={monto}
            onChange={e => setMonto(e.target.value)}
            placeholder={saldo.toFixed(2)}
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '1.5px solid #E1DDD0',
              fontSize: '16px',
              fontWeight: 700,
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '12px',
              borderRadius: '8px',
              border: '1.5px solid #E1DDD0',
              background: 'white',
              color: '#7E9389',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Cancelar
          </button>
          <button
            onClick={handlePay}
            disabled={loading}
            style={{
              flex: 2,
              padding: '12px',
              borderRadius: '8px',
              border: 'none',
              background: loading ? '#C7C2B0' : 'linear-gradient(135deg, #1B3B36, #102622)',
              color: 'white',
              fontWeight: 700,
              fontSize: '14px',
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '⏳ Procesando...' : '💳 Ir a Stripe'}
          </button>
        </div>
      </div>
    </div>
  )
}
