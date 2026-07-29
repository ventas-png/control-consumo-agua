import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getUserOrNull } from '../_shared/auth.ts'
import { enforceRateLimit, getClientIp } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

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
    if (!PRE_AUTH_EVENTS.has(event_type) && !verifiedUserId) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // ── Rate limit (auditoría 2026-07-28, Bloque C · PR-16) ──────────────────
    // Esta función se despliega con --no-verify-jwt (deploy-functions.yml:94) y
    // acepta PRE_AUTH_EVENTS sin sesión, con `details` JSON controlado por quien
    // llama. No tenía NINGÚN límite: cualquiera podía inundar `security_logs`
    // para enterrar un incidente real bajo ruido (anti-forense), inflar el
    // almacenamiento, o inyectar contenido que se renderiza en el panel de
    // seguridad del superadmin.
    //
    // fail-CLOSED a propósito: aquí el rate limit es el ÚNICO control, así que
    // si el contador cae, fail-open dejaría el endpoint completamente abierto —
    // y tumbar el contador es justo lo primero que intentaría un atacante.
    // Perder algunos eventos pre-login es preferible a perder la integridad del
    // log de auditoría.
    //
    // El tope es generoso: un login fallido legítimo genera 1 evento, y una
    // ráfaga de reintentos honesta cabe de sobra en 60/hora por IP.
    const rl = await enforceRateLimit(
      adminClient,
      {
        subject: `ip:${getClientIp(req)}`,
        action: 'log_security_event',
        max: 60,
        failClosed: true,
      },
      corsHeaders,
    )
    if (rl) return rl

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
