/**
 * UpgradeCTA — banner mostrado cuando un usuario intenta acceder a una
 * funcionalidad bloqueada por su plan actual. Click "Actualizar" abre
 * Stripe Checkout directamente (plat:P36d) o invoca `onUpgrade` custom.
 */

import { useState, type ReactNode } from 'react'
import { Button } from './Button'
import { useFeatureFlags } from '../../lib/featureFlags'
import { createCheckoutSession } from '../../domain/shared/mutations'
import { trackFunnel, FUNNEL } from '../../lib/analytics'
import { notify } from './Dialog'

interface Props {
  /** Nombre legible de la feature ('Asambleas digitales', 'Cobranza judicial'). */
  feature: string
  /** Descripcion corta del beneficio (opcional). */
  description?: ReactNode
  /** Tier minimo requerido (default 'Bundle Completo'). */
  requiredPlan?: string
  /** Plan code para Stripe Checkout (default 'bundle'). */
  targetPlanCode?: 'agua_only' | 'condominios_only' | 'bundle'
  /** Billing cycle para Stripe Checkout. */
  billingCycle?: 'monthly' | 'yearly'
  /** Handler custom al hacer click. Override del flujo Stripe. */
  onUpgrade?: () => void
}

export function UpgradeCTA({
  feature,
  description,
  requiredPlan = 'Bundle Completo',
  targetPlanCode = 'bundle',
  billingCycle = 'monthly',
  onUpgrade,
}: Props) {
  const { planName, refresh } = useFeatureFlags()
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    if (onUpgrade) {
      onUpgrade()
      return
    }

    setLoading(true)
    trackFunnel(FUNNEL.checkoutIniciado, { origen: 'upgrade_cta', feature, plan_destino: targetPlanCode, ciclo: billingCycle })
    try {
      // plat:P36d — invoca edge function que crea Stripe Checkout session
      // y devuelve la URL. Redirigimos al usuario alli para completar el pago.
      const { url, swapped, error } = await createCheckoutSession({
        plan_code: targetPlanCode,
        billing_cycle: billingCycle,
        return_path: window.location.pathname + window.location.hash,
      })

      if (error) throw new Error(error)

      // P0 #1: la company ya tenía suscripción activa → el edge cambió el plan
      // in-place (con prorrateo, sin URL). Antes este camino caía al throw de
      // "No se obtuvo URL": el usuario veía un error mientras Stripe SÍ había
      // aplicado el upgrade. Éxito + refresh de flags desbloquea la feature.
      if (swapped) {
        trackFunnel(FUNNEL.planActualizado, { origen: 'upgrade_cta', plan_destino: targetPlanCode })
        notify({
          variant: 'success',
          title: 'Tu plan se actualizó',
          text: 'El cambio ya está activo; el ajuste se prorratea en tu próxima factura.',
        })
        await refresh()
        setLoading(false)
        return
      }

      if (!url) throw new Error('No se obtuvo URL de checkout')

      window.location.href = url
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al abrir checkout'
      notify({
        variant: 'error',
        title: 'No se pudo abrir el checkout',
        text: `${msg}. Intenta de nuevo o contacta a soporte.`,
      })
      setLoading(false)
    }
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
      <Button
        variant="gradient-primary"
        onClick={handleClick}
        loading={loading}
        loadingText="Abriendo checkout…"
        iconLeft={!loading ? '✨' : undefined}
      >
        Actualizar plan
      </Button>
    </div>
  )
}
