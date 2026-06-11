// Detección y manejo del callback OAuth de Gmail + token de reset legado
// (P1 #4, extraído de App.tsx sin cambios de comportamiento).
import { supabase } from './supabase'
import { notify } from '../components/shared/Dialog'

// Detect password reset token in URL
export function getResetToken(): string | null {
  return new URLSearchParams(window.location.search).get('reset_token')
}

// Detect Gmail OAuth callback.
// supabase.ts intercepts the URL early and saves params to sessionStorage before
// Supabase can try to process the Gmail code as its own PKCE callback.
export interface GmailOAuthParams { code: string; state: string; stateData: { t: string; company_id: string | null; is_superadmin: boolean } }

export function detectGmailOAuthCallback(): GmailOAuthParams | null {
  // Primary: read from sessionStorage (set by supabase.ts before Supabase init)
  const stored = sessionStorage.getItem('__gmail_callback')
  if (stored) {
    try {
      sessionStorage.removeItem('__gmail_callback')
      const { code, state } = JSON.parse(stored) as { code: string; state: string }
      const stateData = JSON.parse(atob(state)) as { t: string; company_id: string | null; is_superadmin: boolean }
      if (stateData.t === 'gmail_connect') return { code, state, stateData }
    } catch { /* invalid stored data */ }
  }
  // Fallback: URL still has params (shouldn't happen after the fix, kept for safety)
  const p = new URLSearchParams(window.location.search)
  const code = p.get('code')
  const state = p.get('state')
  if (!code || !state) return null
  try {
    const stateData = JSON.parse(atob(state)) as { t: string; company_id: string | null; is_superadmin: boolean }
    if (stateData.t === 'gmail_connect') {
      window.history.replaceState({}, '', window.location.pathname)
      return { code, state, stateData }
    }
  } catch { /* not our callback */ }
  return null
}

const SUPABASE_URL_FOR_FN = import.meta.env.VITE_SUPABASE_URL as string

export async function handleGmailOAuthCallback(params: GmailOAuthParams): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token ?? ''
  const res = await fetch(`${SUPABASE_URL_FOR_FN}/functions/v1/google-oauth-callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code: params.code, state: params.state }),
  })
  if (res.ok) {
    const json = await res.json() as { email?: string }
    notify({
      variant: 'success',
      title: '¡Cuenta de Google conectada!',
      text: `Los correos se enviarán desde ${json.email ?? 'tu cuenta de Google'}.`,
    })
  } else {
    const err = await res.json() as { error?: string }
    notify({ variant: 'error', title: 'Error al conectar Google', text: err.error ?? 'Intenta nuevamente.' })
  }
}
