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
 * del conmutador del portal y de la topbar.
 */
export function aplicarViewportNativo(): void {
  document.querySelector('meta[name="viewport"]')?.setAttribute('content', VIEWPORT_NATIVO)
}
