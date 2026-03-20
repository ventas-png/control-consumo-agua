import { supabase } from './supabase'

async function getClientIP(): Promise<string> {
  try {
    const response = await fetch('https://api.ipify.org?format=json')
    const data = await response.json() as { ip: string }
    return data.ip
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
    const clientIP = await getClientIP()
    await supabase.from('security_logs').insert({
      user_id: userId ?? null,
      event_type: eventType,
      details,
      ip_address: clientIP,
      user_agent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Failed to log security event:', error)
  }
}
