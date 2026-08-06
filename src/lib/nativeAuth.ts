// OAuth de Google en la app nativa (Capacitor).
//
// En web, supabase.auth.signInWithOAuth() redirige el navegador a Google y de
// vuelta a la app; `detectSessionInUrl` intercambia el code automáticamente. En
// una app nativa eso no funciona: el WebView no puede recibir el redirect de
// Google (política de Google) y no hay una "URL de la pestaña" que Supabase pueda
// leer. El patrón correcto (recomendado por Supabase para Capacitor) es:
//   1. Pedir la URL de autorización con skipBrowserRedirect (no navegamos el WebView).
//   2. Abrirla en el navegador del sistema con @capacitor/browser.
//   3. Google redirige a un custom scheme (com.administratodo.app://auth-callback)
//      que abre de vuelta la app; @capacitor/app emite el evento appUrlOpen.
//   4. Extraemos el ?code= del deep link y lo canjeamos con exchangeCodeForSession
//      (flujo PKCE — el code_verifier lo guardó el paso 1 en el storage nativo).
//   5. onAuthStateChange('SIGNED_IN') en useAuth aplica la sesión, igual que en web.
//
// El custom scheme debe registrarse en los proyectos nativos (Info.plist en iOS,
// intent-filter en Android) y añadirse a la allowlist de redirect en Supabase Auth.
// Ver MOBILE.md.
import { supabase } from './supabase'
import { isNative } from './platform'

export const NATIVE_OAUTH_REDIRECT = 'com.administratodo.app://auth-callback'

/** Lanza el login con Google en nativo. Devuelve un mensaje de error o null. */
export async function nativeGoogleLogin(): Promise<string | null> {
  try {
    const { Browser } = await import('@capacitor/browser')
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: NATIVE_OAUTH_REDIRECT, skipBrowserRedirect: true },
    })
    if (error || !data?.url) return 'Error al iniciar sesión con Google'
    await Browser.open({ url: data.url })
    return null
  } catch {
    return 'Error al iniciar sesión con Google'
  }
}

/**
 * Registra el listener de deep links que completa el OAuth al volver de Google.
 * Idempotente y no-op en web. Llamar una vez al arrancar la app (main.tsx).
 */
export function initNativeAuthListener(): void {
  if (!isNative()) return
  void (async () => {
    const { App } = await import('@capacitor/app')
    await App.addListener('appUrlOpen', async ({ url }) => {
      // Solo el callback de login; el connect de Gmail (envío de correo) usa su
      // propio flujo web y no pasa por aquí.
      if (!url.includes('auth-callback')) return
      try {
        const { Browser } = await import('@capacitor/browser')
        await Browser.close().catch(() => undefined)
        const code = new URL(url).searchParams.get('code')
        if (code) await supabase.auth.exchangeCodeForSession(code)
      } catch {
        // silencioso: si falla, el usuario sigue en la pantalla de login
      }
    })
  })()
}
