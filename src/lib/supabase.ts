import { createClient } from '@supabase/supabase-js'

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
