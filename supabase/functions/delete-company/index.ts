import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17.4.0?target=deno'
import { requireUser } from '../_shared/auth.ts'
// Lógica pura (gates de confirmación/gracia, partición de usuarios, snapshot
// de auditoría) extraída a ./logic.ts para testearla en vitest (infra:I22).
import {
  buildPurgeAuditBefore,
  checkPurgeGates,
  isBenignStripeCancelError,
  isSuperAdminRole,
  partitionCompanyUsers,
  resolveGraceDays,
  type CompanyRow,
  type CompanyUser,
} from './logic.ts'

// ============================================================================
// delete-company — purga definitiva de una empresa (solo super_admin).
// ============================================================================
// La suspensión (companies.activa=false) es el mecanismo operativo normal; la
// purga es el último paso de un ciclo con guardas:
//   1. Solo super_admin (validado contra app_users con service role).
//   2. confirm_name debe coincidir EXACTO con companies.nombre.
//   3. La empresa debe llevar suspendida >= DELETE_COMPANY_GRACE_DAYS (90 por
//      defecto) — período de gracia para arrepentimiento/exportación.
//   4. Si hay suscripción Stripe viva se cancela ANTES de borrar (si la clave
//      de plataforma no está configurada, se aborta: jamás dejar un cobro
//      recurrente huérfano).
//   5. Se eliminan los usuarios de la empresa con el mismo orden probado de
//      delete-user (user_roles → rol de ajustes → app_users → auth).
//   6. Snapshot de auditoría en audit_log ANTES del DELETE (service role
//      bypassea RLS; la tabla no tiene policies de INSERT de cliente).
//   7. DELETE companies — las FK ON DELETE CASCADE limpian las tablas
//      dependientes (projects, unidades, pagos, condominios, billing…).
//   8. Limpieza best-effort del logo en storage (no aborta si falla).

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
    try { origins.add(new URL(appUrl).origin) } catch { /* ignore malformed APP_URL */ }
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

