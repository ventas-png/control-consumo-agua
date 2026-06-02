/**
 * UpgradeCTA — banner mostrado cuando un usuario intenta acceder a una
 * funcionalidad bloqueada por su plan actual. Linkea a la pagina de upgrade.
 */

import { type ReactNode } from 'react'
import { Button } from './Button'
import { useFeatureFlags } from '../../lib/featureFlags'

interface Props {
  /** Nombre legible de la feature ('Asambleas digitales', 'Cobranza judicial'). */
  feature: string
  /** Descripcion corta del beneficio (opcional). */
  description?: ReactNode
  /** Tier minimo requerido (default 'Bundle Completo'). */
  requiredPlan?: string
  /** Handler al hacer click en "Actualizar plan". Si no se pasa, va a /empresa. */
  onUpgrade?: () => void
}

export function UpgradeCTA({
  feature,
  description,
  requiredPlan = 'Bundle Completo',
  onUpgrade,
}: Props) {
  const { planName } = useFeatureFlags()

  function handleClick() {
    if (onUpgrade) {
      onUpgrade()
      return
    }
    // Default: scroll to empresa / billing section
    window.location.hash = '#empresa'
  }

  return (
    <div
      role="region"
      aria-label={`${feature} requiere upgrade`}
      style={{
        background: 'linear-gradient(135deg, var(--at-primary-tint), var(--at-accent-tint))',
        border: '1.5px solid var(--at-primary-soft-2)',
        borderRadius: 14,
        padding: '28px 32px',
        textAlign: 'center',
        maxWidth: 560,
        margin: '40px auto',
      }}
    >
      <div style={{ fontSize: 42, marginBottom: 12 }}>🔒</div>
      <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: 'var(--at-ink)' }}>
        {feature} no incluido en tu plan
      </h2>
      {description && (
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--at-ink-2)', lineHeight: 1.5 }}>
          {description}
        </p>
      )}
      <p style={{ margin: '0 0 20px', fontSize: 12, color: 'var(--at-ink-3)' }}>
        Tu plan actual: <strong>{planName ?? '—'}</strong> · Requiere: <strong>{requiredPlan}</strong>
      </p>
      <Button variant="gradient-primary" onClick={handleClick} iconLeft="✨">
        Actualizar plan
      </Button>
    </div>
  )
}
