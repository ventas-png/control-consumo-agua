import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS utilities for Edge Functions
function getAllowedOrigins(): string[] {
  const envOrigins = Deno.env.get('ALLOWED_ORIGINS')
  if (envOrigins) {
    return envOrigins.split(',').map(origin => origin.trim())
  }
  return [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
  ]
}

function getCorsHeaders(origin: string | null) {
  const allowedOrigins = getAllowedOrigins()
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  }
}

function validateOrigin(origin: string | null, corsHeaders: ReturnType<typeof getCorsHeaders>) {
  const allowedOrigins = getAllowedOrigins()
  if (!origin || !allowedOrigins.includes(origin)) {
    return new Response(
      JSON.stringify({ error: 'Origin not allowed', origin }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
  return null
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Validate origin
  const originError = validateOrigin(origin, corsHeaders)
  if (originError) return originError

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

    // company_owner and admin can only configure their own company
    if ((callerRole === 'company_owner' || callerRole === 'admin') && companyId !== callerCompanyId) {
      return new Response(JSON.stringify({ error: 'Cannot configure payment for other companies' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Use admin client to write secrets securely
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Update public config in companies table
    let companyUpdate: Record<string, unknown>
    let secretsUpdate: Record<string, unknown>

    if (provider === 'stripe') {
      companyUpdate = {
        stripe_public_key: publicKey,
        stripe_configured: true,
        stripe_activo: true,
      }
      secretsUpdate = {
        company_id: companyId,
        stripe_secret_key: secretKey,
        updated_at: new Date().toISOString(),
      }
    } else {
      companyUpdate = {
        paypal_client_id: publicKey,
        paypal_configured: true,
        paypal_activo: true,
      }
      secretsUpdate = {
        company_id: companyId,
        paypal_client_secret: secretKey,
        updated_at: new Date().toISOString(),
      }
    }

    const { error: companyError } = await adminClient
      .from('companies')
      .update(companyUpdate)
      .eq('id', companyId)

    if (companyError) {
      console.error('Error saving company config:', companyError)
      return new Response(JSON.stringify({ error: 'Failed to save configuration' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Upsert secret in company_payment_secrets table (only service_role can access)
    const { error: secretError } = await adminClient
      .from('company_payment_secrets')
      .upsert(secretsUpdate, { onConflict: 'company_id' })

    if (secretError) {
      console.error('Error saving payment secret:', secretError)
      // Rollback: unmark as configured since secret wasn't saved
      const rollback: Record<string, unknown> = provider === 'stripe'
        ? { stripe_configured: false, stripe_activo: false }
        : { paypal_configured: false, paypal_activo: false }
      await adminClient.from('companies').update(rollback).eq('id', companyId)

      return new Response(JSON.stringify({ error: 'Failed to save secret key' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('Error saving payment config:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
