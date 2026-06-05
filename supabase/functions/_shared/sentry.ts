// _shared/sentry.ts — Captura de errores de las edge functions hacia Sentry.
//
// **Por qué un cliente propio y no `@sentry/deno`**: el bundler de
// `supabase functions deploy` baja las dependencias remotas desde esm.sh, que
// devuelve 522 de forma intermitente (ver `.github/scripts/deploy-fn.sh`).
// Importar el SDK de Sentry añadiría otra dependencia remota pesada al bundle de
// CADA función y otra superficie para esos 522. En su lugar hablamos el
// protocolo de ingest de Sentry (envelope) a mano con `fetch` — cero
// dependencias, cero imports remotos.
//
// **Activación**: no-op silencioso si `SENTRY_DSN` no está en el entorno. Es un
// secreto de Edge Functions (Supabase → Settings → Edge Functions → Secrets),
// NO una variable `VITE_` (esas terminan en el bundle del browser). El valor es
// el MISMO DSN del proyecto que usa el frontend (el DSN es público por diseño),
// pero aquí se llama `SENTRY_DSN` (sin prefijo) para no confundirlo con el del
// cliente. Entorno/release opcionales vía `SENTRY_ENVIRONMENT` / `SENTRY_RELEASE`.
//
// **PII**: este helper NUNCA lee el body, headers, IP ni cookies del request.
// Solo envía lo que el caller le pasa explícitamente en `tags`/`extra` — así que
// el caller NO debe pasar secretos (tokens, credenciales del PAC/payfac, datos de
// tarjeta) ni PII de residentes. `company_id`/`project_id` (ids de tenant) sí son
// aceptables, igual que en el `setMonitoringUser` del frontend.

interface ParsedDsn {
  /** Public key (la parte antes de la `@`). */
  publicKey: string
  /** URL del endpoint de envelope, listo para POST. */
  envelopeUrl: string
}

/**
 * Parsea un DSN `https://<publicKey>@<host>/<projectId>` y construye la URL del
 * endpoint de envelope `https://<host>/api/<projectId>/envelope/`. Devuelve null
 * si el DSN es inválido o no está presente (→ el caller hace no-op).
 */
function parseDsn(dsn: string | undefined): ParsedDsn | null {
  if (!dsn) return null
  try {
    const url = new URL(dsn)
    const publicKey = url.username
    // El path es `/<projectId>` (puede venir con segmentos extra en self-hosted).
    const projectId = url.pathname.replace(/^\//, '').split('/').pop()
    if (!publicKey || !projectId) return null
    const host = url.host
    const proto = url.protocol || 'https:'
    return {
      publicKey,
      envelopeUrl: `${proto}//${host}/api/${projectId}/envelope/`,
    }
  } catch {
    return null
  }
}

interface SentryConfig {
  dsn: ParsedDsn | null
  environment: string
  release?: string
}

let cachedConfig: SentryConfig | null = null

// Lee el entorno de forma PEREZOSA y memoizada. Perezosa a propósito: importar
// este módulo no toca `Deno.env` en tiempo de carga, así que un test que importe
// sus helpers puros (parseDsn/parseStack) bajo vitest/Node no revienta con
// "Deno is not defined". El `globalThis.Deno?` extra evita el throw aunque algo
// llegue a llamar esto fuera de Deno.
function getConfig(): SentryConfig {
  if (cachedConfig) return cachedConfig
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env
  cachedConfig = {
    dsn: parseDsn(env?.get('SENTRY_DSN')),
    environment: env?.get('SENTRY_ENVIRONMENT') ?? 'production',
    release: env?.get('SENTRY_RELEASE') || undefined,
  }
  return cachedConfig
}

/** ¿Está la captura de Sentry activa en este entorno? */
export function sentryEnabled(): boolean {
  return getConfig().dsn !== null
}

/** Genera un event_id de 32 hex (formato que espera Sentry). */
function newEventId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface StackFrame {
  filename?: string
  function?: string
  lineno?: number
  colno?: number
}

/**
 * Parsea (best-effort) un stack trace estilo V8 (`at fn (file:line:col)`) a
 * frames de Sentry. Si una línea no matchea, se omite — el `value` del error
 * siempre va, así que nunca perdemos el dato principal. El orden de Sentry es
 * "más interno al final", así que invertimos.
 */
function parseStack(stack: string | undefined): StackFrame[] | undefined {
  if (!stack) return undefined
  const frames: StackFrame[] = []
  for (const line of stack.split('\n')) {
    const m = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/)
    if (!m) continue
    frames.push({
      function: m[1] || '<anonymous>',
      filename: m[2],
      lineno: Number(m[3]),
      colno: Number(m[4]),
    })
  }
  if (frames.length === 0) return undefined
  return frames.reverse()
}

