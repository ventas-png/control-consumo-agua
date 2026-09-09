/**
 * CORS utilities for Edge Functions
 * Restricts CORS to allowed origins for improved security
 */

// Get allowed origins from environment or use defaults
function getAllowedOrigins(): string[] {
  // Production domains are always allowed (independent of the ALLOWED_ORIGINS secret).
  const origins = new Set<string>([
    'https://administratodo.com',
    'https://www.administratodo.com',
    'https://administratodo.app',
    'https://www.administratodo.app',
  ])

  const envOrigins = Deno.env.get('ALLOWED_ORIGINS')
  if (envOrigins) {
    for (const origin of envOrigins.split(',')) {
      const trimmed = origin.trim()
      if (trimmed) origins.add(trimmed)
    }
  } else {
    // Default: localhost for development
    origins.add('http://localhost:5173')
    origins.add('http://localhost:3000')
    origins.add('http://127.0.0.1:5173')
    origins.add('http://127.0.0.1:3000')
  }

  // Always allow the configured public app URL so production CORS works even
  // when ALLOWED_ORIGINS is unset (APP_URL is already set for Google OAuth).
  const appUrl = Deno.env.get('APP_URL')
  if (appUrl) {
    try { origins.add(new URL(appUrl).origin) } catch { /* ignore malformed APP_URL */ }
  }

  return [...origins]
}

// ════════════════════════════════════════════════════════════════════════════
// Previews de Vercel de ESTE proyecto
// ════════════════════════════════════════════════════════════════════════════
// EL PROBLEMA. Vercel crea un host NUEVO por despliegue de preview, así que
// ninguna lista fija puede contenerlos: cada rama, y cada push a esa rama,
// estrena origen. Sin esto, toda edge function responde 403 «Origin not
// allowed» a la aplicación desplegada en un preview — y ese 403 es
// indistinguible de un bug de la app, que es como se pierde media tarde.
//
// LA FORMA DEL HOST la fija Vercel: <proyecto>-<hash|rama>-<equipo>.vercel.app.
// Para este proyecto y este equipo, eso es
//   control-consumo-agua-<lo que Vercel ponga>-prestadora-de-servicios-projects.vercel.app
//
// CON UNA TRAMPA: Vercel TRUNCA el nombre del proyecto cuando el host completo
// no cabe en los 63 caracteres de una etiqueta DNS, y el alias de rama —el
// enlace «Preview» que publica su bot en cada PR, el que abre un humano— pierde
// la última letra:
//   control-consumo-agu-git-c1a22a-prestadora-de-servicios-projects.vercel.app
// mientras que la URL canónica del despliegue conserva el nombre entero:
//   control-consumo-agua-4lt4l03ik-prestadora-de-servicios-projects.vercel.app
// Las dos son reales y las dos sirven la misma aplicación, así que el patrón
// acepta el nombre con la `a` final y sin ella (`agua?`). Lo que NO se relaja
// es el resto: el sufijo del equipo sigue siendo obligatorio y anclado, que es
// lo que impide que el preview de otra organización entre por aquí.
//
// POR QUÉ UNA REGEX ANCLADA Y NO UN COMODÍN. Las tres formas fáciles de
// escribir esto son las tres formas de abrirlo de par en par:
//
//   · `*.vercel.app` acepta el preview de CUALQUIERA. Vercel es un servicio
//     público: un atacante despliega su propio proyecto y ya tiene un origen
//     permitido desde el que leer respuestas autenticadas.
//   · `origin.includes('control-consumo-agua')` acepta
//     `https://evil.com/?control-consumo-agua` y
//     `https://control-consumo-agua.evil.com`.
//   · `origin.startsWith('https://control-consumo-agua')` acepta
//     `https://control-consumo-agua.evil.com` — el prefijo coincide y el
//     dominio es de otro.
//
// Por eso se compara el HOSTNAME COMPLETO, ya parseado por `URL`, contra una
// regex anclada en ambos extremos. Parsear primero es lo que neutraliza el
// truco del userinfo: en
// `https://control-consumo-agua-x-prestadora-de-servicios-projects.vercel.app@evil.com`
// el hostname real es `evil.com`, y la regex lo rechaza sin ambigüedad.
const HOST_PREVIEW_VERCEL =
  /^control-consumo-agua?-[a-z0-9-]+-prestadora-de-servicios-projects\.vercel\.app$/

