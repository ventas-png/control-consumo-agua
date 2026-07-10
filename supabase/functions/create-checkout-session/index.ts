import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17.4.0?target=deno'
import {
  computeExpectedQuantities,
  planSwapItems,
  type StripeSubItem,
  type PlanPriceIds,
} from '../_shared/billingSync.ts'

// ============================================================================
// create-checkout-session — Platform Stripe (plat:P1 part 2, F2.12)
// ============================================================================
// JWT-required: solo company_owner/admin de un tenant puede iniciar checkout
// para su propia company. Validacion:
//
//   1. JWT del caller → user_id
//   2. user es company_owner/admin (de app_users)
//   3. plan_code existe y is_active
//   4. rate_limit_check: max 5 sesiones por user en 1h
//   5. Si la company NO tiene subscription, crear una en status 'incomplete'
//      antes del checkout. El webhook la actualiza cuando llega
//      checkout.session.completed.
//
// Devuelve la URL de Stripe Checkout. Frontend hace window.location.href.
// ============================================================================

function getAllowedOrigins(): string[] {
  const origins = new Set<string>([
    'https://administratodo.com',
    'https://www.administratodo.com',
    'https://administratodo.app',
    'https://www.administratodo.app',
  ])
  const envOrigins = Deno.env.get('ALLOWED_ORIGINS')
  if (envOrigins) for (const o of envOrigins.split(',')) { const t = o.trim(); if (t) origins.add(t) }
  else {
    origins.add('http://localhost:5173')
    origins.add('http://localhost:3000')
  }
  const appUrl = Deno.env.get('APP_URL')
  if (appUrl) { try { origins.add(new URL(appUrl).origin) } catch { /* ignore */ } }
  return [...origins]
}

