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
  /**
   * Qué hacer si el RPC del contador FALLA (error de red/DB, respuesta nula).
   * No confundir con «el sujeto excedió el tope», que siempre bloquea.
   *
   *   · `false` (default) → fail-OPEN: se permite la solicitud. Correcto para
   *     endpoints autenticados, donde ya hubo un control de acceso antes y
   *     tumbar a usuarios legítimos por un fallo del contador es peor.
   *
   *   · `true` → fail-CLOSED: se responde 503. Para endpoints ANÓNIMOS, donde
   *     el rate limit ES el único control: si el contador cae, fail-open deja
   *     el endpoint completamente abierto a un atacante, y eso es exactamente
   *     lo que un atacante provocaría primero (auditoría 2026-07-28, PR-21).
   */
  failClosed?: boolean
}

/**
 * Aplica el límite vía el RPC `rate_limit_hit`. Devuelve un `Response` 429 si se excedió,
 * o `null` si se permite la solicitud.
 *
 * El 429 incluye `Retry-After` (segundos = `windowSeconds`): es el peor caso para que el
 * contador vuelva a admitir al sujeto (todas las filas de la ventana caen al desplazarse).
 * Da una pista honesta al cliente/UI y a los proxies, sin filtrar el conteo exacto.
 *
 * Ante un FALLO DEL CONTADOR (error del RPC o respuesta nula) el comportamiento lo decide
 * `failClosed`: por defecto permite la solicitud (fail-open, para no tumbar a usuarios
 * legítimos en endpoints ya autenticados), y con `failClosed: true` responde 503. En
 * cualquier caso el fallo AHORA SE REGISTRA — antes se tragaba en silencio, así que una
 * caída del RPC desactivaba todos los límites del repo sin dejar rastro.
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
  const { data, error } = await client.rpc('rate_limit_hit', {
    p_subject: opts.subject,
    p_action: opts.action,
    p_max_count: opts.max,
    p_window: `${windowSeconds} seconds`,
  })

  // El contador falló (no es que el sujeto se pasara del tope). Antes esto se
  // tragaba en silencio: `error` ni siquiera se desestructuraba, así que una
  // caída del RPC desactivaba TODOS los límites del repo sin dejar rastro.
  if (error || data == null) {
    console.error(
      `[rateLimit] contador no disponible (action=${opts.action}, failClosed=${opts.failClosed === true}):`,
      error ?? 'respuesta nula',
    )
    if (opts.failClosed) {
      return new Response(
        JSON.stringify({ error: 'Servicio temporalmente no disponible. Intenta de nuevo en unos minutos.' }),
        {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
        },
      )
    }
    return null
  }

  if (data === false) {
    return new Response(
      JSON.stringify({ error: opts.message ?? 'Demasiadas solicitudes. Espera unos minutos e intenta de nuevo.' }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Retry-After': String(windowSeconds),
        },
      },
    )
  }
  return null
}

/**
 * Aplica varios límites en secuencia y devuelve el primer 429 que se dispare (o `null` si
 * todos pasan). Útil para keyear un mismo endpoint por **varias dimensiones** —p. ej. IP
 * **y** email— de forma que ni una IP rotando emails ni un email rotando IPs evada el tope.
 *
 * Corto-circuita en el primer límite excedido: NO registra hits en los límites posteriores,
 * así un atacante no puede "quemar" el contador de email de una víctima saturando primero
 * el de IP (el de IP corta antes de tocar el de email).
 *
 * @example
 *   const rl = await enforceRateLimits(admin, [
 *     { subject: `ip:${ip}`,       action: 'create_cliente_account',       max: 10 },
 *     { subject: `email:${email}`, action: 'create_cliente_account:email', max: 5  },
 *   ], corsHeaders)
 *   if (rl) return rl
 */
export async function enforceRateLimits(
  client: RpcClient,
  limits: RateLimitOptions[],
  corsHeaders: HeadersInit,
): Promise<Response | null> {
  for (const opts of limits) {
    const res = await enforceRateLimit(client, opts, corsHeaders)
    if (res) return res
  }
  return null
}
