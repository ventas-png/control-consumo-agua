import posthog from 'posthog-js'

// Product analytics, vendor-neutral wrapper around PostHog. Fully optional: if
// VITE_POSTHOG_KEY is not set, every function is a no-op. Swapping vendors only
// requires changing this file.
//
// Session replay is intentionally OFF by default: it would require loading an
// external recorder script (CSP `script-src` + `worker-src blob:`) and can
// capture resident PII. Enable it deliberately once a privacy review is done.

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://us.i.posthog.com'

let enabled = false

export function initAnalytics(): void {
  if (!KEY || enabled) return
  posthog.init(KEY, {
    api_host: HOST,
    person_profiles: 'identified_only',
    capture_pageview: true,
    disable_session_recording: true,
  })
  enabled = true
}

export function identify(id: string, props?: Record<string, unknown>): void {
  if (!enabled) return
  posthog.identify(id, props)
}

// Super-properties multi-tenant: cada `track()` llevará estas props automáticamente
// (sin tener que pasarlas en cada call). PostHog las persiste hasta el siguiente
// `reset()`. Reservado para datos del tenant activo (company_id, role, plan), no
// para datos del evento puntual.
export interface SuperProperties {
  company_id?: string | null
  role?: string | null
  plan?: string | null
  [key: string]: unknown
}

export function registerSuperProperties(props: SuperProperties): void {
  if (!enabled) return
  posthog.register(props)
}

export function track(event: string, props?: Record<string, unknown>): void {
  if (!enabled) return
  posthog.capture(event, props)
}

export function resetAnalytics(): void {
  if (!enabled) return
  // posthog.reset() ya limpia las super-properties registradas, no necesita
  // llamada adicional.
  posthog.reset()
}
