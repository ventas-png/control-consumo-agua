// Entry SSR para el pre-render estático de las páginas legales (ver scripts/prerender-legal.mjs).
// Se bundlea con esbuild (Node) y se invoca tras `vite build` para escribir HTML completo de
// las rutas legales (y la de eliminación de cuenta que exigen las tiendas) en
// dist/<ruta>/index.html — así los crawlers/auditorías obtienen el
// contenido + meta sin ejecutar JS. Solo se pre-renderiza el español (versión indexable y
// vinculante); el inglés se sirve por el mismo HTML y se activa client-side vía ?lang=en.
//
// renderToStaticMarkup ignora los useEffect (la meta la inyecta el script desde LEGAL_META),
// por lo que no se ejecuta ningún código que toque window/document.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import LegalPage from '../components/legal/LegalPage'
import { LEGAL_META, LEGAL_PATHS, type LegalDocType } from '../components/legal/content'

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

// La ruta sale de LEGAL_PATHS (una sola fuente de verdad con App.tsx, el footer y el sitemap).
export const PRERENDER_DOCS: { doc: LegalDocType; path: string }[] = (
  ['privacy', 'tos', 'dpa', 'account_deletion'] as const
).map((doc) => ({ doc, path: LEGAL_PATHS[doc].replace(/^\//, '') }))
