import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enforceRateLimits, getClientIp } from '../_shared/rateLimit.ts'
import { validatePayload, type SignupPayload } from './validate.ts'

// ============================================================================
// signup-company — onboarding self-service publico (plat:P5, F2.10)
// ============================================================================
// Crea atomicamente: auth user + company + app_users link (role: company_owner).
// Es publico (--no-verify-jwt) — la unica capa de validacion es el origin
// check, la fortaleza de la password y el email confirmation de Supabase Auth
// (si esta habilitado en el proyecto). Para mitigar abuso futuro, se pueden
// agregar CAPTCHA y/o rate-limit table; no en MVP.
//
// Idempotencia / rollback:
//   - auth.admin.createUser falla si el email ya existe → respuesta 409.
//   - Si companies.insert falla → eliminamos el auth user para no dejar
//     huerfanos.
//   - Si app_users.insert falla → eliminamos company + auth user.
//   - Welcome email es fire-and-forget — si falla, el signup ya esta hecho.
// ============================================================================

function getAllowedOrigins(): string[] {
  const origins = new Set<string>([
    'https://administratodo.com',
    'https://www.administratodo.com',
    'https://administratodo.app',
    'https://www.administratodo.app',
  ])
  const envOrigins = Deno.env.get('ALLOWED_ORIGINS')
  if (envOrigins) {
    for (const o of envOrigins.split(',')) { const t = o.trim(); if (t) origins.add(t) }
  } else {
    origins.add('http://localhost:5173')
    origins.add('http://localhost:3000')
    origins.add('http://127.0.0.1:5173')
    origins.add('http://127.0.0.1:3000')
  }
  const appUrl = Deno.env.get('APP_URL')
  if (appUrl) {
    try { origins.add(new URL(appUrl).origin) } catch { /* malformed APP_URL */ }
  }
  return [...origins]
}

function getCorsHeaders(origin: string | null) {
  const allowed = getAllowedOrigins()
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0]
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

