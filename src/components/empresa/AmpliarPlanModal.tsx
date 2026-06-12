import { useState, useEffect } from 'react'
import { EditModal } from '../shared/EditModal'
import { notify } from '../shared/Dialog'
import { supabase } from '../../lib/supabase'
import { usePlanLimits } from '../../hooks/usePlanLimits'
import { fetchPlanPricing, fetchMonthlyTotalBreakdown } from '../../domain/facturacion/billing'
import { proyectarTotalConLimitesCents, type PlanPricingCents } from '../../lib/businessBilling'

// ============================================================================
// AmpliarPlanModal — ampliación self-service de los límites del tenant.
// ============================================================================
// El cobro es por USO (base + proyectos extra + unidades, sync diario a
// Stripe): ampliar límites no cobra nada por sí mismo — habilita crecer y el
// cobro sube cuando se crean los proyectos/unidades. El modal muestra el
// total actual y la PROYECCIÓN si se usara todo el límite solicitado
// (supuesto visible: unidades nuevas a tarifa de proyectos adicionales).
// La escritura pasa por la RPC solicitar_ampliacion_limites (valida rol
// owner/admin, suscripción viva y topes del plan; audita en audit_log).

interface BreakdownRow {
  total_cents: number
  primary_units_count: number
}

interface Props {
  companyId: string
  onClose: () => void
  /** El padre recarga proyectos/límites (la card de uso se remonta). */
  onSuccess: () => void
}

