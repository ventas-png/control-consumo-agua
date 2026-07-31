/**
 * Sube al inicio del contenido de la app.
 *
 * `window.scrollTo` no sirve por sí solo: en teléfonos el shell mide 100dvh y
 * el que scrollea es `.app-main`, no el documento (ver el bloque ≤767px de
 * src/index.css). En escritorio pasa lo contrario, así que hay que mirar quién
 * tiene scroll real antes de pedirlo.
 */
export function scrollAppToTop(behavior: ScrollBehavior = 'smooth'): void {
  const main = document.querySelector<HTMLElement>('.app-main')
  if (main && main.scrollHeight > main.clientHeight) {
    main.scrollTo({ top: 0, behavior })
    return
  }
  window.scrollTo({ top: 0, behavior })
}
