// Cobros pluggable — Edge function `payfac-save-credentials` (guardar credenciales
// del payfac). Espeja EXACTO `fiscal-save-credentials` pero contra la bóveda
// `payfac_secrets`.
//
// Como `payfac_secrets` es DENY-ALL bajo RLS, el cliente NO escribe directo —
// invoca este edge, que con service_role hace el UPSERT del SECRETO por
// (company_id, project_id NULL=empresa), haciendo MERGE por ambiente
// (sandbox/prod) para no pisar el ambiente no enviado.
//
// SEGURIDAD: jamás se proyecta `credenciales` al cliente. verify_jwt=false en
// config.toml: validamos el token a mano (service_role O admin/owner JWT).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { timingSafeEqualSecret } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { encryptJson, decryptJson } from '../_shared/secretsCrypto.ts'
// Lógica pura (validación de ambientes, merge de credenciales, resolución de
// tenant y gate multi-tenant) extraída a ./validate.ts para poder testearla en
// vitest (infra:I22).
import {
  autorizadoParaTenant,
  esObjeto,
  mergeCredenciales,
  normalizarProveedor,
  resolverCompanyId,
  tieneCredenciales,
  type CredencialesAmbiente,
} from './validate.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

interface ReqBody {
  company_id?: string
  project_id?: string | null
  /** Payfac al que pertenecen estas credenciales (ej. 'qpaypro', 'visanet'). */
  proveedor?: string
  /** Credenciales por ambiente. Se hace MERGE: omitir un ambiente lo preserva. */
  credenciales?: {
    sandbox?: CredencialesAmbiente | null
    prod?: CredencialesAmbiente | null
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
        return json({ error: 'Solo administradores pueden guardar credenciales del payfac' }, 403)
      }
    } else {
      return json({ error: 'Unauthorized' }, 401)
    }

    const body = (await req.json().catch(() => ({}))) as ReqBody
    const projectId = body.project_id ?? null

    // ── 1) Resolver el tenant (project_id, si viene, es autoritativo) ──
    let projectCompanyId: string | null = null
    if (projectId) {
      const { data: proj, error: projErr } = await admin
        .from('projects')
        .select('id, company_id')
        .eq('id', projectId)
        .maybeSingle()
      if (projErr) return json({ error: projErr.message }, 500)
      if (!proj) return json({ error: 'Locación (proyecto) no encontrada' }, 404)
      projectCompanyId = (proj as { company_id?: string }).company_id ?? null
    }

    const companyId = resolverCompanyId(projectCompanyId, body.company_id, callerCompanyId)
    if (!companyId) return json({ error: 'Falta company_id' }, 400)

    // Autorización por tenant: admin/owner solo escribe en su propia empresa.
    if (!autorizadoParaTenant(internal, callerIsSuperAdmin, callerCompanyId, companyId)) {
      return json({ error: 'No autorizado para guardar credenciales de otro tenant' }, 403)
    }

    // ── 2) Validar el cuerpo: al menos un ambiente con credenciales no vacías ──
    const sandbox = body.credenciales?.sandbox
    const prod = body.credenciales?.prod
    const traeSandbox = tieneCredenciales(sandbox)
    const traeProd = tieneCredenciales(prod)
    if (!traeSandbox && !traeProd) {
      return json(
        { error: 'Envía credenciales para al menos un ambiente (sandbox o prod).' },
        400,
      )
    }

    const proveedor = normalizarProveedor(body.proveedor)

    // ── 3) MERGE con lo ya guardado (preservar el ambiente no enviado) ──
    let lookup = admin
      .from('payfac_secrets')
      .select('credenciales')
      .eq('company_id', companyId)
    lookup = projectId === null ? lookup.is('project_id', null) : lookup.eq('project_id', projectId)
    const { data: existente, error: readErr } = await lookup.maybeSingle()

    let credActuales: Record<string, unknown> = {}
    if (!readErr && existente) {
      // P0 #7: descifrar el blob existente para el merge (dual-read: objeto legacy pasa igual).
      const dec = await decryptJson((existente as { credenciales?: unknown }).credenciales)
      if (esObjeto(dec)) credActuales = dec as Record<string, unknown>
    }

    const nuevasCredenciales = mergeCredenciales(credActuales, sandbox, prod)

    // ── 4) Upsert (cambiar credenciales invalida el último "probar conexión") ──
    const { error: upErr } = await admin
      .from('payfac_secrets')
      .upsert(
        {
          company_id: companyId,
          project_id: projectId,
          proveedor,
          // P0 #7: cifrar el blob en reposo (passthrough sin llave → objeto igual).
          credenciales: await encryptJson(nuevasCredenciales),
          estado_conexion: 'desconocido',
          estado_mensaje: null,
          estado_probado_en: null,
        },
        { onConflict: 'company_id,project_id' },
      )
    if (upErr) return json({ error: upErr.message }, 500)

    // Respuesta: SOLO metadata/flags. NUNCA el secreto.
    return json({
      ok: true,
      company_id: companyId,
      project_id: projectId,
      proveedor,
      tiene_sandbox: 'sandbox' in nuevasCredenciales,
      tiene_prod: 'prod' in nuevasCredenciales,
      estado_conexion: 'desconocido',
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500)
  }
})