export interface EdgeErrorContext {
  /** Nombre de la edge function (→ tag `function`, clave para `edge.error_rate`). */
  function?: string
  /** Nombre de la transacción/operación (ej. `webhook:invoice.paid`). */
  transaction?: string
  /** Tags adicionales (indexados/filtrables en Sentry). Solo valores no sensibles. */
  tags?: Record<string, string | undefined>
  /** Contexto extra para diagnóstico (no indexado). Nunca secretos ni PII. */
  extra?: Record<string, unknown>
  /** Severidad. Default 'error'. */
  level?: 'fatal' | 'error' | 'warning' | 'info'
}

/**
 * Reporta una excepción de una edge function a Sentry. Fire-and-forget seguro:
 *
 *   - No-op si `SENTRY_DSN` no está configurado.
 *   - NUNCA lanza (cualquier fallo de red se traga con un `console.error` corto).
 *   - Tiene timeout propio (2s) para no colgar el path de error.
 *
 * Se `await`-ea en el catch antes de responder porque el runtime de Supabase
 * puede reciclar el aislado al retornar el `Response`, matando fetches en vuelo.
 *
 * @returns el event_id si se envió, o null si fue no-op/falló.
 */
export async function captureEdgeException(
  error: unknown,
  context: EdgeErrorContext = {},
): Promise<string | null> {
  const cfg = getConfig()
  const dsn = cfg.dsn
  if (!dsn) return null

  try {
    const err = error instanceof Error ? error : new Error(String(error))
    const eventId = newEventId()
    const nowSeconds = Date.now() / 1000

    const tags: Record<string, string> = { runtime: 'deno' }
    if (context.function) tags.function = context.function
    for (const [k, v] of Object.entries(context.tags ?? {})) {
      if (v !== undefined) tags[k] = v
    }

    const event = {
      event_id: eventId,
      timestamp: nowSeconds,
      platform: 'javascript',
      level: context.level ?? 'error',
      logger: 'edge',
      environment: cfg.environment,
      ...(cfg.release ? { release: cfg.release } : {}),
      ...(context.transaction ? { transaction: context.transaction } : {}),
      server_name: context.function ?? 'edge-function',
      tags,
      ...(context.extra ? { extra: context.extra } : {}),
      exception: {
        values: [
          {
            type: err.name || 'Error',
            value: err.message,
            stacktrace: (() => {
              const frames = parseStack(err.stack)
              return frames ? { frames } : undefined
            })(),
          },
        ],
      },
    }

    // Envelope = header line + item header line + payload line, separados por \n.
    const envelope =
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }) +
      '\n' +
      JSON.stringify({ type: 'event' }) +
      '\n' +
      JSON.stringify(event)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2000)
    try {
      await fetch(dsn.envelopeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          // Auth por header (equivalente a `?sentry_key=`); `sentry_client`
          // identifica este cliente casero en el dashboard de Sentry.
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=edge-fetch/1.0`,
        },
        body: envelope,
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    return eventId
  } catch (e) {
    // El reporte de errores jamás debe romper la función. Log corto y seguimos.
    console.error('[sentry] no se pudo reportar la excepción:', e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Envuelve un handler de `Deno.serve` para capturar en Sentry CUALQUIER error no
 * atrapado y devolver un 500 genérico (sin filtrar el mensaje interno al cliente).
 * Útil para funciones nuevas; las que ya tienen su propio try/catch pueden
 * simplemente llamar `captureEdgeException(e, { function: '...' })` en el catch.
 *
 * @example
 *   Deno.serve(withSentry('mi-funcion', async (req) => { ... }))
 */
export function withSentry(
  functionName: string,
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req)
    } catch (e) {
      await captureEdgeException(e, { function: functionName })
      return new Response(
        JSON.stringify({ error: 'Error interno' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }
  }
}
