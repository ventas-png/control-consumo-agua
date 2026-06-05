// Consentimiento de cookies (RGPD/CCPA). Fuente de verdad del estado de consentimiento
// + puente con las herramientas que se condicionan a él (hoy: analítica PostHog).
//
// Diseño: este módulo importa de analytics.ts (one-way) para aplicar el consentimiento;
// analytics.ts NO importa de aquí, para evitar ciclos. El arranque lo orquesta main.tsx:
//   initAnalytics()        → inicializa PostHog OPTED-OUT por defecto (no captura nada)
//   applyStoredConsent()   → si el usuario ya decidió, aplica su elección (opt-in/out)
//
// Las cookies "esenciales" (sesión, seguridad, prevención de fraude) no se condicionan:
// son necesarias para prestar el servicio. Solo "analítica" y "funcionales" son opcionales.

import { setAnalyticsConsent } from './analytics'

export interface CookieConsent {
  analytics: boolean
  functional: boolean
}

export interface StoredConsent extends CookieConsent {
  /** false = el usuario todavía no eligió (mostrar el banner). */
  decided: boolean
}

const STORAGE_KEY = 'at-cookie-consent-v1'

const UNDECIDED: StoredConsent = { decided: false, analytics: false, functional: false }

export function readConsent(): StoredConsent {
  if (typeof localStorage === 'undefined') return UNDECIDED
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return UNDECIDED
    const parsed = JSON.parse(raw) as Partial<CookieConsent>
    return { decided: true, analytics: !!parsed.analytics, functional: !!parsed.functional }
  } catch {
    return UNDECIDED
  }
}

/** Persiste la elección del usuario y la aplica a las herramientas (analítica). */
export function saveConsent(consent: CookieConsent): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...consent, v: 1, ts: new Date().toISOString() }),
    )
  } catch {
    /* almacenamiento no disponible (modo privado): el banner reaparecerá la próxima vez */
  }
  setAnalyticsConsent(consent.analytics)
}

/** Aplica el consentimiento ya guardado. Llamar una vez al arrancar, tras initAnalytics(). */
export function applyStoredConsent(): void {
  const c = readConsent()
  if (c.decided) setAnalyticsConsent(c.analytics)
}

// La reapertura del panel (openCookieSettings / onOpenCookieSettings) vive en
// lib/cookieConsentChannel — sin dependencias, para no arrastrar analytics al footer.