function validateOrigin(origin: string | null, corsHeaders: ReturnType<typeof getCorsHeaders>) {
  const allowed = getAllowedOrigins()
  if (!origin || !allowed.includes(origin)) {
    return new Response(
      JSON.stringify({ error: 'Origin not allowed' }),
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
  return null
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const originError = validateOrigin(origin, corsHeaders)
  if (originError) return originError

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const payload = await req.json() as SignupPayload
    const validationError = validatePayload(payload)
    if (validationError) {
      return new Response(JSON.stringify({ error: validationError }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const email = payload.email!.trim().toLowerCase()
    const fullName = payload.full_name!.trim()
    const companyName = payload.company_name!.trim()

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Rate limit por IP y por email: máx 5 registros/hora desde la misma red, y máx 3/hora
    // contra el mismo correo. Mitiga el abuso de alta self-service que el header de este
    // archivo marcaba como TODO ("rate-limit table; no en MVP") y, con la dimensión de email,
    // frena el martilleo de un mismo correo desde IPs rotadas. Server-side: el RPC corre como
    // service_role (infra:I2). El de IP corta primero (no quema el contador del email).
    const rl = await enforceRateLimits(admin, [
      {
        subject: `ip:${getClientIp(req)}`,
        action: 'signup_company',
        max: 5,
        message: 'Demasiados registros desde esta red. Espera una hora e intenta de nuevo.',
      },
      {
        subject: `email:${email}`,
        action: 'signup_company:email',
        max: 3,
        message: 'Demasiados intentos de registro con este correo. Espera una hora e intenta de nuevo.',
      },
    ], corsHeaders)
    if (rl) return rl

    // 1. Crear auth user. Si Supabase Auth tiene email confirmations habilitado,
    // queda en pending hasta confirmar; el resto del setup sucede igual para
    // que cuando confirme tenga su workspace listo.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: payload.password,
      email_confirm: false, // Supabase enviara el correo de confirmacion estandar
      user_metadata: { full_name: fullName },
    })

    if (createErr || !created?.user) {
      const msg = createErr?.message?.toLowerCase() ?? ''
      if (msg.includes('already') || msg.includes('exists') || msg.includes('registered')) {
        return new Response(
          JSON.stringify({ error: 'Ese correo ya esta registrado. Inicia sesion o usa otro correo.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      return new Response(
        JSON.stringify({ error: createErr?.message ?? 'No se pudo crear el usuario' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const userId = created.user.id

    // 2. Crear company. Si falla → cleanup auth user.
    const { data: company, error: companyErr } = await admin
      .from('companies')
      .insert({
        nombre: companyName,
        email,
        telefono: payload.phone?.trim() || null,
        // Moneda elegida en el formulario; 'gtq' si no vino (mercado base).
        default_currency: (payload.default_currency ?? 'gtq').trim().toLowerCase(),
        servicio_agua: payload.servicio_agua === true,
        servicio_condominios: payload.servicio_condominios === true,
        max_projects: 5,
        max_units: 50,
        signup_source: 'self_service',
      })
      .select('id')
      .single()

    if (companyErr || !company) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined)
      return new Response(
        JSON.stringify({ error: companyErr?.message ?? 'No se pudo crear la empresa' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const companyId = (company as { id: string }).id

    // 3. Crear app_users link con rol company_owner. Si falla → cleanup todo.
    const { error: appUserErr } = await admin
      .from('app_users')
      .insert({
        id: userId,
        full_name: fullName,
        email,
        role: 'company_owner',
        company_id: companyId,
        activo: true,
      })

    if (appUserErr) {
      await admin.from('companies').delete().eq('id', companyId).catch(() => undefined)
      await admin.auth.admin.deleteUser(userId).catch(() => undefined)
      return new Response(
        JSON.stringify({ error: appUserErr.message ?? 'No se pudo vincular el usuario a la empresa' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 3.5. Evidencia legal (click-wrap). validatePayload ya exigió legal_accepted === true;
    // aquí persistimos el rastro de auditoría: una fila por documento VIGENTE en
    // legal_acceptances con la versión (p.ej. VFinal-2026), la IP real (getClientIp,
    // server-side), el user-agent y el timestamp. El owner acepta también el DPA
    // (audience 'company') en nombre del tenant. Idempotente vía el índice único.
    // Best-effort: si fallara NO revertimos la cuenta ya creada (el usuario consintió y
    // el server lo validó); se registra el error para auditoría/observabilidad.
    try {
      const { data: legalDocs, error: legalDocsErr } = await admin
        .from('legal_documents')
        .select('doc_type, version')
        .eq('is_current', true)
        .eq('locale', 'es')
        .in('doc_type', ['tos', 'privacy', 'dpa'])
      if (legalDocsErr) {
        console.error('[signup-company] legal_documents lookup failed:', legalDocsErr.message)
      } else if (!legalDocs || legalDocs.length === 0) {
        console.error('[signup-company] no current legal_documents (es); acceptance not recorded')
      } else {
        const acceptedAt = new Date().toISOString()
        const clientIp = getClientIp(req)
        const userAgent = req.headers.get('user-agent')
        const rows = (legalDocs as Array<{ doc_type: string; version: string }>).map((d) => ({
          user_id: userId,
          company_id: companyId,
          doc_type: d.doc_type,
          version: d.version,
          locale: 'es',
          accepted_at: acceptedAt,
          client_ip: clientIp,
          user_agent: userAgent,
        }))
        const { error: legalErr } = await admin
          .from('legal_acceptances')
          .upsert(rows, { onConflict: 'user_id,doc_type,version,locale', ignoreDuplicates: true })
        if (legalErr) console.error('[signup-company] legal acceptance insert failed:', legalErr.message)
      }
    } catch (e) {
      console.error('[signup-company] legal acceptance recording error:', e instanceof Error ? e.message : String(e))
    }

    // 4. Welcome email — fire-and-forget. Solo se intenta si hay config de
    // superadmin email; si no, lo dejamos pasar silenciosamente para no
    // bloquear el signup en caso de que el operador todavia no haya conectado
    // su cuenta de Gmail superadmin.
    const sendEmailUrl = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/send-email`
    fetch(sendEmailUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
      },
      body: JSON.stringify({
        is_superadmin: true,
        template_key: 'bienvenida_empresa',
        to_email: email,
        to_name: fullName,
        vars: {
          empresa_nombre: 'AdministraTodo',
          nombre_admin: fullName,
          empresa_cliente: companyName,
          subject: `¡Bienvenidos a AdministraTodo, ${companyName}!`,
          message: `Hola ${fullName}, tu cuenta de ${companyName} ya esta lista. Revisa tu correo para confirmar y empezar a usar AdministraTodo.`,
        },
      }),
    }).catch(err => console.error('[signup-company] welcome email failed:', err))

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        company_id: companyId,
        // Hint al cliente: si el proyecto tiene email confirmations habilitado,
        // la sesion no esta lista hasta que el usuario confirme. La UI muestra
        // "Revisa tu correo".
        requires_confirmation: true,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(
      JSON.stringify({ error: `Error inesperado: ${msg}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
