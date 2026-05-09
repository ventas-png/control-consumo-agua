import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Event types allowed without a valid JWT (fired before login completes)
const PRE_AUTH_EVENTS = new Set([
  'failed_login_attempt',
  'login_error',
  'login_success',
  'password_reset_requested',
])

function getClientIP(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const fly = req.headers.get('fly-client-ip')
  if (fly) return fly
  return 'unknown'
}

function getAllowedOrigins(): string[] {
  const envOrigins = Deno.env.get('ALLOWED_ORIGINS')
  if (envOrigins) return envOrigins.split(',').map(o => o.trim())
  return ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'http://127.0.0.1:3000']
}

function getCorsHeaders(origin: string | null) {
  const allowed = getAllowedOrigins()
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0]
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    // Try to verify JWT — required for post-auth events
    const authHeader = req.headers.get('authorization')
    let verifiedUserId: string | null = null

    if (authHeader) {
      const callerClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      )
      const { data: { user } } = await callerClient.auth.getUser()
      if (user) verifiedUserId = user.id
    }

    // Post-auth events require a valid JWT
    if (!PRE_AUTH_EVENTS.has(event_type) && !verifiedUserId) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { error } = await adminClient.from('security_logs').insert({
      // Always use JWT-verified user_id — never trust body to prevent spoofing
      user_id: verifiedUserId ?? null,
      event_type,
      details,
      ip_address: getClientIP(req),
      user_agent: user_agent ?? '',
      timestamp: new Date().toISOString(),
    })

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
