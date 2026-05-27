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
    // Sample 10% of transactions in prod, everything elsewhere.
    tracesSampleRate: ENV === 'production' ? 0.1 : 1.0,
    // Don't attach IP / cookies. We set a minimal user (id/company/role) explicitly.
    sendDefaultPii: false,
  })
  enabled = true
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return
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
