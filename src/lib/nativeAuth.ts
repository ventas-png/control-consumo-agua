// Login social (Google y Apple) en la app nativa (Capacitor).
//
// En web, supabase.auth.signInWithOAuth() redirige el navegador al proveedor y
// de vuelta a la app; `detectSessionInUrl` intercambia el code automáticamente.
// En una app nativa eso no funciona: el WebView no puede recibir el redirect
// (Google lo prohíbe) y no hay una "URL de la pestaña" que Supabase pueda leer.
// El patrón correcto (recomendado por Supabase para Capacitor) es:
//   1. Pedir la URL de autorización con skipBrowserRedirect (no navegamos el WebView).
//   2. Abrirla en el navegador del sistema con @capacitor/browser.
//   3. Supabase redirige a un custom scheme (com.administratodo.app://auth-callback)
//      que abre de vuelta la app; @capacitor/app emite el evento appUrlOpen.
//   4. Extraemos el ?code= del deep link y lo canjeamos con exchangeCodeForSession
//      (flujo PKCE — el code_verifier lo guardó el paso 1 en el storage nativo).
//   5. onAuthStateChange('SIGNED_IN') en useAuth aplica la sesión, igual que en web.
//
// Sign in with Apple va por el MISMO camino (proveedor `apple` de Supabase en el
// navegador del sistema) y no por un plugin nativo: el plugin de la comunidad
// fija Capacitor 7 en su Package.swift y rompe la resolución SPM con el 8 que usa
// este proyecto, y así es GoTrue quien valida el id_token, el nonce y guarda el
// nombre que Apple entrega solo en la primera autorización. Ver MOBILE.md §5.
//
// El custom scheme debe registrarse en los proyectos nativos (Info.plist en iOS,
// intent-filter en Android) y añadirse a la allowlist de redirect en Supabase Auth.
// Ver MOBILE.md.
import { supabase } from './supabase'
import { isNative } from './platform'

export const NATIVE_OAUTH_REDIRECT = 'com.administratodo.app://auth-callback'

export type ProveedorSocial = 'google' | 'apple'

const NOMBRE_PROVEEDOR: Record<ProveedorSocial, string> = { google: 'Google', apple: 'Apple' }

/** Mensaje de error del login social, uno por proveedor (lo muestra la UI tal cual). */
export function errorLoginSocial(provider: ProveedorSocial): string {
  return `Error al iniciar sesión con ${NOMBRE_PROVEEDOR[provider]}`
}

/** Lanza el login social en nativo. Devuelve un mensaje de error o null. */
export async function nativeSocialLogin(provider: ProveedorSocial): Promise<string | null> {
  try {
    const { Browser } = await import('@capacitor/browser')
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: NATIVE_OAUTH_REDIRECT, skipBrowserRedirect: true },
    })
    if (error || !data?.url) return errorLoginSocial(provider)
    await Browser.open({ url: data.url })
    return null
  } catch {
    return errorLoginSocial(provider)
  }
}

/** Lanza el login con Google en nativo. Devuelve un mensaje de error o null. */
export function nativeGoogleLogin(): Promise<string | null> {
  return nativeSocialLogin('google')
}

/** Lanza Sign in with Apple en nativo (vía Supabase, en el navegador del sistema). */
export function nativeAppleLogin(): Promise<string | null> {
  return nativeSocialLogin('apple')
}

/**
 * Registra el listener de deep links que completa el OAuth al volver del
 * proveedor. Idempotente y no-op en web. Llamar una vez al arrancar la app (main.tsx).
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
