import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enforceRateLimits, getClientIp } from '../_shared/rateLimit.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Verify the caller is authenticated
    const authHeader = req.headers.get('authorization') ?? ''
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { company_id, is_superadmin } = await req.json() as {
      company_id?: string
      is_superadmin?: boolean
    }

    if (!company_id && !is_superadmin) {
      return new Response(
        JSON.stringify({ error: 'company_id or is_superadmin required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Authorization: el caller solo puede iniciar un flujo de conexión de Gmail
    // para un scope que realmente le pertenece — nunca se confía solo en el body.
    // is_superadmin → debe ser super_admin; un company_id → debe ser admin/owner
    // de ESA empresa (o super_admin). Cierra el secuestro de la config de email
    // de otro tenant o del superadmin de plataforma.
    {
      const { data: prof } = await supabase
        .from('app_users').select('role, company_id').eq('id', user.id).maybeSingle()
      const role = (prof as { role?: string } | null)?.role ?? ''
      const callerCompany = (prof as { company_id?: string | null } | null)?.company_id ?? null
      const isSuper = role === 'super_admin' || role === 'superadmin'
      const authorized = is_superadmin
        ? isSuper
        : isSuper || (['admin', 'company_owner'].includes(role) && callerCompany === company_id)
      if (!authorized) {
        return new Response(
          JSON.stringify({ error: 'No autorizado para conectar el correo de este scope' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Rate limit server-side (infra:I2). El caller está autenticado, pero topamos el inicio
    // de OAuth por usuario e IP: evita generación masiva de state tokens / consent loops
    // (abuso o bug de reintentos) hacia el endpoint de Google. `supabase` es service_role,
    // que es el único rol al que `rate_limit_hit` está concedido.
    const rlInitiate = await enforceRateLimits(supabase, [
      { subject: user.id, action: 'google_oauth_initiate', max: 20 },
      { subject: `ip:${getClientIp(req)}`, action: 'google_oauth_initiate:ip', max: 40 },
    ], corsHeaders)
    if (rlInitiate) return rlInitiate

    if (!GOOGLE_CLIENT_ID) {
      return new Response(
        JSON.stringify({ error: 'Google OAuth no está configurado en el servidor. Agrega GOOGLE_CLIENT_ID en los secrets de Supabase.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // State: base64 JSON with type tag + company info + timestamp (CSRF protection)
    const statePayload = {
      t: 'gmail_connect',
      company_id: company_id ?? null,
      is_superadmin: is_superadmin ?? false,
      ts: Date.now(),
    }
    const state = btoa(JSON.stringify(statePayload))
    const redirectUri = `${APP_URL}/`

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: [
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ].join(' '),
      access_type: 'offline',
      prompt: 'consent select_account',
      state,
    })

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

    return new Response(
      JSON.stringify({ url: authUrl, state }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    // PR-17: el detalle se registra pero NO se devuelve. Antes se mandaba
    // `String(err)` al cliente, que expone texto de Postgres / de la API de
    // Google. Sin este log el detalle se perdería del todo, que es peor para
    // diagnosticar que la fuga que se está cerrando.
    console.error('[google-oauth-initiate]', err instanceof Error ? err.message : String(err))
    return new Response(
      JSON.stringify({ error: 'Error interno del servidor. Si persiste, contactá a soporte.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
