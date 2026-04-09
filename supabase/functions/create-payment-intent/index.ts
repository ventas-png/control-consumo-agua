import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, validateOrigin } from '../_shared/cors.ts'

// Import Stripe library
const stripe = await import('https://esm.sh/stripe@13.10.0?target=deno')

// Supported currencies for Stripe
const STRIPE_SUPPORTED_CURRENCIES = new Set([
  'usd', 'eur', 'gbp', 'jpy', 'aud', 'cad', 'chf', 'cny', 'inr', 'mxn',
  'nzd', 'sgd', 'hkd', 'nok', 'sek', 'dkk', 'pln', 'czk', 'huf', 'ron',
  'bgn', 'hrk', 'rub', 'try', 'brl', 'ars', 'clp', 'cop', 'pen', 'uyu',
  'idr', 'myr', 'php', 'thb', 'vnd', 'zar', 'kes', 'egp', 'aed', 'qar'
])

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

    if (!cliente_id || !registro_id || !company_id || !monto || monto <= 0) {
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
    const currency = (company.default_currency && STRIPE_SUPPORTED_CURRENCIES.has(company.default_currency.toLowerCase()))
      ? company.default_currency.toLowerCase()
      : 'usd'

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
    const paymentIntent = await stripeClient.paymentIntents.create({
      amount: Math.round(monto * 100), // Convert to cents
      currency: currency,
      metadata: {
        cliente_id,
        registro_id,
        company_id,
      },
      description: `Pago de agua - ${cliente?.nombre ?? 'Cliente'}`,
    })

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
