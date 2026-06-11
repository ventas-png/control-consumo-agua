// _shared/auth.ts — Helpers para validar JWT en edge functions.
//
// **Por qué**: las edge functions con `verify_jwt = false` en supabase/config.toml
// reciben el header `Authorization` crudo y deben validarlo manualmente.
// Antes cada función reimplementaba este patrón con leves variaciones,
// algunas saltándose validaciones o devolviendo distintos códigos de error.
//
// Estos helpers consolidan el patrón en una sola fuente de verdad: leer header,
// llamar `auth.getUser()` con un client temporal, devolver el user verificado o
// un Response 401.
//
// **Cuándo usar**:
// - `requireUser(req)` → endpoints que requieren cualquier usuario autenticado.
// - `requireRole(req, roles)` → endpoints que requieren un rol específico
//   (admin/owner/superadmin). Lee `app_users` para verificar.
// - `getUserOrNull(req)` → endpoints "opcional auth" (ej. log-security-event que
//   acepta eventos pre-auth con event_type whitelisted).

import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2'

export interface AuthResult {
  user: User
  /** Cliente Supabase autenticado con el JWT del usuario (respeta RLS). */
  client: SupabaseClient
}

export interface AuthError {
  response: Response
}

/**
 * Lee el JWT del header Authorization y lo valida via auth.getUser().
 *
 * Devuelve `{ user, client }` si el JWT es válido, o `null` si no hay header
 * o el JWT es inválido. NO lanza error — use `requireUser` si quiere fallar.
 */
export async function getUserOrNull(
  req: Request,
  corsHeaders: HeadersInit,
): Promise<AuthResult | null> {
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!authHeader) return null

  const client = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )
  void corsHeaders // unused but kept for consistency with requireUser signature
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return null
  return { user, client }
}

/**
 * Exige que el request lleve un JWT válido. Si falta o es inválido,
 * devuelve un Response 401 listo para retornar al cliente.
 *
 * @example
 * const auth = await requireUser(req, corsHeaders)
 * if ('response' in auth) return auth.response
 * const { user, client } = auth
 */
export async function requireUser(
  req: Request,
  corsHeaders: HeadersInit,
): Promise<AuthResult | AuthError> {
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!authHeader) {
    return {
      response: new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      ),
    }
  }

  const client = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) {
    return {
      response: new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      ),
    }
  }
  return { user, client }
}

/**
 * Exige que el JWT sea válido Y que el usuario tenga uno de los `roles`
 * permitidos en `app_users.role`. Devuelve 403 si el rol no matchea.
 *
 * Usa un admin client (service role) para leer `app_users` y bypassear RLS
 * — es necesario porque algunos roles solo pueden leerse a sí mismos.
 *
 * @example
 * const auth = await requireRole(req, corsHeaders, ['owner', 'admin', 'superadmin'])
 * if ('response' in auth) return auth.response
 * const { user, role } = auth
 */
export async function requireRole(
  req: Request,
  corsHeaders: HeadersInit,
  roles: string[],
): Promise<(AuthResult & { role: string }) | AuthError> {
  const base = await requireUser(req, corsHeaders)
  if ('response' in base) return base

  const adminClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )
  const { data: profile, error } = await adminClient
    .from('app_users')
    .select('role')
    .eq('id', base.user.id)
    .single()

  if (error || !profile) {
    return {
      response: new Response(
        JSON.stringify({ error: 'User profile not found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      ),
    }
  }

  if (!roles.includes(profile.role)) {
    return {
      response: new Response(
        JSON.stringify({ error: `Forbidden: requires role ${roles.join('|')}` }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      ),
    }
  }

  return { ...base, role: profile.role }
}

/**
 * Comparación en TIEMPO CONSTANTE de un token recibido contra un secreto
 * esperado (auditoría P2 #11: `token === SERVICE_ROLE_KEY` filtra por timing
 * cuántos caracteres iniciales coinciden). Se comparan los digests SHA-256
 * (longitud fija → tampoco se filtra la longitud del secreto) con XOR
 * acumulado sin cortocircuito.
 */
export async function timingSafeEqualSecret(recibido: string, esperado: string): Promise<boolean> {
  if (!recibido || !esperado) return false
  const enc = new TextEncoder()
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(recibido)),
    crypto.subtle.digest('SHA-256', enc.encode(esperado)),
  ])
  const va = new Uint8Array(a)
  const vb = new Uint8Array(b)
  let diff = 0
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i]
  return diff === 0
}
