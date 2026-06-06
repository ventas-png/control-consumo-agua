import { useState, useEffect } from 'react'
import { notify } from '../shared/Dialog'
import { fetchPortalPaymentConfig } from '../../domain/portal/queries'
import type { Registro, Cliente, UserSession } from '../../types'
import { calcularTotalPagar } from '../../lib/business'
import { StripeCheckoutModal } from './StripeCheckoutModal'
import { PagoManualModal } from './PagoManualModal'

interface Props {
  registros: Registro[]
  clientes: Cliente[]
  currentUser: UserSession
  moneda: string
}

export function CustomerPaymentsTab({ registros, currentUser, moneda }: Props) {
  const [paymentConfig, setPaymentConfig] = useState<{
    stripe_configured: boolean
    stripe_activo: boolean
    paypal_configured: boolean
    paypal_activo: boolean
  }>({
    stripe_configured: false,
    stripe_activo: false,
    paypal_configured: false,
    paypal_activo: false,
  })
  const [loading, setLoading] = useState(true)
  const [stripeModal, setStripeModal] = useState<Registro | null>(null)
  const [manualModal, setManualModal] = useState<Registro | null>(null)

  useEffect(() => {
    cargarConfig()
  }, [currentUser.company_id])

  async function cargarConfig() {
    if (!currentUser.company_id) return
    const data = await fetchPortalPaymentConfig(currentUser.company_id)
    if (data) {
      setPaymentConfig({
        stripe_configured: data.stripe_configured || false,
        stripe_activo: data.stripe_activo !== false,
        paypal_configured: data.paypal_configured || false,
        paypal_activo: data.paypal_activo !== false,
      })
    }
    setLoading(false)
  }

  // Registros pendientes (no pagados)
  const registrosPendientes = registros.filter(r => r.estado !== 'pagado').sort((a, b) =>
    new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
  )

  const totalPendiente = registrosPendientes.reduce((acc, r) => {
    const total = r.monto_calculado ?? calcularTotalPagar(r.consumo, r.tarifa_aplicada, r.canon_aplicado ?? 20).total
    return acc + (total - (r.monto_pagado ?? 0))
  }, 0)

  if (loading) {
    return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--at-ink-3)' }}>Cargando...</div>
  }

  if (registrosPendientes.length === 0) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '12px' }}>✅</div>
        <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)', marginBottom: '6px' }}>
          ¡Sin cargos pendientes!
        </div>
        <div style={{ color: 'var(--at-ink-3)' }}>Todos tus pagos están al día</div>
      </div>
    )
  }

  return (
    <div>
      {/* Resumen */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
        marginBottom: '28px',
      }}>
        <div style={{
          background: 'linear-gradient(135deg, var(--at-warning), var(--at-warning))',
          borderRadius: '16px',
          padding: '20px',
          color: 'white',
          boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
        }}>
          <div style={{ fontSize: '12px', opacity: 0.9, marginBottom: '6px', fontWeight: 500 }}>Total por Pagar</div>
          <div style={{ fontSize: '28px', fontWeight: 700 }}>{moneda} {totalPendiente.toFixed(2)}</div>
        </div>

        <div style={{
          background: 'linear-gradient(135deg, var(--at-primary-2), var(--at-primary-hover))',
          borderRadius: '16px',
          padding: '20px',
          color: 'white',
          boxShadow: '0 8px 20px rgba(0,0,0,0.12)',
        }}>
          <div style={{ fontSize: '12px', opacity: 0.9, marginBottom: '6px', fontWeight: 500 }}>Cargos Pendientes</div>
          <div style={{ fontSize: '28px', fontWeight: 700 }}>{registrosPendientes.length}</div>
        </div>
      </div>

      {/* Lista de cargos */}
      <div style={{ display: 'grid', gap: '12px' }}>
        {registrosPendientes.map(registro => {
          const total = registro.monto_calculado ?? calcularTotalPagar(registro.consumo, registro.tarifa_aplicada, registro.canon_aplicado ?? 20).total
          const abonado = registro.monto_pagado ?? 0
          const saldo = Math.max(0, total - abonado)
          const esMora = registro.estado === 'mora'

          return (
            <div
              key={registro.id}
              style={{
                background: 'var(--at-surface)',
                borderRadius: '12px',
                padding: '16px',
                border: esMora ? '2px solid var(--at-danger)' : '1px solid var(--at-line)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'start' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)' }}>
                      Lectura: {new Date(registro.fecha).toLocaleDateString('es-GT')}
                    </span>
                    {esMora && (
                      <span style={{
                        padding: '4px 12px',
                        borderRadius: '20px',
                        fontSize: '11px',
                        fontWeight: 700,
                        background: 'var(--at-danger-tint)',
                        color: 'var(--at-danger)',
                      }}>
                        ⚠️ En mora
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', fontSize: '13px', marginTop: '12px' }}>
                    <div>
                      <div style={{ color: 'var(--at-ink-3)', marginBottom: '2px' }}>Consumo</div>
                      <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{registro.consumo.toFixed(2)} m³</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--at-ink-3)', marginBottom: '2px' }}>Monto Total</div>
                      <div style={{ fontWeight: 700, color: 'var(--at-ink)' }}>{moneda} {total.toFixed(2)}</div>
                    </div>
                    <div>
                      <div style={{ color: 'var(--at-ink-3)', marginBottom: '2px' }}>Saldo</div>
                      <div style={{ fontWeight: 700, color: saldo > 0 ? 'var(--at-danger)' : 'var(--at-success)', fontSize: '14px' }}>
                        {moneda} {saldo.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Botones de pago */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '140px' }}>
                  {paymentConfig.stripe_activo && (
                    <button
                      onClick={() => setStripeModal(registro)}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        border: 'none',
                        background: 'linear-gradient(135deg, var(--at-primary), var(--at-primary-hover))',
                        color: 'white',
                        fontWeight: 700,
                        fontSize: '13px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      💳 Pagar Stripe
                    </button>
                  )}
                  {paymentConfig.paypal_activo && (
                    <button
                      onClick={() => {
                        notify({
                          variant: 'info',
                          title: 'PayPal',
                          text: 'Integración de PayPal disponible próximamente',
                        })
                      }}
                      style={{
                        padding: '10px',
                        borderRadius: '8px',
                        border: 'none',
                        background: 'linear-gradient(135deg, #0070ba, #003d7a)',
                        color: 'white',
                        fontWeight: 700,
                        fontSize: '13px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      🅿️ Pagar PayPal
                    </button>
                  )}
                  <button
                    onClick={() => setManualModal(registro)}
                    style={{
                      padding: '10px',
                      borderRadius: '8px',
                      border: '1.5px solid var(--at-line)',
                      background: 'var(--at-surface)',
                      color: 'var(--at-ink-3)',
                      fontWeight: 700,
                      fontSize: '13px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    📄 Registrar Pago Manual
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modales */}
      {stripeModal && (
        <StripeCheckoutModal
          registro={stripeModal}
          moneda={moneda}
          currentUser={currentUser}
          onClose={() => setStripeModal(null)}
          onSuccess={() => {
            setStripeModal(null)
            void cargarConfig()
          }}
        />
      )}

      {manualModal && (
        <PagoManualModal
          registro={manualModal}
          moneda={moneda}
          currentUser={currentUser}
          onClose={() => setManualModal(null)}
          onSuccess={() => {
            setManualModal(null)
            void cargarConfig()
          }}
        />
      )}
    </div>
  )
}
