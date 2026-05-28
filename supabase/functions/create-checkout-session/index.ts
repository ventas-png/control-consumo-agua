import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17.4.0?target=deno'

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
    const cycle = payload.billing_cycle === 'yearly' ? 'yearly' : 'monthly'
    if (!planCode) {
      return new Response(JSON.stringify({ error: 'plan_code requerido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 5. Fetch plan
    const { data: plan } = await supabase
      .from('billing_plans')
      .select('id, code, name, stripe_price_id_monthly, stripe_price_id_yearly, is_active')
      .eq('code', planCode)
      .single()
    if (!plan || !(plan as { is_active: boolean }).is_active) {
      return new Response(JSON.stringify({ error: 'Plan invalido o desactivado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const priceId = cycle === 'yearly'
      ? (plan as { stripe_price_id_yearly: string | null }).stripe_price_id_yearly
      : (plan as { stripe_price_id_monthly: string | null }).stripe_price_id_monthly
    if (!priceId) {
      return new Response(
        JSON.stringify({ error: `Plan "${planCode}" no tiene price_id de Stripe configurado. Contacta a AdministraTodo.` }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 6. Get or create Stripe customer for this company
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('id, stripe_customer_id, status, trial_end, plan_id')
      .eq('company_id', companyId)
      .in('status', ['trialing', 'active', 'past_due', 'incomplete'])
      .maybeSingle()

    const stripe = new Stripe(stripeSecret, { apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion })

    let customerId = (existingSub as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null
    if (!customerId) {
      const { data: company } = await supabase
        .from('companies')
        .select('nombre, email')
        .eq('id', companyId)
        .single()
      const customer = await stripe.customers.create({
        email: (appUser as { email: string }).email,
        name: (company as { nombre: string } | null)?.nombre ?? undefined,
        metadata: { company_id: companyId, user_id: user.id },
      })
      customerId = customer.id
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
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        ...(trialPeriodDays && trialPeriodDays > 0 ? { trial_period_days: trialPeriodDays } : {}),
        metadata: { company_id: companyId, plan_code: planCode, billing_cycle: cycle },
      },
      success_url: `${appUrl}${returnPath}?checkout=success&session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}${returnPath}?checkout=canceled`,
      metadata: { company_id: companyId, plan_id: (plan as { id: string }).id, plan_code: planCode },
      allow_promotion_codes: true,
      billing_address_collection: 'auto',
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
