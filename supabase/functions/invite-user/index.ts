// ============================================================================
// invite-user — T3/plat:P3: crea una invitación de usuario y envía el correo.
// ============================================================================
// Flujo:
//   1. Valida JWT del llamador (shared/auth requireUser) y que sea
//      company_owner / admin / super_admin.
//   2. Valida el rol a invitar (no se puede invitar super_admin ni
//      company_owner por esta vía; el rol admin solo lo invita el PRINCIPAL:
//      company_owner o super_admin — 403 para un administrador) y que la
//      company sea la propia (salvo super_admin). El control real del camino
//      directo (INSERT en user_invitations por la API) es la política RLS
//      user_invitations_insert de la migración 20261026000700.
//   3. Genera un token aleatorio seguro (crypto) con expiración (7 días).
//   4. Inserta la fila en user_invitations (service_role; revoca los pending
//      previos al MISMO correo en la company — comparación exacta del correo en
//      minúsculas, sin comodines —, y si quien llama no es el principal NO revoca
//      los de rol 'admin': son del propietario).
//   5. Envía el correo de invitación reusando send-email (template genérico
//      `notificacion_empresa` con CTA → /aceptar-invitacion?token=...), desde
//      la cuenta de Gmail de la empresa. Fire-and-forget: si falla el correo
//      la invitación queda creada y se puede reenviar.
//
// Límites de plan: el modelo de límites (usePlanLimits / get_company_effective_
// limits) cubre proyectos y unidades, NO usuarios — no hay max_users. Por eso
// solo aplicamos rate-limit por llamador (igual que create-user), no un límite
// de plan. Ver follow-up en el PR.
//
// `verify_jwt = false` en config.toml: validamos el JWT manualmente con el
// shared helper para devolver errores consistentes (mismo patrón que create-user).
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireUser } from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rateLimit.ts'
import { getCorsHeaders, validateOrigin } from '../_shared/cors.ts'
// Lógica pura (whitelist de roles, token, expiración, validación de email)
// extraída a ./validate.ts para poder testearla en vitest (infra:I22).
import {
  MSG_SOLO_PRINCIPAL_ADMIN,
  canInviteRole,
  computeExpiresAt,
  generateToken,
  idsPendientesARevocar,
  isInvitableRole,
  isPrincipalRole,
  isTextOrAbsent,
  isValidEmail,
  roleLabel as labelForRole,
} from './validate.ts'

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
    // 1. JWT válido (shared helper, mismo patrón que create-user).
    const auth = await requireUser(req, corsHeaders)
    if ('response' in auth) return auth.response
    const { user: caller, client: callerClient } = auth

    const { data: callerProfile } = await callerClient
      .from('app_users')
      .select('role, company_id')
      .eq('id', caller.id)
      .single()

    const callerRole: string = (callerProfile as { role: string; company_id: string | null } | null)?.role ?? ''
    const callerCompanyId: string | null = (callerProfile as { role: string; company_id: string | null } | null)?.company_id ?? null

    const isSuperAdmin = callerRole === 'super_admin' || callerRole === 'superadmin'
    const isCompanyOwner = callerRole === 'company_owner'
    const isAdmin = callerRole === 'admin'

    if (!isSuperAdmin && !isCompanyOwner && !isAdmin) {
      return new Response(JSON.stringify({ error: 'Insufficient permissions' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // El cuerpo llega de la red: un campo que no sea texto (arreglo, objeto, número…) o un cuerpo que no sea un objeto JSON es una petición mal formada → 400, nunca un
    // TypeError en .trim() (500 «Internal server error»). Se valida ANTES de recortar y de decidir nada con el rol.
    const body = await req.json().catch(() => null) as {
      email?: unknown
      role?: unknown
      company_id?: unknown
      full_name?: unknown
    } | null
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return new Response(JSON.stringify({ error: 'Cuerpo inválido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!isTextOrAbsent(body.email)) {
      return new Response(JSON.stringify({ error: 'Correo electrónico inválido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!isTextOrAbsent(body.role)) {
      return new Response(JSON.stringify({ error: 'Rol inválido. Solo admin/operador/visualizador/cobros' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!isTextOrAbsent(body.full_name) || !isTextOrAbsent(body.company_id)) {
      return new Response(JSON.stringify({ error: 'Datos inválidos' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const email = (body.email ?? '').trim().toLowerCase()
    const role = (body.role ?? '').trim()
    // Non-superadmins siempre invitan a SU company.
    const companyId = isSuperAdmin ? (body.company_id ?? callerCompanyId) : callerCompanyId
    const inviteeName = (body.full_name ?? '').trim()

    if (!email || !isValidEmail(email)) {
      return new Response(JSON.stringify({ error: 'Correo electrónico inválido' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!role || !isInvitableRole(role)) {
      return new Response(JSON.stringify({ error: 'Rol inválido. Solo admin/operador/visualizador/cobros' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    // El rol 'admin' solo lo invita el PRINCIPAL (company_owner o super_admin): un administrador recibe 403 con el motivo.
    if (!canInviteRole(callerRole, role)) {
      return new Response(JSON.stringify({ error: MSG_SOLO_PRINCIPAL_ADMIN }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!companyId) {
      return new Response(JSON.stringify({ error: 'Falta company_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (!isSuperAdmin && companyId !== callerCompanyId) {
      return new Response(JSON.stringify({ error: 'No puedes invitar usuarios a otra empresa' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    // Rate limit por llamador: máx 30 invitaciones/hora (igual que create-user).
    const rl = await enforceRateLimit(adminClient, {
      subject: caller.id,
      action: 'invite_user',
      max: 30,
      message: 'Demasiadas invitaciones en poco tiempo. Espera unos minutos.',
    }, corsHeaders)
    if (rl) return rl

    // 2. Revoca los pending previos al MISMO correo en la company (evita chocar con el índice único parcial y permite re-invitar limpio).
    // Se leen las pendientes de la empresa y se comparan en código (correo recortado y en minúsculas, igualdad exacta) para revocarlas por id: un filtro
    // ilike con el correo del cuerpo interpretaría % _ \ — y el * de PostgREST — como comodines, y '%@%.%' (pasa isValidEmail) revocaba TODAS las
    // pendientes de la empresa. Y quien NO es el principal no revoca las invitaciones 'admin': son del propietario (esta escritura es con service_role,
    // sin RLS; un administrador no debe poder anular por aquí lo que la política user_invitations_update ya le impide).
    const { data: pendientes } = await adminClient
      .from('user_invitations')
      .select('id, email, role')
      .eq('company_id', companyId)
      .eq('status', 'pending')
    const idsRevocar = idsPendientesARevocar(
      (pendientes ?? []) as Array<{ id: string; email: string | null; role: string | null }>,
      email,
      isPrincipalRole(callerRole),
    )
    if (idsRevocar.length > 0) {
      await adminClient
        .from('user_invitations')
        .update({ status: 'revoked' })
        .eq('company_id', companyId)
        .eq('status', 'pending')
        .in('id', idsRevocar)
    }

    // 3. Crea la invitación con token + expiración.
    const token = generateToken()
    const expiresAt = computeExpiresAt()

    const { data: invitation, error: insertErr } = await adminClient
      .from('user_invitations')
      .insert({
        company_id: companyId,
        email,
        role,
        token,
        invited_by: caller.id,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select('id')
      .single()

    // Índice único (empresa, correo) entre las pendientes: si queda una que este llamador no podía revocar (la invitación 'admin' del propietario), es un conflicto, no un 500.
    if ((insertErr as { code?: string } | null)?.code === '23505') {
      return new Response(JSON.stringify({ error: 'Ya hay una invitación pendiente para ese correo; la gestiona el propietario de la empresa.' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    if (insertErr || !invitation) {
      return new Response(JSON.stringify({ error: insertErr?.message ?? 'No se pudo crear la invitación' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Datos para el correo: nombre de la empresa + URL de la app.
    const { data: company } = await adminClient
      .from('companies')
      .select('nombre, logo_url')
      .eq('id', companyId)
      .single()

    const companyName = (company as { nombre?: string } | null)?.nombre ?? 'tu empresa'
    const companyLogo = (company as { logo_url?: string } | null)?.logo_url ?? ''
    const appUrl = (Deno.env.get('APP_URL') ?? origin ?? 'https://administratodo.com').replace(/\/$/, '')
    const acceptUrl = `${appUrl}/aceptar-invitacion?token=${encodeURIComponent(token)}`
    const roleLabel = labelForRole(role)

    // 5. Envía el correo reusando send-email (template `notificacion_empresa`,
    // que soporta CTA). Desde la cuenta de Gmail de la empresa (company_id).
    // Fire-and-forget: la invitación ya está creada.
    const sendEmailUrl = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/send-email`
    let emailQueued = false
    try {
      const emailRes = await fetch(sendEmailUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
        },
        body: JSON.stringify({
          company_id: companyId,
          template_key: 'notificacion_empresa',
          to_email: email,
          to_name: inviteeName || email,
          vars: {
            empresa_nombre: companyName,
            empresa_logo: companyLogo,
            titulo: `Te invitaron a ${companyName}`,
            subject: `Invitación para unirte a ${companyName}`,
            message:
              `Has sido invitado/a a unirte a ${companyName} en AdministraTodo con el rol de ${roleLabel}. ` +
              `Haz clic en el botón para crear tu contraseña y activar tu cuenta. ` +
              `Esta invitación expira en 7 días.`,
            cta_url: acceptUrl,
            cta_texto: 'Aceptar invitación',
          },
        }),
      })
      emailQueued = emailRes.ok
      if (!emailRes.ok) {
        const errBody = await emailRes.json().catch(() => ({}))
        console.error('[invite-user] send-email non-ok:', emailRes.status, errBody)
      }
    } catch (err) {
      console.error('[invite-user] send-email failed:', err)
    }

    return new Response(
      JSON.stringify({
        success: true,
        invitation_id: (invitation as { id: string }).id,
        email_sent: emailQueued,
        // El frontend puede mostrar/copiar el link si el correo no se envió
        // (p.ej. la empresa todavía no conectó su Gmail).
        accept_url: acceptUrl,
        expires_at: expiresAt,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('invite-user error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
