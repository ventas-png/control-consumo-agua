// Canal de eventos para abrir el panel de cookies. Deliberadamente SIN dependencias
// (no importa analytics ni nada): así el Footer puede disparar la reapertura del panel
// sin arrastrar la analítica a su grafo de imports (importante para el pre-render SSR,
// donde import.meta.env no existe). El estado/persistencia del consentimiento vive en
// lib/cookieConsent; aquí solo va el "timbre".

export const OPEN_COOKIE_SETTINGS_EVENT = 'at:open-cookie-settings'

/** Reabre el panel de preferencias (lo dispara, p.ej., el enlace del footer). */
export function openCookieSettings(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_COOKIE_SETTINGS_EVENT))
}

export function onOpenCookieSettings(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, handler)
  return () => window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, handler)
}

export const COOKIE_CONSENT_SAVED_EVENT = 'at:cookie-consent-saved'

/** Avisa de que el usuario ya eligió (lo dispara saveConsent). */
export function notifyCookieConsentSaved(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(COOKIE_CONSENT_SAVED_EVENT))
}

/**
 * Para quien espera a que el banner de cookies se cierre antes de mostrar otra
 * cosa en el mismo sitio (el aviso de instalar la app).
 */
export function onCookieConsentSaved(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(COOKIE_CONSENT_SAVED_EVENT, handler)
  return () => window.removeEventListener(COOKIE_CONSENT_SAVED_EVENT, handler)
}
