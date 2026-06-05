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
