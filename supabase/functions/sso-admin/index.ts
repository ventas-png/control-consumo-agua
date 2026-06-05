// plat:P10 — Edge function `sso-admin` (admin de SSO/SAML por tenant).
//
// Gestiona los DOMINIOS SSO y el PROVEEDOR SAML de UNA empresa. Espeja el patrón
// de auth/tenant de fiscal-save-credentials / payfac-save-credentials.
//
// PRINCIPIOS DE SEGURIDAD:
//   - company_id se DERIVA de la sesión (app_users del caller), NUNCA del input.
//   - Exige owner/admin (o super_admin con empresa). Otros roles → 403.
//   - Gestiona SOLO filas de ESA empresa (todas las queries .eq('company_id', …)).
//   - La verificación de propiedad del dominio es el GATE de `enforced` (lo
//     refuerza el CHECK de la tabla); el chequeo DNS/email real es follow-up.
//
// SINCRONIZACIÓN DEL PROVEEDOR (handshake parqueado):
//   En `save_metadata` intenta registrar/sincronizar el proveedor SAML vía la
//   GoTrue Admin SSO API. Si SSO NO está habilitado en el proyecto (plan Pro +
//   GOTRUE_SAML_ENABLED + clave de firma), responde "parqueado" con un mensaje
//   claro PERO igual persiste la metadata en company_sso_domains (no se pierde).
//
// verify_jwt=false en config.toml: validamos el token a mano (igual que las otras
// edge admin del repo). La lógica pura (validación/normalización/GoTrue body +
// clasificación de respuesta) vive en _shared/sso.ts (frontera Deno/Vite).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import {
  parseSsoAdminRequest,
  buildGoTrueProviderBody,
  classifyGoTrueResult,
  type SsoAdminAction,
} from '../_shared/sso.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const ADMIN_ROLES = ['company_owner', 'admin', 'super_admin', 'superadmin']

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
    if (!token) return json({ error: 'Unauthorized' }, 401)

    // ── Auth: JWT de owner/admin del tenant. company_id SIEMPRE de la sesión. ──
    const { data: { user }, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !user) return json({ error: 'Unauthorized' }, 401)

    const { data: au } = await admin
      .from('app_users')
      .select('company_id, role')
      .eq('id', user.id)
      .maybeSingle()
    if (!au) return json({ error: 'Forbidden' }, 403)

    const role = (au as { role?: string }).role ?? ''
    const companyId = (au as { company_id?: string }).company_id ?? null
    if (!ADMIN_ROLES.includes(role)) {
      return json({ error: 'Solo administradores pueden gestionar SSO' }, 403)
    }
    if (!companyId) {
      return json({ error: 'Tu usuario no está asociado a una empresa' }, 403)
    }

    // ── Validar el body (PURO; nunca acepta company_id del cliente) ──
    const raw = await req.json().catch(() => ({}))
    const parsed = parseSsoAdminRequest(raw)
    if ('error' in parsed) return json({ error: parsed.error }, 400)
    const reqAction: SsoAdminAction = parsed

    switch (reqAction.action) {
      // ── Asociar un dominio a la empresa ──
      case 'upsert_domain': {
        // Insert; si el dominio ya existe (UNIQUE global) y es de OTRA empresa,
        // el insert falla → mensaje claro (sin filtrar de quién es).
        const { data: existing } = await admin
          .from('company_sso_domains')
          .select('*')
          .eq('company_id', companyId)
          .eq('domain', reqAction.domain)
          .maybeSingle()
        if (existing) return json({ ok: true, domain: existing })

        const { data: inserted, error: insErr } = await admin
          .from('company_sso_domains')
          .insert({ company_id: companyId, domain: reqAction.domain })
          .select('*')
          .single()
        if (insErr) {
          if (insErr.code === '23505') {
            return json({ error: 'Ese dominio ya está registrado por otra empresa.' }, 409)
          }
          return json({ error: insErr.message }, 500)
        }
        return json({ ok: true, domain: inserted })
      }

      // ── Quitar un dominio (scoped a la empresa) ──
      case 'delete_domain': {
        const { error: delErr } = await admin
          .from('company_sso_domains')
          .delete()
          .eq('company_id', companyId)
          .eq('id', reqAction.id)
        if (delErr) return json({ error: delErr.message }, 500)
        return json({ ok: true })
      }

      // ── Toggle enforce (el CHECK de la tabla bloquea enforce sin verified) ──
      case 'set_enforced': {
        const { data: updated, error: updErr } = await admin
          .from('company_sso_domains')
          .update({ enforced: reqAction.enforced })
          .eq('company_id', companyId)
          .eq('id', reqAction.id)
          .select('*')
          .maybeSingle()
        if (updErr) {
          // 23514 = check_violation (enforced sin verified): mensaje claro.
          if (updErr.code === '23514') {
            return json(
              { error: 'No puedes forzar SSO en un dominio sin verificar su propiedad.' },
              409,
            )
          }
          return json({ error: updErr.message }, 500)
        }
        if (!updated) return json({ error: 'Dominio no encontrado' }, 404)
        return json({ ok: true, domain: updated })
      }

      // ── Iniciar verificación: devuelve token + instrucciones (DNS check parqueado) ──
      case 'start_verification': {
        const { data: row, error: rowErr } = await admin
          .from('company_sso_domains')
          .select('*')
          .eq('company_id', companyId)
          .eq('id', reqAction.id)
          .maybeSingle()
        if (rowErr) return json({ error: rowErr.message }, 500)
        if (!row) return json({ error: 'Dominio no encontrado' }, 404)
        const r = row as { domain: string; verification_token: string; verified: boolean }
        return json({
          ok: true,
          domain: row,
          verification: {
            method: 'dns_txt',
            record_name: `_admtdo-sso.${r.domain}`,
            record_value: r.verification_token,
            verified: r.verified,
            // El chequeo DNS/email automático es follow-up (handshake parqueado):
            // por ahora la verificación se confirma manualmente en un próximo PR.
            note: 'Crea el registro TXT indicado. La verificación automática se habilitará en un follow-up; hasta entonces el dominio no puede forzar SSO (gate anti-secuestro).',
          },
        })
      }

      // ── Guardar metadata IdP + intentar sincronizar proveedor en GoTrue ──
      case 'save_metadata': {
        const { data: row, error: rowErr } = await admin
          .from('company_sso_domains')
          .select('*')
          .eq('company_id', companyId)
          .eq('id', reqAction.id)
          .maybeSingle()
        if (rowErr) return json({ error: rowErr.message }, 500)
        if (!row) return json({ error: 'Dominio no encontrado' }, 404)
        const domain = (row as { domain: string }).domain

        // 1) Persistir SIEMPRE la metadata (aunque SSO esté parqueado).
        const { error: mdErr } = await admin
          .from('company_sso_domains')
          .update({ idp_metadata: reqAction.metadata })
          .eq('company_id', companyId)
          .eq('id', reqAction.id)
        if (mdErr) return json({ error: mdErr.message }, 500)

        // 2) Intentar registrar/sincronizar el proveedor SAML en GoTrue.
        const body = buildGoTrueProviderBody(reqAction.metadata, [domain])
        let result
        try {
          const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/sso/providers`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: SERVICE_ROLE_KEY,
              Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify(body),
          })
          const respBody = await resp.json().catch(() => null)
          result = classifyGoTrueResult(resp.status, respBody)
        } catch (e) {
          // Fallo de red/exception → no romper: queda persistido, proveedor parqueado.
          result = {
            status: 'sso_disabled' as const,
            message:
              'No se pudo contactar GoTrue SSO — configuración persistida; registro de proveedor parqueado (plat:P10).' +
              (e instanceof Error ? ` (${e.message})` : ''),
          }
        }

        // 3) Si se registró, guardar el provider id. Si parqueado/error, dejar null.
        if (result.status === 'ok' && result.providerId) {
          await admin
            .from('company_sso_domains')
            .update({ sso_provider_id: result.providerId })
            .eq('company_id', companyId)
            .eq('id', reqAction.id)
        }

        return json({
          ok: result.status !== 'error',
          parked: result.status === 'sso_disabled',
          provider_id: result.status === 'ok' ? result.providerId ?? null : null,
          message: result.message,
        })
      }
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Error interno' }, 500)
  }
})
