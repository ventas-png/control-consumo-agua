// Helpers puros de la analítica SaaS del dashboard superadmin (testeables sin
// React ni supabase). Centralizan las fórmulas para que cada número se calcule
// en UN solo lugar:
//   · churnRatePct       — misma fórmula que venía usando SuperAdminMetricsCard.
//   · computeArpaCents   — MRR cobrable / empresas activas de pago (sin pilotos).
//   · computeDeltaPct    — variación % de una serie diaria en ventana ~30 días.
//   · computeDeltaMrr    — delta del MRR cobrable con fallback etiquetado al total.
//   · computeNetGrowth   — altas − bajas del último mes COMPLETO.
//   · computeConversionTrial — conversión de las últimas 3 cohortes completas.
//   · buildPlanDoughnut  — top 5 planes + "Otros" para la dona de composición.
import { parseFecha } from '../../lib/format'
import { planCodeLabel } from './empresaHelpers'
import type { MrrTrendPoint, PlanDistributionEntry, SuperadminTrendPoint, TrialCohortePoint } from '../../domain/superadmin/queries'

/**
 * Churn 30d en % — fórmula ÚNICA de la plataforma (idéntica a la histórica de
 * SuperAdminMetricsCard): canceladas / (activas + trialing + canceladas) × 100.
 * Denominador 0 → 0.
 */
export function churnRatePct(activas: number, trialing: number, canceladas30d: number): number {
  const denominador = activas + trialing + canceladas30d
  if (denominador === 0) return 0
  return (canceladas30d / denominador) * 100
}

/**
 * ARPA (average revenue per account) en cents: MRR cobrable entre empresas
 * activas DE PAGO (excluye pilotos grandfathered, que no aportan al numerador).
 * Denominador ≤ 0 → null (se pinta "—").
 */
export function computeArpaCents(
  mrrCobrableCents: number,
  suscripcionesActivas: number,
  empresasGrandfathered: number,
): number | null {
  const cuentasDePago = suscripcionesActivas - empresasGrandfathered
  if (cuentasDePago <= 0) return null
  return Math.round(mrrCobrableCents / cuentasDePago)
}

const DIA_MS = 24 * 60 * 60 * 1000

/**
 * Variación % de una serie diaria en ventana de ~30 días: compara el último
 * punto con valor no-null contra el punto no-null más cercano a (último − 30
 * días) que tenga al menos 25 días de antigüedad respecto al último. Devuelve
 * null si no hay 2 puntos válidos suficientemente separados o si el punto base
 * es 0 (evita divisiones por cero e "infinitos" de series recién activadas).
 */
export function computeDeltaPct(
  serie: MrrTrendPoint[],
  valor: (p: MrrTrendPoint) => number | null | undefined,
): number | null {
  const puntos = serie
    .map(p => ({ t: parseFecha(p.day).getTime(), v: valor(p) }))
    .filter((p): p is { t: number; v: number } => typeof p.v === 'number' && !Number.isNaN(p.t))
  if (puntos.length < 2) return null

  const ultimo = puntos[puntos.length - 1]
  const objetivo = ultimo.t - 30 * DIA_MS
  let base: { t: number; v: number } | null = null
  for (const p of puntos) {
    if (ultimo.t - p.t < 25 * DIA_MS) break
    if (base === null || Math.abs(p.t - objetivo) < Math.abs(base.t - objetivo)) base = p
  }
  if (!base || base.v === 0) return null
  return Math.round(((ultimo.v - base.v) / base.v) * 1000) / 10
}

export interface DeltaMrr {
  pct: number
  /** Sobre qué serie se calculó: la cobrable, o el MRR total como fallback
   *  etiquetado mientras el desglose histórico no exista. */
  base: 'cobrable' | 'total'
}

/**
 * Delta 30d del MRR cobrable. Mientras la serie cobrable no tenga historia
 * (columnas nuevas, no reconstruibles hacia atrás) cae al MRR total — el
 * llamador DEBE etiquetar ese fallback ("· MRR total"). null = sin comparativo.
 */
export function computeDeltaMrr(serie: MrrTrendPoint[]): DeltaMrr | null {
  const cobrable = computeDeltaPct(serie, p => p.mrr_cobrable_cents ?? null)
  if (cobrable !== null) return { pct: cobrable, base: 'cobrable' }
  const total = computeDeltaPct(serie, p => p.mrr_cents)
  if (total !== null) return { pct: total, base: 'total' }
  return null
}

export interface NetGrowth {
  mes: string
  altas: number
  bajas: number
  neto: number
}

/**
 * Crecimiento neto (altas de empresas − bajas de suscripciones) del último mes
 * COMPLETO — el mes en curso se excluye porque aún puede moverse. null si la
 * serie no trae ningún mes cerrado.
 */
export function computeNetGrowth(trends: SuperadminTrendPoint[], hoy: Date = new Date()): NetGrowth | null {
  const inicioMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1).getTime()
  const cerrados = trends.filter(t => parseFecha(t.mes).getTime() < inicioMesActual)
  const ultimo = cerrados[cerrados.length - 1]
  if (!ultimo) return null
  return { mes: ultimo.mes, altas: ultimo.altas, bajas: ultimo.bajas, neto: ultimo.altas - ultimo.bajas }
}

export interface ConversionTrial {
  pct: number
  /** Cuántas cohortes completas entraron al cálculo (≤ 3). */
  cohortes: number
}

/**
 * Conversión de trial de las (hasta) 3 cohortes mensuales COMPLETAS más
 * recientes: (activas cobrables + activas sin cobro) / trials × 100. El mes en
 * curso se excluye (su cohorte sigue en trial). null si no hay trials.
 */
export function computeConversionTrial(
  cohortes: TrialCohortePoint[],
  hoy: Date = new Date(),
): ConversionTrial | null {
  const inicioMesActual = new Date(hoy.getFullYear(), hoy.getMonth(), 1).getTime()
  const completas = cohortes
    .filter(c => parseFecha(c.mes).getTime() < inicioMesActual)
    .slice(-3)
  const trials = completas.reduce((s, c) => s + c.trials, 0)
  if (trials === 0) return null
  const convertidas = completas.reduce((s, c) => s + c.activas_cobrables + c.activas_sin_cobro, 0)
  return { pct: Math.round((convertidas / trials) * 1000) / 10, cohortes: completas.length }
}

export interface PlanDoughnutData {
  labels: string[]
  counts: number[]
}

/**
 * Datos de la dona de composición por plan: top 5 por count + "Otros"
 * agregado. planName con fallback a la etiqueta legible del code.
 */
export function buildPlanDoughnut(dist: PlanDistributionEntry[]): PlanDoughnutData {
  const ordenada = [...dist].sort((a, b) => b.count - a.count)
  const top = ordenada.slice(0, 5)
  const resto = ordenada.slice(5).reduce((s, p) => s + p.count, 0)
  const labels = top.map(p => p.planName || planCodeLabel(p.planCode))
  const counts = top.map(p => p.count)
  if (resto > 0) {
    labels.push('Otros')
    counts.push(resto)
  }
  return { labels, counts }
}

const MESES_NOMBRES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

/** "2026-06-01" → "Jun 2026" (etiqueta de mes para las gráficas mensuales). */
export function formatMesLabel(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return mes
  return `${MESES_NOMBRES[m - 1]} ${y}`
}

/** Minutos transcurridos desde un timestamp ISO; null si no parsea. */
export function minutosDesde(iso: string | null | undefined, ahora: Date = new Date()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((ahora.getTime() - t) / 60000))
}
