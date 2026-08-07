import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptSecret } from '../_shared/secretsCrypto.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { enforceRateLimits, getClientIp } from '../_shared/rateLimit.ts'
import { buildEmailConfigRecord, canConnectEmailScope, validateOAuthState } from './logic.ts'

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

interface TokenResponse {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope: string
  error?: string
  error_description?: string
}

interface GoogleUserInfo {
  email: string
  name: string
}

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

    const { code, state } = await req.json() as { code: string; state: string }

    if (!code || !state) {
      return new Response(
        JSON.stringify({ error: 'code and state are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Decode and validate state (decisión pura en logic.ts — mismos 3 rechazos 400)
    const stateCheck = validateOAuthState(state)
    if (!stateCheck.ok) {
      return new Response(
        JSON.stringify({ error: stateCheck.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    const stateData = stateCheck.state

    // Authorization: re-validamos el scope contra el rol/empresa REAL del caller
    // (no contra el state, que va sin firmar). Aunque alguien fabrique un state
    // con is_superadmin:true o el company_id de otro tenant, aquí se rechaza si
    // el caller no es super_admin / admin-owner de esa empresa. Es la barrera
    // que impide sobrescribir la config de Gmail de otro tenant o del superadmin.
    {
      const { data: prof } = await supabase
        .from('app_users').select('role, company_id').eq('id', user.id).maybeSingle()
      const role = (prof as { role?: string } | null)?.role ?? ''
      const callerCompany = (prof as { company_id?: string | null } | null)?.company_id ?? null
      const authorized = canConnectEmailScope(
        { companyId: stateData.company_id, isSuperadmin: stateData.is_superadmin },
        { role, companyId: callerCompany },
      )
      if (!authorized) {
        return new Response(
          JSON.stringify({ error: 'No autorizado para conectar el correo de este scope' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // ── Rate limit (auditoría 2026-07-28, Bloque C · PR-16) ─────────────────
    // `google-oauth-initiate` sí topa el inicio del flujo (20/usuario, 40/IP),
    // pero el callback —que es el lado que hace el intercambio de código contra
    // Google y ESCRIBE los tokens del tenant— no tenía ninguno. Se alinea con su
    // par: sin esto, el gasto de cuota contra Google y las escrituras a
    // company_email_configs quedaban sin tope aunque el inicio estuviera topado.
    //
    // Va DESPUÉS del gate de autorización de arriba a propósito: así el contador
    // registra intentos ya autenticados y autorizados, y no lo puede quemar un
    // tercero para dejar sin servicio al admin legítimo.
    const rlCallback = await enforceRateLimits(supabase, [
      { subject: user.id, action: 'google_oauth_callback', max: 20 },
      { subject: `ip:${getClientIp(req)}`, action: 'google_oauth_callback:ip', max: 40 },
    ], corsHeaders)
    if (rlCallback) return rlCallback

    // Exchange authorization code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${APP_URL}/`,
        grant_type: 'authorization_code',
      }),
    })

    const tokens = await tokenRes.json() as TokenResponse

    if (tokens.error || !tokens.access_token) {
      return new Response(
        JSON.stringify({ error: tokens.error_description ?? tokens.error ?? 'Token exchange failed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch Gmail address from Google
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const userInfo = await userInfoRes.json() as GoogleUserInfo

    // P0 #7: cifrar los tokens OAuth en reposo (passthrough sin llave). Se
    // cifran AQUÍ y se le pasan ya cifrados al helper, que es puro.
    const record = buildEmailConfigRecord(
      tokens,
      userInfo.email,
      stateData,
      Date.now(),
      await encryptSecret(tokens.access_token),
      tokens.refresh_token ? await encryptSecret(tokens.refresh_token) : null,
    )

    if (stateData.is_superadmin) {
      await supabase.from('company_email_configs').delete().eq('is_superadmin', true)
      const { error: dbError } = await supabase.from('company_email_configs').insert(record)
      if (dbError) throw new Error(dbError.message)
    } else {
      // Partial unique index on company_id (WHERE company_id IS NOT NULL) doesn't
      // support ON CONFLICT upsert — use delete+insert instead.
      await supabase.from('company_email_configs').delete().eq('company_id', stateData.company_id)
      const { error: dbError } = await supabase.from('company_email_configs').insert(record)
      if (dbError) throw new Error(dbError.message)
    }

    return new Response(
      JSON.stringify({ success: true, email: userInfo.email }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    // PR-17: el detalle se registra pero NO se devuelve. Antes se mandaba
    // `String(err)` al cliente, que expone texto de Postgres / de la API de
    // Google. Sin este log el detalle se perdería del todo, que es peor para
    // diagnosticar que la fuga que se está cerrando.
    console.error('[google-oauth-callback]', err instanceof Error ? err.message : String(err))
    return new Response(
      JSON.stringify({ error: 'Error interno del servidor. Si persiste, contactá a soporte.' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
