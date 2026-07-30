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
