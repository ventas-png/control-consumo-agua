import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptSecret } from '../_shared/secretsCrypto.ts'

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

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  // Note: validateOrigin is intentionally skipped — Stripe webhook requests
  // are server-to-server and do not include an Origin header.
  // Authentication is performed via Stripe signature verification below.

  try {
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.text()
    const signature = req.headers.get('stripe-signature')

    if (!signature) {
      console.error('No Stripe signature found')
      return new Response(JSON.stringify({ error: 'No signature' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    let event = null
    let companyId = null
    const Stripe = stripe.default || stripe

    // First, try to find matching webhook secret using indexed search
    // Get all company secrets for verification (fallback to O(n) if needed)
    const { data: secrets, error: secretsError } = await adminClient
      .from('company_payment_secrets')
      .select('company_id, stripe_webhook_secret')
      .neq('stripe_webhook_secret', null)

    if (secretsError || !secrets || secrets.length === 0) {
      console.error('No companies with Stripe webhook secret configured')
      return new Response(JSON.stringify({ error: 'No companies configured' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    // Try to verify with each company's webhook secret
    for (const secret of secrets) {
      try {
        if (!secret.stripe_webhook_secret) continue

        // P0 #7: descifrar en reposo (dual-read: texto plano legacy pasa igual).
        const webhookSecret = await decryptSecret(secret.stripe_webhook_secret)
        if (!webhookSecret) continue

        event = Stripe.webhooks.constructEvent(
          body,
          signature,
          webhookSecret
        )
        companyId = secret.company_id
        console.log(`Webhook verified for company: ${companyId}`)
        break
      } catch (err) {
        // Signature verification failed for this company, try next
        continue
      }
    }

    if (!event || !companyId) {
      console.error('Webhook signature verification failed for all companies')
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      })
    }

    console.log(`Processing webhook event: ${event.type}`)

    // Handle different event types
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object as any

      // Find the payment request
      const { data: paymentRequest } = await adminClient
        .from('payment_requests')
        .select('*')
        .eq('stripe_payment_intent', paymentIntent.id)
        .single()

      if (paymentRequest) {
        // SECURITY: Validate company ownership to prevent cross-company pago creation
        if (paymentRequest.company_id !== companyId) {
          console.error('Company mismatch in webhook: payment_requests.company_id != verified webhook company_id')
          return new Response(JSON.stringify({ error: 'Company validation failed' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          })
        }

        // Create pago record with 'verificado' status (auto-verified via webhook)
        const { error: pagoError } = await adminClient
          .from('pagos')
          .insert({
            registro_id: paymentRequest.registro_id,
            cliente_id: paymentRequest.cliente_id,
            project_id: null,
            monto: paymentRequest.monto,
            metodo: 'tarjeta_credito', // Stripe is credit card
            tipo_aplicacion: 'pago_total',
            verification_status: 'verificado',
            estado: 'verificado',
            stripe_payment_intent_id: paymentIntent.id,
            comprobante_url: null,
            comprobante_tipo: null,
            verified_at: new Date().toISOString(),
            verified_by: 'stripe_webhook',
            notas: `Pago automático de Stripe - ${paymentIntent.id}`,
            created_by: null,
          })

        if (pagoError) {
          console.error('Error creating pago from webhook:', pagoError)
          return new Response(JSON.stringify({ error: 'Failed to create pago' }), {
            status: 500, headers: { 'Content-Type': 'application/json' },
          })
        }

        // Update payment_requests status
        const { error: updateError } = await adminClient
          .from('payment_requests')
          .update({ estado: 'succeeded' })
          .eq('id', paymentRequest.id)

        if (updateError) {
          console.error('Error updating payment request:', updateError)
        }
      }
    } else if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object as any

      const { data: paymentRequest } = await adminClient
        .from('payment_requests')
        .select('*')
        .eq('stripe_payment_intent', paymentIntent.id)
        .single()

      if (paymentRequest) {
        // Update payment_requests status
        const { error: updateError } = await adminClient
          .from('payment_requests')
          .update({
            estado: 'failed',
          })
          .eq('id', paymentRequest.id)

        if (updateError) {
          console.error('Error updating payment request on failure:', updateError)
        }
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('Webhook error:', err)
    return new Response(JSON.stringify({ error: 'Webhook processing failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
