// serv:S11 — Edge function `fiscal-test-connection` ("probar conexión" al PAC).
//
// Habilitación "selecciona y conecta": dado un tenant (y opcionalmente una
// LOCACIÓN), resuelve la CONFIG FISCAL EFECTIVA (override locación↔empresa),
// resuelve el FiscalProvider por esa config, hace un PING (vía SandboxProvider —
// SIN HTTP a ningún PAC real) y devuelve ok/fail + mensaje. Persiste el resultado
// (estado_conexion/mensaje/probado_en) en la bóveda fiscal_pac_secrets para que
// la UI muestre "conectado/sin conectar" sin leer jamás el secreto.
//
// Flujo:
//   1. CORS + auth: service_role (interno) o JWT de admin/owner del tenant.
//   2. Cargar config fiscal de la EMPRESA (companies) y, si se pasa project_id,
//      el override de la LOCACIÓN (projects) con admin client (service_role).
//   3. Resolver la config EFECTIVA + el provider; si el régimen es 'ninguno' →
//      respuesta clara (el tenant/locación no factura).
//   4. PING vía el provider (hoy Sandbox: consultarEstado deterministra). Sin
//      HTTP a PAC real. Mapea a ok/fail + mensaje.
//   5. Upsert del ESTATUS (NO el secreto) en fiscal_pac_secrets por
//      (company_id, project_id). Las credenciales NO se tocan aquí.
//
// SEGURIDAD: NUNCA devuelve ni registra `credenciales`. La tabla es deny-all bajo
// RLS; solo este edge (service_role) la escribe. verify_jwt=false en config.toml:
// validamos el token a mano (service_role O admin JWT), igual que timbrar-documento.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import {
  getFiscalProvider,
  resolverConfigFiscalEfectiva,
  regimenRealDeConfig,
  type ConfigFiscalEmpresa,
  type ConfigFiscalLocacion,
} from '../_shared/fiscal/index.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

// Columnas fiscales de cada nivel (evita traer payloads pesados / irrelevantes).
const COMPANY_COLS =
  'id,nombre,nombre_fiscal,nit,tax_id,rfc,regimen_fiscal,proveedor_timbrado,address_postal_code'
const PROJECT_COLS =
  'id,company_id,nombre,nombre_fiscal,nit,rfc,regimen_fiscal,proveedor_timbrado,establecimiento,lugar_expedicion,serie_fiscal'

interface CompanyRow {
  id: string
  nombre?: string | null
  nombre_fiscal?: string | null
  nit?: string | null
  tax_id?: string | null
  rfc?: string | null
  regimen_fiscal?: string | null
  proveedor_timbrado?: string | null
  address_postal_code?: string | null
}

interface ProjectRow {
  id: string
  company_id?: string | null
  nombre?: string | null
  nombre_fiscal?: string | null
  nit?: string | null
  rfc?: string | null
  regimen_fiscal?: string | null
  proveedor_timbrado?: string | null
  establecimiento?: string | null
  lugar_expedicion?: string | null
  serie_fiscal?: string | null
}

interface ReqBody {
  /** Tenant a probar. Opcional para admin/owner (se infiere de su JWT). */
  company_id?: string
  /** Locación a probar. NULL/ausente = nivel empresa. */
  project_id?: string | null
  /** Ambiente a reportar en el estatus ('sandbox' | 'prod'). Default 'sandbox'. */
  ambiente?: string
}

function empresaConfigDeRow(c: CompanyRow): ConfigFiscalEmpresa {
  return {
    regimenFiscal: (c.regimen_fiscal as ConfigFiscalEmpresa['regimenFiscal']) ?? null,
    nombre: c.nombre ?? null,
    nombreFiscal: c.nombre_fiscal ?? null,
    nit: c.nit ?? null,
    taxId: c.tax_id ?? null,
    rfc: c.rfc ?? null,
    proveedorTimbrado: c.proveedor_timbrado ?? null,
    codigoPostal: c.address_postal_code ?? null,
  }
}

