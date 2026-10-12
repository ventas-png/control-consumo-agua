import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17.4.0?target=deno'
import { requireUser } from '../_shared/auth.ts'
import { getCorsHeaders, isOriginAllowed } from '../_shared/cors.ts'
// Lógica pura (validación del cuerpo, gates de confirmación/gracia, traducción
// de errores de la RPC) extraída a ./logic.ts para testearla en vitest (infra:I22).
import {
  checkPurgeGates,
  isAuthUserGone,
  isBenignStripeCancelError,
  isSuperAdminRole,
  mapPurgeRpcError,
  parsePurgeBody,
  parsePurgeResult,
  PURGE_REHEARSAL_OK,
  resolveGraceDays,
  type CompanyRow,
} from './logic.ts'

// ============================================================================
// delete-company — purga definitiva de una empresa (solo super_admin).
// ============================================================================
// La suspensión (companies.activa=false) es el mecanismo operativo normal; la
// purga es el último paso de un ciclo con guardas:
//   1. Origen permitido y JWT válido de un super_admin (app_users, service role).
//   2. Cuerpo válido: objeto con company_id (UUID) y confirm_name (texto).
//   3. confirm_name coincide EXACTO con companies.nombre, la empresa está
//      suspendida y lleva >= DELETE_COMPANY_GRACE_DAYS (90 por defecto). Se
//      comprueba aquí, ANTES de tocar Stripe, y otra vez en la RPC.
//   4. Si hay suscripción Stripe viva: primero un ENSAYO de la purga
//      (`purgar_empresa(..., p_ensayo => true)`, que hace todo y lo revierte);
//      sólo si pasa se cancela en Stripe. Sin clave de plataforma se aborta:
//      jamás dejar un cobro recurrente huérfano.
//   5. `purgar_empresa`: TODAS las escrituras de base de datos en UNA
//      transacción (desligar superadministradores, borrar personas y cuentas
//      cliente exclusivas, auditoría, datos, DELETE de companies). Si algo
//      falla se revierte todo: nunca queda una empresa viva sin personas ni
//      una auditoría que mienta.
//   6. Sólo DESPUÉS del COMMIT, auth.admin.deleteUser para cada identidad que
//      devolvió la RPC. Las que fallen se informan en `auth_pendientes` (la
//      lista completa también queda en audit_log.before.usuarios_auth).
//   7. Limpieza best-effort del logo en storage (no aborta si falla).

