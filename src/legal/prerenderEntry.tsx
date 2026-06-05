// Entry SSR para el pre-render estático de las páginas legales (ver scripts/prerender-legal.mjs).
// Se bundlea con esbuild (Node) y se invoca tras `vite build` para escribir HTML completo de
// las 3 rutas legales en dist/<ruta>/index.html — así los crawlers/auditorías obtienen el
// contenido + meta sin ejecutar JS. Solo se pre-renderiza el español (versión indexable y
// vinculante); el inglés se sirve por el mismo HTML y se activa client-side vía ?lang=en.
//
// renderToStaticMarkup ignora los useEffect (la meta la inyecta el script desde LEGAL_META),
// por lo que no se ejecuta ningún código que toque window/document.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import LegalPage from '../components/legal/LegalPage'
import { LEGAL_META, type LegalDocType } from '../components/legal/content'

export interface PrerenderResult {
  html: string
  title: string
  description: string
}

export function renderLegal(doc: LegalDocType, lang: 'es' | 'en'): PrerenderResult {
  const html = renderToStaticMarkup(createElement(LegalPage, { doc, lang }))
  const meta = LEGAL_META[lang][doc]
  return { html, title: meta.metaTitle, description: meta.metaDescription }
}

export const PRERENDER_DOCS: { doc: LegalDocType; path: string }[] = [
  { doc: 'privacy', path: 'politica-privacidad' },
  { doc: 'tos', path: 'terminos-servicio' },
  { doc: 'dpa', path: 'acuerdo-dpa-cookies' },
]
