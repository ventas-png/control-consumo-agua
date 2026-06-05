/**
 * Feature flags por plan (plat:P36).
 *
 * Lee las features programaticas que incluye el plan activo del tenant via
 * la vista `my_feature_flags`. El usuario obtiene un Set<string> de codes
 * que puede consultar para gating de UI/funcionalidades.
 *
 * **Diferencia con `companies.servicio_*`**: aquellos son binarios (agua /
 * condominios). Estos son features dentro de cada modulo (asambleas
 * digitales, transparencia financiera, cobranza judicial, etc).
 *
 * @example
 * const { has, loading } = useFeatureFlags()
 * if (loading) return <Spinner />
 * if (!has('asambleas_digitales')) return <UpgradeBanner feature="asambleas" />
 *
 * @example uso declarativo
 * <FeatureGate feature="cobranza_judicial" fallback={<UpgradeBanner />}>
 *   <CobranzaJudicialTab />
 * </FeatureGate>
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from './supabase'
import { logger } from './logger'

// ── Catalogo de feature codes ───────────────────────────────────────────────
// Mantener sincronizado con el seed de billing_plans.feature_codes en
// supabase/migrations/20260602000000_feature_flags_per_plan.sql

export const FEATURE_CODES = [
  'asambleas_digitales',
  'transparencia_financiera',
  'cobranza_judicial',
  'analisis_cartera',
  'automation',
  'api_access',
  'white_label',
  'multi_proyecto',
  'exportacion_avanzada',
  'enterprise_sso',
] as const

export type FeatureCode = typeof FEATURE_CODES[number]

// ── Tipos del contexto ──────────────────────────────────────────────────────

interface FeatureFlagsContextValue {
  /** Set de codes que el plan actual incluye. */
  flags: Set<FeatureCode>
  /** Helper: `flags.has(code)` shortcut. */
  has: (code: FeatureCode) => boolean
  /** True mientras se carga por primera vez. */
  loading: boolean
  /** Plan code activo (agua_only/condominios_only/bundle) o null si no hay subscription. */
  planCode: string | null
  /** Nombre legible del plan. */
  planName: string | null
  /** Refresca manualmente (ej. tras upgrade). */
  refresh: () => Promise<void>
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | null>(null)

// ── Provider ────────────────────────────────────────────────────────────────

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<Set<FeatureCode>>(new Set())
  const [planCode, setPlanCode] = useState<string | null>(null)
  const [planName, setPlanName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('my_feature_flags')
        .select('feature_code, plan_code, plan_name')
      if (error) throw error
      const rows = (data ?? []) as Array<{ feature_code: string; plan_code: string; plan_name: string }>
      const codes = new Set<FeatureCode>()
      for (const r of rows) {
        // Solo agregar codes conocidos (defensivo contra DB con codes nuevos no declarados aun)
        if ((FEATURE_CODES as readonly string[]).includes(r.feature_code)) {
          codes.add(r.feature_code as FeatureCode)
        }
      }
      setFlags(codes)
      setPlanCode(rows[0]?.plan_code ?? null)
      setPlanName(rows[0]?.plan_name ?? null)
    } catch (e) {
      logger.warn('featureFlags: could not load flags', { error: String(e) })
      // No-flag fallback: el usuario ve la app sin features premium pero no crashea
      setFlags(new Set())
      setPlanCode(null)
      setPlanName(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const value = useMemo<FeatureFlagsContextValue>(() => ({
    flags,
    has: (code: FeatureCode) => flags.has(code),
    loading,
    planCode,
    planName,
    refresh: load,
  }), [flags, loading, planCode, planName, load])

  return (
    <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>
  )
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useFeatureFlags(): FeatureFlagsContextValue {
  const ctx = useContext(FeatureFlagsContext)
  if (!ctx) {
    // Permite usar el hook fuera del Provider en tests, devolviendo todo vacío.
    return {
      flags: new Set(),
      has: () => false,
      loading: false,
      planCode: null,
      planName: null,
      refresh: async () => {},
    }
  }
  return ctx
}

// ── Componente declarativo ─────────────────────────────────────────────────

interface FeatureGateProps {
  feature: FeatureCode
  /** Que renderizar cuando el plan NO incluye la feature. */
  fallback?: ReactNode
  /** Que renderizar mientras carga (default: null = nada hasta saber). */
  loadingFallback?: ReactNode
  children: ReactNode
}

/**
 * Renderiza `children` solo si el plan incluye `feature`. Si no, renderiza
 * `fallback` (default: null). Util para gating de tabs/secciones premium.
 *
 * @example
 * <FeatureGate feature="asambleas_digitales" fallback={<UpgradeCTA />}>
 *   <PortalAsambleasTab />
 * </FeatureGate>
 */
export function FeatureGate({ feature, fallback = null, loadingFallback = null, children }: FeatureGateProps) {
  const { has, loading } = useFeatureFlags()
  if (loading) return <>{loadingFallback}</>
  if (!has(feature)) return <>{fallback}</>
  return <>{children}</>
}