function locacionConfigDeRow(p: ProjectRow): ConfigFiscalLocacion {
  return {
    regimenFiscal: (p.regimen_fiscal as ConfigFiscalLocacion['regimenFiscal']) ?? null,
    nombre: p.nombre ?? null,
    nombreFiscal: p.nombre_fiscal ?? null,
    nit: p.nit ?? null,
    rfc: p.rfc ?? null,
    proveedorTimbrado: p.proveedor_timbrado ?? null,
    establecimiento: p.establecimiento ?? null,
    lugarExpedicion: p.lugar_expedicion ?? null,
    serieFiscal: p.serie_fiscal ?? null,
  }
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
        return json({ error: 'Solo administradores pueden probar la conexión fiscal' }, 403)
      }
    } else {
      return json({ error: 'Unauthorized' }, 401)
    }

    const body = (await req.json().catch(() => ({}))) as ReqBody
    const projectId = body.project_id ?? null
    const ambiente = body.ambiente === 'prod' ? 'prod' : 'sandbox'

    // ── 1) Resolver el tenant a probar ──
    // Si viene project_id, el tenant lo dicta el proyecto (autoritativo). Si no,
    // se usa company_id del body o el del JWT del llamante.
    let project: ProjectRow | null = null
    if (projectId) {
      const { data: proj, error: projErr } = await admin
        .from('projects')
        .select(PROJECT_COLS)
        .eq('id', projectId)
        .maybeSingle()
      if (projErr) return json({ error: projErr.message }, 500)
      if (!proj) return json({ error: 'Locación (proyecto) no encontrada' }, 404)
      project = proj as ProjectRow
    }

    const companyId =
      (project?.company_id ?? null) ??
      body.company_id ??
      callerCompanyId ??
      null
    if (!companyId) return json({ error: 'Falta company_id' }, 400)

    // Autorización por tenant: admin/owner solo prueba su propia empresa.
    if (!internal && !callerIsSuperAdmin && callerCompanyId !== companyId) {
      return json({ error: 'No autorizado para probar la conexión de otro tenant' }, 403)
    }

    // ── 2) Cargar config fiscal de la EMPRESA ──
    const { data: company, error: compErr } = await admin
      .from('companies')
      .select(COMPANY_COLS)
      .eq('id', companyId)
      .maybeSingle()
    if (compErr) return json({ error: compErr.message }, 500)
    if (!company) return json({ error: 'Empresa no encontrada' }, 404)

    // ── 3) Resolver config EFECTIVA + provider ──
    const config = resolverConfigFiscalEfectiva(
      empresaConfigDeRow(company as CompanyRow),
      project ? locacionConfigDeRow(project) : null,
    )
    const regimen = regimenRealDeConfig(config)

    // Helper: persiste el estatus (NO el secreto) y arma la respuesta.
    const persistirYResponder = async (
      ok: boolean,
      mensaje: string,
      httpStatus: number,
    ) => {
      const estadoConexion = ok ? 'ok' : 'error'
      const ahora = new Date().toISOString()
      // Upsert por (company_id, project_id). NO toca `credenciales` (preserva lo
      // ya cargado): solo escribe proveedor + estatus del ping. Si la fila no
      // existe aún, se crea con credenciales por defecto (vacías).
      const { error: upErr } = await admin
        .from('fiscal_pac_secrets')
        .upsert(
          {
            company_id: companyId,
            project_id: projectId,
            proveedor: config.proveedorTimbrado,
            estado_conexion: estadoConexion,
            estado_mensaje: mensaje,
            estado_probado_en: ahora,
          },
          { onConflict: 'company_id,project_id' },
        )
      if (upErr) {
        // No bloquea el resultado del ping; lo reportamos como advertencia.
        return json(
          {
            ok,
            mensaje,
            proveedor: config.proveedorTimbrado,
            regimen: config.regimenFiscal,
            ambiente,
            desde_locacion: config.desdeLocacion,
            advertencia: `No se pudo guardar el estatus: ${upErr.message}`,
          },
          httpStatus,
        )
      }
      return json(
        {
          ok,
          mensaje,
          proveedor: config.proveedorTimbrado,
          regimen: config.regimenFiscal,
          ambiente,
          desde_locacion: config.desdeLocacion,
          estado_conexion: estadoConexion,
          probado_en: ahora,
        },
        httpStatus,
      )
    }

    // Régimen 'ninguno' → no hay PAC que probar; lo reportamos como fail claro.
    if (!regimen) {
      return await persistirYResponder(
        false,
        'La locación/empresa no tiene un régimen fiscal configurado (régimen "ninguno"). Configure FEL (GT) o CFDI (MX) y un proveedor antes de probar la conexión.',
        200,
      )
    }

    // ── 4) PING vía el provider (hoy Sandbox; SIN HTTP a PAC real) ──
    const provider = getFiscalProvider(regimen, {
      companyId,
      proveedor: config.proveedorTimbrado,
      regimen,
    })

    try {
      // consultarEstado con un UUID de prueba: el Sandbox responde ok; un provider
      // real haría un ping liviano (consulta de estatus / health). NO timbra nada.
      const ping = await provider.consultarEstado(`ping:${companyId}:${projectId ?? 'empresa'}`)
      if (ping.ok) {
        return await persistirYResponder(
          true,
          `Conexión OK con el proveedor "${provider.nombre}" (${ambiente}).`,
          200,
        )
      }
      return await persistirYResponder(
        false,
        ping.error ?? `El proveedor "${provider.nombre}" respondió un error.`,
        200,
      )
    } catch (e) {
      // Provider real sin credenciales (PacNoConfiguradoError) o fallo de red:
      // el ping es "fail" pero la request es válida → 200 con ok:false.
      const msg = e instanceof Error ? e.message : 'Error al probar la conexión con el PAC'
      return await persistirYResponder(false, msg, 200)
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500)
  }
})
