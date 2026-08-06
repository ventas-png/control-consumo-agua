import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decryptSecret } from '../_shared/secretsCrypto.ts'
import { getCorsHeaders, validateOrigin } from '../_shared/cors.ts'

// CORS utilities

const stripe = await import('https://esm.sh/stripe@13.10.0?target=deno')

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

    // Get caller's role and company
    const { data: callerProfile } = await callerClient
      .from('app_users')
      .select('role, company_id')
      .eq('id', caller.id)
      .single()

    const callerRole = (callerProfile as { role: string; company_id: string } | null)?.role ?? ''
    const callerCompanyId = (callerProfile as { role: string; company_id: string } | null)?.company_id

    // Only allow company owners/admins to test Stripe
    if (callerRole !== 'company_owner' && callerRole !== 'admin') {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json() as { companyId: string }
    const { companyId } = body

    if (!companyId) {
      return new Response(JSON.stringify({ error: 'Company ID required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // company_owner and admin can only test their own company
    if ((callerRole === 'company_owner' || callerRole === 'admin') && companyId !== callerCompanyId) {
      return new Response(JSON.stringify({ error: 'Cannot test Stripe for other companies' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get company Stripe configuration
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: company, error: companyError } = await adminClient
      .from('companies')
      .select('stripe_configured')
      .eq('id', companyId)
      .single()

    if (companyError || !company) {
      return new Response(JSON.stringify({ error: 'Company not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!company.stripe_configured) {
      return new Response(JSON.stringify({ error: 'Stripe not configured' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Read secret from isolated table (only service_role can access)
    const { data: secrets, error: secretsError } = await adminClient
      .from('company_payment_secrets')
      .select('stripe_secret_key')
      .eq('company_id', companyId)
      .single()

    if (secretsError || !secrets?.stripe_secret_key) {
      return new Response(JSON.stringify({ error: 'Stripe secret key not found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Test Stripe connection by getting account info.
    // P0 #7: descifrar en reposo (dual-read: texto plano legacy pasa igual).
    const stripeSecretKey = await decryptSecret(secrets.stripe_secret_key)
    const Stripe = stripe.default || stripe
    const stripeClient = new Stripe(stripeSecretKey as string)

    try {
      const account = await stripeClient.account.retrieve()

      return new Response(JSON.stringify({
        success: true,
        message: 'Stripe connection successful',
        account_id: account.id,
        account_name: account.display_name,
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    } catch (stripeError: any) {
      return new Response(JSON.stringify({
        success: false,
        error: stripeError.message || 'Invalid Stripe credentials',
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

  } catch (err) {
    console.error('Error testing Stripe:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
