import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
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

    const record = buildEmailConfigRecord(tokens, userInfo.email, stateData)

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
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
