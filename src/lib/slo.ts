/**
 * SLO definitions + tracking (infra:I3).
 *
 * Service Level Objectives definidos como código para que:
 * 1. Los targets vivan en el repo (versionados, revisables en PRs).
 * 2. Sentry/PostHog reciban eventos taggeados con `slo_breach=true` cuando
 *    un flujo crítico excede el target, habilitando alertas dedicadas.
 * 3. Métricas custom (`measureSLO`) emitan latency + success rate sin que
 *    cada call site tenga que instrumentar manualmente.
 *
 * **Targets de latencia** (p95, cliente):
 * - Login flow:           < 3.0s (incluye round-trip a Supabase Auth)
 * - Cobro/pago:           < 3.0s (Stripe Checkout o pago manual)
 * - DataTable initial:    < 800ms (tabla principal, sin filtros)
 * - Tab switch:           < 500ms (cambiar de tab en condominios)
 * - Modal open:           < 200ms (snappy abrir modal)
 * - Search/filter:        < 400ms (cliente-side, ~10k rows)
 *
 * **Error rate** (porcentual, ventana 5min):
 * - Login:                < 1%   (fallos legítimos por credenciales no cuentan)
 * - Edge functions:       < 2%
 * - Pago/Stripe:          < 0.5%
 *
 * **Availability** (health endpoint):
 * - 99.9% mensual (≤ 43 min downtime/mes)
 *
 * Estos targets son TENTATIVOS — refinar tras 2-4 semanas de baseline en
 * Sentry. Si una metrica nunca breach, ajustar hacia abajo. Si breach
 * constantemente, refactorizar el flow o subir el target con justificación.
 */

import { captureException } from './monitoring'
import { track } from './analytics'
import { logger } from './logger'

// ── SLO catalog ─────────────────────────────────────────────────────────────

export const SLO_CATALOG = {
  // Latencia (ms)
  // 3.0s (antes 2.0s): baseline de 30 días mostró p50 de ~1.9s medido en
  // cliente — el servidor de Auth responde en 130-260ms, el resto es red del
  // usuario (móviles en GT). Con target de 2s, el 46% de logins "breachaba"
  // sin que hubiera nada accionable. Ver PR #543 y la revisión de infra.
  'login.complete':           { type: 'latency', target_p95_ms: 3000, severity: 'critical' },
  'auth.oauth.callback':      { type: 'latency', target_p95_ms: 3000, severity: 'critical' },
  'payment.checkout.open':    { type: 'latency', target_p95_ms: 3000, severity: 'critical' },
  'payment.manual.submit':    { type: 'latency', target_p95_ms: 2500, severity: 'critical' },
  'datatable.initial':        { type: 'latency', target_p95_ms: 800,  severity: 'high' },
  'datatable.search':         { type: 'latency', target_p95_ms: 400,  severity: 'medium' },
  'datatable.sort':           { type: 'latency', target_p95_ms: 300,  severity: 'medium' },
  'tab.switch':               { type: 'latency', target_p95_ms: 500,  severity: 'high' },
  'modal.open':               { type: 'latency', target_p95_ms: 200,  severity: 'medium' },
  'feature_flags.load':       { type: 'latency', target_p95_ms: 600,  severity: 'high' },

  // Error rate (porcentual)
  'login.error_rate':         { type: 'error_rate', target_pct: 1.0,  severity: 'critical' },
  'edge.error_rate':          { type: 'error_rate', target_pct: 2.0,  severity: 'high' },
  'payment.error_rate':       { type: 'error_rate', target_pct: 0.5,  severity: 'critical' },

  // Availability
  'health.uptime':            { type: 'availability', target_pct: 99.9, severity: 'critical' },
} as const

export type SLOKey = keyof typeof SLO_CATALOG

export type SLOSeverity = 'low' | 'medium' | 'high' | 'critical'

// ── Tracking ────────────────────────────────────────────────────────────────

interface BreachContext {
  /** Valor medido (ms para latency, count para errors). */
  measured: number
  /** Target del catalog. */
  target: number
  /** Severity heredada del catalog. */
  severity: SLOSeverity
  /** Props extra para diagnóstico (user_id, route, etc). */
  extra?: Record<string, unknown>
}

/**
 * Emite un evento de "SLO breach" a Sentry y PostHog. Sentry usa esto para
 * disparar alertas (tag `slo_breach=true`). PostHog acumula como event
 * `slo.breach` para construir dashboards "% breach por SLO en 24h".
 *
 * NO lanza error — es side-effect puro. La operación que falló sigue su flujo.
 */
export function trackSLOBreach(key: SLOKey, ctx: BreachContext): void {
  const def = SLO_CATALOG[key]
  if (!def) {
    logger.warn('slo: unknown key', { key })
    return
  }

  // Sentry: capturamos como exception con tags para alerting.
  const breachError = new Error(`SLO breach: ${key}`)
  captureException(breachError, {
    slo_key: key,
    slo_type: def.type,
    slo_severity: ctx.severity,
    slo_target: ctx.target,
    slo_measured: ctx.measured,
    slo_breach: true,
    ...ctx.extra,
  })

  // PostHog: event para dashboards.
  track('slo.breach', {
    slo_key: key,
    slo_type: def.type,
    slo_severity: ctx.severity,
    target: ctx.target,
    measured: ctx.measured,
    ...ctx.extra,
  })

  logger.warn(`slo.breach ${key}: ${ctx.measured} > ${ctx.target} (${ctx.severity})`, ctx.extra)
}

/**
 * Mide la latencia de una operación async y emite un breach si excede el target.
 *
 * @example
 * await measureSLO('datatable.initial', async () => {
 *   const data = await loadCuotas()
 *   setCuotas(data)
 * })
 */
export async function measureSLO<T>(
  key: SLOKey,
  op: () => Promise<T>,
  extra?: Record<string, unknown>,
): Promise<T> {
  const def = SLO_CATALOG[key]
  if (def.type !== 'latency') {
    // Para no-latency, simplemente ejecuta sin medir.
    return op()
  }

  const start = performance.now()
  try {
    const result = await op()
    const elapsed = performance.now() - start
    if (elapsed > def.target_p95_ms) {
      trackSLOBreach(key, {
        measured: Math.round(elapsed),
        target: def.target_p95_ms,
        severity: def.severity,
        extra,
      })
    }
    // Siempre trackear la latencia para histograma posthog.
    track('slo.latency', {
      slo_key: key,
      elapsed_ms: Math.round(elapsed),
      breached: elapsed > def.target_p95_ms,
      ...extra,
    })
    return result
  } catch (e) {
    // Si la operación lanzó, capturamos el tiempo Y propagamos.
    const elapsed = performance.now() - start
    track('slo.latency', {
      slo_key: key,
      elapsed_ms: Math.round(elapsed),
      errored: true,
      ...extra,
    })
    throw e
  }
}

/**
 * Helper para reportar un evento de error a un SLO de error_rate. Llama esto
 * en el catch de operaciones criticas — PostHog acumulará para calcular el
 * porcentaje en ventana movil.
 */
export function reportSLOError(
  key: SLOKey & (`${string}.error_rate`),
  extra?: Record<string, unknown>,
): void {
  track('slo.error', { slo_key: key, ...extra })
}