export function AmpliarPlanModal({ companyId, onClose, onSuccess }: Props) {
  const limits = usePlanLimits(companyId)
  const [pricing, setPricing] = useState<PlanPricingCents | null>(null)
  const [breakdown, setBreakdown] = useState<BreakdownRow | null>(null)
  const [maxProj, setMaxProj] = useState('')
  const [maxUnits, setMaxUnits] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void Promise.all([
      fetchPlanPricing<PlanPricingCents>(companyId),
      fetchMonthlyTotalBreakdown<BreakdownRow>(companyId),
    ]).then(([p, b]) => {
      if (!alive) return
      setPricing(p)
      setBreakdown(b)
    })
    return () => { alive = false }
  }, [companyId])

  // Sembrar los inputs con los límites actuales cuando cargan.
  useEffect(() => {
    if (limits.loading) return
    setMaxProj(prev => prev || String(limits.max_projects ?? ''))
    setMaxUnits(prev => prev || String(limits.max_units ?? ''))
  }, [limits.loading, limits.max_projects, limits.max_units])

  const curProj = limits.max_projects ?? 0
  const curUnits = limits.max_units ?? 0
  const newProj = parseInt(maxProj, 10) || 0
  const newUnits = parseInt(maxUnits, 10) || 0
  const capProj = pricing?.max_projects ?? null
  const capUnits = pricing?.max_units ?? null

  const proyeccionCents = pricing && newProj > 0 && newUnits > 0
    ? proyectarTotalConLimitesCents(pricing, newProj, newUnits, breakdown?.primary_units_count ?? 0)
    : null

  const sinCambios = newProj === curProj && newUnits === curUnits
  const invalido =
    newProj < curProj || newUnits < curUnits ||
    (capProj !== null && newProj > capProj) ||
    (capUnits !== null && newUnits > capUnits)

  async function ampliar() {
    if (sinCambios || invalido) return
    setSaving(true)
    const { error } = await supabase.rpc('solicitar_ampliacion_limites', {
      p_max_projects: newProj,
      p_max_units: newUnits,
    })
    setSaving(false)
    if (error) {
      // La RPC devuelve mensajes en español (rol, suscripción, tope del plan).
      notify({ variant: 'error', title: 'No se pudo ampliar', text: error.message })
      return
    }
    notify({
      variant: 'success',
      title: 'Límites ampliados',
      text: `Ahora puedes tener hasta ${newProj} proyecto(s) y ${newUnits} unidad(es). El cobro se ajusta según lo que crees.`,
      duration: 2500,
    })
    onSuccess()
    onClose()
  }

  return (
    <EditModal
      title="Ampliar plan"
      subtitle="Aumenta tus límites de proyectos y unidades — pagas solo por lo que usas."
      onClose={onClose}
      size="sm"
      footer={
        <>
          <button onClick={onClose} disabled={saving} style={btnSecondary}>Cancelar</button>
          <button
            onClick={() => void ampliar()}
            disabled={saving || sinCambios || invalido || limits.loading}
            style={{ ...btnPrimary, opacity: saving || sinCambios || invalido ? 0.6 : 1 }}
          >
            {saving ? 'Ampliando…' : 'Ampliar límites'}
          </button>
        </>
      }
    >
      {limits.loading ? (
        <div style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>Cargando límites…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <LimitInput
            label="Proyectos"
            hint={`En uso: ${limits.projects_count} · Límite actual: ${curProj}${capProj !== null ? ` · Máximo del plan: ${capProj}` : ''}`}
            value={maxProj}
            min={curProj}
            max={capProj}
            onChange={setMaxProj}
          />
          <LimitInput
            label="Unidades"
            hint={`En uso: ${limits.units_count} · Límite actual: ${curUnits}${capUnits !== null ? ` · Máximo del plan: ${capUnits.toLocaleString('es-GT')}` : ''}`}
            value={maxUnits}
            min={curUnits}
            max={capUnits}
            onChange={setMaxUnits}
          />

          {pricing && (
            <div style={{
              background: 'var(--at-surface-2)', border: '1px solid var(--at-line)',
              borderRadius: '10px', padding: '12px 14px', fontSize: '13px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                <span style={{ color: 'var(--at-ink-2)' }}>Cobro mensual actual</span>
                <strong>{formatUsd(breakdown?.total_cents ?? 0)}</strong>
              </div>
              {proyeccionCents !== null && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', marginTop: '6px' }}>
                  <span style={{ color: 'var(--at-ink-2)' }}>Si usas todo el nuevo límite</span>
                  <strong style={{ color: 'var(--at-primary)' }}>{formatUsd(proyeccionCents)}</strong>
                </div>
              )}
              <p style={{ margin: '10px 0 0', fontSize: '12px', color: 'var(--at-ink-3)', lineHeight: 1.5 }}>
                Tarifas: {formatUsd(pricing.extra_project_cents)}/proyecto adicional,{' '}
                {formatUsd(pricing.unit_primary_cents)}/unidad del proyecto principal,{' '}
                {formatUsd(pricing.unit_extra_cents)}/unidad en proyectos adicionales.
                Ampliar no cobra nada hoy: <strong>tu cobro real se ajusta según lo que crees</strong>{' '}
                (la proyección estima las unidades nuevas a la tarifa de proyectos adicionales).
              </p>
            </div>
          )}

          {invalido && (
            <div style={{ fontSize: '12px', color: 'var(--at-danger)' }} role="alert">
              Los límites solo pueden ampliarse y no exceder el máximo del plan.
            </div>
          )}
        </div>
      )}
    </EditModal>
  )
}

function LimitInput({ label, hint, value, min, max, onChange }: {
  label: string
  hint: string
  value: string
  min: number
  max: number | null
  onChange: (v: string) => void
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink)' }}>{label}</span>
      <input
        type="number"
        min={min}
        max={max ?? undefined}
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '140px', padding: '8px 10px', borderRadius: '8px',
          border: '1px solid var(--at-line-strong)', fontSize: '14px',
        }}
      />
      <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{hint}</span>
    </label>
  )
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const btnPrimary = {
  padding: '9px 18px', borderRadius: '8px', border: 'none',
  background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
  color: 'white', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
} as const

const btnSecondary = {
  padding: '9px 16px', borderRadius: '8px',
  border: '1px solid var(--at-line)', background: 'var(--at-surface)',
  color: 'var(--at-ink-2)', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
} as const
