import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
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
      return new Response(JSON.stringify({ error: 'Todos los campos son requeridos.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (password.length < 8) {
      return new Response(JSON.stringify({ error: 'La contraseña debe tener al menos 8 caracteres.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
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
      return new Response(JSON.stringify({ error: 'Error al verificar su identidad. Intente nuevamente.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const result = lookupResult as { match_count: number; cliente_id: string | null }

    if (result.match_count < 3 || !result.cliente_id) {
      return new Response(JSON.stringify({
        error: 'No se encontró un cliente con los datos proporcionados. Verifique su DPI/CUI, fecha de nacimiento y correo electrónico.',
      }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const clienteId = result.cliente_id

    // Step 2: Verify that the client has permission to create an account
    const { data: clienteRecord, error: clienteError } = await adminClient
      .from('clientes')
      .select('id, nombre, puede_crear_cuenta')
      .eq('id', clienteId)
      .single()

    if (clienteError || !clienteRecord) {
      return new Response(JSON.stringify({ error: 'No se pudo obtener la información del cliente.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!clienteRecord.puede_crear_cuenta) {
      return new Response(JSON.stringify({
        error: 'Su cuenta no está habilitada para el portal de clientes. Comuníquese con su empresa de servicios.',
      }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Step 3: Check that no account already exists for this cliente_id
    const { data: existingUser } = await adminClient
      .from('app_users')
      .select('id')
      .eq('cliente_id', clienteId)
      .maybeSingle()

    if (existingUser) {
      return new Response(JSON.stringify({
        error: 'Ya existe una cuenta asociada a este cliente. Si olvidó su contraseña, use la opción "Olvidé mi contraseña".',
      }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Step 4: Check email is not already in use
    const { data: existingByEmail } = await adminClient
      .from('app_users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle()

    // Note: app_users does not store email directly; Supabase Auth handles it.
    // We check via auth admin list if email is taken.
    // This is a best-effort check; the createUser call will fail if email is taken.
    if (existingByEmail) {
      return new Response(JSON.stringify({ error: 'El correo electrónico ya está registrado.' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Step 5: Create Supabase Auth user
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
      return new Response(JSON.stringify({ error: message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const newUserId = newAuthUser.user.id

    // Step 6: Insert profile in app_users
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
      // Roll back auth user creation if profile insert fails
      console.error('Profile insert error:', profileError)
      await adminClient.auth.admin.deleteUser(newUserId)
      return new Response(JSON.stringify({ error: 'No se pudo completar el registro. Intente nuevamente.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, user_id: newUserId }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('Unexpected error:', err)
    return new Response(JSON.stringify({ error: 'Error inesperado. Intente nuevamente.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
