import { createClient, type SupabaseClient, type SupportedStorage } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import { extractOAuthCallbackError, type OAuthCallbackError } from '../domain/auth/oauthCallbackError'
import { isNative } from './platform'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

// Almacenamiento de la sesión según plataforma:
//   - Web: sessionStorage. Endurecimiento anti-XSS (nunca localStorage) — la sesión
//     no sobrevive al cierre de la pestaña, decisión de seguridad previa.
//   - Nativo (Capacitor): el sessionStorage del WebView se borra al terminar el
//     proceso, así que la sesión no sobreviviría a cerrar la app. Usamos
//     @capacitor/preferences (almacenamiento del SO, fuera del alcance del XSS del
//     WebView) para que el usuario siga autenticado al reabrir.
// El adaptador es asíncrono (soportado por supabase-js); el plugin se carga de
// forma perezosa y se cachea la promesa para no re-importarlo en cada acceso.
let preferencesPromise: Promise<typeof import('@capacitor/preferences')['Preferences']> | null = null
function getPreferences() {
  if (!preferencesPromise) {
    preferencesPromise = import('@capacitor/preferences').then((m) => m.Preferences)
  }
  return preferencesPromise
}

const capacitorPreferencesStorage: SupportedStorage = {
  async getItem(key) {
    const Preferences = await getPreferences()
    const { value } = await Preferences.get({ key })
    return value
  },
  async setItem(key, value) {
    const Preferences = await getPreferences()
    await Preferences.set({ key, value })
  },
  async removeItem(key) {
    const Preferences = await getPreferences()
    await Preferences.remove({ key })
  },
}

// Intercept Gmail OAuth callbacks BEFORE Supabase initializes.
// With detectSessionInUrl: true, Supabase would try to exchange any ?code= param
// as its own PKCE code. When it fails (no code_verifier stored), it can corrupt
// the active session. We detect the Gmail state signature early, stash the params
// in sessionStorage, and clean the URL so Supabase never sees it.
;(function interceptGmailCallback() {
  const p = new URLSearchParams(window.location.search)
  const code = p.get('code')
  const state = p.get('state')
  if (!code || !state) return
  try {
    const d = JSON.parse(atob(state)) as { t?: string }
    if (d?.t === 'gmail_connect') {
      sessionStorage.setItem('__gmail_callback', JSON.stringify({ code, state }))
      window.history.replaceState({}, '', window.location.pathname)
    }
  } catch { /* not a Gmail callback — let Supabase handle it */ }
})()

// Captura el error del callback OAuth ANTES de crear el cliente. Cuando GoTrue
// no puede completar el login (ej. "Unable to exchange external code" porque el
// client secret de Google en Supabase es inválido), redirige de vuelta con
// #error=...&error_description=... y NINGÚN evento de supabase-js lo reporta.
// Guardamos el error para que useOAuthSession lo muestre y limpiamos la URL
// (así un reload no lo re-procesa). Sin esto el usuario rebota a la landing
// sin ningún mensaje.
let oauthCallbackError: OAuthCallbackError | null = null
;(function captureOAuthCallbackError() {
  try {
    const { error, cleanedHash, cleanedSearch } = extractOAuthCallbackError(
      window.location.hash,
      window.location.search,
    )
    if (!error) return
    oauthCallbackError = error
    window.history.replaceState({}, '', window.location.pathname + cleanedSearch + cleanedHash)
  } catch { /* nunca bloquear el arranque de la app por esto */ }
})()

/** Error del callback OAuth capturado en esta carga de página (o null). */
export function getOAuthCallbackError(): OAuthCallbackError | null {
  return oauthCallbackError
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: isNative() ? capacitorPreferencesStorage : window.sessionStorage,
    // PKCE SOLO en nativo. El deep link del login con Google vuelve con ?code=
    // y src/lib/nativeAuth.ts lo canjea con exchangeCodeForSession, que exige
    // PKCE; con el flujo implícito (default de supabase-js) GoTrue devolvería
    // #access_token= en el fragmento y el canje fallaría EN SILENCIO.
    // En web se mantiene el implícito a propósito: PKCE exige guardar un
    // code_verifier en el mismo storage, y la web usa sessionStorage — abrir el
    // enlace de recuperación de contraseña en otra pestaña o navegador se
    // quedaría sin verifier y rompería el flujo.
    flowType: isNative() ? 'pkce' : 'implicit',
  },
  global: {
    headers: { 'x-application-name': 'aquacontrol' },
  },
})

// ── Cliente TIPADO paralelo (P2 tipos · adopción incremental) ────────────────
// La MISMA instancia, vista con el esquema generado (src/types/database.types.ts).
// Tipar `createClient<Database>` de una produce ~148 errores TS en 49 archivos
// (medido), así que la migración es módulo por módulo: el código nuevo/migrado
// importa `db` (tablas, columnas, RPCs y embeds chequeados en compile-time) y el
// resto sigue con `supabase` sin tipar. El flip global queda para cuando la
// adopción llegue a ~100%.
export const db = supabase as unknown as SupabaseClient<Database>

// Mitigación de cold starts (Sentry PINK-RIBBON-2/-8/-4): con la instancia
// inactiva, el primer signInWithPassword puede tardar 15-20s y morir en el
// auth_timeout de useCredentialsLogin (~10% de los logins medidos en 30 días).
// Un GET barato al health de Auth despierta la instancia mientras el usuario
// todavía está tecleando sus credenciales, en vez de pagarlo en el submit.
let lastWarmupAt = 0

/** Despierta la instancia de Supabase. Deduplicado a 1 ping por 5 minutos. */
export function warmUpSupabase(): void {
  const now = Date.now()
  if (now - lastWarmupAt < 5 * 60_000) return
  lastWarmupAt = now
  void fetch(`${supabaseUrl}/auth/v1/health`, {
    headers: { apikey: supabaseAnonKey },
  }).catch(() => undefined)
}
