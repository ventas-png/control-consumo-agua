import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

// Generic identity error — same message for all failure modes to prevent enumeration
const IDENTITY_ERROR = 'No se encontró un cliente con los datos proporcionados. Verifique su DPI/CUI y fecha de nacimiento.'

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  function ok(data: Record<string, unknown>) {
    return new Response(JSON.stringify(data), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  function err(message: string) {
    return new Response(JSON.stringify({ error: message }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Step 1: Verify the caller has a valid Supabase JWT
    const authHeader = req.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return err('No autorizado.')
    }
    const token = authHeader.replace('Bearer ', '')

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: { user: oauthUser }, error: authError } = await adminClient.auth.getUser(token)
    if (authError || !oauthUser) {
      return err('No autorizado.')
    }

    // Email comes from the verified JWT — cannot be tampered by the client
    const email = oauthUser.email
    if (!email) {
      return err('La cuenta de Google no tiene un correo electrónico asociado.')
    }

    // Full name from Google metadata
    const fullName: string =
      oauthUser.user_metadata?.full_name ??
      oauthUser.user_metadata?.name ??
      email

    // Step 2: Parse and validate body
    const body = await req.json() as { cui_dui?: string; fecha_nacimiento?: string }
    const { cui_dui, fecha_nacimiento } = body

    if (!cui_dui || !fecha_nacimiento) {
      return err('DPI/CUI y fecha de nacimiento son requeridos.')
    }

    // Step 3: Verify no app_users record already exists for this auth user
    // (idempotency guard — prevents double-registration on retry)
    const { data: existingProfile } = await adminClient
      .from('app_users')
      .select('id')
      .eq('id', oauthUser.id)
      .maybeSingle()

    if (existingProfile) {
      // Already onboarded — treat as success so caller can proceed to login
      return ok({ success: true, already_exists: true })
    }

    // Step 4: Look up cliente using the same RPC as the email/password flow
    // Email from JWT + DPI + birthdate must all match (3-of-3)
    const { data: lookupResult, error: lookupError } = await adminClient.rpc(
      'buscar_cliente_para_onboarding',
      { p_cui_dui: cui_dui, p_fecha_nac: fecha_nacimiento, p_email: email }
    )

    if (lookupError) {
      console.error('Lookup error:', lookupError)
      return err('Error al verificar su identidad. Intente nuevamente.')
    }

    const result = lookupResult as { match_count: number; cliente_id: string | null }

    if (result.match_count < 3 || !result.cliente_id) {
      return err(IDENTITY_ERROR)
    }

    const clienteId = result.cliente_id

    // Step 5: Verify the cliente has permission to create an account
    const { data: clienteRecord, error: clienteError } = await adminClient
      .from('clientes')
      .select('id, puede_crear_cuenta')
      .eq('id', clienteId)
      .single()

    if (clienteError || !clienteRecord) {
      return err('No se pudo obtener la información del cliente.')
    }

    if (!clienteRecord.puede_crear_cuenta) {
      return err('Su cuenta no está habilitada para el portal de clientes. Comuníquese con su empresa de servicios.')
    }

    // Step 6: Ensure no other user already owns this cliente_id
    const { data: existingLink } = await adminClient
      .from('app_users')
      .select('id')
      .eq('cliente_id', clienteId)
      .maybeSingle()

    if (existingLink) {
      return err(IDENTITY_ERROR)
    }

    // Step 7: Create app_users profile (auth user already exists from OAuth)
    const { error: profileError } = await adminClient
      .from('app_users')
      .insert({
        id: oauthUser.id,
        full_name: fullName.trim(),
        role: 'cliente',
        cliente_id: clienteId,
        activo: true,
      })

    if (profileError) {
      console.error('Profile insert error:', profileError)
      return err('No se pudo completar el registro. Intente nuevamente.')
    }

    return ok({ success: true })

  } catch (e) {
    console.error('Unexpected error:', e)
    return err('Error inesperado. Intente nuevamente.')
  }
})
