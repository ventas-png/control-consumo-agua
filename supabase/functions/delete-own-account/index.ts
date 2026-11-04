import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17.4.0?target=deno'
import { requireUser } from '../_shared/auth.ts'
import { getCorsHeaders, validateOrigin } from '../_shared/cors.ts'
import { enforceRateLimit, getClientIp } from '../_shared/rateLimit.ts'
// Lógica pura (cuerpo, compuertas, conteo del resto de la empresa, filas de auditoría) en ./validate.ts, testeada en vitest.
import {
  buildAccountDeletedSecurityLog,
  buildSelfDeletedAudit,
  checkSelfDeleteGate,
  contarOtrosActivos,
  isAuthUserGone,
  isBenignStripeCancelError,
  LIVE_SUBSCRIPTION_STATUSES,
  MSG_SIN_STRIPE,
  MSG_STRIPE_FALLO,
  parseSelfDeleteBody,
  SUSPENSION_REASON,
  type OtherUserRow,
  type OtrosActivos,
  type SelfProfile,
} from './validate.ts'

// ============================================================================
// delete-own-account — la persona autenticada elimina SU PROPIA cuenta.
// ============================================================================
// Exigido por App Store Review 5.1.1 (v) y por la política «Account deletion» de Google Play (docs/PUBLICACION_TIENDAS.md, bloqueante #1).
// El objetivo es SIEMPRE el llamador (su JWT): no hay user_id en el cuerpo. Orden:
//   1. Origen permitido, JWT válido, cuerpo válido ({ dry_run: true } o { confirm: 'ELIMINAR' }), límite de tasa por usuario.
//   2. Perfil del llamador con service_role (puede no existir: login huérfano). Si es propietario, el resto de personas activas de su empresa.
//   3. Compuertas (validate.ts): superadministrador 403; único propietario con equipo 409; único propietario solo → se suspende la empresa.
//   4. dry_run → se responde lo que PASARÍA, sin escribir nada. La UI lo usa para avisar antes de pedir la contraseña.
//   5. Si la empresa se suspende: primero se cancela su suscripción Stripe viva (sin clave de plataforma se aborta: nunca un cobro huérfano),
//      luego companies.activa=false (entra en el periodo de gracia de docs/PURGA_EMPRESA.md).
//   6. user_roles y el rol de ajustes ANTES del perfil (mismo orden y motivo que delete-user: el trigger de auditoría de user_roles necesita
//      la fila de app_users viva), después el perfil, después la identidad en auth.
//   7. Auditoría best-effort: permission_audit_log (user_deleted, self_service) y security_logs (account_deleted).

