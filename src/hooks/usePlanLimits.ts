import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Limites efectivos y uso actual de una company (plat:P1 part 3, F2.13).
// Wrapper sobre las RPCs get_company_effective_limits y get_company_usage,
// que centralizan la logica GREATEST(plan, legacy_override).
//
// Devuelve NULL en max_X cuando el plan no impone limite (unlimited). El
// caller debe interpretarlo asi y desactivar cualquier UI de "limite alcanzado"
// en ese caso.
//
// Refresh manual via refresh(): util tras INSERT exitoso (volver a contar).

export interface PlanLimits {
  max_projects: number | null
  max_units: number | null
  projects_count: number
  units_count: number
  loading: boolean
  error: string | null
  refresh: () => void
}

export function usePlanLimits(companyId: string | null | undefined): PlanLimits {
  const [state, setState] = useState<{
    max_projects: number | null
    max_units: number | null
    projects_count: number
    units_count: number
    loading: boolean
    error: string | null
  }>({
    max_projects: null,
    max_units: null,
    projects_count: 0,
    units_count: 0,
    loading: true,
    error: null,
  })
  const [trigger, setTrigger] = useState(0)

  useEffect(() => {
    if (!companyId) {
      setState(s => ({ ...s, loading: false }))
      return
    }
    let alive = true
    setState(s => ({ ...s, loading: true, error: null }))
    void (async () => {
      const [limitsRes, usageRes] = await Promise.all([
        supabase.rpc('get_company_effective_limits', { p_company_id: companyId }),
        supabase.rpc('get_company_usage', { p_company_id: companyId }),
      ])
      if (!alive) return
      if (limitsRes.error || usageRes.error) {
        setState(s => ({
          ...s,
          loading: false,
          error: limitsRes.error?.message ?? usageRes.error?.message ?? 'Error cargando límites',
        }))
        return
      }
      const limits = (limitsRes.data as Array<{ max_projects: number | null; max_units: number | null }> | null)?.[0]
      const usage = (usageRes.data as Array<{ projects_count: number; units_count: number }> | null)?.[0]
      setState({
        max_projects: limits?.max_projects ?? null,
        max_units: limits?.max_units ?? null,
        projects_count: Number(usage?.projects_count ?? 0),
        units_count: Number(usage?.units_count ?? 0),
        loading: false,
        error: null,
      })
    })()
    return () => { alive = false }
  }, [companyId, trigger])

  return {
    ...state,
    refresh: () => setTrigger(t => t + 1),
  }
}
