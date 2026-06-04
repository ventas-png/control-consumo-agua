// serv:S11 — Edge function `timbrar-documento` (ESQUELETO, provider-agnostic).
//
// Flujo:
//   1. CORS + auth: service_role (interno/cron) o JWT de admin/owner del tenant.
//   2. Cargar la Factura (registro) + config fiscal del emisor (companies) y del
//      receptor (clientes) con admin client (service_role; bypassa RLS).
//   3. Armar el DTE CANÓNICO (provider-agnostic) y validarlo (NIT/RFC, totales).
//   4. Resolver el FiscalProvider por la config del tenant (hoy → Sandbox).
//   5. Crear el documento en estado 'por_timbrar', llamar al provider, y según el
//      resultado aplicar la transición (timbrar/rechazar) y persistir en
//      `documentos_fiscales`.
//
// NO hace HTTP a ningún PAC real: getFiscalProvider devuelve SandboxProvider por
// defecto. Integrar un certificador real es follow-up (credenciales en Vault).
//
// verify_jwt = false en config.toml: validamos el token a mano (igual que
// route-reminders / invite-user), aceptando service_role O un admin JWT.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import {
  getFiscalProvider,
  aplicarTransicionFiscal,
  validarDteParaTimbrar,
} from '../_shared/fiscal/index.ts'
import {
  armarDteDesdeFilas,
  type ClienteRow,
  type CompanyRow,
  type RegistroRow,
} from './buildDte.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Columnas a proyectar (evita traer payloads pesados / columnas irrelevantes).
const COMPANY_COLS =
  'id,nombre,nombre_fiscal,nit,tax_id,rfc,regimen_fiscal,proveedor_timbrado,address_line1,address_city,address_state,address_postal_code,country,iva_tasa_default'
const CLIENTE_COLS = 'id,nombre,nombre_fiscal,nit,rfc,uso_cfdi'
const REGISTRO_COLS =
  'id,cliente_id,cliente_nombre,project_id,mes,monto_calculado,iva_tasa,iva_monto,monto_con_iva,total_a_pagar'

interface ReqBody {
  registro_id?: string
  /** Tipo de comprobante (default 'factura'). Reservado para follow-up. */
  tipo?: string
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

