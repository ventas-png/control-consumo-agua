import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enforceRateLimits, getClientIp } from '../_shared/rateLimit.ts'
import { getCorsHeaders, validateOrigin } from '../_shared/cors.ts'

// Generic identity error — same message for "not found" and "already verified" to prevent enumeration
const IDENTITY_ERROR = 'No se encontró un cliente con los datos proporcionados. Verifique su DPI/CUI, fecha de nacimiento y correo electrónico.'

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

  // Validación de origen (auditoría 2026-07-28, Bloque C · PR-19). Esta función
  // se despliega con --no-verify-jwt (onboarding pre-login) y era la ÚNICA de su
  // familia sin este gate: signup-company, create-user y delete-user sí lo
  // tienen. No sustituye a la autenticación —un cliente que no sea navegador
  // puede mandar cualquier Origin— pero corta el abuso desde una página de
  // terceros y alinea la función con el resto.
  const originError = validateOrigin(origin, corsHeaders)
  if (originError) return originError

  try {
    const body = await req.json() as {
      full_name: string
      email: string
      cui_dui: string
      fecha_nacimiento: string
      password: string
      legal_accepted?: boolean
    }

    const { full_name, email, cui_dui, fecha_nacimiento, password } = body

    if (!full_name || !email || !cui_dui || !fecha_nacimiento || !password) {
      return err('Todos los campos son requeridos.')
    }

    // Click-wrap obligatorio (RGPD/CCPA): el cliente debe aceptar los documentos legales.
    if (body.legal_accepted !== true) {
      return err('Debes aceptar los Términos de Servicio, la Política de Privacidad y el Anexo DPA.')
    }

    if (password.length < 8) {
      return err('La contraseña debe tener al menos 8 caracteres.')
    }

    // Service-role client to bypass RLS
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Rate limit server-side (infra:I2). Endpoint anónimo de alta self-service: principal
    // vector de abuso (enumeración de identidad vía buscar_cliente_para_onboarding + spam de
    // cuentas). Keyeado por IP y por email para que ni una IP rotando correos ni un correo
    // rotando IPs evada el tope. El de IP corta primero (no quema el contador del email).
    //
    // failClosed: endpoint ANÓNIMO donde el rate limit es el ÚNICO control. En
    // fail-open, una caída del RPC `rate_limit_hit` no solo abre el alta de cuentas:
    // deja sin tope la ENUMERACIÓN de identidades contra
    // buscar_cliente_para_onboarding (DPI/CUI + fecha de nacimiento + correo), que es
    // exactamente lo que el IDENTITY_ERROR genérico de arriba existe para frenar.
    // Regla documentada en _shared/rateLimit.ts.
    const normalizedEmail = email.toLowerCase().trim()
    const rl = await enforceRateLimits(adminClient, [
      { subject: `ip:${getClientIp(req)}`, action: 'create_cliente_account', max: 10, failClosed: true },
      { subject: `email:${normalizedEmail}`, action: 'create_cliente_account:email', max: 5, failClosed: true },
    ], corsHeaders)
    if (rl) return rl

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
      return err(IDENTITY_ERROR)
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
      return err(IDENTITY_ERROR)
    }

    // Step 4: Create Supabase Auth user
    const { data: newAuthUser, error: createError } = await adminClient.auth.admin.createUser({
      email: email.toLowerCase().trim(),
      password,
      email_confirm: true,
      user_metadata: { full_name },
    })

    let newUserId: string
    // Si el perfil no se puede crear (Step 5), solo se borra el auth user
    // cuando lo creamos nosotros en este request — nunca uno adoptado.
    let createdFreshAuthUser = false

    if (createError || !newAuthUser?.user) {
      const isDuplicate = createError?.message?.toLowerCase().includes('already') ?? false

      // Login huérfano: existe en Auth pero SIN perfil app_users (p.ej. un
      // perfil eliminado sin borrar el login, o un alta anterior que quedó a
      // medias). Sin esto, ese correo queda bloqueado para siempre: registro →
      // "ya está registrado", login → sin perfil. La identidad ya se verificó
      // 3-de-3 contra `clientes` (Step 1) y el cliente no tiene otra cuenta
      // (Step 3), así que adoptar el login (nueva contraseña + perfil) es
      // equivalente a crearlo. generateLink NO envía correo: solo resuelve el
      // auth user por email.
      let adoptedId: string | null = null
      if (isDuplicate) {
        const { data: linkData } = await adminClient.auth.admin.generateLink({
          type: 'recovery',
          email: email.toLowerCase().trim(),
        })
        const existingId = linkData?.user?.id
        if (existingId) {
          const { data: existingProfile } = await adminClient
            .from('app_users')
            .select('id')
            .eq('id', existingId)
            .maybeSingle()
          if (!existingProfile) {
            const { error: adoptError } = await adminClient.auth.admin.updateUserById(existingId, {
              password,
              email_confirm: true,
              user_metadata: { full_name },
            })
            if (adoptError) console.error('Orphan auth user adopt error:', adoptError)
            else {
              adoptedId = existingId
              // PR-19: esta rama SOBRESCRIBE la contraseña de un auth user que
              // ya existía. Está acotada a huérfanos (sin fila en `app_users`,
              // ver el `if (!existingProfile)` de arriba), así que no toca
              // cuentas en uso — pero sigue siendo un cambio de credencial
              // autorizado únicamente por DPI + fecha de nacimiento + correo,
              // tres datos de baja entropía que suelen ir impresos en la
              // factura. Como mínimo debe dejar rastro: antes ocurría en
              // silencio absoluto, sin forma de detectarlo a posteriori.
              await adminClient.from('security_logs').insert({
                user_id: existingId,
                event_type: 'orphan_auth_user_adopted',
                details: {
                  email: email.toLowerCase().trim(),
                  cliente_id: clienteId,
                  motivo: 'onboarding reclamó un auth user sin perfil',
                },
                ip_address: getClientIp(req),
                user_agent: req.headers.get('user-agent') ?? '',
                timestamp: new Date().toISOString(),
              })
            }
          }
        }
      }

      if (!adoptedId) {
        console.error('Auth create error:', createError)
        const message = isDuplicate
          ? 'El correo electrónico ya está registrado.'
          : 'No se pudo crear la cuenta. Intente nuevamente.'
        return err(message)
      }
      newUserId = adoptedId
    } else {
      newUserId = newAuthUser.user.id
      createdFreshAuthUser = true
    }

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
      if (createdFreshAuthUser) await adminClient.auth.admin.deleteUser(newUserId)
      return err('No se pudo completar el registro. Intente nuevamente.')
    }

    // Step 6: Evidencia legal (click-wrap). Una fila por documento de usuario VIGENTE
    // (Términos + Privacidad; el DPA es 'company', no aplica al residente) en
    // legal_acceptances, con versión, IP real (server-side), user-agent y timestamp.
    // Best-effort: si fallara NO revertimos la cuenta (el usuario consintió y el server
    // lo validó); se registra el error. Idempotente vía el índice único.
    try {
      const { data: legalDocs, error: legalDocsErr } = await adminClient
        .from('legal_documents')
        .select('doc_type, version')
        .eq('is_current', true)
        .eq('locale', 'es')
        .in('doc_type', ['tos', 'privacy'])
      if (legalDocsErr) {
        console.error('legal_documents lookup failed:', legalDocsErr.message)
      } else if (!legalDocs || legalDocs.length === 0) {
        console.error('no current legal_documents (es); acceptance not recorded')
      } else {
        const acceptedAt = new Date().toISOString()
        const clientIp = getClientIp(req)
        const userAgent = req.headers.get('user-agent')
        const rows = (legalDocs as Array<{ doc_type: string; version: string }>).map((d) => ({
          user_id: newUserId,
          company_id: null,
          doc_type: d.doc_type,
          version: d.version,
          locale: 'es',
          accepted_at: acceptedAt,
          client_ip: clientIp,
          user_agent: userAgent,
        }))
        const { error: legalErr } = await adminClient
          .from('legal_acceptances')
          .upsert(rows, { onConflict: 'user_id,doc_type,version,locale', ignoreDuplicates: true })
        if (legalErr) console.error('legal acceptance insert failed:', legalErr.message)
      }
    } catch (e) {
      console.error('legal acceptance recording error:', e instanceof Error ? e.message : String(e))
    }

    return ok({ success: true, user_id: newUserId })

  } catch (e) {
    console.error('Unexpected error:', e)
    return err('Error inesperado. Intente nuevamente.')
  }
})
