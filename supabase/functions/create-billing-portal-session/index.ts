import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17.4.0?target=deno'
import { getCorsHeaders } from '../_shared/cors.ts'
// Gate de rol extraído a ./logic.ts para testearlo en vitest (infra:I22).
// El CORS lo sirve _shared/cors.ts, ya centralizado en main.
import { canManageBilling } from './logic.ts'

// ============================================================================
// create-billing-portal-session — Stripe Billing Portal (plat:P1, F2.12)
// ============================================================================
// Genera una URL al portal Stripe-hosted donde el company_owner puede:
//   - Actualizar tarjeta
//   - Cambiar plan (upgrade/downgrade entre los billing_plans configurados)
//   - Cancelar suscripcion (al final del periodo)
//   - Descargar invoices PDF
//
// Requiere que la company ya tenga stripe_customer_id (es decir, paso por
// create-checkout-session al menos una vez). Si no lo tiene, devuelve 404.
// ============================================================================

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

    const { data: appUser } = await supabase
      .from('app_users')
      .select('role, company_id')
      .eq('id', user.id)
      .single()
    if (!appUser || !canManageBilling((appUser as { role: string }).role)) {
      return new Response(JSON.stringify({ error: 'Solo company_owner o admin' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const companyId = (appUser as { company_id: string }).company_id

    const { data: allowed } = await supabase.rpc('rate_limit_check', {
      p_user_id: user.id,
      p_action: 'create_billing_portal_session',
      p_max_count: 10,
    })
    if (allowed === false) {
      return new Response(JSON.stringify({ error: 'Demasiadas solicitudes al portal. Espera unos minutos.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('company_id', companyId)
      .in('status', ['trialing', 'active', 'past_due', 'incomplete'])
      .maybeSingle()
    const customerId = (sub as { stripe_customer_id: string | null } | null)?.stripe_customer_id
    if (!customerId) {
      return new Response(
        JSON.stringify({ error: 'No hay informacion de pago registrada. Primero configura un plan.' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:5173'
    const stripe = new Stripe(stripeSecret, { apiVersion: '2024-12-18.acacia' as Stripe.LatestApiVersion })

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/perfil`,
    })

    return new Response(
      JSON.stringify({ success: true, url: session.url }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // PR-17: el detalle va al log (y de ahí a Sentry), NO al cliente. `msg`
    // puede traer texto de Postgres o de la API de Stripe: nombres de tabla,
    // constraints, ids internos. Mismo criterio que create-user:204.
    console.error('[create-billing-portal-session]', msg)
    return new Response(JSON.stringify({ error: 'Error interno del servidor. Si persiste, contactá a soporte.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
