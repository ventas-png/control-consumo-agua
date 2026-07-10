import { useState, useEffect } from 'react'
import { fetchActiveSubscription } from '../../domain/shared/queries'
import { openBillingSection } from './promptUpgrade'

// ============================================================================
// PastDueBanner — P0 #2 (auditoría 2026-07-10): dunning ante pago fallido.
// ============================================================================
// Se monta en App.tsx (junto al TrialExpirationBanner) y solo se renderiza
// cuando subscription.status === 'past_due'. Comunica que el pago falló y que,
// pasada la ventana de gracia (DUNNING_GRACE_DAYS desde past_due_since), la
// cuenta cae a SOLO LECTURA por el enforcement server-side
// (company_write_enabled + triggers enforce_company_write_active).
//
// No es descartable: un pago fallido es acción requerida, no un aviso opcional.
// CTA reutiliza openBillingSection (Perfil → Mi plan / Administrar facturación)
// para mantener un solo flujo de billing en toda la app.

// Debe coincidir con la gracia del write-gate en la migración
// 20260710030000_dunning_past_due_readonly.sql.
const DUNNING_GRACE_DAYS = 14

interface SubscriptionRow {
  status: string
  past_due_since?: string | null
}

interface Props {
  companyId: string | null | undefined
}

export function PastDueBanner({ companyId }: Props) {
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!companyId) { setLoading(false); return }
    let alive = true
    void fetchActiveSubscription(companyId).then((data) => {
      if (!alive) return
      setSubscription(data)
      setLoading(false)
    })
    return () => { alive = false }
  }, [companyId])

  if (loading || !subscription) return null
  if (subscription.status !== 'past_due') return null

  // Días restantes de gracia antes de solo-lectura. Sin past_due_since (dato
  // legacy) asumimos que aún hay gracia y no anunciamos una fecha.
  let daysLeft: number | null = null
  let isReadOnly = false
  if (subscription.past_due_since) {
    const since = new Date(subscription.past_due_since).getTime()
    const deadline = since + DUNNING_GRACE_DAYS * 24 * 60 * 60 * 1000
    const msLeft = deadline - Date.now()
    daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000))
    isReadOnly = msLeft <= 0
  }

  const bgColor = 'var(--at-danger-tint)'
  const borderColor = 'var(--at-danger)'
  const textColor = 'var(--at-danger)'

  function handleUpdatePayment() {
    // Mismo flujo de billing que el resto de la app (Perfil → Mi plan, con
    // "Administrar facturación" que abre el Stripe Billing Portal).
    openBillingSection()
  }

  const graceText =
    daysLeft === null
      ? 'Actualiza tu método de pago para evitar la suspensión.'
      : isReadOnly
        ? <>La cuenta está en <strong>modo solo lectura</strong> por falta de pago. Actualiza tu método de pago para reactivar.</>
        : daysLeft <= 1
          ? <>Actualiza tu método de pago <strong>hoy</strong>: la cuenta pasará a solo lectura muy pronto.</>
          : <>Tienes <strong>{daysLeft} días</strong> para actualizar tu método de pago antes de que la cuenta pase a solo lectura.</>

  return (
    <div
      role="alert"
      style={{
        background: bgColor,
        borderBottom: `2px solid ${borderColor}`,
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        flexWrap: 'wrap',
        position: 'sticky',
        top: 0,
        zIndex: 151,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
        <span style={{ fontSize: '20px' }} aria-hidden="true">⚠️</span>
        <span style={{ color: textColor, fontWeight: 600, fontSize: '14px' }}>
          El pago de tu suscripción fue rechazado. {graceText}
        </span>
      </div>
      <button
        onClick={handleUpdatePayment}
        style={{
          padding: '6px 14px',
          borderRadius: '8px',
          border: 'none',
          background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
          color: 'white',
          fontWeight: 600,
          fontSize: '13px',
          cursor: 'pointer',
        }}
      >
        Actualizar método de pago
      </button>
    </div>
  )
}
