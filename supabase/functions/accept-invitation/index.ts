// ============================================================================
// accept-invitation — T3/plat:P3: el invitado fija su contraseña y se activa.
// ============================================================================
// Público (sessionless): el invitado no tiene cuenta todavía. La única clave de
// validación es el TOKEN (aleatorio seguro) + el origin check + la fortaleza de
// la contraseña. No usa RLS — valida el token con service_role.
//
// Flujo (reusa la lógica de create-user para el alta + RBAC):
//   1. Valida origin + payload (token, password).
//   2. Busca la invitación por token; debe estar 'pending' y no expirada. Si
//      expiró, la marca 'expired' y devuelve 410.
//   3. Crea el auth user (email_confirm: true — el token ya prueba el email) con
//      el correo de la invitación y la contraseña elegida.
//   4. Inserta app_users vinculado al company_id con el rol preasignado.
//   5. Asigna el rol RBAC en user_roles (mismo PLATFORM_ROLE_ID map que
//      create-user). Rollback en cascada si algo falla.
//   6. Marca la invitación 'accepted' (token de un solo uso).
//
// `verify_jwt = false` en config.toml.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enforceRateLimit, getClientIp } from '../_shared/rateLimit.ts'

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
      { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
  return null
}

// Misma validación server-side que validatePasswordStrength del frontend.
function validatePassword(pw: string): string | null {
  if (!pw || pw.length < 8) return 'La contraseña debe tener al menos 8 caracteres'
  if (!/[A-Z]/.test(pw)) return 'La contraseña debe incluir al menos una mayúscula'
  if (!/[a-z]/.test(pw)) return 'La contraseña debe incluir al menos una minúscula'
  if (!/\d/.test(pw)) return 'La contraseña debe incluir al menos un número'
  return null
}

// Mapa rol → role_id de plataforma (RBAC). Espejo EXACTO del de create-user
// (migración 20260518000013_rbac_platform_modules.sql).
const PLATFORM_ROLE_ID: Record<string, string> = {
  admin:     '00000000-0000-0000-0000-000000000201',
  operator:  '00000000-0000-0000-0000-000000000202',
  operador:  '00000000-0000-0000-0000-000000000202',
  viewer:    '00000000-0000-0000-0000-000000000203',
  visor:     '00000000-0000-0000-0000-000000000203',
  collector: '00000000-0000-0000-0000-000000000204',
}

interface InvitationRow {
  id: string
  company_id: string
  email: string
  role: string
  status: string
  expires_at: string
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
    const body = await req.json() as { token?: string; password?: string; full_name?: string; action?: string }
    const token = (body.token ?? '').trim()
    const password = body.password ?? ''
    const fullName = (body.full_name ?? '').trim()
    // 'preview' → solo devuelve empresa/rol/email para que la landing pública
    // los muestre antes de pedir la contraseña. 'accept' (default) → crea la cuenta.
    const isPreview = body.action === 'preview'

