import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

function getClientIP(req: Request): string {
  // Cloudflare
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf
  // Standard proxy header (first IP is the real client)
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  // Fly.io / Render
  const flyClient = req.headers.get('fly-client-ip')
  if (flyClient) return flyClient
  return 'unknown'
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { event_type, details, user_id, user_agent } = await req.json() as {
      event_type: string
      details: Record<string, unknown>
      user_id?: string | null
      user_agent?: string
    }

    if (!event_type) {
      return new Response(JSON.stringify({ error: 'event_type is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Use service role to bypass RLS for audit log inserts
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const ip = getClientIP(req)

    const { error } = await adminClient.from('security_logs').insert({
      user_id: user_id ?? null,
      event_type,
      details,
      ip_address: ip,
      user_agent: user_agent ?? '',
      timestamp: new Date().toISOString(),
    })

    if (error) throw error

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Internal error'
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