function jsonResponse(body: unknown, status: number, corsHeaders: ReturnType<typeof getCorsHeaders>) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const allowed = getAllowedOrigins()
  if (!origin || !allowed.includes(origin)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403, corsHeaders)
  }

  try {
    const auth = await requireUser(req, corsHeaders)
    if ('response' in auth) return auth.response
    const { user: caller } = auth

    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { data: callerProfile } = await adminClient
      .from('app_users')
      .select('role')
      .eq('id', caller.id)
      .single()
    const callerRole = (callerProfile as { role: string } | null)?.role ?? ''
    if (!isSuperAdminRole(callerRole)) {
      return jsonResponse({ error: 'Solo el superadministrador puede eliminar empresas' }, 403, corsHeaders)
    }

    const body = await req.json() as { company_id?: string; confirm_name?: string }
    const companyId = (body.company_id ?? '').trim()
    const confirmName = (body.confirm_name ?? '').trim()
    if (!companyId || !confirmName) {
      return jsonResponse({ error: 'Faltan company_id o confirm_name' }, 400, corsHeaders)
    }

    const { data: company, error: companyError } = await adminClient
      .from('companies')
      .select('id, nombre, activa, suspended_at, suspended_reason, logo_url, created_at')
      .eq('id', companyId)
      .single()
    if (companyError || !company) {
      return jsonResponse({ error: 'Empresa no encontrada' }, 404, corsHeaders)
    }
    const companyRow = company as CompanyRow

    const graceDays = resolveGraceDays(Deno.env.get('DELETE_COMPANY_GRACE_DAYS'))
    const gate = checkPurgeGates(companyRow, confirmName, graceDays)
    if (!gate.ok) {
      return jsonResponse({ error: gate.error }, gate.status, corsHeaders)
    }

    // ── Stripe: cancelar la suscripción viva antes de borrar la empresa ──
    const { data: liveSub } = await adminClient
      .from('subscriptions')
      .select('id, stripe_subscription_id, status')
      .eq('company_id', companyId)
      .in('status', ['trialing', 'active', 'past_due', 'incomplete'])
      .not('stripe_subscription_id', 'is', null)
      .maybeSingle()
    const stripeSubId = (liveSub as { stripe_subscription_id: string | null } | null)?.stripe_subscription_id ?? null
    if (stripeSubId) {
      const stripeSecret = Deno.env.get('STRIPE_PLATFORM_SECRET_KEY') ?? ''
      if (!stripeSecret) {
        return jsonResponse({
          error: 'La empresa tiene una suscripción Stripe activa pero STRIPE_PLATFORM_SECRET_KEY no está configurada. Cancela la suscripción manualmente antes de eliminar.',
        }, 503, corsHeaders)
      }
      const stripe = new Stripe(stripeSecret, { apiVersion: '2024-12-18.acacia' })
      try {
        await stripe.subscriptions.cancel(stripeSubId)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Ya cancelada/inexistente en Stripe → seguir; cualquier otro fallo aborta
        // para no dejar un cobro recurrente huérfano.
        if (!isBenignStripeCancelError(msg)) {
          return jsonResponse({ error: `No se pudo cancelar la suscripción en Stripe: ${msg}` }, 502, corsHeaders)
        }
      }
    }

    // ── Snapshot de conteos para auditoría ──
    const [{ count: projectCount }, { count: unitCount }, { count: userCount }] = await Promise.all([
      adminClient.from('projects').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      adminClient.from('unidades').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
      adminClient.from('app_users').select('id', { count: 'exact', head: true }).eq('company_id', companyId),
    ])

    // ── Usuarios de la empresa: mismo orden probado que delete-user ──
    const { data: companyUsers } = await adminClient
      .from('app_users')
      .select('id, role, full_name')
      .eq('company_id', companyId)
    const users = (companyUsers ?? []) as CompanyUser[]

    if (users.some(u => u.id === caller.id)) {
      return jsonResponse({ error: 'No puedes eliminar una empresa a la que pertenece tu propia cuenta' }, 400, corsHeaders)
    }
    // Un super_admin nunca debería colgar de una empresa; si ocurre, se le
    // desliga (company_id=null) en vez de eliminarlo junto con el tenant.
    const { superAdmins, deletables } = partitionCompanyUsers(users)
    for (const sa of superAdmins) {
      await adminClient.from('app_users').update({ company_id: null }).eq('id', sa.id)
    }

    for (const u of deletables) {
      const { error: rolesErr } = await adminClient.from('user_roles').delete().eq('user_id', u.id)
      if (rolesErr) {
        return jsonResponse({ error: `No se pudieron eliminar los roles del usuario ${u.id}: ${rolesErr.message}` }, 500, corsHeaders)
      }
      const { error: overrideErr } = await adminClient.from('roles').delete().eq('user_override_for', u.id)
      if (overrideErr) {
        return jsonResponse({ error: `No se pudo eliminar el rol de ajustes del usuario ${u.id}: ${overrideErr.message}` }, 500, corsHeaders)
      }
      const { error: profileErr } = await adminClient.from('app_users').delete().eq('id', u.id)
      if (profileErr) {
        return jsonResponse({ error: `No se pudo eliminar el perfil ${u.id}: ${profileErr.message}` }, 500, corsHeaders)
      }
      const { error: authErr } = await adminClient.auth.admin.deleteUser(u.id)
      if (authErr) {
        return jsonResponse({
          error: `Perfil ${u.id} eliminado pero no se pudo eliminar su acceso (${authErr.message}). Reintenta para completar la purga.`,
        }, 500, corsHeaders)
      }
    }

    // ── Auditoría ANTES del DELETE (el snapshot es lo único que sobrevive) ──
    await adminClient.from('audit_log').insert({
      table_name: 'companies',
      record_id: companyId,
      action: 'DELETE',
      actor_id: caller.id,
      company_id: companyId,
      before: buildPurgeAuditBefore(
        companyRow,
        { projects: projectCount, unidades: unitCount, usuarios: users.length },
        graceDays,
        stripeSubId,
      ),
    })

    // ── DELETE: las FK ON DELETE CASCADE limpian las tablas dependientes ──
    const { error: deleteErr } = await adminClient.from('companies').delete().eq('id', companyId)
    if (deleteErr) {
      return jsonResponse({ error: `No se pudo eliminar la empresa: ${deleteErr.message}` }, 500, corsHeaders)
    }

    // ── Storage best-effort: logo de la empresa ──
    if (companyRow.logo_url) {
      const { error: storageErr } = await adminClient.storage.from('company-logos').remove([companyRow.logo_url])
      if (storageErr) console.warn('[delete-company] no se pudo borrar el logo:', storageErr.message)
    }

    return jsonResponse({
      ok: true,
      deleted: {
        company_id: companyId,
        nombre: companyRow.nombre,
        usuarios: deletables.length,
        proyectos: projectCount ?? 0,
        unidades: unitCount ?? 0,
      },
    }, 200, corsHeaders)
  } catch (err) {
    console.error('delete-company error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders)
  }
})
