// Cobros pluggable — Edge function `payfac-test-connection` ("probar conexión" al
// payfac). Espeja `fiscal-test-connection`.
//
// Dado un tenant (y opcionalmente una LOCACIÓN), resuelve la CONFIG DE PAGO
// EFECTIVA (override locación↔empresa), CARGA las credenciales del ambiente desde
// la bóveda (service_role), resuelve el PaymentProvider y hace un PING:
//   - sandbox          → siempre ok (cobro simulado).
//   - qpaypro (real)   → valida presencia de credenciales (x_login/x_api_key) SIN
//                        crear un cobro real ni generar ruido.
//   - visanet/paypal   → reporta "sin conectar" (stub).
// Persiste el resultado (estado_conexion/mensaje/probado_en) en payfac_secrets.
//
// SEGURIDAD: NUNCA devuelve ni registra `credenciales`. verify_jwt=false:
// validamos el token a mano (service_role O admin/owner JWT).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { timingSafeEqualSecret } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { decryptJson } from '../_shared/secretsCrypto.ts'
import {
  credencialesEfectivasDeAmbiente,
  getPaymentProvider,
  resolverConfigPagoEfectiva,
  type AmbientePago,
  type ConfigPagoEmpresa,
  type ConfigPagoLocacion,
} from '../_shared/payments/index.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

interface ReqBody {
  company_id?: string
  project_id?: string | null
  /** Ambiente a probar ('sandbox' | 'prod'). Default 'sandbox'. */
  ambiente?: string
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const token = (req.headers.get('authorization') ?? '').replace('Bearer ', '').trim()

    // ── Auth: service_role (interno) o JWT de admin/owner/super_admin ──
    let callerCompanyId: string | null = null
    let callerIsSuperAdmin = false
    let internal = false

    if (token && (await timingSafeEqualSecret(token, SERVICE_ROLE_KEY))) {
      internal = true
    } else if (token) {
      const { data: { user }, error } = await admin.auth.getUser(token)
      if (error || !user) return json({ error: 'Unauthorized' }, 401)
      const { data: au } = await admin
        .from('app_users')
        .select('company_id, role')
        .eq('id', user.id)
        .maybeSingle()
      if (!au) return json({ error: 'Forbidden' }, 403)
      const role = (au as { role?: string }).role
      if (role === 'super_admin') callerIsSuperAdmin = true
      else if (role === 'company_owner' || role === 'admin') {
        callerCompanyId = (au as { company_id?: string }).company_id ?? null
      } else {
        return json({ error: 'Solo administradores pueden probar la conexión del payfac' }, 403)
      }
    } else {
      return json({ error: 'Unauthorized' }, 401)
    }

    const body = (await req.json().catch(() => ({}))) as ReqBody
    const projectId = body.project_id ?? null
    const ambiente: AmbientePago = body.ambiente === 'prod' ? 'prod' : 'sandbox'

    // ── 1) Resolver el tenant ──
    let projectRow: { company_id?: string | null; proveedor_pago?: string | null } | null = null
    if (projectId) {
      const { data: proj, error: projErr } = await admin
        .from('projects')
        .select('id, company_id, proveedor_pago')
        .eq('id', projectId)
        .maybeSingle()
      if (projErr) return json({ error: projErr.message }, 500)
      if (!proj) return json({ error: 'Locación (proyecto) no encontrada' }, 404)
      projectRow = proj as typeof projectRow
    }

    const companyId = (projectRow?.company_id ?? null) ?? body.company_id ?? callerCompanyId ?? null
    if (!companyId) return json({ error: 'Falta company_id' }, 400)

    if (!internal && !callerIsSuperAdmin && callerCompanyId !== companyId) {
      return json({ error: 'No autorizado para probar la conexión de otro tenant' }, 403)
    }

    // ── 2) Cargar config de pago de la EMPRESA ──
    const { data: company, error: compErr } = await admin
      .from('companies')
      .select('id, proveedor_pago, default_currency')
      .eq('id', companyId)
      .maybeSingle()
    if (compErr) return json({ error: compErr.message }, 500)
    if (!company) return json({ error: 'Empresa no encontrada' }, 404)

    // ── 3) Resolver config EFECTIVA (override locación↔empresa) ──
    const empresaConfig: ConfigPagoEmpresa = {
      proveedorPago: (company as { proveedor_pago?: string | null }).proveedor_pago ?? null,
      monedaDefault: (company as { default_currency?: string | null }).default_currency ?? null,
    }
    const locacionConfig: ConfigPagoLocacion | null = projectRow
      ? { proveedorPago: projectRow.proveedor_pago ?? null }
      : null
    const config = resolverConfigPagoEfectiva(empresaConfig, locacionConfig)

    // ── 4) Cargar credenciales del ambiente desde la bóveda (NUNCA al cliente) ──
    // Herencia locación→empresa (espeja create-charge): probar una locación que
    // hereda el payfac usa las credenciales de la empresa (project_id NULL).
    let credLookup = admin
      .from('payfac_secrets')
      .select('project_id, credenciales')
      .eq('company_id', companyId)
    credLookup = projectId === null
      ? credLookup.is('project_id', null)
      : credLookup.or(`project_id.eq.${projectId},project_id.is.null`)
    const { data: secretRows } = await credLookup
    const filas = ((secretRows as { project_id: string | null; credenciales?: unknown }[] | null) ?? [])
    // P0 #7: descifrar los blobs jsonb en reposo (dual-read: objeto legacy pasa igual).
    const credenciales = credencialesEfectivasDeAmbiente(
      await decryptJson(filas.find((f) => f.project_id !== null)?.credenciales),
      await decryptJson(filas.find((f) => f.project_id === null)?.credenciales),
      ambiente,
    )

    // Helper: persiste el ESTATUS (NO el secreto) y arma la respuesta.
    const persistirYResponder = async (ok: boolean, mensaje: string) => {
      const estadoConexion = ok ? 'ok' : 'error'
      const ahora = new Date().toISOString()
      const { error: upErr } = await admin
        .from('payfac_secrets')
        .upsert(
          {
            company_id: companyId,
            project_id: projectId,
            proveedor: config.proveedorPago,
            estado_conexion: estadoConexion,
            estado_mensaje: mensaje,
            estado_probado_en: ahora,
          },
          { onConflict: 'company_id,project_id' },
        )
      const base = {
        ok,
        mensaje,
        proveedor: config.proveedorPago,
        moneda: config.moneda,
        ambiente,
        desde_locacion: config.desdeLocacion,
      }
      if (upErr) return json({ ...base, advertencia: `No se pudo guardar el estatus: ${upErr.message}` })
      return json({ ...base, estado_conexion: estadoConexion, probado_en: ahora })
    }

    // ── 5) PING vía el provider ──
    const provider = getPaymentProvider({
      companyId,
      proveedor: config.proveedorPago,
      ambiente,
      moneda: config.moneda,
      credenciales,
    })

    try {
      const ping = await provider.consultarEstado(`ping:${companyId}:${projectId ?? 'empresa'}`)
      if (ping.ok) {
        return await persistirYResponder(true, `Conexión OK con el payfac "${provider.nombre}" (${ambiente}).`)
      }
      return await persistirYResponder(false, ping.error ?? `El payfac "${provider.nombre}" respondió un error.`)
    } catch (e) {
      // Stub sin integrar (PayfacNoConfiguradoError) o fallo de red: ping "fail"
      // pero la request es válida → 200 con ok:false.
      const msg = e instanceof Error ? e.message : 'Error al probar la conexión con el payfac'
      return await persistirYResponder(false, msg)
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500)
  }
})
