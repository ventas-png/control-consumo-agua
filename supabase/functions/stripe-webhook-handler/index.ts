import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptSecret } from '../_shared/secretsCrypto.ts'
// Decisión de la respuesta HTTP (lógica pura) en ./logic.ts, testeable en
// vitest. Antes aquí se importaba `buildPagoRow`, que armaba la fila de `pagos`
// a mano: ya no existe — el pago lo inserta `conciliar_pago_externo` en la misma
// transacción que acredita el recibo.
import {
  decidirCruceDeEmpresa,
  decidirTrasConciliar,
  decidirTrasReclamo,
  decidirTrasSellar,
  type Conciliacion,
  type Decision,
  type Reclamo,
} from './logic.ts'

// CORS utilities

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
import { getCorsHeaders } from '../_shared/cors.ts'

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

  /**
   * Única salida con cuerpo. Que el status venga de `Decision` y no de un
   * literal repartido por el archivo es deliberado: el status ES la semántica
   * frente a Stripe —2xx significa «no me lo traigas más»— y así se decide en
   * un módulo puro con pruebas, no a ojo en cada rama.
   */
  const responder = (d: Extract<Decision, { accion: 'responder' }>) =>
    new Response(JSON.stringify(d.body), {
      status: d.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

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

    // ── Idempotencia REAL ───────────────────────────────────────────────────
    // Antes esto era un INSERT a secas en `stripe_webhook_events`, y un choque
    // de PK respondía 200 `already_processed`. El problema no era el INSERT sino
    // lo que significaba: reclamaba el evento ANTES de procesarlo, y la tabla
    // —que desde 20260528000040 tiene `processed_at` y `error_message`— nunca
    // se cerraba. Si el procesamiento se caía después de reclamar, el reintento
    // de Stripe encontraba la fila, recibía 200 y el cobro se quedaba sin
    // acreditar PARA SIEMPRE, sin nadie que lo volviera a intentar.
    //
    // «Lo vi» y «lo terminé» son hechos distintos. 20260911231905 los separa en
    // cuatro estados y reclama en UNA sentencia: dos entregas simultáneas del
    // mismo evento son exactamente el caso que un check-then-insert deja pasar.
    const { data: reclamoRaw, error: reclamoErr } = await adminClient.rpc(
      'stripe_webhook_evento_reclamar',
      {
        p_event_id: event.id,
        p_event_type: event.type,
        p_livemode: event.livemode,
        p_payload: event as unknown as Record<string, unknown>,
      },
    )
    if (reclamoErr) {
      console.error('[stripe-webhook] no se pudo reclamar el evento:', reclamoErr.message)
      return responder({
        accion: 'responder', status: 500,
        body: { received: false, retryable: true, error: 'no se pudo registrar el evento' },
      })
    }

    const trasReclamo = decidirTrasReclamo((reclamoRaw ?? {}) as Reclamo)
    if (trasReclamo.accion === 'responder') return responder(trasReclamo)

    // A partir de aquí el evento es NUESTRO y hay que cerrarlo pase lo que pase:
    // dejarlo en `procesando` lo convierte en un evento que nadie retoma hasta
    // que vence el umbral de rancio.
    //
    // Devuelve si el sello quedó escrito. Antes esto sólo lo registraba en el
    // log y seguía: si la conciliación salía bien pero marcar el evento
    // `completado` fallaba, el handler respondía 200 con el evento atascado en
    // `procesando` — Stripe dejaba de traerlo y quedaba un cobro acreditado sin
    // constancia de haberse terminado. Un 200 sólo se emite cuando TODO quedó
    // escrito, incluido el sello.
    const cerrar = async (ok: boolean, motivo?: string): Promise<boolean> => {
      const { error } = await adminClient.rpc('stripe_webhook_evento_cerrar', {
        p_event_id: event.id, p_ok: ok, p_error: motivo ?? null,
      })
      if (error) {
        console.error('[stripe-webhook] no se pudo cerrar el evento:', error.message)
        return false
      }
      return true
    }

    /**
     * Cierra y responde. Si el cierre falla, la respuesta pasa a ser
     * reintentable pase lo que pase: reintentar es barato —la conciliación
     * responde `ya_conciliado`— y dar por bueno lo que no se pudo sellar no lo
     * es.
     */
    const cerrarYResponder = async (
      ok: boolean, decision: Extract<Decision, { accion: 'responder' }>, motivo?: string,
    ) => {
      const tras = decidirTrasSellar(await cerrar(ok, motivo), decision)
      return responder(tras as Extract<Decision, { accion: 'responder' }>)
    }

    try {
      console.log(`Processing webhook event: ${event.type}`)

      if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = event.data.object as { id: string }

        // El monto, la empresa y el ítem salen de `payment_requests`, NUNCA del
        // payload de Stripe: lo que se concilia es la solicitud que este sistema
        // creó, no lo que venga en el evento.
        const { data: pr, error: prErr } = await adminClient
          .from('payment_requests')
          .select('id, company_id')
          .eq('stripe_payment_intent', paymentIntent.id)
          .maybeSingle()

        if (prErr) {
          return await cerrarYResponder(false, {
            accion: 'responder', status: 500,
            body: { received: false, retryable: true, error: prErr.message },
          }, `lectura de payment_requests: ${prErr.message}`)
        }

        if (!pr) {
          // No hay solicitud para este intent. No es un fallo nuestro y
          // reintentarlo daría lo mismo: se cierra como completado para que
          // Stripe no insista, y queda el rastro en la tabla.
          console.warn(`[stripe-webhook] sin payment_request para ${paymentIntent.id}`)
          return await cerrarYResponder(true, {
            accion: 'responder', status: 200,
            body: { received: true, sin_solicitud: true },
          })
        }

        const cruce = decidirCruceDeEmpresa(companyId, pr.company_id)
        if (cruce.accion === 'responder') {
          console.error('[stripe-webhook] la solicitud de cobro es de otra empresa')
          return await cerrarYResponder(
            false, cruce, 'cruce de empresa entre el secreto verificado y la solicitud')
        }

        // UNA transacción: inserta el pago (idempotente por UNIQUE sobre
        // payment_request_id), acredita el recibo o la cuota y cierra la
        // solicitud. La procedencia de la verificación viaja con ella: el pago
        // queda `aplicado` —el hecho contable— y conserva quién probó que el
        // cobro ocurrió, que es la firma de Stripe.
        const { data: conciliado, error: conciliarErr } = await adminClient.rpc(
          'conciliar_pago_externo',
          {
            p_payment_request_id: pr.id,
            p_verificado_por: 'stripe_webhook',
            p_verificado_en: new Date(event.created * 1000).toISOString(),
          },
        )

        const decision = decidirTrasConciliar(
          (conciliado ?? null) as Conciliacion | null,
          conciliarErr,
        )
        return await cerrarYResponder(!conciliarErr, decision, conciliarErr?.message)
      }

      if (event.type === 'payment_intent.payment_failed') {
        const paymentIntent = event.data.object as { id: string }
        const { error: updErr } = await adminClient
          .from('payment_requests')
          .update({ estado: 'failed' })
          .eq('stripe_payment_intent', paymentIntent.id)
          .eq('company_id', companyId)

        if (updErr) {
          return await cerrarYResponder(false, {
            accion: 'responder', status: 500,
            body: { received: false, retryable: true, error: updErr.message },
          }, `marcar failed: ${updErr.message}`)
        }
        return await cerrarYResponder(
          true, { accion: 'responder', status: 200, body: { received: true } })
      }

      // Un tipo de evento que no manejamos ES un procesamiento terminado: no
      // hay nada que hacer con él y reintentarlo no cambiaría nada.
      return await cerrarYResponder(true, {
        accion: 'responder', status: 200,
        body: { received: true, ignorado: event.type },
      })
    } catch (e) {
      // El evento quedó reclamado: cerrarlo como fallido es lo que permite que
      // el reintento de Stripe lo retome de inmediato en vez de esperar al
      // umbral de rancio.
      const motivo = e instanceof Error ? e.message : String(e)
      await cerrar(false, motivo)
      console.error('[stripe-webhook] fallo procesando el evento:', motivo)
      return responder({
        accion: 'responder', status: 500,
        body: { received: false, retryable: true, error: 'fallo procesando el evento' },
      })
    }

  } catch (err) {
    console.error('Webhook error:', err)
    return new Response(JSON.stringify({ error: 'Webhook processing failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
