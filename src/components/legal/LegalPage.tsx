// Página legal pública e indexable (Política de Privacidad / Términos / DPA+Cookies).
// Se resuelve como early-return sessionless en App.tsx ANTES del gate de auth, por lo
// que es 100% pública (no requiere sesión ni Supabase). Reutiliza la identidad visual
// del landing: se envuelve en `.at-root` (tokens --c-* + tipografía Grotesk) y reusa el
// <Footer> global. Fija <title> y <meta description> por documento para SEO.
//
// Bilingüe: el idioma llega por prop (App lo deriva de ?lang) o se detecta del URL. El
// español es la versión vinculante; el inglés es una traducción de cortesía (nota visible).

import { useEffect } from 'react'
import { BrandLogo } from '../shared/BrandLogo'
import { Footer } from '../landing/Social'
import { COPY, type Lang } from '../landing/i18n'
import { LEGAL_META, LEGAL_BODIES, LEGAL_PATHS, legalHref, type LegalDocType } from './content'
import './legal.css'

interface Props {
  doc: LegalDocType
  /** Idioma. App lo pasa derivado de ?lang; si falta, se detecta del URL (default es). */
  lang?: Lang
}

function detectLang(): Lang {
  if (typeof window === 'undefined') return 'es'
  return new URLSearchParams(window.location.search).get('lang') === 'en' ? 'en' : 'es'
}

/** Crea o actualiza un <meta name="..."> en <head>, devolviendo el valor previo para
 *  poder restaurarlo al desmontar (evita filtrar la descripción legal al resto del SPA). */
function setMetaTag(name: string, content: string): { el: HTMLMetaElement; prev: string | null; created: boolean } {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  let created = false
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', name)
    document.head.appendChild(el)
    created = true
  }
  const prev = el.getAttribute('content')
  el.setAttribute('content', content)
  return { el, prev, created }
}

export default function LegalPage({ doc, lang: langProp }: Props) {
  const lang: Lang = langProp ?? detectLang()
  const meta = LEGAL_META[lang][doc]
  const Body = LEGAL_BODIES[lang][doc]
  const homeHref = lang === 'en' ? '/?lang=en' : '/'

  const ui = lang === 'en'
    ? { back: '← Back to home', courtesyA: 'This English text is a courtesy translation; the legally binding version is the ', courtesyLink: 'Spanish one', courtesyB: '.' }
    : { back: '← Volver al inicio', courtesyA: '', courtesyLink: '', courtesyB: '' }

  useEffect(() => {
    const prevTitle = document.title
    const prevHtmlLang = document.documentElement.lang
    document.title = meta.metaTitle
    document.documentElement.lang = lang
    const description = setMetaTag('description', meta.metaDescription)
    // Robots: estas páginas SÍ deben indexarse (transparencia legal / auditoría APIs).
    const robots = setMetaTag('robots', 'index, follow')

    return () => {
      document.title = prevTitle
      document.documentElement.lang = prevHtmlLang
      const restore = (m: { el: HTMLMetaElement; prev: string | null; created: boolean }) => {
        if (m.created) m.el.remove()
        else if (m.prev !== null) m.el.setAttribute('content', m.prev)
      }
      restore(description)
      restore(robots)
    }
  }, [meta.metaTitle, meta.metaDescription, lang])

  return (
    <div className="at-root">
      <header className="legal-topbar">
        <div className="container legal-topbar-inner">
          <a href={homeHref} className="legal-brand" aria-label="AdministraTodo — inicio">
            <BrandLogo size={32} />
            <span>AdministraTodo</span>
          </a>
          <div className="legal-topbar-right">
            <nav className="legal-lang" aria-label="Idioma / Language">
              <a href={LEGAL_PATHS[doc]} className={lang === 'es' ? 'active' : ''} aria-current={lang === 'es' ? 'true' : undefined}>ES</a>
              <span aria-hidden="true">·</span>
              <a href={legalHref(doc, 'en')} className={lang === 'en' ? 'active' : ''} aria-current={lang === 'en' ? 'true' : undefined}>EN</a>
            </nav>
            <a href={homeHref} className="legal-back">{ui.back}</a>
          </div>
        </div>
      </header>

      <main className="legal-main">
        <article className="container legal-prose">
          <h1>{meta.title}</h1>
          <p className="legal-updated">{meta.updated}</p>
          {lang === 'en' && (
            <p className="legal-courtesy">
              {ui.courtesyA}
              <a href={LEGAL_PATHS[doc]}>{ui.courtesyLink}</a>
              {ui.courtesyB}
            </p>
          )}
          <Body />
        </article>
      </main>

      <Footer t={COPY[lang]} />
    </div>
  )
}
