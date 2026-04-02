import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Restrict CORS to the configured allowed origin.
// Set ALLOWED_ORIGIN in Supabase Edge Function secrets (e.g. https://your-app.vercel.app).
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? ''

function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const origin = (ALLOWED_ORIGIN && requestOrigin === ALLOWED_ORIGIN)
    ? ALLOWED_ORIGIN
    : (ALLOWED_ORIGIN || 'null') // deny unrecognised origins
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function ok(data: Record<string, unknown>, cors: Record<string, string>) {
  return new Response(JSON.stringify(data), {
    status: 200, headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function clientErr(message: string, cors: Record<string, string>, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function validatePassword(password: string): string | null {
  if (!password || password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.'
  if (password.length > 128) return 'La contraseña es demasiado larga.'
  if (!/[a-zA-Z]/.test(password)) return 'La contraseña debe contener al menos una letra.'
  if (!/[0-9]/.test(password)) return 'La contraseña debe contener al menos un número.'
  return null
}

const EMAIL_REGEX = /^[^\s@]{1,64}@[^\s@]{1,255}$/

Deno.serve(async (req) => {
  const requestOrigin = req.headers.get('Origin')
  const cors = corsHeaders(requestOrigin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json() as {
      full_name: string
      email: string
      cui_dui: string
      fecha_nacimiento: string
      password: string
    }

    const { full_name, email, cui_dui, fecha_nacimiento, password } = body

    // Validate required fields
    if (!full_name || !email || !cui_dui || !fecha_nacimiento || !password) {
      return clientErr('Todos los campos son requeridos.', cors)
    }

    // Validate input lengths to prevent DoS / injection via oversized payloads
    if (full_name.length > 200) return clientErr('Nombre demasiado largo.', cors)
    if (email.length > 254) return clientErr('Correo electrónico inválido.', cors)
    if (cui_dui.length > 20) return clientErr('DPI/CUI inválido.', cors)
    if (fecha_nacimiento.length > 10) return clientErr('Fecha de nacimiento inválida.', cors)

    // Basic email format check
    if (!EMAIL_REGEX.test(email)) {
      return clientErr('Formato de correo electrónico inválido.', cors)
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_nacimiento)) {
      return clientErr('Formato de fecha inválido.', cors)
    }

    // Validate CUI/DUI: only digits and hyphens
    if (!/^[\d\-]+$/.test(cui_dui)) {
      return clientErr('DPI/CUI contiene caracteres inválidos.', cors)
    }

    // Validate password strength
    const pwdError = validatePassword(password)
    if (pwdError) {
      return clientErr(pwdError, cors)
    }

    // Service-role client to bypass RLS
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Step 1: Look up client using existing RPC (SECURITY DEFINER, searches global pool)
    const { data: lookupResult, error: lookupError } = await adminClient.rpc(
      'buscar_cliente_para_onboarding',
      { p_cui_dui: cui_dui, p_fecha_nac: fecha_nacimiento, p_email: email }
    )

    if (lookupError) {
      console.error('Lookup error:', lookupError)
      return clientErr('Error al verificar su identidad. Intente nuevamente.', cors, 500)
    }

    const result = lookupResult as { match_count: number; cliente_id: string | null }

    if (result.match_count < 3 || !result.cliente_id) {
      return clientErr('No se encontró un cliente con los datos proporcionados. Verifique su DPI/CUI, fecha de nacimiento y correo electrónico.', cors, 422)
    }

    const clienteId = result.cliente_id

    // Step 2: Verify that the client has permission to create an account
    const { data: clienteRecord, error: clienteError } = await adminClient
      .from('clientes')
      .select('id, nombre, puede_crear_cuenta')
      .eq('id', clienteId)
      .single()

    if (clienteError || !clienteRecord) {
      return clientErr('No se pudo obtener la información del cliente.', cors, 500)
    }

    if (!clienteRecord.puede_crear_cuenta) {
      return clientErr('Su cuenta no está habilitada para el portal de clientes. Comuníquese con su empresa de servicios.', cors, 403)
    }

    // Step 3: Check that no account already exists for this cliente_id
    const { data: existingUser } = await adminClient
      .from('app_users')
      .select('id')
      .eq('cliente_id', clienteId)
      .maybeSingle()

    if (existingUser) {
      return clientErr('Ya existe una cuenta asociada a este cliente. Si olvidó su contraseña, use la opción "Olvidé mi contraseña".', cors, 409)
    }

    // Step 4: Create Supabase Auth user
    const { data: newAuthUser, error: createError } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name },
    })

    if (createError || !newAuthUser?.user) {
      console.error('Auth create error:', createError)
      const message = createError?.message?.includes('already registered')
        ? 'El correo electrónico ya está registrado.'
        : 'No se pudo crear la cuenta. Intente nuevamente.'
      return clientErr(message, cors, 409)
    }

    const newUserId = newAuthUser.user.id

    // Step 5: Insert profile in app_users
    const { error: profileError } = await adminClient
      .from('app_users')
      .insert({
        id: newUserId,
        full_name: full_name.trim(),
        role: 'cliente',
        cliente_id: clienteId,
        activo: true,
      })

    if (profileError) {
      console.error('Profile insert error:', profileError)
      await adminClient.auth.admin.deleteUser(newUserId)
      return clientErr('No se pudo completar el registro. Intente nuevamente.', cors, 500)
    }

    return ok({ success: true, user_id: newUserId }, cors)

  } catch (e) {
    console.error('Unexpected error:', e)
    return new Response(JSON.stringify({ error: 'Error inesperado. Intente nuevamente.' }), {
      status: 500, headers: { ...corsHeaders(req.headers.get('Origin')), 'Content-Type': 'application/json' },
    })
  }
})