function json(body: unknown, status: number, corsHeaders: ReturnType<typeof getCorsHeaders>) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const originError = validateOrigin(origin, corsHeaders)
  if (originError) return originError

  try {
    const auth = await requireUser(req, corsHeaders)
    if ('response' in auth) return auth.response
    const { user: caller } = auth

    const body = parseSelfDeleteBody(await req.json().catch(() => null))
    if (!body.ok) return json({ error: body.error }, 400, corsHeaders)

    // Service-role client: lee el perfil saltándose RLS (un login sin fila en app_users también tiene que poder borrarse) y ejecuta el borrado.
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Límite por usuario (endpoint autenticado → fail-open, regla de _shared/rateLimit.ts). Frena a quien machaque el botón o a un script con
    // un token robado; el daño real lo acota el JWT: sólo puede borrarse a sí mismo.
    const rl = await enforceRateLimit(adminClient, { subject: caller.id, action: 'delete_own_account', max: 10 }, corsHeaders)
    if (rl) return rl

    const { data: profileRow, error: profileErr } = await adminClient
      .from('app_users')
      .select('id, role, company_id, full_name, cliente_id')
      .eq('id', caller.id)
      .maybeSingle()
    if (profileErr) {
      console.error('[delete-own-account] no se pudo leer el perfil:', profileErr.message)
      return json({ error: 'No se pudo leer tu perfil; no se eliminó nada. Intenta de nuevo.' }, 500, corsHeaders)
    }
    const profile = (profileRow as SelfProfile | null) ?? null

    let otros: OtrosActivos = { propietarios: 0, equipo: 0 }
    if (profile && profile.role === 'company_owner' && profile.company_id) {
      const { data: rows, error: rowsErr } = await adminClient
        .from('app_users')
        .select('id, role, activo')
        .eq('company_id', profile.company_id)
        .neq('id', caller.id)
        .eq('activo', true)
      if (rowsErr) {
        console.error('[delete-own-account] no se pudo leer el resto de la empresa:', rowsErr.message)
        return json({ error: 'No se pudo comprobar el resto de usuarios de tu empresa; no se eliminó nada. Intenta de nuevo.' }, 500, corsHeaders)
      }
      otros = contarOtrosActivos(((rows ?? []) as OtherUserRow[]), caller.id)
    }

    const gate = checkSelfDeleteGate({ profile, otros })
    if (!gate.ok) return json({ error: gate.error }, gate.status, corsHeaders)

    if (body.dryRun) {
      return json({ ok: true, dry_run: true, suspende_empresa: gate.suspenderEmpresa }, 200, corsHeaders)
    }

    // ── Único propietario y solo: la empresa se suspende (y su cobro recurrente se cancela antes) ──
    const companyId = gate.suspenderEmpresa && profile ? profile.company_id : null
    if (companyId) {
      const { data: liveSubs, error: subsErr } = await adminClient
        .from('subscriptions')
        .select('id, stripe_subscription_id, status')
        .eq('company_id', companyId)
        .in('status', LIVE_SUBSCRIPTION_STATUSES)
        .not('stripe_subscription_id', 'is', null)
      if (subsErr) {
        console.error('[delete-own-account] no se pudo leer la suscripción:', subsErr.message)
        return json({ error: 'No se pudo comprobar la suscripción de tu empresa; no se eliminó nada. Intenta de nuevo.' }, 500, corsHeaders)
      }
      const stripeSubIds = ((liveSubs ?? []) as { stripe_subscription_id: string | null }[])
        .map((s) => s.stripe_subscription_id)
        .filter((id): id is string => !!id)

      if (stripeSubIds.length > 0) {
        const stripeSecret = Deno.env.get('STRIPE_PLATFORM_SECRET_KEY') ?? ''
        if (!stripeSecret) return json({ error: MSG_SIN_STRIPE }, 503, corsHeaders)
        const stripe = new Stripe(stripeSecret, { apiVersion: '2024-12-18.acacia' })
        for (const subId of stripeSubIds) {
          try {
            await stripe.subscriptions.cancel(subId)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            if (!isBenignStripeCancelError(msg)) {
              console.error('[delete-own-account] Stripe no canceló la suscripción:', msg)
              return json({ error: MSG_STRIPE_FALLO }, 502, corsHeaders)
            }
          }
        }
      }

      const { error: suspErr } = await adminClient
        .from('companies')
        .update({ activa: false, suspended_at: new Date().toISOString(), suspended_reason: SUSPENSION_REASON })
        .eq('id', companyId)
      if (suspErr) {
        console.error('[delete-own-account] no se pudo suspender la empresa:', suspErr.message)
        return json({ error: 'No se pudo suspender tu empresa; tu cuenta no se eliminó. Intenta de nuevo.' }, 500, corsHeaders)
      }
    }

    // ── El perfil: roles y rol de ajustes primero (auditoría), después la fila ──
    if (profile) {
      const { error: rolesDelError } = await adminClient.from('user_roles').delete().eq('user_id', caller.id)
      if (rolesDelError) {
        return json({ error: 'No se pudieron eliminar tus roles: ' + rolesDelError.message }, 500, corsHeaders)
      }
      const { error: overrideDelError } = await adminClient.from('roles').delete().eq('user_override_for', caller.id)
      if (overrideDelError) {
        return json({ error: 'No se pudo eliminar tu rol de ajustes: ' + overrideDelError.message }, 500, corsHeaders)
      }
      const { error: profileDelError } = await adminClient.from('app_users').delete().eq('id', caller.id)
      if (profileDelError) {
        return json({ error: 'No se pudo eliminar tu perfil: ' + profileDelError.message }, 500, corsHeaders)
      }
    }

    // ── La identidad en auth (lo que de verdad impide volver a entrar) ──
    const { error: authDelError } = await adminClient.auth.admin.deleteUser(caller.id)
    if (authDelError && !isAuthUserGone(authDelError)) {
      return json({
        error: 'Tu perfil se eliminó, pero no se pudo eliminar el acceso. Vuelve a intentarlo. (' + authDelError.message + ')',
      }, 500, corsHeaders)
    }

    // ── Auditoría (best-effort) ──
    const empresaSuspendida = companyId !== null
    if (profile) {
      await adminClient.from('permission_audit_log').insert(buildSelfDeletedAudit(profile, empresaSuspendida))
    }
    await adminClient.from('security_logs').insert(buildAccountDeletedSecurityLog({
      userId: caller.id,
      profile,
      empresaSuspendida,
      ip: getClientIp(req),
      userAgent: req.headers.get('user-agent') ?? '',
    }))

    return json({ ok: true, empresa_suspendida: empresaSuspendida }, 200, corsHeaders)
  } catch (err) {
    console.error('delete-own-account error:', err)
    return json({ error: 'Internal server error' }, 500, corsHeaders)
  }
})