    if (token && token === SERVICE_ROLE_KEY) {
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
        return json({ error: 'Solo administradores pueden timbrar comprobantes' }, 403)
      }
    } else {
      return json({ error: 'Unauthorized' }, 401)
    }

    const body = (await req.json().catch(() => ({}))) as ReqBody
    if (!body.registro_id) return json({ error: 'Falta registro_id' }, 400)

    // ── 1) Cargar la Factura (registro) ──
    const { data: registro, error: regErr } = await admin
      .from('registros')
      .select(REGISTRO_COLS)
      .eq('id', body.registro_id)
      .maybeSingle()
    if (regErr) return json({ error: regErr.message }, 500)
    if (!registro) return json({ error: 'Factura (registro) no encontrada' }, 404)

    // El tenant del registro se resuelve por su proyecto (registros no tiene
    // company_id directo): project_id → projects.company_id.
    const projectId = (registro as { project_id?: string }).project_id
    if (!projectId) return json({ error: 'La factura no tiene proyecto asociado' }, 400)
    const { data: project } = await admin
      .from('projects')
      .select('company_id')
      .eq('id', projectId)
      .maybeSingle()
    const companyId = (project as { company_id?: string } | null)?.company_id
    if (!companyId) return json({ error: 'No se pudo resolver el tenant de la factura' }, 400)

    // Autorización por tenant: un admin/owner solo timbra facturas de su company.
    if (!internal && !callerIsSuperAdmin && callerCompanyId !== companyId) {
      return json({ error: 'No autorizado para timbrar facturas de otro tenant' }, 403)
    }

    // ── 2) Cargar config fiscal del emisor (companies) y receptor (clientes) ──
    const { data: company, error: compErr } = await admin
      .from('companies')
      .select(COMPANY_COLS)
      .eq('id', companyId)
      .maybeSingle()
    if (compErr) return json({ error: compErr.message }, 500)
    if (!company) return json({ error: 'Empresa no encontrada' }, 404)

    let cliente: ClienteRow | null = null
    const clienteId = (registro as { cliente_id?: string }).cliente_id
    if (clienteId) {
      const { data: cli } = await admin
        .from('clientes')
        .select(CLIENTE_COLS)
        .eq('id', clienteId)
        .maybeSingle()
      cliente = (cli as ClienteRow | null) ?? null
    }

    // ── 3) Armar el DTE canónico y validarlo ──
    let dte
    let regimen
    try {
      const armado = armarDteDesdeFilas({
        company: company as CompanyRow,
        cliente,
        registro: registro as RegistroRow,
      })
      dte = armado.dte
      regimen = armado.regimen
    } catch (e) {
      // Régimen no configurado, etc. → 400 con el mensaje del builder.
      return json({ error: e instanceof Error ? e.message : 'No se pudo armar el DTE' }, 400)
    }

    const problemas = validarDteParaTimbrar(dte)
    if (problemas.length > 0) {
      return json({ error: 'DTE inválido', detalles: problemas }, 422)
    }

    // ── 4) Resolver el provider por la config del tenant (hoy → Sandbox) ──
    const proveedor = (company as CompanyRow).proveedor_timbrado ?? 'sandbox'
    const provider = getFiscalProvider(regimen, { companyId, proveedor, regimen })

    // ── 5) Crear el documento en 'por_timbrar', timbrar y persistir resultado ──
    const { data: doc, error: insErr } = await admin
      .from('documentos_fiscales')
      .insert({
        company_id: companyId,
        registro_id: dte.registroId,
        regimen,
        tipo: body.tipo ?? 'factura',
        estado: 'por_timbrar',
        proveedor: provider.nombre,
        request_payload: dte,
      })
      .select('id, estado')
      .single()
    if (insErr) return json({ error: insErr.message }, 500)

    const docId = (doc as { id: string }).id

    // Llamar al provider. Un error de infraestructura (PAC no configurado, red)
    // lo capturamos y dejamos el documento como 'rechazado' con el mensaje.
    let resultado
    try {
      resultado = await provider.timbrar(dte)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Error al timbrar'
      const parche = aplicarTransicionFiscal('por_timbrar', 'rechazar', new Date().toISOString(), msg)
      await admin.from('documentos_fiscales').update(parche).eq('id', docId)
      return json({ error: msg, documento_id: docId, estado: 'rechazado' }, 502)
    }

    const ahora = new Date().toISOString()
    if (resultado.ok) {
      const parche = aplicarTransicionFiscal('por_timbrar', 'timbrar', ahora)
      const { error: updErr } = await admin
        .from('documentos_fiscales')
        .update({
          ...parche,
          uuid_fiscal: resultado.uuidFiscal ?? null,
          serie: resultado.serie ?? null,
          numero: resultado.numero ?? null,
          numero_autorizacion: resultado.numeroAutorizacion ?? null,
          fecha_certificacion: resultado.fechaCertificacion ?? parche.fecha_certificacion ?? ahora,
          response_payload: resultado.raw ?? null,
        })
        .eq('id', docId)
      if (updErr) return json({ error: updErr.message, documento_id: docId }, 500)
      return json({
        ok: true,
        documento_id: docId,
        estado: 'timbrado',
        uuid_fiscal: resultado.uuidFiscal,
        serie: resultado.serie,
        numero: resultado.numero,
        proveedor: provider.nombre,
      })
    }

    // Rechazo de negocio del provider (ok:false).
    const parche = aplicarTransicionFiscal('por_timbrar', 'rechazar', ahora, resultado.error ?? undefined)
    await admin
      .from('documentos_fiscales')
      .update({ ...parche, response_payload: resultado.raw ?? null })
      .eq('id', docId)
    return json({ ok: false, documento_id: docId, estado: 'rechazado', error: resultado.error }, 422)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500)
  }
})
