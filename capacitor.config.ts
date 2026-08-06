import type { CapacitorConfig } from '@capacitor/cli'

// Configuración de Capacitor: envuelve el build web (Vite → `dist/`) en apps
// nativas iOS/Android reutilizando el mismo código de la SPA. Ver MOBILE.md para
// los pasos de `cap add`, permisos, deep links de OAuth y publicación en tiendas.
const config: CapacitorConfig = {
  appId: 'com.administratodo.app',
  appName: 'AdministraTodo',
  webDir: 'dist',
  // androidScheme 'https' hace que el WebView de Android sirva la app desde un
  // origen seguro (https://localhost). Necesario para APIs que requieren
  // secure-context (geolocalización, cámara vía getUserMedia, etc.).
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // La barra de estado NO se superpone al WebView: en iOS el plugin baja el
    // `webView.frame` por debajo de ella y pinta la franja con backgroundColor.
    // Es lo que reserva el hueco de verdad — `env(safe-area-inset-top)` resuelve
    // a 0 en este WebView, así que el `calc()` del CSS no reservaba nada y el
    // conmutador Condominios/Agua quedaba bajo el reloj. Ver src/lib/nativeApp.ts.
    // En Android (targetSdk 36) el sistema impone edge-to-edge y esto no aplica.
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
      backgroundColor: '#1B3B36',
    },
    SplashScreen: {
      // La app oculta el splash manualmente al terminar el arranque (ver
      // src/lib/nativeApp.ts). launchShowDuration 0 evita el flash inicial.
      launchShowDuration: 0,
      backgroundColor: '#1B3B36',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
  },
}

export default config
