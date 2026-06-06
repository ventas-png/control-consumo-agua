import { useState, useEffect } from 'react'
import { fetchActiveSubscription } from '../../domain/shared/queries'
import { promptUpgrade } from './promptUpgrade'

// ============================================================================
// TrialExpirationBanner — F4.3.3: warning persistente cuando el trial esta
// cerca de expirar.
// ============================================================================
// Se monta en App.tsx (despues del topbar) y solo se renderiza cuando:
//   - subscription.status === 'trialing'
//   - trial_end existe y esta a <= TRIAL_WARN_DAYS dias
//
// CTA "Configurar pago" reutiliza promptUpgrade (F4.1.2) que navega al plan
// picker en Perfil → Mi plan. Mantiene un solo flow de conversion en toda la
// app (consistencia + menor mantenimiento).
//
// Dismiss local: el usuario puede ocultarlo via sessionStorage (no persiste
// entre sesiones — re-aparece en cada login asi sigue conduciendo a conversion).

const TRIAL_WARN_DAYS = 7
const DISMISS_KEY = 'at:trial-banner-dismissed'

interface SubscriptionRow {
  status: string
  trial_end: string | null
}

interface Props {
  companyId: string | null | undefined
}

export function TrialExpirationBanner({ companyId }: Props) {
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })

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

  if (loading || dismissed || !subscription) return null
  if (subscription.status !== 'trialing' || !subscription.trial_end) return null

  const trialEnd = new Date(subscription.trial_end)
  const now = new Date()
  const msLeft = trialEnd.getTime() - now.getTime()
  const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000))

  // Expirado o muy lejos: no mostramos. Lejos = el usuario no necesita aun el
  // recordatorio; expirado = el subscription deberia haber pasado a active o
  // past_due (otro componente maneja esos casos).
  if (daysLeft > TRIAL_WARN_DAYS || daysLeft < 0) return null

  const isUrgent = daysLeft <= 2
  const bgColor = isUrgent ? 'var(--at-danger-tint)' : 'var(--at-warning-tint)'
  const borderColor = isUrgent ? 'var(--at-danger)' : 'var(--at-warning)'
  const textColor = isUrgent ? 'var(--at-danger)' : 'var(--at-warning)'

  const daysText = daysLeft === 0
    ? 'hoy'
    : daysLeft === 1
      ? 'mañana'
      : `en ${daysLeft} días`

  function handleDismiss() {
    setDismissed(true)
    try { sessionStorage.setItem(DISMISS_KEY, '1') } catch { /* no-op */ }
  }

  async function handleUpgrade() {
    // promptUpgrade no aplica aqui directamente (no es limit-reached). Usamos
    // su mismo CustomEvent para navegar al plan picker. Importamos solo por
    // consistencia del CTA → mismo destino.
    await promptUpgrade({ resource: 'project', current: 0, limit: 0 })
  }

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
        zIndex: 150,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
        <span style={{ fontSize: '20px' }} aria-hidden="true">{isUrgent ? '⏰' : 'ℹ️'}</span>
        <span style={{ color: textColor, fontWeight: 600, fontSize: '14px' }}>
          Tu trial termina <strong>{daysText}</strong>. Configura un método de pago para no perder acceso.
        </span>
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={() => { void handleUpgrade() }}
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
          Configurar pago
        </button>
        <button
          onClick={handleDismiss}
          aria-label="Ocultar este aviso por esta sesión"
          style={{
            padding: '6px 10px',
            borderRadius: '8px',
            border: '1px solid var(--at-line-strong)',
            background: 'transparent',
            color: textColor,
            fontSize: '13px',
            cursor: 'pointer',
          }}
        >
          Después
        </button>
      </div>
    </div>
  )
}