    if (!token) {
      return new Response(JSON.stringify({ error: 'Falta el token de invitación' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Rate limit por IP (defense-in-depth contra fuerza bruta de tokens). El
    // token tiene 32 bytes de entropía, pero limitar es barato y consistente
    // con signup-company. 60 intentos/hora cubre reintentos legítimos.
    const rl = await enforceRateLimit(adminClient, {
      subject: `ip:${getClientIp(req)}`,
      action: 'accept_invitation',
      max: 60,
      message: 'Demasiados intentos. Espera unos minutos e intenta de nuevo.',
    }, corsHeaders)
    if (rl) return rl

    // 2. Busca la invitación por token.
    const { data: inv, error: invErr } = await adminClient
      .from('user_invitations')
      .select('id, company_id, email, role, status, expires_at')
      .eq('token', token)
      .maybeSingle()

    if (invErr || !inv) {
      return new Response(JSON.stringify({ error: 'Invitación no encontrada o inválida' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const invitation = inv as InvitationRow

    if (invitation.status !== 'pending') {
      const msg = invitation.status === 'accepted'
        ? 'Esta invitación ya fue utilizada.'
        : 'Esta invitación ya no está disponible.'
      return new Response(JSON.stringify({ error: msg }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      // Marca expirada (best-effort) y devuelve 410.
      await adminClient.from('user_invitations')
        .update({ status: 'expired' })
        .eq('id', invitation.id)
        .eq('status', 'pending')
      return new Response(JSON.stringify({ error: 'Esta invitación expiró. Pide una nueva.' }), {
        status: 410, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const email = invitation.email.trim().toLowerCase()

    // Datos de la empresa para mostrar en la landing (preview) o devolver al aceptar.
    const { data: company } = await adminClient
      .from('companies')
      .select('nombre')
      .eq('id', invitation.company_id)
      .single()
    const companyName = (company as { nombre?: string } | null)?.nombre ?? null

    // PREVIEW: no crea nada — solo expone empresa/rol/email (mínimos).
    if (isPreview) {
      return new Response(
        JSON.stringify({
          valid: true,
          email,
          role: invitation.role,
          company_id: invitation.company_id,
          company_name: companyName,
          expires_at: invitation.expires_at,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // ACCEPT: a partir de aquí sí se exige contraseña válida.
    const pwError = validatePassword(password)
    if (pwError) {
      return new Response(JSON.stringify({ error: pwError }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Crea el auth user. email_confirm: true — el token ya prueba posesión
    // del correo, así el usuario puede iniciar sesión inmediatamente.
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    })

    if (createErr || !created?.user) {
      const m = createErr?.message?.toLowerCase() ?? ''
      if (m.includes('already') || m.includes('exists') || m.includes('registered')) {
        return new Response(
          JSON.stringify({ error: 'Ya existe una cuenta con este correo. Inicia sesión.' }),
          { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({ error: createErr?.message ?? 'No se pudo crear el usuario' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const userId = created.user.id

    // 4. Inserta app_users vinculado al company_id con el rol preasignado.
    const { error: profileErr } = await adminClient.from('app_users').insert({
      id: userId,
      full_name: fullName || null,
      role: invitation.role,
      company_id: invitation.company_id,
      activo: true,
    })

    if (profileErr) {
      await adminClient.auth.admin.deleteUser(userId).catch(() => undefined)
      return new Response(
        JSON.stringify({ error: 'No se pudo crear el perfil: ' + profileErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // 5. Asigna el rol RBAC (mismo map que create-user). super_admin /
    // company_owner / admin bypassan RBAC y no tienen platform role; los demás
    // sí. invited_by se usa como assigned_by (lo recuperamos de la invitación).
    const platformRoleId = PLATFORM_ROLE_ID[invitation.role]
    if (platformRoleId) {
      const { error: roleErr } = await adminClient.from('user_roles').insert({
        user_id: userId,
        role_id: platformRoleId,
        assigned_by: userId, // self-assigned vía aceptación de invitación
      })
      if (roleErr) {
        // Rollback: no dejar un usuario sin permisos.
        await adminClient.from('app_users').delete().eq('id', userId).catch(() => undefined)
        await adminClient.auth.admin.deleteUser(userId).catch(() => undefined)
        return new Response(
          JSON.stringify({ error: 'No se pudo asignar el rol: ' + roleErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
    }

    // 6. Marca la invitación aceptada (token de un solo uso). Condicionamos a
    // status='pending' para que sea idempotente bajo carrera (otro request en
    // vuelo no la "re-acepta").
    const { error: acceptErr } = await adminClient
      .from('user_invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        accepted_user_id: userId,
      })
      .eq('id', invitation.id)
      .eq('status', 'pending')

    if (acceptErr) {
      // El usuario ya quedó creado; logueamos pero no hacemos rollback para no
      // dejar al invitado sin cuenta tras fijar su contraseña.
      console.error('[accept-invitation] could not mark accepted:', acceptErr.message)
    }

    return new Response(
      JSON.stringify({
        success: true,
        user_id: userId,
        // El frontend usa email para signInWithPassword y dejar la sesión lista.
        email,
        company_id: invitation.company_id,
        company_name: companyName,
        role: invitation.role,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('accept-invitation error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
