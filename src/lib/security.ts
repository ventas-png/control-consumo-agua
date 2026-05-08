import { supabase } from './supabase'

export async function logSecurityEvent(
  eventType: string,
  details: Record<string, unknown>,
  userId?: string
): Promise<void> {
  try {
    // IP is captured server-side from request headers — no client-side IP lookup needed
    const { error } = await supabase.functions.invoke('log-security-event', {
      body: {
        event_type: eventType,
        details,
        user_id: userId ?? null,
        user_agent: navigator.userAgent,
      },
    })
    if (error) throw error
  } catch (error) {
    console.error('Failed to log security event:', error)
  }
}