function getCorsHeaders(origin: string | null) {
  const allowed = getAllowedOrigins()
  return {
    'Access-Control-Allow-Origin': origin && allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

interface Payload {
  plan_code?: string
  billing_cycle?: 'monthly' | 'yearly'
  return_path?: string  // path relativo en la app para success/cancel — ej /perfil
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const stripeSecret = Deno.env.get('STRIPE_PLATFORM_SECRET_KEY') ?? ''
  if (!stripeSecret) {
    return new Response(
      JSON.stringify({ error: 'Stripe no configurado. Contacta a AdministraTodo.' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Verify JWT del caller
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )
    const { data: { user }, error: authError } = await callerClient.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Verify role + company
    const { data: appUser } = await supabase
      .from('app_users')
      .select('role, company_id, email')
      .eq('id', user.id)
      .single()
    if (!appUser || !['company_owner', 'admin'].includes((appUser as { role: string }).role)) {
      return new Response(JSON.stringify({ error: 'Solo company_owner o admin pueden gestionar la suscripcion' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const companyId = (appUser as { company_id: string }).company_id
    if (!companyId) {
      return new Response(JSON.stringify({ error: 'Usuario sin company_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Rate limit: 5 sesiones por hora
    const { data: allowed } = await supabase.rpc('rate_limit_check', {
      p_user_id: user.id,
      p_action: 'create_checkout_session',
      p_max_count: 5,
    })
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Demasiadas sesiones de checkout. Espera unos minutos.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Validate payload
    const payload = await req.json() as Payload
    const planCode = payload.plan_code?.trim()
    // F2.14 multi-line pricing: solo monthly por ahora. Yearly cycle requeriria
    // duplicar los 4 stripe prices (activation/extra_project/unit_primary/
    // unit_extra) en variante yearly. Followup si producto lo pide.
    const cycle: 'monthly' = 'monthly'
    if (payload.billing_cycle === 'yearly') {
      return new Response(
        JSON.stringify({ error: 'Pricing anual aun no soportado en el modelo por uso. Selecciona mensual.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
    if (!planCode) {
      return new Response(JSON.stringify({ error: 'plan_code requerido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 5. Fetch plan + 4 stripe price ids (F2.14 multi-line pricing)
    const { data: plan } = await supabase
      .from('billing_plans')
      .select('id, code, name, is_active, stripe_price_id_activation, stripe_price_id_extra_project, stripe_price_id_unit_primary, stripe_price_id_unit_extra')
      .eq('code', planCode)
      .single()
    if (!plan || !(plan as { is_active: boolean }).is_active) {
      return new Response(JSON.stringify({ error: 'Plan invalido o desactivado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const p = plan as {
      id: string
      stripe_price_id_activation: string | null
      stripe_price_id_extra_project: string | null
      stripe_price_id_unit_primary: string | null
      stripe_price_id_unit_extra: string | null
    }
    if (!p.stripe_price_id_activation || !p.stripe_price_id_extra_project || !p.stripe_price_id_unit_primary || !p.stripe_price_id_unit_extra) {
      return new Response(
        JSON.stringify({ error: `Plan "${planCode}" no tiene los 4 stripe_price_id de pricing por uso configurados. Contacta a AdministraTodo.` }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 5b. Calcular quantities iniciales basado en uso real actual
    const { data: usageRows } = await supabase.rpc('calculate_monthly_total_cents', { p_company_id: companyId })
    const usage = (usageRows as Array<{ extra_projects_count: number; primary_units_count: number; extra_units_count: number }> | null)?.[0]
    const qty = {
      activation: 1,
      extra_project: usage?.extra_projects_count ?? 0,
      unit_primary: Math.max(1, usage?.primary_units_count ?? 0),
      unit_extra: usage?.extra_units_count ?? 0,
    }
    // Stripe Checkout requiere quantity >= 1 en cada line_item. Lines con 0 se
    // omiten. activation y unit_primary siempre van; los otros 2 solo si > 0.
    const lineItems: Array<{ price: string; quantity: number }> = [
      { price: p.stripe_price_id_activation, quantity: qty.activation },
      { price: p.stripe_price_id_unit_primary, quantity: qty.unit_primary },
    ]
    if (qty.extra_project > 0) lineItems.push({ price: p.stripe_price_id_extra_project, quantity: qty.extra_project })
    if (qty.unit_extra > 0) lineItems.push({ price: p.stripe_price_id_unit_extra, quantity: qty.unit_extra })

    // 6. Get or create Stripe customer for this company
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('id, stripe_customer_id, stripe_subscription_id, status, trial_end, plan_id')
      .eq('company_id', companyId)
      .in('status', ['trialing', 'active', 'past_due', 'incomplete'])
      .maybeSingle()

    const stripe = new Stripe(stripeSecret, { apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion })

    // 6b. CAMBIO DE PLAN in-place (P0 #1). Si la company ya tiene una
    // subscription ACTIVA en Stripe, NO abrimos otro Checkout (crearía una
    // SEGUNDA subscription → doble cobro). En su lugar, actualizamos los items
    // de la subscription existente al nuevo plan con prorrateo. El webhook
    // customer.subscription.updated sincroniza el plan_id local (más el
    // fast-path directo de abajo para que la UI lo refleje al instante).
    const sub = existingSub as {
      id: string
      stripe_subscription_id: string | null
      status: string
    } | null
    if (sub?.stripe_subscription_id && ['trialing', 'active', 'past_due'].includes(sub.status)) {
      const activeSubId = sub.stripe_subscription_id

      let stripeSub: Stripe.Subscription
      try {
        stripeSub = await stripe.subscriptions.retrieve(activeSubId, { expand: ['items.data.price'] })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        return new Response(
          JSON.stringify({ error: `No se pudo leer la suscripción actual en Stripe: ${msg}` }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const expected = computeExpectedQuantities({
        extra_projects_count: usage?.extra_projects_count ?? 0,
        primary_units_count: usage?.primary_units_count ?? 0,
        extra_units_count: usage?.extra_units_count ?? 0,
      })
      const newPriceIds: PlanPriceIds = {
        activation: p.stripe_price_id_activation,
        unit_primary: p.stripe_price_id_unit_primary,
        extra_project: p.stripe_price_id_extra_project,
        unit_extra: p.stripe_price_id_unit_extra,
      }
      const curItems: StripeSubItem[] = stripeSub.items.data.map(it => ({
        id: it.id,
        price: { id: typeof it.price === 'string' ? it.price : it.price.id },
        quantity: it.quantity ?? 0,
      }))
      const swapOps = planSwapItems(curItems, expected, newPriceIds)

      if (swapOps.length > 0) {
        try {
          await stripe.subscriptions.update(activeSubId, {
            items: swapOps as Stripe.SubscriptionUpdateParams.Item[],
            proration_behavior: 'create_prorations',
            metadata: {
              ...stripeSub.metadata,
              company_id: companyId,
              plan_code: planCode,
              plan_id: p.id,
            },
          }, {
            idempotencyKey: `swap-${activeSubId}-${p.id}-${curItems.map(i => `${i.price.id}:${i.quantity}`).sort().join(',')}`,
          })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          return new Response(
            JSON.stringify({ error: `No se pudo cambiar el plan en Stripe: ${msg}` }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          )
        }
      }

      // Fast-path: reflejar el plan_id local de inmediato (el webhook también lo
      // hará; ambos convergen al mismo valor de forma idempotente).
      await supabase.from('subscriptions').update({ plan_id: p.id }).eq('id', sub.id)

      return new Response(
        JSON.stringify({ success: true, swapped: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    let customerId = (existingSub as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null
    if (!customerId) {
      const { data: company } = await supabase
        .from('companies')
        .select('nombre, email, country, address_line1, address_city, address_state, address_postal_code, tax_id, tax_id_type')
        .eq('id', companyId)
        .single()
      const c = company as {
        nombre: string
        email: string | null
        country: string | null
        address_line1: string | null
        address_city: string | null
        address_state: string | null
        address_postal_code: string | null
        tax_id: string | null
        tax_id_type: string | null
      } | null

      // F4.3.4: si la empresa ya tiene country + address, los pasamos al
      // customer para que Stripe Tax pueda calcular IVA desde el primer
      // checkout. tax_id se agrega aparte via stripe.customers.createTaxId.
      const customerParams: Stripe.CustomerCreateParams = {
        email: (appUser as { email: string }).email,
        name: c?.nombre ?? undefined,
        metadata: { company_id: companyId, user_id: user.id },
      }
      if (c?.country) {
        customerParams.address = {
          country: c.country,
          ...(c.address_line1 ? { line1: c.address_line1 } : {}),
          ...(c.address_city ? { city: c.address_city } : {}),
          ...(c.address_state ? { state: c.address_state } : {}),
          ...(c.address_postal_code ? { postal_code: c.address_postal_code } : {}),
        }
      }
      const customer = await stripe.customers.create(customerParams)
      customerId = customer.id

      if (c?.tax_id && c?.tax_id_type) {
        try {
          await stripe.customers.createTaxId(customerId, {
            type: c.tax_id_type as Stripe.CustomerCreateTaxIdParams['type'],
            value: c.tax_id,
          })
        } catch (taxErr) {
          console.warn('[create-checkout-session] tax_id rechazado por Stripe:', taxErr instanceof Error ? taxErr.message : String(taxErr))
        }
      }
    }

    // 7. Preserve trial: si la sub tiene trial_end en el futuro, le decimos
    // a Stripe que respete ese trial.
    const existingTrialEnd = (existingSub as { trial_end: string | null } | null)?.trial_end
    let trialPeriodDays: number | undefined
    if (existingTrialEnd) {
      const trialMs = new Date(existingTrialEnd).getTime() - Date.now()
      if (trialMs > 0) trialPeriodDays = Math.ceil(trialMs / (24 * 60 * 60 * 1000))
    }

    // 8. Build Checkout Session
    const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173'
    const returnPath = payload.return_path?.startsWith('/') ? payload.return_path : '/perfil'

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: lineItems,
      subscription_data: {
        ...(trialPeriodDays && trialPeriodDays > 0 ? { trial_period_days: trialPeriodDays } : {}),
        metadata: { company_id: companyId, plan_code: planCode, billing_cycle: cycle },
      },
      success_url: `${appUrl}${returnPath}?checkout=success&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}${returnPath}?checkout=canceled`,
      metadata: { company_id: companyId, plan_id: p.id, plan_code: planCode },
      allow_promotion_codes: true,
      // F4.3.4: Stripe Tax integration. Requiere Stripe Tax habilitado en
      // Dashboard → Settings → Tax. Si no esta habilitado, automatic_tax es
      // ignorado por Stripe (no rompe el checkout).
      automatic_tax: { enabled: true },
      tax_id_collection: { enabled: true },
      billing_address_collection: 'required',
      customer_update: { address: 'auto', name: 'auto' },
    }, {
      idempotencyKey: `checkout-${companyId}-${user.id}-${Date.now()}`,
    })

    return new Response(
      JSON.stringify({ success: true, url: session.url, session_id: session.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[create-checkout-session]', msg)
    return new Response(JSON.stringify({ error: `Error: ${msg}` }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
