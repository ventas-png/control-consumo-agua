// Página legal pública e indexable (Política de Privacidad / Términos / DPA+Cookies).
// Se resuelve como early-return sessionless en App.tsx ANTES del gate de auth, por lo
// que es 100% pública (no requiere sesión ni Supabase). Reutiliza la identidad visual
// del landing: se envuelve en `.at-root` (tokens --c-* + tipografía Grotesk) y reusa el
// <Footer> global. Fija <title> y <meta description> por documento para SEO.

import { useEffect } from 'react'
import { BrandLogo } from '../shared/BrandLogo'
import { Footer } from '../landing/Social'
import { COPY } from '../landing/i18n'
import { LEGAL_META, LEGAL_BODIES, type LegalDocType } from './content'
import './legal.css'

interface Props {
  doc: LegalDocType
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

export default function LegalPage({ doc }: Props) {
  const meta = LEGAL_META[doc]
  const Body = LEGAL_BODIES[doc]

  useEffect(() => {
    const prevTitle = document.title
    document.title = meta.metaTitle
    const description = setMetaTag('description', meta.metaDescription)
    // Robots: estas páginas SÍ deben indexarse (transparencia legal / auditoría APIs).
    const robots = setMetaTag('robots', 'index, follow')

    return () => {
      document.title = prevTitle
      const restore = (m: { el: HTMLMetaElement; prev: string | null; created: boolean }) => {
        if (m.created) m.el.remove()
        else if (m.prev !== null) m.el.setAttribute('content', m.prev)
      }
      restore(description)
      restore(robots)
    }
  }, [meta.metaTitle, meta.metaDescription])

  return (
    <div className="at-root">
      <header className="legal-topbar">
        <div className="container legal-topbar-inner">
          <a href="/" className="legal-brand" aria-label="AdministraTodo — inicio">
            <BrandLogo size={32} />
            <span>AdministraTodo</span>
          </a>
          <a href="/" className="legal-back">← Volver al inicio</a>
        </div>
      </header>

      <main className="legal-main">
        <article className="container legal-prose">
          <h1>{meta.title}</h1>
          <p className="legal-updated">{meta.updated}</p>
          <Body />
        </article>
      </main>

      <Footer t={COPY.es} />
    </div>
  )
}
