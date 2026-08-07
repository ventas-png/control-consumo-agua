// Inicialización específica de la app nativa (Capacitor). No-op en web.
// Se llama una vez al arrancar (main.tsx), después de montar React.
import { isNative } from './platform'

/**
 * Ajustes de arranque nativo: barra de estado acorde al tema de marca y ocultar
 * el splash una vez que la UI está lista. Todo es defensivo: si un plugin no está
 * disponible, se ignora en silencio para no bloquear el arranque.
 */
export function initNativeApp(): void {
  if (!isNative()) return
  aplicarViewportNativo()
  void configurarBarraDeEstado().then(publicarAltoBarraDeEstado)
  void ocultarSplash()
}

/** Variable CSS con el hueco a reservar arriba. La lee el bloque ≤767px de index.css. */
export const VAR_SAFE_TOP = '--at-safe-top'

/**
 * Publica en CSS el alto REAL de la barra de estado, medido por el lado nativo.
 *
 * POR QUÉ HACE FALTA. El CSS reserva el hueco con `env(safe-area-inset-top)`, y
 * en este WebView ese valor es 0: se comprobó sobre capturas del aparato, donde
 * los chips Condominios/Agua arrancan exactamente a los 8px del padding inline.
 * Confirmado además que el bundle nativo SÍ está corriendo (el zoom por pellizco
 * está bloqueado, cosa que solo hace `aplicarViewportNativo`), así que no es un
 * problema de entrega: el WebView simplemente no expone el inset.
 *
 * `StatusBar.getInfo()` sí lo sabe — devuelve `height` en px — y no pasa por CSS.
 * Las reglas usan `max(env(...), var(--at-safe-top))`, así que en la web, donde
 * la variable no existe, sigue mandando `env()` sin cambiar nada.
 *
 * `overlays` evita sumar el hueco dos veces: si `overlaysWebView: false` ya bajó
 * el `webView.frame` por debajo de la barra, no queda nada que reservar y la
 * variable va a 0. Con eso los dos mecanismos son excluyentes por construcción,
 * funcione el que funcione.
 */
export async function publicarAltoBarraDeEstado(): Promise<void> {
  try {
    const { StatusBar } = await import('@capacitor/status-bar')
    const info = await StatusBar.getInfo()
    const reservar = info.visible !== false && info.overlays
    const alto = reservar ? Math.max(0, Math.round(info.height ?? 0)) : 0
    document.documentElement.style.setProperty(VAR_SAFE_TOP, `${alto}px`)
  } catch {
    // Sin plugin: la variable queda sin definir y manda el env() del CSS.
  }
}

/** Verde de marca: fondo de la barra de estado e íconos claros encima. */
const COLOR_BARRA_ESTADO = '#1B3B36'

/**
 * Saca el contenido de debajo de la barra de estado, por la vía nativa.
 *
 * POR QUÉ NO BASTA EL CSS. El conmutador Condominios/Agua y las cabeceras de
 * los portales reservan el hueco con `calc(8px + env(safe-area-inset-top))`
 * (bloque ≤767px de index.css). En este WebView **`env(safe-area-inset-top)`
 * resuelve a 0**: se midió sobre una captura del aparato, donde los chips
 * arrancan exactamente a los 8px del padding inline, sin nada sumado. Con el
 * inset a cero el `calc()` no reserva nada y los chips quedan bajo el reloj,
 * donde además no se pueden tocar. Tampoco sirve renunciar a
 * `viewport-fit=cover`: si el motor no conoce los insets, `contain` no tiene
 * por dónde encoger el viewport.
 *
 * LO QUE SÍ FUNCIONA. `setOverlaysWebView({ overlay: false })` no es CSS: en
 * iOS el plugin redimensiona `webView.frame` por debajo de la barra de estado
 * y pinta esa franja con `backgroundColor` (ver `StatusBar.swift`). El hueco
 * deja de depender de que el WebView exponga `env()`.
 *
 * Se deja también en `capacitor.config.ts` (`plugins.StatusBar`), que es lo que
 * manda y se aplica antes de que arranque la capa web — sin parpadeo. Esta
 * llamada es el cinturón por si el config no llegara al binario.
 *
 * ANDROID. Con `targetSdk 36` el sistema impone edge-to-edge y esta opción no
 * tiene efecto; ahí el hueco sigue dependiendo del CSS. No se ha reportado el
 * problema en Android, así que no se toca.
 */
export async function configurarBarraDeEstado(): Promise<void> {
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined)
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined)
    await StatusBar.setBackgroundColor({ color: COLOR_BARRA_ESTADO }).catch(() => undefined)
  } catch {
    // status-bar no disponible: se deja la barra tal cual, sin bloquear el arranque.
  }
}

/** Oculta el splash cuando la UI ya está montada. Silencioso si no está el plugin. */
export async function ocultarSplash(): Promise<void> {
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide().catch(() => undefined)
  } catch {
    // sin splash-screen: nada que ocultar
  }
}

/** Viewport que se aplica SOLO dentro de la app nativa (ver `initNativeApp`). */
export const VIEWPORT_NATIVO =
  'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'

/**
 * Desactiva el zoom del WebView en la app nativa.
 *
 * POR QUÉ SOLO EN NATIVO. Al enfocar un campo, iOS amplía la página y no
 * deshace el zoom al cerrar el formulario: la página queda ampliada y se puede
 * arrastrar de lado. En la WEB el único freno es `font-size >= 16px` (ver el
 * bloque ≤767px de index.css), porque **Safari ignora `maximum-scale` y
 * `user-scalable` desde iOS 10** por accesibilidad. **WKWebView sí los
 * respeta**, así que dentro de la app propia se corta de raíz — y ese arreglo
 * no llegaba a la app aunque el de la web estuviera bien.
 *
 * Contrapartida: en la app nativa se pierde el pinch-zoom. Es el comportamiento
 * normal de una app, y el Zoom del sistema (Ajustes → Accesibilidad) sigue
 * funcionando. En el navegador no se toca nada: `initNativeApp` sale antes.
 *
 * Se mantiene `viewport-fit=cover` por el borde inferior (home indicator). El
 * hueco de la barra de estado ya NO depende de él: lo resuelve el lado nativo
 * en `configurarBarraDeEstado`.
 */
export function aplicarViewportNativo(): void {
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', VIEWPORT_NATIVO)
}
