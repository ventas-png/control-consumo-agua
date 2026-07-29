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


// PR-12 (auditoría 2026-07-28). Antes: `await import('...stripe@13.10.0?target=deno')`
// + `Stripe.webhooks.constructEvent(...)` — la variante SÍNCRONA.
//
// Con `?target=deno`, esm.sh sirve el build web del SDK, cuyo
// `createDefaultCryptoProvider()` devuelve un `SubtleCryptoProvider`
// (WebPlatformFunctions.js:35). El `computeHMACSignature` síncrono de ese
// provider LANZA SIEMPRE (`CryptoProviderOnlySupportsAsyncError`,
// SubtleCryptoProvider.js:17): en Deno no existe HMAC síncrono.
//
// Como la excepción caía en un `catch { continue }`, se lanzaba una vez por cada
// secreto de empresa, se agotaba el bucle y la función respondía
// `403 Invalid signature` — para el 100% de los eventos, indistinguible de una
// firma realmente inválida. El webhook de cobro por tenant llevaba caído desde
// que se escribió.
//
// Se alinea con `stripe-platform-webhook`, que ya lo hace bien: mismo SDK 17.4.0
// e import estático.
import Stripe from 'https://esm.sh/stripe@17.4.0?target=deno'

// La verificación de firma es puro HMAC local: no llama a la API de Stripe, así
// que la clave del constructor es irrelevante. Se instancia una sola vez para
// obtener el helper `webhooks`; el secreto real de cada empresa se pasa por
// llamada. (Este webhook es multi-tenant: no hay UNA secret key de plataforma
// que poner aquí, a diferencia de stripe-platform-webhook.)
const stripeVerifier = new Stripe('sk_webhook_signature_verification_only', {
  apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion,
})

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

    let event: Stripe.Event | null = null
    let companyId: string | null = null

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

    // Try to verify with each company's webhook secret.
    //
    // El barrido O(n) es inherente a un webhook multi-tenant con un secreto por
    // empresa: Stripe no dice a qué tenant pertenece el evento hasta que la firma
    // valida. Lo que sí se arregla es no confundir "firma que no casa" con "el
    // verificador está roto": se cuenta cada tipo de fallo por separado.
    let firmaNoCasa = 0
    let erroresInesperados = 0
    for (const secret of secrets) {
      if (!secret.stripe_webhook_secret) continue
      // P0 #7: descifrar en reposo (dual-read: texto plano legacy pasa igual).
      const webhookSecret = await decryptSecret(secret.stripe_webhook_secret)
      if (!webhookSecret) continue

      try {
        event = await stripeVerifier.webhooks.constructEventAsync(body, signature, webhookSecret)
        companyId = secret.company_id
        console.log(`Webhook verified for company: ${companyId}`)
        break
      } catch (err) {
        // Una firma que no casa con ESTE tenant es el caso normal del barrido.
        // Cualquier otra excepción significa que el verificador no funciona —
        // tragársela fue justo lo que mantuvo el bug invisible.
        if (err instanceof Stripe.errors.StripeSignatureVerificationError) {
          firmaNoCasa++
        } else {
          erroresInesperados++
          console.error(
            '[stripe-webhook] fallo NO atribuible a la firma:',
            err instanceof Error ? err.message : String(err),
          )
        }
      }
    }

    if (!event || !companyId) {
      if (erroresInesperados > 0) {
        // No es "firma inválida": el verificador está roto. 500 para que Stripe
        // reintente y para que el fallo salga en las métricas de error.
        console.error(
          `[stripe-webhook] verificador roto: ${erroresInesperados} error(es) inesperado(s) de ${secrets.length} secreto(s).`,
        )
        return new Response(JSON.stringify({ error: 'Verification unavailable' }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        })
      }
      console.error(
        `[stripe-webhook] firma inválida para las ${firmaNoCasa} empresa(s) con secreto configurado`,
      )
      return new Response(JSON.stringify({ error: 'Invalid signature' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      })
    }

    // ── Idempotencia ────────────────────────────────────────────────────────
    // Stripe reentrega el mismo evento ante timeouts o 5xx, y su ventana de
    // tolerancia de firma (300 s por defecto) permite reenviar una captura
    // válida. Mismo patrón que stripe-platform-webhook:324-339 — el PK de
    // `stripe_webhook_events` es la barrera.
    //
    // `pagos.stripe_payment_intent_id` es UNIQUE
    // (20260317000000_baseline_legacy_tables_phase1.sql:195), así que un replay
    // tampoco duplicaría el cobro; pero sin esto devolvería 500 y Stripe seguiría
    // reintentando un evento ya aplicado.
    const { error: dedupeErr } = await adminClient
      .from('stripe_webhook_events')
      .insert({
        event_id: event.id,
        event_type: event.type,
        livemode: event.livemode,
        payload: event as unknown as Record<string, unknown>,
      })
    if (dedupeErr) {
      if (dedupeErr.code === '23505') {
        return new Response(JSON.stringify({ received: true, already_processed: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      console.error('[stripe-webhook] error insertando evento:', dedupeErr.message)
      return new Response(JSON.stringify({ error: 'DB error' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
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
          // 23505 sobre `pagos.stripe_payment_intent_id` (UNIQUE) = el pago ya
          // estaba registrado. Es éxito, no fallo: devolver 500 haría que Stripe
          // reintentara para siempre un evento ya aplicado.
          if (pagoError.code === '23505') {
            console.log(`[stripe-webhook] pago ya registrado para ${paymentIntent.id}`)
            return new Response(JSON.stringify({ received: true, already_processed: true }), {
              status: 200, headers: { 'Content-Type': 'application/json' },
            })
          }
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
