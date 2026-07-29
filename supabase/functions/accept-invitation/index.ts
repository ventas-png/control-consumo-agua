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
import { getCorsHeaders, validateOrigin } from '../_shared/cors.ts'
// Lógica pura (fortaleza de password, map RBAC, gate de estado de invitación)
// extraída a ./validate.ts para poder testearla en vitest (infra:I22).
import {
  checkInvitationUsable,
  isDuplicateUserError,
  platformRoleId,
  validatePassword,
} from './validate.ts'

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

    // Gate de estado (idempotencia + expiración) modelado como dato puro.
    const gate = checkInvitationUsable(
      { status: invitation.status, expiresAt: invitation.expires_at },
    )
    if (!gate.ok) {
      if (gate.markExpired) {
        // Marca expirada (best-effort) antes de responder 410.
        await adminClient.from('user_invitations')
          .update({ status: 'expired' })
          .eq('id', invitation.id)
          .eq('status', 'pending')
      }
      return new Response(JSON.stringify({ error: gate.error }), {
        status: gate.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
      if (isDuplicateUserError(createErr?.message)) {
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
    const roleId = platformRoleId(invitation.role)
    if (roleId) {
      const { error: roleErr } = await adminClient.from('user_roles').insert({
        user_id: userId,
        role_id: roleId,
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
