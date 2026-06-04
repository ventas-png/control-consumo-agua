import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17.4.0?target=deno'
import { captureEdgeException } from '../_shared/sentry.ts'

// ============================================================================
// stripe-platform-webhook — receptor de eventos Stripe (plat:P1, F2.12)
// ============================================================================
// Deployada sin JWT (Stripe firma cada request con HMAC-SHA256). Verificacion:
//
//   1. Header stripe-signature presente
//   2. constructEventAsync valida HMAC con STRIPE_PLATFORM_WEBHOOK_SECRET
//      → si falla, 400 inmediato
//   3. Idempotencia: INSERT en stripe_webhook_events con event.id como PK.
//      Conflict → ya procesado, return 200 sin re-aplicar.
//   4. Procesar evento → UPDATE subscriptions/invoices
//   5. UPDATE processed_at o error_message
//
// Eventos soportados (los criticos para sync de SaaS billing):
//
//   - checkout.session.completed         → primera asociacion company↔stripe_sub
//   - customer.subscription.created      → upsert subscription
//   - customer.subscription.updated      → sync status, period, plan
//   - customer.subscription.deleted      → canceled
//   - invoice.paid                       → INSERT invoice paid
//   - invoice.payment_failed             → INSERT invoice failed + status past_due
//   - invoice.finalized                  → INSERT invoice open
//
// Eventos no soportados: 200 + log (Stripe espera 200 para no reenviar).
// ============================================================================

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const STRIPE_PLATFORM_SECRET_KEY = Deno.env.get('STRIPE_PLATFORM_SECRET_KEY') ?? ''
const STRIPE_PLATFORM_WEBHOOK_SECRET = Deno.env.get('STRIPE_PLATFORM_WEBHOOK_SECRET') ?? ''

function mapStripeStatus(s: string): string {
  // Stripe puede devolver 'paused' o 'trialing' que ya cubrimos. Cualquier
  // status no presente en el CHECK de subscriptions cae a 'incomplete'.
  const valid = ['trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid']
  return valid.includes(s) ? s : 'incomplete'
}

function mapInvoiceStatus(s: string | null | undefined): string {
  const valid = ['draft', 'open', 'paid', 'void', 'uncollectible']
  return s && valid.includes(s) ? s : 'open'
}

