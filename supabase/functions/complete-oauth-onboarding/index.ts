import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { requireUser } from '../_shared/auth.ts'
import { enforceRateLimits, getClientIp } from '../_shared/rateLimit.ts'

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
    // F.infra:I1b — JWT validation via shared helper.
    // El user viene del JWT validado; el client del helper no se usa porque
    // todas las queries downstream necesitan service_role (bypass de RLS para
    // buscar el cliente y crear el app_users record).
    const auth = await requireUser(req, corsHeaders)
    if ('response' in auth) return auth.response
    const oauthUser = auth.user

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Rate limit server-side (infra:I2). El JWT ya está validado, pero el OAuth onboarding
    // dispara buscar_cliente_para_onboarding (enumeración de identidad por DPI+fecha): topamos
    // intentos por usuario y por IP para frenar fuerza bruta de DPI/fecha desde una sesión.
    const rlOauth = await enforceRateLimits(adminClient, [
      { subject: oauthUser.id, action: 'complete_oauth_onboarding', max: 15 },
      { subject: `ip:${getClientIp(req)}`, action: 'complete_oauth_onboarding:ip', max: 30 },
    ], corsHeaders)
    if (rlOauth) return rlOauth

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
