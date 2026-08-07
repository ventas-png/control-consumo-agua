// Geometría del panel de la campana. Va en su propio módulo, sin imports, para
// poder probarlo sin arrastrar `useNotifications` → `supabase.ts`, que lanza al
// cargarse si no hay variables de entorno (en CI no las hay).

const ANCHO_PANEL = 340
const MARGEN = 8

/**
 * Coloca el panel sin que se salga de la pantalla.
 *
 * Antes era `position: absolute; right: 0; width: 340px`, es decir, anclado al
 * borde derecho de la campana y creciendo hacia la izquierda. En un teléfono la
 * campana está a unos 200px del borde, así que un panel de 340px empezaba en
 * -140 y la mitad quedaba fuera de la pantalla. `max-width` no lo arregla: el
 * problema no es el ancho, es de qué lado crece.
 *
 * Se mantiene la alineación a la derecha del icono cuando cabe, y si no cabe se
 * empuja hasta el margen. El cálculo es contra el viewport porque el panel se
 * pinta con `position: fixed`; el portal scrollea el documento, así que aquí no
 * hay ningún contenedor con scroll que atrape el fixed (ver MOBILE.md).
 */
export function calcularPosicion(ancla: DOMRect, vw: number, vh: number) {
  const width = Math.min(ANCHO_PANEL, vw - MARGEN * 2)
  const derecha = ancla.right - width
  const left = Math.min(Math.max(MARGEN, derecha), vw - width - MARGEN)
  const top = ancla.bottom + MARGEN
  // Con `fixed` el panel ya no alarga la página: si no se acota, un aparato
  // bajito lo cortaría por abajo en vez de por la izquierda.
  return { top, left, width, maxHeight: Math.max(0, vh - top - MARGEN) }
}
