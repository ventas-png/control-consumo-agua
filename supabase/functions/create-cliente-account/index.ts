import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function getCorsHeaders(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin ?? '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}


Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  function ok(data: Record<string, unknown>) {
    return new Response(JSON.stringify(data), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  function err(message: string) {
    // Always return 200 so the Supabase JS client surfaces the message in data.error
    // instead of converting it to a FunctionsHttpError that loses the message
    return new Response(JSON.stringify({ error: message }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
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

    if (!full_name || !email || !cui_dui || !fecha_nacimiento || !password) {
      return err('Todos los campos son requeridos.')
    }

    if (password.length < 8) {
      return err('La contraseña debe tener al menos 8 caracteres.')
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
      return err('Error al verificar su identidad. Intente nuevamente.')
    }

    const result = lookupResult as { match_count: number; cliente_id: string | null }

    if (result.match_count < 3 || !result.cliente_id) {
      return err('No se encontró un cliente con los datos proporcionados. Verifique su DPI/CUI, fecha de nacimiento y correo electrónico.')
    }

    const clienteId = result.cliente_id

    // Step 2: Verify that the client has permission to create an account
    const { data: clienteRecord, error: clienteError } = await adminClient
      .from('clientes')
      .select('id, nombre, puede_crear_cuenta')
      .eq('id', clienteId)
      .single()

    if (clienteError || !clienteRecord) {
      return err('No se pudo obtener la información del cliente.')
    }

    if (!clienteRecord.puede_crear_cuenta) {
      return err('Su cuenta no está habilitada para el portal de clientes. Comuníquese con su empresa de servicios.')
    }

    // Step 3: Check that no account already exists for this cliente_id
    const { data: existingUser } = await adminClient
      .from('app_users')
      .select('id')
      .eq('cliente_id', clienteId)
      .maybeSingle()

    if (existingUser) {
      return err('Ya existe una cuenta asociada a este cliente. Si olvidó su contraseña, use la opción "Olvidé mi contraseña".')
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
      return err(message)
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
      return err('No se pudo completar el registro. Intente nuevamente.')
    }

    return ok({ success: true, user_id: newUserId })

  } catch (e) {
    console.error('Unexpected error:', e)
    return err('Error inesperado. Intente nuevamente.')
  }
})
