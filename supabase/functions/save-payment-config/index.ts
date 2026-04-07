import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Validate caller using their JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser()
    if (callerError || !caller) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get caller's role and company
    const { data: callerProfile } = await callerClient
      .from('app_users')
      .select('role, company_id')
      .eq('id', caller.id)
      .single()

    const callerRole = (callerProfile as { role: string; company_id: string } | null)?.role ?? ''
    const callerCompanyId = (callerProfile as { role: string; company_id: string } | null)?.company_id

    // Only allow company owners and admins
    if (callerRole !== 'company_owner' && callerRole !== 'admin') {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json() as {
      companyId: string
      provider: 'stripe' | 'paypal'
      publicKey: string
      secretKey: string
    }

    const { companyId, provider, publicKey, secretKey } = body

    if (!companyId || !provider || !publicKey || !secretKey) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (provider !== 'stripe' && provider !== 'paypal') {
      return new Response(JSON.stringify({ error: 'Invalid provider' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Company owners can only configure their own company
    if (callerRole === 'company_owner' && companyId !== callerCompanyId) {
      return new Response(JSON.stringify({ error: 'Cannot configure payment for other companies' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Use admin client to write secrets securely
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    let updateData: Record<string, unknown>

    if (provider === 'stripe') {
      updateData = {
        stripe_public_key: publicKey,
        stripe_secret_key: secretKey,
        stripe_configured: true,
        stripe_activo: true,
      }
    } else {
      updateData = {
        paypal_client_id: publicKey,
        paypal_client_secret: secretKey,
        paypal_configured: true,
        paypal_activo: true,
      }
    }

    const { error: updateError } = await adminClient
      .from('companies')
      .update(updateData)
      .eq('id', companyId)

    if (updateError) {
      console.error('Error saving payment config:', updateError)
      return new Response(JSON.stringify({ error: 'Failed to save configuration' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    console.error('Error saving payment config:', err)
    return new Response(JSON.stringify({ error: err.message || 'Failed to save payment config' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