function jsonResponse(body: unknown, status: number, corsHeaders: ReturnType<typeof getCorsHeaders>) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // `getAllowedOrigins` ya no existe aquí (6db61ad1 la llevó a _shared/cors.ts
  // sin exportarla): su llamada era un ReferenceError FUERA del try, y toda
  // petición acababa en 500 antes de cualquier compuerta. `isOriginAllowed`
  // acepta la misma lista que la copia inline anterior; además, sólo si el
  // proyecto define ALLOW_VERCEL_PREVIEW_ORIGINS=true (únicamente el sandbox),
  // los previews de Vercel de este proyecto.
  if (!origin || !isOriginAllowed(origin)) {
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

    const { data: callerProfile, error: callerErr } = await adminClient
      .from('app_users')
      .select('role, company_id')
      .eq('id', caller.id)
      .maybeSingle()
    if (callerErr) {
      console.error('[delete-company] no se pudo leer el perfil de quien llama:', callerErr.message)
      return jsonResponse({ error: 'No se pudo verificar el rol de quien llama' }, 500, corsHeaders)
    }
    const callerRow = callerProfile as { role: string; company_id: string | null } | null
    if (!callerRow || !isSuperAdminRole(callerRow.role)) {
      return jsonResponse({ error: 'Solo el superadministrador puede eliminar empresas' }, 403, corsHeaders)
    }

    const body = parsePurgeBody(await req.json().catch(() => null))
    if (!body.ok) return jsonResponse({ error: body.error }, 400, corsHeaders)
    const { companyId, confirmName } = body

    if (callerRow.company_id === companyId) {
      return jsonResponse({ error: 'No puedes eliminar una empresa a la que pertenece tu propia cuenta' }, 400, corsHeaders)
    }

    const { data: company, error: companyError } = await adminClient
      .from('companies')
      .select('id, nombre, activa, suspended_at, logo_url')
      .eq('id', companyId)
      .maybeSingle()
    if (companyError) {
      console.error('[delete-company] no se pudo leer la empresa:', companyError.message)
      return jsonResponse({ error: 'No se pudo leer la empresa' }, 500, corsHeaders)
    }
    if (!company) {
      return jsonResponse({ error: 'Empresa no encontrada' }, 404, corsHeaders)
    }
    const companyRow = company as CompanyRow

    const graceDays = resolveGraceDays(Deno.env.get('DELETE_COMPANY_GRACE_DAYS'))
    const gate = checkPurgeGates(companyRow, confirmName, graceDays)
    if (!gate.ok) {
      return jsonResponse({ error: gate.error }, gate.status, corsHeaders)
    }

    // ── Stripe: ¿hay suscripción viva? ──
    const { data: liveSubs, error: subsErr } = await adminClient
      .from('subscriptions')
      .select('id, stripe_subscription_id, status')
      .eq('company_id', companyId)
      .in('status', ['trialing', 'active', 'past_due', 'incomplete'])
      .not('stripe_subscription_id', 'is', null)
    if (subsErr) {
      // Sin saber si hay un cobro recurrente vivo no se purga: podría quedar huérfano.
      console.error('[delete-company] no se pudo leer la suscripción:', subsErr.message)
      return jsonResponse({ error: 'No se pudo leer la suscripción de la empresa; no se purgó nada' }, 500, corsHeaders)
    }
    const stripeSubIds = ((liveSubs ?? []) as { stripe_subscription_id: string | null }[])
      .map((s) => s.stripe_subscription_id)
      .filter((id): id is string => !!id)
    const stripeSubId = stripeSubIds[0] ?? null

    const rpcArgs = {
      p_company_id: companyId,
      p_actor_id: caller.id,
      p_confirm_name: confirmName,
      p_grace_days: graceDays,
      p_stripe_subscription_id: stripeSubId,
    }

    if (stripeSubIds.length > 0) {
      const stripeSecret = Deno.env.get('STRIPE_PLATFORM_SECRET_KEY') ?? ''
      if (!stripeSecret) {
        return jsonResponse({
          error: 'La empresa tiene una suscripción Stripe activa pero STRIPE_PLATFORM_SECRET_KEY no está configurada. Cancela la suscripción manualmente antes de eliminar.',
        }, 503, corsHeaders)
      }

      // Ensayo: si la purga no va a poder completarse, no se toca Stripe.
      const { error: ensayoErr } = await adminClient.rpc('purgar_empresa', { ...rpcArgs, p_ensayo: true })
      if (!ensayoErr || !(ensayoErr.message ?? '').startsWith(`${PURGE_REHEARSAL_OK}:`)) {
        if (!ensayoErr) {
          // Un ensayo que «confirma» es imposible: o la RPC desplegada no es la
          // esperada, o algo la cambió. No se sigue a ciegas.
          console.error('[delete-company] el ensayo de la purga no se revirtió')
          return jsonResponse({ error: 'El ensayo de la purga no respondió como se esperaba; no se purgó nada' }, 500, corsHeaders)
        }
        const mapped = mapPurgeRpcError(ensayoErr)
        console.error('[delete-company] el ensayo de la purga falló:', ensayoErr.code, ensayoErr.message)
        return jsonResponse({ error: mapped.error }, mapped.status, corsHeaders)
      }

      const stripe = new Stripe(stripeSecret, { apiVersion: '2024-12-18.acacia' })
      for (const subId of stripeSubIds) {
        try {
          await stripe.subscriptions.cancel(subId)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          // Ya cancelada/inexistente en Stripe → seguir; cualquier otro fallo aborta
          // para no dejar un cobro recurrente huérfano.
          if (!isBenignStripeCancelError(msg)) {
            return jsonResponse({ error: `No se pudo cancelar la suscripción en Stripe: ${msg}` }, 502, corsHeaders)
          }
        }
      }
    }

    // ── La purga: todo o nada, en una transacción ──
    const { data: purga, error: purgaErr } = await adminClient.rpc('purgar_empresa', rpcArgs)
    if (purgaErr) {
      const mapped = mapPurgeRpcError(purgaErr)
      console.error('[delete-company] la purga se revirtió:', purgaErr.code, purgaErr.message)
      return jsonResponse({ error: mapped.error }, mapped.status, corsHeaders)
    }
    const resultado = parsePurgeResult(purga)
    if (!resultado) {
      // La transacción YA confirmó: la empresa no existe. Lo que falta son las
      // identidades de auth, cuya lista quedó en audit_log.before.usuarios_auth.
      console.error('[delete-company] respuesta inesperada de purgar_empresa:', JSON.stringify(purga))
      return jsonResponse({
        error: 'La empresa se purgó, pero la respuesta no trae las cuentas a eliminar de auth. Su lista está en audit_log (before.usuarios_auth).',
      }, 500, corsHeaders)
    }

    // ── auth: sólo DESPUÉS del COMMIT ──
    // Desde aquí la purga ya confirmó: un fallo —devuelto o lanzado— no puede
    // acabar en el catch general como un 500 que diga que no pasó nada.
    const authPendientes: string[] = []
    for (const userId of resultado.usuarios_auth) {
      const authErr = await adminClient.auth.admin.deleteUser(userId).then(
        ({ error }) => error,
        (err: unknown) => ({ message: err instanceof Error ? err.message : String(err) }),
      )
      if (authErr && !isAuthUserGone(authErr)) {
        console.error(`[delete-company] no se pudo eliminar el acceso ${userId}:`, authErr.message)
        authPendientes.push(userId)
      }
    }

    // ── Storage best-effort: logo de la empresa ──
    if (resultado.logo_url) {
      try {
        const { error: storageErr } = await adminClient.storage.from('company-logos').remove([resultado.logo_url])
        if (storageErr) console.warn('[delete-company] no se pudo borrar el logo:', storageErr.message)
      } catch (err) {
        console.warn('[delete-company] no se pudo borrar el logo:', err)
      }
    }

    return jsonResponse({
      ok: true,
      deleted: {
        company_id: resultado.company_id,
        nombre: resultado.nombre,
        usuarios: resultado.personas,
        cuentas_cliente: resultado.cuentas_cliente,
        clientes: resultado.clientes,
        proyectos: resultado.proyectos,
        unidades: resultado.unidades,
        superadmins_desligados: resultado.superadmins_desligados,
      },
      auth_pendientes: authPendientes,
      ...(authPendientes.length > 0
        ? {
          aviso: `La empresa se purgó, pero ${authPendientes.length} acceso(s) no se pudieron eliminar de auth. ` +
            'Bórralos desde Authentication › Users en Supabase; sus IDs están en auth_pendientes y en audit_log.',
        }
        : {}),
    }, 200, corsHeaders)
  } catch (err) {
    console.error('delete-company error:', err)
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders)
  }
})
