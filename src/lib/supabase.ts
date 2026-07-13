import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.sessionStorage,
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
