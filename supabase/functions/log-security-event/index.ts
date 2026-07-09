import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getUserOrNull } from '../_shared/auth.ts'
// Lógica pura (whitelist pre-auth, extracción de IP, fila de security_logs)
// extraída a ./validate.ts para testearla en vitest (infra:I22).
import { buildSecurityLogRow, getClientIP, isPreAuthEvent } from './validate.ts'

function getAllowedOrigins(): string[] {
  // Production domains are always allowed (independent of the ALLOWED_ORIGINS secret).
  const origins = new Set<string>([
    'https://administratodo.com',
    'https://www.administratodo.com',
    'https://administratodo.app',
    'https://www.administratodo.app',
  ])

  const envOrigins = Deno.env.get('ALLOWED_ORIGINS')
  if (envOrigins) {
    for (const o of envOrigins.split(',')) { const t = o.trim(); if (t) origins.add(t) }
  } else {
    origins.add('http://localhost:5173')
    origins.add('http://localhost:3000')
    origins.add('http://127.0.0.1:5173')
    origins.add('http://127.0.0.1:3000')
  }

  const appUrl = Deno.env.get('APP_URL')
  if (appUrl) {
    try { origins.add(new URL(appUrl).origin) } catch { /* ignore malformed APP_URL */ }
  }

  return [...origins]
}

function getCorsHeaders(origin: string | null) {
  const allowed = getAllowedOrigins()
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0]
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json() as {
      event_type: string
      details: Record<string, unknown>
      user_agent?: string
    }

    const { event_type, details, user_agent } = body

    if (!event_type) {
      return new Response(JSON.stringify({ error: 'event_type is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // F.infra:I1 — JWT validation via shared helper. log-security-event acepta
    // requests sin JWT solo para PRE_AUTH_EVENTS (failed_login, etc).
    const auth = await getUserOrNull(req, corsHeaders)
    const verifiedUserId = auth?.user.id ?? null

    // Post-auth events require a valid JWT
    if (!isPreAuthEvent(event_type) && !verifiedUserId) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Always use JWT-verified user_id — never trust body to prevent spoofing
    const { error } = await adminClient.from('security_logs').insert(
      buildSecurityLogRow({
        verifiedUserId,
        eventType: event_type,
        details,
        ip: getClientIP(req.headers),
        userAgent: user_agent,
        timestamp: new Date().toISOString(),
      }),
    )

    if (error) throw error

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
