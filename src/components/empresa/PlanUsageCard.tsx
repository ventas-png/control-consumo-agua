import { type CSSProperties } from 'react'
import { usePlanLimits } from '../../hooks/usePlanLimits'
import { promptUpgrade, type UpgradeResource } from '../shared/promptUpgrade'

// ============================================================================
// PlanUsageCard — F4.2.2: Visibilidad operacional del uso del plan.
// ============================================================================
// Card en EmpresaSection con 2 barras de progreso (proyectos, unidades) y CTA
// "Mejorar plan" cuando se cruza el umbral critico. Aprovecha el hook
// usePlanLimits (F2.13) que ya consolida limites efectivos + uso actual.
//
// Estados visuales por barra:
//   - < 70% : verde (ok)
//   - 70-89%: amarillo (warning, aviso temprano)
//   - >= 90%: rojo (critical) + CTA visible
//
// Si el plan es ilimitado (max === null), muestra "(ilimitado)" sin barra.

interface Props {
  companyId: string | null | undefined
}

export function PlanUsageCard({ companyId }: Props) {
  const limits = usePlanLimits(companyId)

  if (!companyId) return null
  if (limits.loading) {
    return (
      <div style={cardStyle}>
        <div style={titleStyle}>Uso del plan</div>
        <div style={{ color: 'var(--at-ink-3)', fontSize: '13px' }}>Cargando…</div>
      </div>
    )
  }
  if (limits.error) {
    // No mostrar la card si fallo el RPC — silencioso para no entorpecer la UI
    return null
  }

  return (
    <div style={cardStyle}>
      <div style={titleStyle}>Uso del plan</div>
      <UsageBar
        label="Proyectos"
        current={limits.projects_count}
        max={limits.max_projects}
        resource="project"
      />
      <UsageBar
        label="Unidades"
        current={limits.units_count}
        max={limits.max_units}
        resource="unit"
      />
    </div>
  )
}

interface UsageBarProps {
  label: string
  current: number
  max: number | null
  resource: UpgradeResource
}

function UsageBar({ label, current, max, resource }: UsageBarProps) {
  // Plan ilimitado: sin barra, solo contador
  if (max === null) {
    return (
      <div style={{ marginTop: '14px' }}>
        <div style={rowStyle}>
          <span style={labelStyle}>{label}</span>
          <span style={{ color: 'var(--at-ink-2)', fontSize: '13px', fontWeight: 600 }}>
            {current} <span style={{ color: 'var(--at-ink-3)', fontWeight: 400 }}>(ilimitado)</span>
          </span>
        </div>
      </div>
    )
  }

  const pct = max > 0 ? Math.min((current / max) * 100, 100) : 0
  const variant: 'ok' | 'warn' | 'critical' =
    pct < 70 ? 'ok' : pct < 90 ? 'warn' : 'critical'
  const barColor =
    variant === 'ok'       ? 'var(--at-success)' :
    variant === 'warn'     ? 'var(--at-warning)' :
                             'var(--at-danger)'
  const textColor =
    variant === 'ok'       ? 'var(--at-ink-2)' :
    variant === 'warn'     ? 'var(--at-warning)' :
                             'var(--at-danger)'
  const reachedLimit = current >= max

  return (
    <div style={{ marginTop: '14px' }}>
      <div style={rowStyle}>
        <span style={labelStyle}>{label}</span>
        <span style={{ color: textColor, fontSize: '13px', fontWeight: 600 }}>
          {current} / {max}{' '}
          <span style={{ color: 'var(--at-ink-3)', fontWeight: 400 }}>({Math.round(pct)}%)</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label}: ${current} de ${max}`}
        aria-valuenow={current}
        aria-valuemin={0}
        aria-valuemax={max}
        style={{
          marginTop: '6px',
          background: 'var(--at-chip)',
          borderRadius: '6px',
          height: '8px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: barColor,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      {reachedLimit && (
        <button
          type="button"
          onClick={() => { void promptUpgrade({ resource, current, limit: max }) }}
          style={ctaStyle}
        >
          Mejorar plan
        </button>
      )}
    </div>
  )
}

const cardStyle: CSSProperties = {
  background: 'var(--at-surface)',
  border: '1px solid var(--at-line)',
  borderRadius: '12px',
  padding: '16px 18px',
}

const titleStyle: CSSProperties = {
  fontSize: '13px',
  fontWeight: 700,
  color: 'var(--at-ink)',
  marginBottom: '4px',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: '12px',
}

const labelStyle: CSSProperties = {
  fontSize: '13px',
  color: 'var(--at-ink-2)',
  fontWeight: 500,
}

const ctaStyle: CSSProperties = {
  marginTop: '8px',
  padding: '6px 14px',
  borderRadius: '8px',
  border: 'none',
  background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
  color: 'white',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
}
