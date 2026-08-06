// ============================================================================
// invite-user — T3/plat:P3: crea una invitación de usuario y envía el correo.
// ============================================================================
// Flujo:
//   1. Valida JWT del llamador (shared/auth requireUser) y que sea
//      company_owner / admin / super_admin.
//   2. Valida el rol a invitar (no se puede invitar super_admin ni
//      company_owner por esta vía) y que la company sea la propia
//      (salvo super_admin).
//   3. Genera un token aleatorio seguro (crypto) con expiración (7 días).
//   4. Inserta la fila en user_invitations (service_role; revoca cualquier
//      pending previo al mismo correo en la company).
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
  INVITABLE_ROLES,
  computeExpiresAt,
  generateToken,
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

    const body = await req.json() as {
      email?: string
      role?: string
      company_id?: string
      full_name?: string
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
    if (!role || !INVITABLE_ROLES.includes(role)) {
      return new Response(JSON.stringify({ error: 'Rol inválido. Solo admin/operador/visualizador/cobros' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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

    // 2. Revoca cualquier pending previo al mismo correo en la company (evita
    // chocar con el índice único parcial y permite re-invitar limpio).
    await adminClient
      .from('user_invitations')
      .update({ status: 'revoked' })
      .eq('company_id', companyId)
      .eq('status', 'pending')
      .ilike('email', email)

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
