import * as Sentry from '@sentry/react'

// Error & performance monitoring (Sentry). Fully optional: if VITE_SENTRY_DSN
// is not set, every function here is a no-op, so local/dev/preview builds work
// without any account or secret.

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined
// Tag del entorno para Sentry. En Vercel: setear la variable de proyecto
// `VITE_APP_ENV = $VERCEL_ENV` para que preview/production lleguen como
// entornos distintos al dashboard de Sentry. Sin esa variable cae a
// `MODE` de Vite (`development` local, `production` en builds).
const ENV = (import.meta.env.VITE_APP_ENV as string | undefined) ?? import.meta.env.MODE
const RELEASE = import.meta.env.VITE_APP_VERSION as string | undefined

let enabled = false

export function initMonitoring(): void {
  if (!DSN || enabled) return
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    release: RELEASE,
    integrations: [Sentry.browserTracingIntegration()],
    // Sampling por severidad: en prod, las transacciones normales se reducen
    // al 10% para mantener el costo bajo, pero las que tienen marca de error
    // o pertenecen a flujos críticos (pagos, auth) se conservan al 100%.
    // En no-prod conservamos todo para debug local.
    tracesSampler: (samplingContext) => {
      if (ENV !== 'production') return 1.0

      // Rutas que SIEMPRE queremos capturar al 100% en producción.
      // Mantener la lista corta: cada entrada es un trace siempre incluido.
      const criticalNames = [
        'login',
        'oauth',
        'payment',
        'stripe',
        'create-user',
        'delete-user',
        'create-payment-intent',
      ]
      const name = samplingContext.name ?? ''
      if (criticalNames.some(c => name.toLowerCase().includes(c))) return 1.0

      // Transacciones que ya nacieron como error: siempre.
      const parent = samplingContext.parentSampled
      if (parent === true) return 1.0

      // Resto: 10%.
      return 0.1
    },
    // Ruido conocido sin impacto en el usuario (Sentry PINK-RIBBON-A):
    // supabase-js coordina la sesión entre pestañas con la Web Locks API; cuando
    // otra pestaña adquiere el candado con `steal` (p. ej. al cerrar/abrir
    // pestañas), la que lo pierde lanza este AbortError y sigue funcionando.
    ignoreErrors: ["Lock broken by another request with the 'steal' option."],
    // Don't attach IP / cookies. We set a minimal user (id/company/role) explicitly.
    sendDefaultPii: false,
  })
  enabled = true
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
  // `tags` se INDEXAN en Sentry (a diferencia de `context`, que va como `extra`):
  // son la única forma de que las Alert Rules filtren por evento (p.ej.
  // event.tags["slo_breach"] = "true"). Ver docs/ALERTING.md.
  tags?: Record<string, string | number | boolean>,
): void {
  if (!enabled) return
  if (tags) {
    Sentry.withScope((scope) => {
      scope.setTags(tags)
      if (context) scope.setExtras(context)
      Sentry.captureException(error)
    })
    return
  }
  Sentry.captureException(error, context ? { extra: context } : undefined)
}

export interface MonitoringUser {
  id: string
  companyId?: string | null
  role?: string
}

export function setMonitoringUser(user: MonitoringUser | null): void {
  if (!enabled) return
  Sentry.setUser(
    user ? { id: user.id, company_id: user.companyId ?? undefined, role: user.role } : null
  )
}