async function upsertSubscriptionFromStripe(
  supabase: ReturnType<typeof createClient>,
  stripeSub: Stripe.Subscription,
): Promise<void> {
  const companyId = stripeSub.metadata?.company_id
  if (!companyId) {
    console.warn('[webhook] subscription sin company_id metadata, skipeando:', stripeSub.id)
    return
  }

  const planCode = stripeSub.metadata?.plan_code
  const billingCycle = stripeSub.metadata?.billing_cycle === 'yearly' ? 'yearly' : 'monthly'

  // Resolver plan_id desde plan_code (o desde price_id si planCode falta)
  let planId: string | null = null
  if (planCode) {
    const { data: plan } = await supabase
      .from('billing_plans')
      .select('id')
      .eq('code', planCode)
      .maybeSingle()
    planId = (plan as { id: string } | null)?.id ?? null
  }
  if (!planId) {
    const priceId = stripeSub.items.data[0]?.price?.id
    if (priceId) {
      const { data: plan } = await supabase
        .from('billing_plans')
        .select('id')
        .or(`stripe_price_id_monthly.eq.${priceId},stripe_price_id_yearly.eq.${priceId}`)
        .maybeSingle()
      planId = (plan as { id: string } | null)?.id ?? null
    }
  }
  if (!planId) {
    console.error('[webhook] no se pudo resolver plan_id para sub', stripeSub.id)
    return
  }

  const periodStart = stripeSub.current_period_start
    ? new Date(stripeSub.current_period_start * 1000).toISOString()
    : new Date().toISOString()
  const periodEnd = stripeSub.current_period_end
    ? new Date(stripeSub.current_period_end * 1000).toISOString()
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const trialEnd = stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000).toISOString() : null
  const canceledAt = stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000).toISOString() : null

  // Upsert: si ya hay una sub activa para esta company, la actualizamos por
  // company_id; si no, INSERT. Stripe_subscription_id es el ancla unica del
  // lado Stripe.
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('stripe_subscription_id', stripeSub.id)
    .maybeSingle()

  const row = {
    company_id: companyId,
    plan_id: planId,
    status: mapStripeStatus(stripeSub.status),
    billing_cycle: billingCycle,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    trial_end: trialEnd,
    canceled_at: canceledAt,
    cancel_at_period_end: !!stripeSub.cancel_at_period_end,
    stripe_subscription_id: stripeSub.id,
    stripe_customer_id: typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer.id,
  }

  if (existing) {
    await supabase
      .from('subscriptions')
      .update(row)
      .eq('id', (existing as { id: string }).id)
  } else {
    // Si la company tiene una sub activa SIN stripe_subscription_id (backfill
    // de F2.11 o trial inicial), la reemplazamos cancelandola primero. El
    // UNIQUE index parcial WHERE status IN activo se respeta.
    await supabase
      .from('subscriptions')
      .update({ status: 'canceled', canceled_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .is('stripe_subscription_id', null)
      .in('status', ['trialing', 'active', 'past_due', 'incomplete'])

    await supabase.from('subscriptions').insert(row)
  }
}

async function upsertInvoiceFromStripe(
  supabase: ReturnType<typeof createClient>,
  stripeInvoice: Stripe.Invoice,
): Promise<void> {
  // Encuentra la subscription correspondiente (necesitamos su id local +
  // company_id)
  const stripeSubId = typeof stripeInvoice.subscription === 'string'
    ? stripeInvoice.subscription
    : stripeInvoice.subscription?.id
  if (!stripeSubId) {
    console.warn('[webhook] invoice sin subscription, skipeando:', stripeInvoice.id)
    return
  }

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('id, company_id')
    .eq('stripe_subscription_id', stripeSubId)
    .maybeSingle()
  if (!sub) {
    console.warn('[webhook] no se encontro subscription local para', stripeSubId)
    return
  }

  // F4.3.4: extraer tax desde Stripe Invoice. Cuando automatic_tax esta
  // habilitado, total_tax_amounts contiene el desglose; usamos el total.
  const taxAmount = Array.isArray(stripeInvoice.total_tax_amounts)
    ? stripeInvoice.total_tax_amounts.reduce((s, t) => s + (t.amount ?? 0), 0)
    : 0
  // customer_tax_ids: array de { type, value } del customer al momento del
  // cobro. Snapshot del primero (típicamente solo hay uno).
  const taxIdEntry = Array.isArray(stripeInvoice.customer_tax_ids)
    ? stripeInvoice.customer_tax_ids[0]
    : null
  const countryBilled = stripeInvoice.customer_address?.country ?? null

  const row = {
    subscription_id: (sub as { id: string }).id,
    company_id: (sub as { company_id: string }).company_id,
    amount_cents: stripeInvoice.amount_paid > 0 ? stripeInvoice.amount_paid : stripeInvoice.amount_due,
    subtotal_cents: stripeInvoice.subtotal ?? null,
    tax_amount_cents: taxAmount,
    tax_id: taxIdEntry?.value ?? null,
    tax_id_type: taxIdEntry?.type ?? null,
    country_billed: countryBilled,
    currency: stripeInvoice.currency,
    status: mapInvoiceStatus(stripeInvoice.status),
    period_start: stripeInvoice.period_start
      ? new Date(stripeInvoice.period_start * 1000).toISOString()
      : new Date().toISOString(),
    period_end: stripeInvoice.period_end
      ? new Date(stripeInvoice.period_end * 1000).toISOString()
      : new Date().toISOString(),
    due_date: stripeInvoice.due_date ? new Date(stripeInvoice.due_date * 1000).toISOString() : null,
    paid_at: stripeInvoice.status_transitions?.paid_at
      ? new Date(stripeInvoice.status_transitions.paid_at * 1000).toISOString()
      : null,
    stripe_invoice_id: stripeInvoice.id,
    pdf_url: stripeInvoice.invoice_pdf,
  }

  // Upsert por stripe_invoice_id (UNIQUE)
  const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('stripe_invoice_id', stripeInvoice.id)
    .maybeSingle()

  if (existing) {
    await supabase.from('invoices').update(row).eq('id', (existing as { id: string }).id)
  } else {
    await supabase.from('invoices').insert(row)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  if (!STRIPE_PLATFORM_SECRET_KEY || !STRIPE_PLATFORM_WEBHOOK_SECRET) {
    console.error('[webhook] secrets no configurados')
    return new Response('Stripe not configured', { status: 503 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('Missing signature', { status: 400 })

  const rawBody = await req.text()
  const stripe = new Stripe(STRIPE_PLATFORM_SECRET_KEY, { apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion })

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_PLATFORM_WEBHOOK_SECRET)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[webhook] firma invalida:', msg)
    return new Response(`Webhook signature verification failed: ${msg}`, { status: 400 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  // Idempotencia: INSERT con PK conflict → ya procesado
  const { error: insertErr } = await supabase
    .from('stripe_webhook_events')
    .insert({
      event_id: event.id,
      event_type: event.type,
      livemode: event.livemode,
      payload: event as unknown as Record<string, unknown>,
    })
  if (insertErr) {
    if (insertErr.code === '23505') {
      // Duplicate key — ya procesado, return 200 silenciosamente
      return new Response('OK (already processed)', { status: 200 })
    }
    console.error('[webhook] error insertando event:', insertErr.message)
    return new Response('DB error', { status: 500 })
  }

  // Procesar el evento
  let errorMessage: string | null = null
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode === 'subscription' && session.subscription) {
          const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id
          const stripeSub = await stripe.subscriptions.retrieve(subId)
          // Propagar metadata de la session a la subscription si no la tiene
          if (!stripeSub.metadata?.company_id && session.metadata?.company_id) {
            const updated = await stripe.subscriptions.update(subId, {
              metadata: {
                company_id: session.metadata.company_id,
                plan_code: session.metadata.plan_code ?? '',
                billing_cycle: 'monthly',
              },
            })
            await upsertSubscriptionFromStripe(supabase, updated)
          } else {
            await upsertSubscriptionFromStripe(supabase, stripeSub)
          }
        }
        break
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await upsertSubscriptionFromStripe(supabase, sub)
        break
      }
      case 'invoice.paid':
      case 'invoice.payment_failed':
      case 'invoice.finalized': {
        const invoice = event.data.object as Stripe.Invoice
        await upsertInvoiceFromStripe(supabase, invoice)
        // Si el pago fallo, asegurar subscription queda past_due
        if (event.type === 'invoice.payment_failed' && invoice.subscription) {
          const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription.id
          const stripeSub = await stripe.subscriptions.retrieve(subId)
          await upsertSubscriptionFromStripe(supabase, stripeSub)
        }
        break
      }
      case 'customer.updated': {
        // F4.3.4: sync de address/tax_id desde Stripe (cuando el cliente edita
        // sus datos via Stripe Customer Portal o checkout). Lo guardamos en
        // companies para que el próximo checkout reuse esos datos.
        const customer = event.data.object as Stripe.Customer
        const companyId = customer.metadata?.company_id
        if (!companyId) {
          console.warn('[webhook] customer.updated sin company_id metadata:', customer.id)
          break
        }
        // Stripe Customer trae tax_ids como sub-resource; los pedimos aparte.
        let taxIdEntry: Stripe.TaxId | undefined
        try {
          const taxIds = await stripe.customers.listTaxIds(customer.id, { limit: 1 })
          taxIdEntry = taxIds.data[0]
        } catch (taxErr) {
          console.warn('[webhook] no se pudo listar tax_ids:', taxErr instanceof Error ? taxErr.message : String(taxErr))
        }
        const addr = customer.address
        const update: Record<string, string | null> = {}
        if (addr?.country) update.country = addr.country
        if (addr?.line1) update.address_line1 = addr.line1
        if (addr?.city) update.address_city = addr.city
        if (addr?.state) update.address_state = addr.state
        if (addr?.postal_code) update.address_postal_code = addr.postal_code
        if (taxIdEntry?.value) {
          update.tax_id = taxIdEntry.value
          update.tax_id_type = taxIdEntry.type
        }
        if (Object.keys(update).length > 0) {
          await supabase.from('companies').update(update).eq('id', companyId)
        }
        break
      }
      default:
        console.log('[webhook] evento no manejado:', event.type)
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
    console.error('[webhook] error procesando', event.type, errorMessage)
    // El 500 hace que Stripe reintente; capturamos en Sentry para alertar si el
    // reintento tampoco resuelve (tag event_type para filtrar por tipo de evento).
    await captureEdgeException(err, {
      function: 'stripe-platform-webhook',
      transaction: `webhook:${event.type}`,
      tags: { event_type: event.type },
    })
  }

  await supabase
    .from('stripe_webhook_events')
    .update({ processed_at: new Date().toISOString(), error_message: errorMessage })
    .eq('event_id', event.id)

  if (errorMessage) {
    // Devolver 500 para que Stripe reintente
    return new Response(`Processing error: ${errorMessage}`, { status: 500 })
  }
  return new Response('OK', { status: 200 })
})
