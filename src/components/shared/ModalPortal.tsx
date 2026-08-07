import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Saca a `document.body` lo que se le pase dentro.
 *
 * POR QUÉ EXISTE. Los overlays de la app son `position: fixed` renderizados en
 * el sitio del árbol donde vive el componente que los abre. Eso funciona solo
 * mientras ningún ancestro sea un contenedor con scroll: **en iOS, un `fixed`
 * dentro de un contenedor que está scrolleando se posiciona respecto a ese
 * contenedor, no respecto al viewport**. Ya nos pasó — el PR #691 introdujo un
 * `height: 100dvh; overflow: hidden` en el shell y los ~40 modales quedaron
 * recortados e inmóviles de golpe; hubo que revertirlo en #692. Chromium no
 * reproduce el fallo, así que no salta en ninguna prueba.
 *
 * Colgando del `body` el ancestro problemático desaparece por construcción, y
 * el shell vuelve a ser libre de montar sus propios scrollers sin arrastrar a
 * los modales.
 *
 * NO cambia el apilamiento: `#root` no crea contexto de apilamiento (no tiene
 * `position`, `isolation`, `transform` ni `contain`), así que los z-index de
 * los overlays ya competían en el contexto raíz y siguen igual. Ver MOBILE.md.
 *
 * Devuelve `null` sin `document` para no romper el prerender de las páginas
 * legales (`src/legal/prerenderEntry.tsx`, `renderToStaticMarkup`).
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null
  return createPortal(children, document.body)
}
