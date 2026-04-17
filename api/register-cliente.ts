import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { full_name, email, cui_dui, fecha_nacimiento, password } = req.body ?? {}

  if (!full_name || !email || !cui_dui || !fecha_nacimiento || !password) {
    return res.status(200).json({ error: 'Todos los campos son requeridos.' })
  }
  if (password.length < 8) {
    return res.status(200).json({ error: 'La contraseña debe tener al menos 8 caracteres.' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(200).json({ error: 'Error de configuración del servidor.' })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  try {
    const { data: lookupResult, error: lookupError } = await admin.rpc(
      'buscar_cliente_para_onboarding',
      { p_cui_dui: cui_dui, p_fecha_nac: fecha_nacimiento, p_email: email }
    )
    if (lookupError) {
      return res.status(200).json({ error: 'Error al verificar su identidad. Intente nuevamente.' })
    }

    const lookup = lookupResult as { match_count: number; cliente_id: string | null }
    if (lookup.match_count < 3 || !lookup.cliente_id) {
      return res.status(200).json({ error: 'No se encontró un cliente con los datos proporcionados. Verifique su DPI/CUI, fecha de nacimiento y correo electrónico.' })
    }

    const clienteId = lookup.cliente_id

    const { data: cliente, error: clienteError } = await admin
      .from('clientes')
      .select('puede_crear_cuenta')
      .eq('id', clienteId)
      .single()

    if (clienteError || !cliente) {
      return res.status(200).json({ error: 'No se pudo obtener la información del cliente.' })
    }
    if (!cliente.puede_crear_cuenta) {
      return res.status(200).json({ error: 'Su cuenta no está habilitada para el portal de clientes. Comuníquese con su empresa de servicios.' })
    }

    const { data: existing } = await admin
      .from('app_users')
      .select('id')
      .eq('cliente_id', clienteId)
      .maybeSingle()

    if (existing) {
      return res.status(200).json({ error: 'Ya existe una cuenta asociada a este cliente. Si olvidó su contraseña, use la opción "Olvidé mi contraseña".' })
    }

    const { data: newAuth, error: createError } = await admin.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name },
    })

    if (createError || !newAuth?.user) {
      const msg = createError?.message?.includes('already registered')
        ? 'El correo electrónico ya está registrado.'
        : 'No se pudo crear la cuenta. Intente nuevamente.'
      return res.status(200).json({ error: msg })
    }

    const newUserId = newAuth.user.id

    const { error: profileError } = await admin.from('app_users').insert({
      id: newUserId,
      full_name: full_name.trim(),
      role: 'cliente',
      cliente_id: clienteId,
      activo: true,
    })

    if (profileError) {
      await admin.auth.admin.deleteUser(newUserId)
      return res.status(200).json({ error: 'No se pudo completar el registro. Intente nuevamente.' })
    }

    return res.status(200).json({ success: true, user_id: newUserId })
  } catch (e) {
    console.error('Registration error:', e)
    return res.status(200).json({ error: 'Error inesperado. Intente nuevamente.' })
  }
}
