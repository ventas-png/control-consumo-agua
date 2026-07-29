import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enforceRateLimit } from '../_shared/rateLimit.ts'
import { decryptSecret } from '../_shared/secretsCrypto.ts'
import { calcularComision, type ComisionConfigRow } from '../_shared/payments/comision.ts'
import { calcularRecargo, totalConRecargo, type RecargoConfigRow } from '../_shared/payments/recargo.ts'
import { getCorsHeaders, validateOrigin } from '../_shared/cors.ts'

// CORS utilities

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

    // Rate limit por usuario (auditoría S6): el camino de dinero no tenía tope.
    // rate_limit_hit es service-role-only → client admin dedicado; fail-open.
    const rlAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    const rl = await enforceRateLimit(rlAdmin, {
      subject: caller.id,
      action: 'create_payment_intent',
      max: 30,
      message: 'Demasiados intentos de pago en poco tiempo. Espera unos minutos e intenta de nuevo.',
    }, corsHeaders)
    if (rl) return rl

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
      .select('company_id, role')
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

    // ── PR-13 (auditoría 2026-07-28): pertenencia de registro_id / cliente_id ──
    // El bloque de arriba valida `company_id` contra el perfil del caller, pero
    // `registro_id` y `cliente_id` venían del body SIN comprobar de quién son, y
    // se escribían tal cual en `payment_requests` (más abajo). El webhook luego
    // crea un `pagos` con esos ids validando solo `payment_requests.company_id`,
    // así que un usuario de la empresa A podía apuntar el cobro al recibo de la
    // empresa B: corrupción de datos financieros cross-tenant.
    //
    // Se espeja el patrón que `create-charge/index.ts:238-284` ya aplica bien:
    // `registros` no tiene company_id, así que se deriva vía `projects`.
    const { data: regRow, error: regErr } = await adminClient
      .from('registros')
      .select('cliente_id, project_id, deleted_at')
      .eq('id', registro_id)
      .maybeSingle()
    if (regErr) {
      console.error('[create-payment-intent] error leyendo registro:', regErr.message)
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const registro = regRow as {
      cliente_id: string | null
      project_id: string | null
      deleted_at: string | null
    } | null
    if (!registro || registro.deleted_at) {
      return new Response(JSON.stringify({ error: 'Recibo no encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let registroCompanyId: string | null = null
    if (registro.project_id) {
      const { data: proj } = await adminClient
        .from('projects')
        .select('company_id')
        .eq('id', registro.project_id)
        .maybeSingle()
      registroCompanyId = (proj as { company_id?: string | null } | null)?.company_id ?? null
    }

    if (registroCompanyId !== company_id) {
      return new Response(JSON.stringify({ error: 'El recibo no pertenece a esta empresa' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // El cliente del cobro tiene que ser el del recibo: si no, el pago se
    // acreditaría a un tercero.
    if (registro.cliente_id !== cliente_id) {
      return new Response(JSON.stringify({ error: 'El cliente no corresponde al recibo' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Gate de rol: no había ninguno — cualquier fila de `app_users` de la empresa
    // servía, incluido un rol de solo lectura. Se alinea con los roles que ya
    // pueden cobrar en el resto del producto.
    const callerRole = (callerProfile as { role?: string } | null)?.role ?? ''
    if (!['super_admin', 'superadmin', 'company_owner', 'admin', 'operator', 'operador'].includes(callerRole)) {
      return new Response(JSON.stringify({ error: 'No autorizado para iniciar cobros' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

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

    // Initialize Stripe with company's secret key.
    // P0 #7: descifrar en reposo (dual-read: texto plano legacy pasa igual).
    const stripeSecretKey = await decryptSecret(secrets.stripe_secret_key)
    const Stripe = stripe.default || stripe
    const stripeClient = new Stripe(stripeSecretKey as string)

    // Get cliente info for payment description
    const { data: cliente } = await adminClient
      .from('clientes')
      .select('nombre')
      .eq('id', cliente_id)
      .single()

    // Recargo por pago con tarjeta (config del TENANT): se SUMA al total que
    // cobra Stripe; el abono al recibo sigue siendo `monto`
    // (payment_requests.monto). Aplica en todos los ambientes — es el total
    // del checkout, no facturación de plataforma.
    const { data: recRows } = await adminClient
      .from('recargo_tarjeta_config')
      .select('canal, activo, pct, fijo')
      .eq('company_id', company_id)
    const recargoCalc = calcularRecargo(monto, 'stripe', (recRows as RecargoConfigRow[] | null) ?? [])
    const totalCobro = totalConRecargo(monto, recargoCalc.recargo)

    // Create PaymentIntent with dynamic currency
    const paymentIntent = await stripeClient.paymentIntents.create({
      amount: Math.round(totalCobro * 100), // Convert to cents (monto + recargo)
      currency: currency,
      metadata: {
        cliente_id,
        registro_id,
        company_id,
      },
      description: recargoCalc.recargo != null
        ? `Pago de agua - ${cliente?.nombre ?? 'Cliente'} · incluye recargo por pago con tarjeta ${recargoCalc.recargo.toFixed(2)} ${currency.toUpperCase()}`
        : `Pago de agua - ${cliente?.nombre ?? 'Cliente'}`,
    })

    // Comisión de plataforma (F7): config por empresa+canal, sellada al crear
    // el cobro. Con llave de TEST de Stripe (sk_test_) no se factura — mismo
    // criterio que el gate de ambiente prod en create-charge.
    let comisionCalc: ReturnType<typeof calcularComision> = { comision: null, detalle: null }
    if (!(stripeSecretKey as string).startsWith('sk_test_')) {
      const { data: comRows } = await adminClient
        .from('comision_config')
        .select('canal, activo, pct, fijo')
        .eq('company_id', company_id)
      comisionCalc = calcularComision(monto, 'stripe', (comRows as ComisionConfigRow[] | null) ?? [])
    }

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
        comision: comisionCalc.comision,
        comision_detalle: comisionCalc.detalle,
        recargo: recargoCalc.recargo,
        recargo_detalle: recargoCalc.detalle,
      })

    if (paymentRequestError) {
      console.error('Error creating payment request record:', paymentRequestError)
    }

    return new Response(JSON.stringify({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      // Desglose del checkout: abono al recibo = monto; Stripe cobra el total.
      recargo: recargoCalc.recargo,
      total_cobrado: totalCobro,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    // PR-17: detalle al log, mensaje genérico al cliente.
    console.error('Error creating payment intent:', err)
    return new Response(JSON.stringify({ error: 'Error interno del servidor. Si persiste, contactá a soporte.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
