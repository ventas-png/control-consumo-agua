// Comunicación — Edge `whatsapp-save-credentials` (guardar credenciales de
// WhatsApp Cloud API por tenant). Espeja `payfac-save-credentials` pero contra
// la bóveda `company_whatsapp_configs` (deny-all bajo RLS).
//
// El #611 dejó el canal WhatsApp funcional pero inerte: el alta de credenciales
// era un INSERT manual por SQL editor (token en texto plano). Este edge es el
// writer que faltaba (auditoría 2026-07-16, S4/B3): con service_role hace el
// UPSERT por company_id CIFRANDO el access_token en reposo (secretsCrypto).
//
// SEGURIDAD: jamás se proyecta el access_token al cliente. verify_jwt=false en
// config.toml: validamos el token a mano (service_role O admin/owner JWT), con
// comparación en tiempo constante del secreto.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { timingSafeEqualSecret } from '../_shared/auth.ts'
import { enforceRateLimit } from '../_shared/rateLimit.ts'
import { encryptSecret } from '../_shared/secretsCrypto.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

interface ReqBody {
  company_id?: string
  /** Identificador del número emisor en Meta (no secreto; la UI lo muestra). */
  phone_number_id?: string
  /** Token de acceso de la app de Meta. Se CIFRA en reposo; nunca se devuelve. */
  access_token?: string
  /** Plantilla aprobada por defecto (opcional) y su locale. */
  template_default?: string | null
  template_lang?: string | null
  is_active?: boolean
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
    let callerUserId: string | null = null
    let internal = false

    if (token && (await timingSafeEqualSecret(token, SERVICE_ROLE_KEY))) {
      internal = true
    } else if (token) {
      const { data: { user }, error } = await admin.auth.getUser(token)
      if (error || !user) return json({ error: 'Unauthorized' }, 401)
      callerUserId = user.id
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
        return json({ error: 'Solo administradores pueden guardar credenciales de WhatsApp' }, 403)
      }
    } else {
      return json({ error: 'Unauthorized' }, 401)
    }

    // Rate limit por usuario (mismo criterio que el resto de escritura sensible).
    if (!internal && callerUserId) {
      const rl = await enforceRateLimit(admin, {
        subject: callerUserId,
        action: 'whatsapp_save_credentials',
        max: 20,
      }, corsHeaders)
      if (rl) return rl
    }

    const body = (await req.json().catch(() => ({}))) as ReqBody

    const companyId = body.company_id ?? callerCompanyId ?? null
    if (!companyId) return json({ error: 'Falta company_id' }, 400)

    // Autorización por tenant: admin/owner solo escribe en su propia empresa.
    if (!internal && !callerIsSuperAdmin && callerCompanyId !== companyId) {
      return json({ error: 'No autorizado para guardar credenciales de otro tenant' }, 403)
    }

    const phoneNumberId = (body.phone_number_id ?? '').trim()
    const accessToken = (body.access_token ?? '').trim()
    if (!phoneNumberId) return json({ error: 'Falta phone_number_id' }, 400)
    if (!accessToken) return json({ error: 'Falta access_token' }, 400)

    // ── Upsert por company_id (UNIQUE). Cifra el token en reposo (passthrough
    //    sin TENANT_SECRETS_ENC_KEY). Cambiar credenciales invalida el último
    //    "probar conexión". template_lang cae a 'es' si no se envía. ──
    const row: Record<string, unknown> = {
      company_id: companyId,
      provider: 'meta',
      phone_number_id: phoneNumberId,
      access_token: await encryptSecret(accessToken),
      template_default: body.template_default ?? null,
      template_lang: (body.template_lang ?? '').trim() || 'es',
      is_active: body.is_active ?? true,
      estado_conexion: 'desconocido',
      estado_mensaje: null,
      estado_probado_en: null,
      updated_at: new Date().toISOString(),
    }

    const { error: upErr } = await admin
      .from('company_whatsapp_configs')
      .upsert(row, { onConflict: 'company_id' })
    if (upErr) return json({ error: upErr.message }, 500)

    // Respuesta: SOLO metadata/flags. NUNCA el access_token.
    return json({
      ok: true,
      company_id: companyId,
      provider: 'meta',
      phone_number_id: phoneNumberId,
      tiene_token: true,
      estado_conexion: 'desconocido',
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500)
  }
})
