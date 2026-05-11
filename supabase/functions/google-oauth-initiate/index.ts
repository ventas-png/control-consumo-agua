import { corsHeaders } from '../_shared/cors.ts'

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? ''
const APP_URL = Deno.env.get('APP_URL') ?? ''

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
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

    if (!GOOGLE_CLIENT_ID) {
      return new Response(
        JSON.stringify({ error: 'Google OAuth not configured on server' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // State encodes company_id + timestamp for CSRF protection.
    // Prefixed with "gmail_connect:" so App.tsx can distinguish from login OAuth.
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
        'https://www.googleapis.com/userinfo.email',
        'https://www.googleapis.com/userinfo.profile',
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
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
