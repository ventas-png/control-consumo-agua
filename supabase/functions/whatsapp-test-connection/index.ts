// Comunicación — Edge `whatsapp-test-connection` ("probar conexión" de la config
// de WhatsApp del tenant). Espeja `payfac-test-connection` pero contra la bóveda
// `company_whatsapp_configs`.
//
// Dado un tenant, carga su config (service_role), DESCIFRA el access_token y hace
// un PING no destructivo a Meta Graph API: GET del phone_number_id
// (fields=verified_name,quality_rating). 200 → ok; 401/403 → token/permiso
// inválido; otro → error. NO envía ningún mensaje. Persiste el resultado
// (estado_conexion/mensaje/probado_en) en la bóveda.
//
// SEGURIDAD: NUNCA devuelve ni registra el access_token. verify_jwt=false:
// validamos el token a mano (service_role O admin/owner JWT), con comparación
// en tiempo constante del secreto.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { timingSafeEqualSecret } from '../_shared/auth.ts'
import { decryptSecret } from '../_shared/secretsCrypto.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const META_GRAPH_VERSION = 'v19.0'

interface ReqBody {
  company_id?: string
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
        return json({ error: 'Solo administradores pueden probar la conexión de WhatsApp' }, 403)
      }
    } else {
      return json({ error: 'Unauthorized' }, 401)
    }

    const body = (await req.json().catch(() => ({}))) as ReqBody
    const companyId = body.company_id ?? callerCompanyId ?? null
    if (!companyId) return json({ error: 'Falta company_id' }, 400)

    if (!internal && !callerIsSuperAdmin && callerCompanyId !== companyId) {
      return json({ error: 'No autorizado para probar la conexión de otro tenant' }, 403)
    }

    // ── Cargar la config del tenant (service_role: la tabla es deny-all) ──
    const { data: cfgRow, error: cfgErr } = await admin
      .from('company_whatsapp_configs')
      .select('id, phone_number_id, access_token, is_active')
      .eq('company_id', companyId)
      .maybeSingle()
    if (cfgErr) return json({ error: cfgErr.message }, 500)
    const cfg = cfgRow as { id: string; phone_number_id: string; access_token: string; is_active: boolean } | null
    if (!cfg) return json({ error: 'La empresa no tiene WhatsApp configurado.' }, 404)

    const accessToken = (await decryptSecret(cfg.access_token)) ?? ''
    if (!cfg.phone_number_id || !accessToken) {
      return await persistir(admin, companyId, 'error', 'Faltan phone_number_id o access_token.', json)
    }

    // ── PING no destructivo: GET del phone number en Graph API ──
    let estado: 'ok' | 'error' = 'error'
    let mensaje = ''
    try {
      const res = await fetch(
        `https://graph.facebook.com/${META_GRAPH_VERSION}/${cfg.phone_number_id}?fields=verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      )
      if (res.ok) {
        const data = await res.json().catch(() => ({})) as { verified_name?: string }
        estado = 'ok'
        mensaje = data.verified_name ? `Conectado como "${data.verified_name}".` : 'Conexión válida.'
      } else {
        const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
        const detalle = err.error?.message ?? `HTTP ${res.status}`
        mensaje = res.status === 401 || res.status === 403
          ? `Token o permisos inválidos: ${detalle}`
          : `Meta Graph API respondió ${res.status}: ${detalle}`
      }
    } catch (e) {
      mensaje = `No se pudo contactar a Meta: ${e instanceof Error ? e.message : 'error de red'}`
    }

    return await persistir(admin, companyId, estado, mensaje, json)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500)
  }
})

/** Persiste el resultado del ping en la bóveda y responde SOLO metadata. */
async function persistir(
  admin: ReturnType<typeof createClient>,
  companyId: string,
  estado: 'ok' | 'error',
  mensaje: string,
  json: (body: unknown, status?: number) => Response,
): Promise<Response> {
  await admin
    .from('company_whatsapp_configs')
    .update({
      estado_conexion: estado,
      estado_mensaje: mensaje,
      estado_probado_en: new Date().toISOString(),
    })
    .eq('company_id', companyId)
  return json({ ok: estado === 'ok', estado_conexion: estado, estado_mensaje: mensaje })
}
