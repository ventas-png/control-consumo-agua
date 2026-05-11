import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

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
  picture?: string
}

interface StatePayload {
  t: string
  company_id: string | null
  is_superadmin: boolean
  ts: number
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { code, state } = await req.json() as { code: string; state: string }

    if (!code || !state) {
      return new Response(
        JSON.stringify({ error: 'code and state are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Decode and validate state
    let stateData: StatePayload
    try {
      stateData = JSON.parse(atob(state)) as StatePayload
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid state parameter' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (stateData.t !== 'gmail_connect') {
      return new Response(
        JSON.stringify({ error: 'Invalid OAuth flow type' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Reject stale states (15-minute window)
    if (Date.now() - stateData.ts > 15 * 60 * 1000) {
      return new Response(
        JSON.stringify({ error: 'OAuth state expired. Please try again.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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

    // Fetch user's Gmail address from Google
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const userInfo = await userInfoRes.json() as GoogleUserInfo

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const tokenExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const record = {
      provider: 'google',
      email: userInfo.email,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      token_expiry: tokenExpiry,
      is_active: true,
      updated_at: new Date().toISOString(),
      ...(stateData.is_superadmin
        ? { company_id: null, is_superadmin: true }
        : { company_id: stateData.company_id, is_superadmin: false }),
    }

    // Upsert by company_id (or superadmin flag)
    if (stateData.is_superadmin) {
      // Delete existing superadmin config before insert (no compound upsert key)
      await supabase
        .from('company_email_configs')
        .delete()
        .eq('is_superadmin', true)
    }

    const { error: dbError } = await supabase
      .from('company_email_configs')
      .upsert(record, {
        onConflict: stateData.is_superadmin ? undefined : 'company_id',
      })

    if (dbError) {
      return new Response(
        JSON.stringify({ error: 'Failed to save credentials', details: dbError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
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
