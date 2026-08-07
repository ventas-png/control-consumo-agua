import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encryptSecret } from '../_shared/secretsCrypto.ts'
import { getCorsHeaders, validateOrigin } from '../_shared/cors.ts'
// Lógica pura (gate de rol, whitelist de proveedor, validación de campos y
// construcción de los updates público/secreto) extraída a ./logic.ts para
// testearla en vitest (infra:I22). El CORS lo sigue sirviendo _shared/cors.ts.
import {
  buildConfigUpdates,
  buildRollbackUpdate,
  esProveedorValido,
  faltanCampos,
  puedeConfigurarPagos,
} from './logic.ts'

// CORS utilities for Edge Functions

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

    // Only allow company owners and admins
    if (!puedeConfigurarPagos(callerRole)) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json() as {
      companyId: string
      provider: 'stripe' | 'paypal'
      publicKey: string
      secretKey: string
    }

    const { companyId, provider, publicKey, secretKey } = body

    if (faltanCampos({ companyId, provider, publicKey, secretKey })) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!esProveedorValido(provider)) {
      return new Response(JSON.stringify({ error: 'Invalid provider' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // company_owner and admin can only configure their own company
    if (puedeConfigurarPagos(callerRole) && companyId !== callerCompanyId) {
      return new Response(JSON.stringify({ error: 'Cannot configure payment for other companies' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Use admin client to write secrets securely
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Update public config in companies table
    //
    // P0 #7: cifrar el secreto en reposo antes de guardarlo. Sin
    // TENANT_SECRETS_ENC_KEY configurada, encryptSecret devuelve el texto plano
    // (passthrough) → cero cambio de comportamiento hasta provisionar la llave.
    const encryptedSecret = await encryptSecret(secretKey)

    const { companyUpdate, secretsUpdate } = buildConfigUpdates(
      provider, companyId, publicKey, encryptedSecret,
    )

    const { error: companyError } = await adminClient
      .from('companies')
      .update(companyUpdate)
      .eq('id', companyId)

    if (companyError) {
      console.error('Error saving company config:', companyError)
      return new Response(JSON.stringify({ error: 'Failed to save configuration' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Upsert secret in company_payment_secrets table (only service_role can access)
    const { error: secretError } = await adminClient
      .from('company_payment_secrets')
      .upsert(secretsUpdate, { onConflict: 'company_id' })

    if (secretError) {
      console.error('Error saving payment secret:', secretError)
      // Rollback: unmark as configured since secret wasn't saved
      await adminClient.from('companies').update(buildRollbackUpdate(provider)).eq('id', companyId)

      return new Response(JSON.stringify({ error: 'Failed to save secret key' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('Error saving payment config:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
