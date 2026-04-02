import { supabase } from './supabase'

// Client-side IP detection is inherently unreliable and leaks requests to a
// third-party service. We record a placeholder here; the authoritative IP
// should be captured server-side (e.g. via a Supabase Edge Function or RLS
// policy that reads the request headers).
function getClientHint(): string {
  // Use timezone + language as a lightweight, privacy-respecting context hint
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown'
    const lang = navigator.language ?? 'unknown'
    return `${tz}/${lang}`
  } catch {
    return 'unknown'
  }
}

export async function logSecurityEvent(
  eventType: string,
  details: Record<string, unknown>,
  userId?: string
): Promise<void> {
  try {
    await supabase.from('security_logs').insert({
      user_id: userId ?? null,
      event_type: eventType,
      details,
      ip_address: null, // resolved server-side; not trusted from the client
      client_hint: getClientHint(),
      user_agent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    // Log to console only in development to avoid leaking info in production
    if (import.meta.env.DEV) {
      console.error('Failed to log security event:', error)
    }
  }
}