/**
 * ¿ESTÁ HABILITADA la puerta de los previews? Por defecto NO.
 *
 * Un preview de Vercel es un despliegue de código sin revisar: cualquiera con
 * permiso de push abre una rama y estrena un origen que casa con el patrón. Eso
 * es aceptable contra el Supabase SANDBOX, donde los datos son de juguete, y no
 * lo es contra el de PRODUCCIÓN, donde ese origen podría leer respuestas
 * autenticadas de clientes reales. La forma del host no distingue los dos
 * casos —es la misma— así que la distinción tiene que venir del entorno.
 *
 * `ALLOW_VERCEL_PREVIEW_ORIGINS=true` se define ÚNICAMENTE en el proyecto
 * sandbox. Sin la variable, o con cualquier otro valor, los previews quedan
 * fuera: la omisión no concede nada, que es lo que tiene que pasar cuando
 * alguien despliega estas funciones a un proyecto nuevo sin leer esto.
 *
 * Se tolera el espacio sobrante y las mayúsculas porque un secreto se pega a
 * mano; no se toleran `1`, `yes` ni `on`: un flag que acepta sinónimos acaba
 * habilitado por accidente.
 */
function vercelPreviewsHabilitados(): boolean {
  return (Deno.env.get('ALLOW_VERCEL_PREVIEW_ORIGINS') ?? '').trim().toLowerCase() === 'true'
}

/**
 * ¿Es `origin` un preview de Vercel de este proyecto, Y están habilitados?
 *
 * El flag se comprueba AQUÍ, y no sólo en `isOriginAllowed`, para que no exista
 * un camino que devuelva «sí» sin pasar por él: quien llame a esta función
 * desde una edge function nueva hereda la protección sin tener que saber que
 * existe.
 *
 * Exige HTTPS: el mismo hostname sobre `http` es un origen DISTINTO y no se
 * acepta — permitirlo invitaría a un man-in-the-middle a hablar con las edge
 * functions en nombre de la app.
 *
 * Exige además que la cadena sea un origen de verdad: sin credenciales, sin
 * ruta y sin puerto. Un header `Origin` nunca los lleva (es
 * `esquema://host[:puerto]`), así que cualquier cosa que los traiga no viene de
 * un navegador cumpliendo la especificación, sino de alguien probando suerte.
 */
export function isVercelPreviewOrigin(origin: string): boolean {
  if (!vercelPreviewsHabilitados()) return false

  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username !== '' || url.password !== '') return false
  if (url.port !== '') return false
  // `new URL('https://host')` normaliza el path a '/'; cualquier otra cosa
  // significa que nos pasaron una URL, no un origen.
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return false

  return HOST_PREVIEW_VERCEL.test(url.hostname)
}

/**
 * Validate request origin against allowed list
 * @param origin - The origin from request headers
 * @returns true if origin is allowed, false otherwise
 */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false

  const allowedOrigins = getAllowedOrigins()
  if (allowedOrigins.includes(origin)) return true

  return isVercelPreviewOrigin(origin)
}

/**
 * Get safe CORS headers with origin validation
 * @param origin - The origin from request headers
 * @returns CORS headers object
 */
export function getCorsHeaders(origin: string | null) {
  // La decisión de «permitido» vive en UN solo sitio. Cuando estaba duplicada
  // aquí (`allowedOrigins.includes(origin)`), añadir un caso nuevo obligaba a
  // acordarse de los dos, y el que se olvidara concedía o negaba de más.
  const allowOrigin = origin && isOriginAllowed(origin) ? origin : getAllowedOrigins()[0]

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    // `Access-Control-Allow-Origin` ya no es constante: depende del `Origin` que
    // entró. Sin `Vary: Origin`, cualquier caché intermedia puede servirle a un
    // preview la cabecera calculada para otro —o para el fallback— y el
    // navegador rechaza la respuesta por un motivo que no está en ningún log.
    'Vary': 'Origin',
  }
}

/**
 * Validate request origin and return error if not allowed
 * @param origin - The origin from request headers
 * @param corsHeaders - CORS headers object
 * @returns Response if origin is not allowed, null if allowed
 */
export function validateOrigin(origin: string | null, corsHeaders: ReturnType<typeof getCorsHeaders>) {
  if (!isOriginAllowed(origin)) {
    return new Response(
      JSON.stringify({
        error: 'Origin not allowed',
        origin: origin
      }),
      {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
  return null
}
