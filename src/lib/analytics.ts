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
    // RGPD/CCPA: arrancamos OPTED-OUT. No se captura nada (ni pageviews) hasta que el
    // usuario acepte la categoría "analítica" en el banner de cookies. El consentimiento
    // guardado se aplica en el arranque vía applyStoredConsent() (lib/cookieConsent).
    opt_out_capturing_by_default: true,
  })
  enabled = true
}

/**
 * Aplica el consentimiento de la categoría "analítica". Sin efecto si PostHog no está
 * configurado (sin VITE_POSTHOG_KEY). Lo invoca lib/cookieConsent al guardar o al
 * rehidratar el consentimiento; nunca se llama directamente desde la UI.
 */
export function setAnalyticsConsent(granted: boolean): void {
  if (!enabled) return
  if (granted) posthog.opt_in_capturing()
  else posthog.opt_out_capturing()
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

// ── Catálogo de eventos del FUNNEL ───────────────────────────────────────────
//
// Nombres centralizados de los eventos clave del producto, para construir los
// embudos en PostHog sin que un typo rompa el reporte (signup → activación →
// monetización). `company_id`/`role`/`plan` ya viajan como super-properties (ver
// `registerSuperProperties` en App.tsx), así que NO hace falta pasarlos aquí.
//
// REGLA PII: las props de estos eventos llevan SOLO ids opacos / flags / montos,
// nunca nombres, emails, NIT/RFC ni datos de tarjeta.
export const FUNNEL = {
  /** Onboarding: una empresa completó el signup self-service (plat:P5). */
  companySignedUp: 'company_signed_up',
  /** Onboarding: un invitado aceptó la invitación y creó su cuenta (plat:P3). */
  invitationAccepted: 'invitation_accepted',
  /** Billing plataforma: el usuario abrió el flujo de upgrade/checkout de plan. */
  checkoutIniciado: 'checkout_iniciado',
  /** Billing plataforma: cambio de plan aplicado in-place con prorrateo (swap). */
  planActualizado: 'plan_actualizado',
  /** Billing: se emitió una factura (pendiente → emitida). */
  facturaEmitida: 'factura_emitida',
  /** Billing: se registró un pago/abono sobre una factura. */
  pagoRegistrado: 'pago_registrado',
  /** Fiscal: se timbró un comprobante (FEL/CFDI) contra el PAC. */
  documentoTimbrado: 'documento_timbrado',
} as const

export type FunnelEvent = (typeof FUNNEL)[keyof typeof FUNNEL]

/**
 * Variante tipada de `track()` para los eventos del catálogo `FUNNEL`. Igual de
 * no-op que `track` cuando PostHog está desactivado.
 */
export function trackFunnel(event: FunnelEvent, props?: Record<string, unknown>): void {
  track(event, props)
}

export function resetAnalytics(): void {
  if (!enabled) return
  // posthog.reset() ya limpia las super-properties registradas, no necesita
  // llamada adicional.
  posthog.reset()
}
