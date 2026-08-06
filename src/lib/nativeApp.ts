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
  // El safe-area se comprueba en el siguiente frame: los insets no siempre están
  // resueltos en el primer layout del WebView.
  requestAnimationFrame(() => asegurarSafeAreaTop())
  void (async () => {
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar')
      // Íconos claros sobre el verde de marca (#1B3B36).
      await StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined)
      await StatusBar.setBackgroundColor({ color: '#1B3B36' }).catch(() => undefined)
    } catch {
      // status-bar no disponible (p. ej. iOS gestiona el color vía Info.plist)
    }
    try {
      const { SplashScreen } = await import('@capacitor/splash-screen')
      await SplashScreen.hide().catch(() => undefined)
    } catch {
      // sin splash-screen: nada que ocultar
    }
  })()
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
 * Se mantiene `viewport-fit=cover`, del que dependen los `env(safe-area-inset-*)`
 * del conmutador del portal y de la topbar — y del que se sale automáticamente
 * si el WebView no los popula (ver `asegurarSafeAreaTop`).
 */
export function aplicarViewportNativo(): void {
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', VIEWPORT_NATIVO)
}

/**
 * Viewport de reserva: igual que `VIEWPORT_NATIVO` pero SIN `viewport-fit=cover`.
 * Con `contain` (el valor por defecto de la especificación) el motor encaja el
 * viewport dentro del área segura de la pantalla, así que la página nunca queda
 * bajo la barra de estado. Ver `asegurarSafeAreaTop`.
 */
export const VIEWPORT_NATIVO_SIN_COVER =
  'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=contain'

/**
 * Mide cuánto vale realmente `env(safe-area-inset-top)` en este WebView, en px.
 *
 * No hay forma de leer un `env()` desde JS: hay que aplicarlo a un elemento y
 * medirlo. La sonda es invisible y se retira en el acto.
 */
export function medirSafeAreaTop(): number {
  const sonda = document.createElement('div')
  sonda.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top, 0px);' +
    'visibility:hidden;pointer-events:none'
  document.body.appendChild(sonda)
  const alto = sonda.getBoundingClientRect().height
  sonda.remove()
  return alto
}

/**
 * Garantiza que el contenido no quede bajo la barra de estado, resuelva o no
 * `env(safe-area-inset-top)`.
 *
 * EL PROBLEMA. Con `viewport-fit=cover` la página arranca en y=0, es decir
 * DEBAJO de la barra de estado, y el hueco se reserva con `env(safe-area-inset-top)`
 * en el elemento más alto (conmutador del portal, cabeceras y topbar; ver el
 * bloque ≤767px de index.css). Todo eso depende de que el WebView popule el
 * inset. Si devuelve 0 —porque el WebView no lo expone, o porque el aparato no
 * tiene notch y su barra de estado no cuenta como inset— los `calc()` se quedan
 * en 8px/16px y los chips Condominios/Agua acaban bajo el reloj, donde además
 * no se pueden tocar.
 *
 * LA SALIDA. Si el inset es 0, se quita `cover`: entonces es el propio motor
 * quien encaja el viewport dentro del área segura y ya no hay nada que reservar
 * (los `env()` valen 0, que es justo lo correcto en ese modo). Se pierde el
 * borde a borde bajo la barra de estado, que es el aspecto normal de una app.
 *
 * Cuando el inset SÍ llega, esta función no toca nada.
 */
export function asegurarSafeAreaTop(medir: () => number = medirSafeAreaTop): void {
  if (medir() > 0) return
  document
    .querySelector('meta[name="viewport"]')
    ?.setAttribute('content', VIEWPORT_NATIVO_SIN_COVER)
}
