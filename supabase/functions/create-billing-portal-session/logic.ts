// Lógica pura de create-billing-portal-session, extraída del handler para
// poder testearla en aislamiento (infra:I22 · Track T8/T5, issue #321). Sin
// Deno ni supabase-js ni stripe → corre directo en vitest.
//
// NOTA: estas funciones son una copia local idéntica a las de
// create-checkout-session/logic.ts porque el código original ya duplicaba el
// bloque CORS/rol por función (las edge fns solo comparten vía _shared/, que
// está fuera del alcance de esta extracción mecánica). Se testean por separado
// porque son código separado: un drift entre copias es exactamente el bug que
// estos tests cazarían.

// Orígenes de producción siempre permitidos.
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://administratodo.com',
  'https://www.administratodo.com',
  'https://administratodo.app',
  'https://www.administratodo.app',
]

/**
 * Whitelist de orígenes CORS. `envOrigins` = ALLOWED_ORIGINS (CSV) y `appUrl` =
 * APP_URL, inyectados por el handler desde Deno.env. Sin ALLOWED_ORIGINS se
 * agregan los localhost de dev; APP_URL inválido se ignora silenciosamente.
 */
export function buildAllowedOrigins(
  envOrigins: string | null | undefined,
  appUrl: string | null | undefined,
): string[] {
  const origins = new Set<string>(DEFAULT_ALLOWED_ORIGINS)
  if (envOrigins) for (const o of envOrigins.split(',')) { const t = o.trim(); if (t) origins.add(t) }
  else {
    origins.add('http://localhost:5173')
    origins.add('http://localhost:3000')
  }
  if (appUrl) { try { origins.add(new URL(appUrl).origin) } catch { /* ignore */ } }
  return [...origins]
}

/**
 * Headers CORS: refleja el Origin SOLO si está en la whitelist; si no, cae al
 * primer origen permitido (nunca refleja un origen arbitrario).
 */
export function corsHeadersFor(origin: string | null, allowed: string[]) {
  return {
    'Access-Control-Allow-Origin': origin && allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

// Roles que pueden abrir el billing portal (cambiar plan, cancelar, tarjeta).
export const BILLING_MANAGER_ROLES = ['company_owner', 'admin']

/** `true` si `role` puede abrir el Stripe Billing Portal de su company. */
export function canManageBilling(role: string): boolean {
  return BILLING_MANAGER_ROLES.includes(role)
}
