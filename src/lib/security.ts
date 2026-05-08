import { supabase } from './supabase'

const IP_CACHE_KEY = 'aq:client_ip'

async function getClientIP(): Promise<string> {
  const cached = sessionStorage.getItem(IP_CACHE_KEY)
  if (cached) return cached
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)
    const response = await fetch('https://api.ipify.org?format=json', { signal: controller.signal })
    clearTimeout(timeoutId)
    const data = await response.json() as { ip: string }
    sessionStorage.setItem(IP_CACHE_KEY, data.ip)
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
