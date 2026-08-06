// Banner + panel de consentimiento de cookies (RGPD/CCPA). Se monta global en main.tsx
// (sibling de <App/>), por lo que aparece en landing, app y páginas legales. Cumple lo
// que la Política de Cookies ya promete: un panel para aceptar/rechazar y REVOCAR.
//
// - Esenciales: siempre activas (sesión/seguridad/anti-fraude), no se pueden desactivar.
// - Analítica: condiciona la captura de PostHog (ver lib/analytics setAnalyticsConsent).
// - Funcionales: preferencias (idioma/moneda). Reservado; hoy no carga terceros.
//
// Revocación: el enlace "Configuración de cookies" del footer dispara openCookieSettings(),
// que reabre este panel con la elección actual.

import { useEffect, useState } from 'react'
import { readConsent, saveConsent, type CookieConsent as Consent } from '../../lib/cookieConsent'
import { onOpenCookieSettings } from '../../lib/cookieConsentChannel'
import './cookie-consent.css'

type Lang = 'es' | 'en'

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'es'
  return new URLSearchParams(window.location.search).get('lang') === 'en' ? 'en' : 'es'
}

function cookiePolicyHref(lang: Lang): string {
  return lang === 'en' ? '/acuerdo-dpa-cookies?lang=en' : '/acuerdo-dpa-cookies'
}

const COPY = {
  es: {
    aria: 'Aviso de cookies',
    title: 'Usamos cookies 🍪',
    bodyA: 'Usamos cookies esenciales para que la plataforma funcione y, con tu permiso, cookies de analítica y funcionales para mejorar el servicio. Consulta la ',
    policy: 'Política de Cookies',
    bodyB: '.',
    acceptAll: 'Aceptar todas',
    reject: 'Solo esenciales',
    configure: 'Configurar',
    save: 'Guardar preferencias',
    essential: { name: 'Esenciales', tag: 'Siempre activas', desc: 'Necesarias para iniciar sesión, mantener la seguridad y prevenir fraudes.' },
    analytics: { name: 'Analítica y rendimiento', desc: 'Nos ayudan a entender el uso de forma agregada y anónima para optimizar la plataforma.' },
    functional: { name: 'Funcionales', desc: 'Recuerdan preferencias como el idioma o la moneda de facturación.' },
  },
  en: {
    aria: 'Cookie notice',
    title: 'We use cookies 🍪',
    bodyA: 'We use essential cookies to make the platform work and, with your permission, analytics and functional cookies to improve the service. See our ',
    policy: 'Cookie Policy',
    bodyB: '.',
    acceptAll: 'Accept all',
    reject: 'Essential only',
    configure: 'Customize',
    save: 'Save preferences',
    essential: { name: 'Essential', tag: 'Always on', desc: 'Required to sign in, keep the platform secure and prevent fraud.' },
    analytics: { name: 'Analytics & performance', desc: 'Help us understand usage in an aggregated, anonymous way to improve the platform.' },
    functional: { name: 'Functional', desc: 'Remember preferences such as language or billing currency.' },
  },
} as const

export function CookieConsent() {
  const [lang] = useState<Lang>(detectLang)
  const t = COPY[lang]

  const [visible, setVisible] = useState(false)
  const [panel, setPanel] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [functional, setFunctional] = useState(false)

  useEffect(() => {
    const c = readConsent()
    setAnalytics(c.analytics)
    setFunctional(c.functional)
    if (!c.decided) setVisible(true)
    // Revocación / reapertura desde el footer.
    return onOpenCookieSettings(() => {
      const cur = readConsent()
      setAnalytics(cur.analytics)
      setFunctional(cur.functional)
      setPanel(true)
      setVisible(true)
    })
  }, [])

  function persist(c: Consent) {
    saveConsent(c)
    setVisible(false)
    setPanel(false)
  }

  if (!visible) return null

  return (
    <div className="cookie-root" role="dialog" aria-label={t.aria} aria-live="polite">
      <div className="cookie-card">
        <div className="cookie-head">
          <h2 className="cookie-title">{t.title}</h2>
          <p className="cookie-body">
            {t.bodyA}
            <a href={cookiePolicyHref(lang)} target="_blank" rel="noopener noreferrer">{t.policy}</a>
            {t.bodyB}
          </p>
        </div>

        {panel && (
          <div className="cookie-options">
            <div className="cookie-option">
              <div className="cookie-option-text">
                <strong>{t.essential.name}</strong>
                <span className="cookie-tag">{t.essential.tag}</span>
                <p>{t.essential.desc}</p>
              </div>
              <input type="checkbox" checked disabled aria-label={t.essential.name} />
            </div>
            <label className="cookie-option">
              <div className="cookie-option-text">
                <strong>{t.analytics.name}</strong>
                <p>{t.analytics.desc}</p>
              </div>
              <input type="checkbox" checked={analytics} onChange={e => setAnalytics(e.target.checked)} />
            </label>
            <label className="cookie-option">
              <div className="cookie-option-text">
                <strong>{t.functional.name}</strong>
                <p>{t.functional.desc}</p>
              </div>
              <input type="checkbox" checked={functional} onChange={e => setFunctional(e.target.checked)} />
            </label>
          </div>
        )}

        <div className="cookie-actions">
          <button type="button" className="cookie-btn cookie-ghost" onClick={() => persist({ analytics: false, functional: false })}>
            {t.reject}
          </button>
          {panel ? (
            <button type="button" className="cookie-btn cookie-ghost" onClick={() => persist({ analytics, functional })}>
              {t.save}
            </button>
          ) : (
            <button type="button" className="cookie-btn cookie-ghost" onClick={() => setPanel(true)}>
              {t.configure}
            </button>
          )}
          <button type="button" className="cookie-btn cookie-primary" onClick={() => persist({ analytics: true, functional: true })}>
            {t.acceptAll}
          </button>
        </div>
      </div>
    </div>
  )
}
