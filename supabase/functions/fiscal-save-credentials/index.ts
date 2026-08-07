// serv:S11 — Edge function `fiscal-save-credentials` (guardar credenciales del PAC).
//
// Habilitación "selecciona tu PAC y solo conecta" (parte 2): como la bóveda
// `fiscal_pac_secrets` es DENY-ALL bajo RLS (ni siquiera authenticated ve filas),
// el cliente NO escribe directo — invoca este edge, que con service_role hace el
// UPSERT del SECRETO por (company_id, project_id NULL=empresa). Espeja el patrón
// de auth/tenant de `fiscal-test-connection` y `save-payment-config`.
//
// Flujo:
//   1. CORS + auth a mano (verify_jwt=false): service_role (interno) o JWT de
//      admin/owner/super_admin del tenant. Autoriza por tenant.
//   2. Resolver el tenant: si viene project_id, el proyecto lo dicta (autoritativo
//      → se valida que exista y de qué empresa es); si no, company_id del body o
//      del JWT del llamante.
//   3. Upsert en fiscal_pac_secrets: MERGE de `credenciales` por ambiente
//      (sandbox/prod) para no pisar el ambiente que no se mandó, set `proveedor`
//      y `estado_conexion='desconocido'` (cambiar credenciales invalida el último
//      ping). NUNCA se devuelve el secreto: la respuesta solo confirma flags.
//
// SEGURIDAD: jamás se proyecta `credenciales` al cliente. La tabla es
// service-role-only; este edge es el ÚNICO escritor desde el front. verify_jwt=
// false en config.toml: validamos el token a mano, igual que timbrar-documento /
// fiscal-test-connection.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { timingSafeEqualSecret } from '../_shared/auth.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { encryptJson, decryptJson } from '../_shared/secretsCrypto.ts'
// Lógica pura (validación de payload, resolución de tenant, gate de
// autorización y MERGE por ambiente) extraída a ./validate.ts para testearla
// con vitest (infra:I22 · Track T8/T5). Aquí queda solo el I/O.
import {
  type CredencialesAmbiente,
  autorizadoParaTenant,
  esObjeto,
  mergeCredenciales,
  normalizarProveedor,
  resolverCompanyId,
  tieneCredenciales,
} from './validate.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

interface ReqBody {
  /** Tenant dueño de las credenciales. Opcional para admin/owner (se infiere del JWT). */
  company_id?: string
  /** Locación de las credenciales. NULL/ausente = nivel empresa (compartidas). */
  project_id?: string | null
  /** PAC/Certificador al que pertenecen estas credenciales (ej. 'infile', 'facturama'). */
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
        return json({ error: 'Solo administradores pueden guardar credenciales del PAC' }, 403)
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
    if (!autorizadoParaTenant({ internal, callerIsSuperAdmin, callerCompanyId }, companyId)) {
      return json({ error: 'No autorizado para guardar credenciales de otro tenant' }, 403)
    }

    // ── 2) Validar el cuerpo: al menos un ambiente con credenciales no vacías ──
    const sandbox = body.credenciales?.sandbox
    const prod = body.credenciales?.prod
    if (!tieneCredenciales(sandbox) && !tieneCredenciales(prod)) {
      return json(
        { error: 'Envía credenciales para al menos un ambiente (sandbox o prod).' },
        400,
      )
    }

    // Proveedor: snapshot informativo de a qué PAC pertenecen las credenciales.
    const proveedor = normalizarProveedor(body.proveedor)

    // ── 3) MERGE con lo ya guardado (preservar el ambiente no enviado) ──
    // Leemos SOLO `credenciales` con service_role para hacer el merge por
    // ambiente; jamás se devuelve al cliente. Si no hay fila aún, parte de {}.
    // El nivel empresa es project_id IS NULL (distinto de `= NULL` en SQL), así
    // que filtramos con .is() cuando projectId es null y con .eq() si no.
    let lookup = admin
      .from('fiscal_pac_secrets')
      .select('credenciales')
      .eq('company_id', companyId)
    lookup = projectId === null
      ? lookup.is('project_id', null)
      : lookup.eq('project_id', projectId)
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
      .from('fiscal_pac_secrets')
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
