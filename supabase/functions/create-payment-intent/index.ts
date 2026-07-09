import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// CORS utilities
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
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
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

const stripe = await import('https://esm.sh/stripe@13.10.0?target=deno')

// Lógica pura (validación de request, moneda, centavos, params del intent)
// extraída a ./logic.ts para poder testearla en vitest (infra:I22).
import { buildPaymentIntentParams, esRequestValido, resolveCurrency } from './logic.ts'

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

    const body = await req.json() as {
      cliente_id: string
      registro_id: string
      company_id: string
      monto: number
    }

    const { cliente_id, registro_id, company_id, monto } = body

    if (!esRequestValido({ cliente_id, registro_id, company_id, monto })) {
      return new Response(JSON.stringify({ error: 'Invalid request parameters' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate that caller belongs to the requested company (CRITICAL SECURITY CHECK)
    const { data: callerProfile } = await callerClient
      .from('app_users')
      .select('company_id')
      .eq('id', caller.id)
      .single()

    if (callerProfile?.company_id !== company_id) {
      return new Response(JSON.stringify({ error: 'Cannot create payment intent for other companies' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get company Stripe configuration and currency using admin client
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: company, error: companyError } = await adminClient
      .from('companies')
      .select('stripe_configured, default_currency')
      .eq('id', company_id)
      .single()

    if (companyError || !company || !company.stripe_configured) {
      return new Response(JSON.stringify({ error: 'Stripe not configured for this company' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate and use currency (fallback to USD if not set or invalid)
    const currency = resolveCurrency(company.default_currency)

    // Read secret from isolated table (only service_role can access)
    const { data: secrets, error: secretsError } = await adminClient
      .from('company_payment_secrets')
      .select('stripe_secret_key')
      .eq('company_id', company_id)
      .single()

    if (secretsError || !secrets?.stripe_secret_key) {
      return new Response(JSON.stringify({ error: 'Stripe secret key not found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Initialize Stripe with company's secret key
    const Stripe = stripe.default || stripe
    const stripeClient = new Stripe(secrets.stripe_secret_key)

    // Get cliente info for payment description
    const { data: cliente } = await adminClient
      .from('clientes')
      .select('nombre')
      .eq('id', cliente_id)
      .single()

    // Create PaymentIntent with dynamic currency
    const paymentIntent = await stripeClient.paymentIntents.create(
      buildPaymentIntentParams({
        cliente_id,
        registro_id,
        company_id,
        monto,
        currency,
        clienteNombre: cliente?.nombre,
      })
    )

    // Create payment_request record for tracking
    const { error: paymentRequestError } = await adminClient
      .from('payment_requests')
      .insert({
        cliente_id,
        registro_id,
        company_id,
        monto,
        provider: 'stripe',
        estado: 'pending',
        stripe_payment_intent: paymentIntent.id,
      })

    if (paymentRequestError) {
      console.error('Error creating payment request record:', paymentRequestError)
    }

    return new Response(JSON.stringify({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    console.error('Error creating payment intent:', err)
    return new Response(JSON.stringify({ error: err.message || 'Failed to create payment intent' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
