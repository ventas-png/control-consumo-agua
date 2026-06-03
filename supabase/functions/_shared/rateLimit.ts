// _shared/rateLimit.ts — rate-limiting server-side reutilizable para edge functions.
//
// **Por qué**: el rate-limit estaba solo client-side y/o inline en 2 funciones de billing
// (`rate_limit_check(user_id, ...)`), que solo limita por user_id. Esto centraliza el patrón
// sobre el RPC `rate_limit_hit(subject, ...)` (SECURITY DEFINER, service_role) para poder
// limitar también endpoints anónimos (signup/login/oauth) por IP, no solo por user_id.
//
// **Cuándo usar**:
//   - Anónimos: `subject: ` + `getClientIp(req)`  (ej. signup-company).
//   - Autenticados: `subject: <user.id>`            (ej. create-user).
//
// Nota: NO importa `@supabase/supabase-js` a nivel de módulo a propósito — usa un tipo
// estructural (`RpcClient`) para que el archivo sea importable tanto desde Deno (edge)
// como desde vitest (los tests corren en Node/jsdom).

/** Cliente mínimo: cualquier cosa con `.rpc()` (el admin client de supabase-js encaja). */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}

/**
 * Extrae la IP del cliente respetando la cadena de proxies. Mismo orden de precedencia
 * que `log-security-event`: Cloudflare → X-Forwarded-For (primer hop) → Fly → 'unknown'.
 */
export function getClientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip')
  if (cf) return cf
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0].trim()
    if (first) return first
  }
  const fly = req.headers.get('fly-client-ip')
  if (fly) return fly
  return 'unknown'
}

export interface RateLimitOptions {
  /** Sujeto del límite: `ip:<addr>` para anónimos, el user id para autenticados. */
  subject: string
  /** Etiqueta de la acción (namespace del contador), ej. 'signup_company'. */
  action: string
  /** Máximo de hits permitidos dentro de la ventana. */
  max: number
  /** Ventana en segundos (default 3600 = 1h). */
  windowSeconds?: number
  /** Mensaje 429 opcional (es-MX). */
  message?: string
}

/**
 * Aplica el límite vía el RPC `rate_limit_hit`. Devuelve un `Response` 429 si se excedió,
 * o `null` si se permite la solicitud.
 *
 * Fail-open: solo bloquea cuando el RPC devuelve `false` explícito. Si hay un error de
 * infraestructura (data null/undefined), permite la solicitud — mismo criterio que el
 * patrón inline previo, para no tumbar a usuarios legítimos si el contador falla.
 *
 * @example
 *   const rl = await enforceRateLimit(admin, { subject: `ip:${getClientIp(req)}`,
 *     action: 'signup_company', max: 5 }, corsHeaders)
 *   if (rl) return rl
 */
export async function enforceRateLimit(
  client: RpcClient,
  opts: RateLimitOptions,
  corsHeaders: HeadersInit,
): Promise<Response | null> {
  const windowSeconds = opts.windowSeconds ?? 3600
  const { data } = await client.rpc('rate_limit_hit', {
    p_subject: opts.subject,
    p_action: opts.action,
    p_max_count: opts.max,
    p_window: `${windowSeconds} seconds`,
  })
  if (data === false) {
    return new Response(
      JSON.stringify({ error: opts.message ?? 'Demasiadas solicitudes. Espera unos minutos e intenta de nuevo.' }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
  return null
}
