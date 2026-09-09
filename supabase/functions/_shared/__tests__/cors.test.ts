// Tests del allow-list de orígenes CORS (infra:I22). Es una frontera de seguridad:
// define qué orígenes pueden invocar las edge functions. cors.ts lee Deno.env al
// evaluar, así que stubeamos el global Deno (mismo patrón que auth.test.ts).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

function stubDeno(env: Record<string, string | undefined>) {
  ;(globalThis as unknown as { Deno: { env: { get: (k: string) => string | undefined } } }).Deno = {
    env: { get: (k: string) => env[k] },
  }
}

beforeEach(() => stubDeno({})) // sin ALLOWED_ORIGINS ni APP_URL → defaults (prod + localhost)
afterEach(() => { delete (globalThis as unknown as { Deno?: unknown }).Deno })

describe('_shared/cors — isOriginAllowed', () => {
  it('permite los dominios de producción siempre', async () => {
    const { isOriginAllowed } = await import('../cors.ts')
    expect(isOriginAllowed('https://administratodo.com')).toBe(true)
    expect(isOriginAllowed('https://www.administratodo.app')).toBe(true)
  })

  it('rechaza orígenes desconocidos y null', async () => {
    const { isOriginAllowed } = await import('../cors.ts')
    expect(isOriginAllowed('https://evil.example')).toBe(false)
    expect(isOriginAllowed(null)).toBe(false)
  })

  it('incluye localhost cuando NO hay ALLOWED_ORIGINS', async () => {
    const { isOriginAllowed } = await import('../cors.ts')
    expect(isOriginAllowed('http://localhost:5173')).toBe(true)
  })

  it('respeta ALLOWED_ORIGINS del entorno y excluye localhost', async () => {
    stubDeno({ ALLOWED_ORIGINS: 'https://staging.example, https://qa.example' })
    const { isOriginAllowed } = await import('../cors.ts')
    expect(isOriginAllowed('https://staging.example')).toBe(true)
    expect(isOriginAllowed('https://qa.example')).toBe(true)
    expect(isOriginAllowed('http://localhost:5173')).toBe(false)
  })
})

describe('_shared/cors — headers y validación', () => {
  it('getCorsHeaders refleja el origin permitido', async () => {
    const { getCorsHeaders } = await import('../cors.ts')
    expect(getCorsHeaders('https://administratodo.com')['Access-Control-Allow-Origin']).toBe('https://administratodo.com')
  })

  it('getCorsHeaders cae al primer permitido si el origin no está en la lista', async () => {
    const { getCorsHeaders } = await import('../cors.ts')
    expect(getCorsHeaders('https://evil.example')['Access-Control-Allow-Origin']).toBe('https://administratodo.com')
  })

  it('validateOrigin devuelve null si permitido y 403 si no', async () => {
    const { validateOrigin, getCorsHeaders } = await import('../cors.ts')
    const headers = getCorsHeaders('https://administratodo.com')
    expect(validateOrigin('https://administratodo.com', headers)).toBeNull()
    const res = validateOrigin('https://evil.example', headers)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  // Sin `Vary: Origin`, una caché intermedia puede servirle a un preview la
  // cabecera calculada para otro origen. Deja de ser teórico en cuanto
  // `Access-Control-Allow-Origin` depende de la petición, que es justo lo que
  // hacen los previews.
  it('siempre declara Vary: Origin, permitido o no', async () => {
    const { getCorsHeaders } = await import('../cors.ts')
    expect(getCorsHeaders('https://administratodo.com')['Vary']).toBe('Origin')
    expect(getCorsHeaders('https://evil.example')['Vary']).toBe('Origin')
    expect(getCorsHeaders(null)['Vary']).toBe('Origin')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Previews de Vercel
// ════════════════════════════════════════════════════════════════════════════
// Vercel estrena host en cada despliegue de preview, así que ninguna lista fija
// los cubre y la puerta tiene que abrirse por FORMA. Estas pruebas fijan dónde
// está el filo: qué entra, y sobre todo qué no.
describe('_shared/cors — previews de Vercel de este proyecto (con el flag ENCENDIDO)', () => {
  // La puerta de los previews está cerrada por defecto y sólo la abre
  // ALLOW_VERCEL_PREVIEW_ORIGINS=true, definido únicamente en el Supabase
  // sandbox (ver el describe siguiente). Todo este bloque describe cómo se
  // comporta ESTANDO abierta.
  beforeEach(() => stubDeno({ ALLOW_VERCEL_PREVIEW_ORIGINS: 'true' }))

  // Dos previews DISTINTOS y REALES, copiados de despliegues de este proyecto.
  // Con uno solo, un `includes()` de la cadena exacta pasaría la prueba y
  // seguiría estando roto.
  //
  // Y son distintos en algo más que el sufijo: el alias de RAMA viene truncado
  // —`control-consumo-agu`, sin la `a` final— porque Vercel recorta el nombre
  // del proyecto para que el host quepa en los 63 caracteres de una etiqueta
  // DNS, mientras que la URL canónica del despliegue lo conserva entero. Las
  // dos sirven la misma app. Si alguien «arregla» el patrón quitando el `?` de
  // `agua?`, esta prueba se cae y le dice por qué.
  const PREVIEW_RAMA =
    'https://control-consumo-agu-git-c1a22a-prestadora-de-servicios-projects.vercel.app'
  const PREVIEW_HASH =
    'https://control-consumo-agua-4lt4l03ik-prestadora-de-servicios-projects.vercel.app'

  it('acepta previews de este proyecto (rama y hash)', async () => {
    const { isOriginAllowed } = await import('../cors.ts')
    expect(isOriginAllowed(PREVIEW_RAMA)).toBe(true)
    expect(isOriginAllowed(PREVIEW_HASH)).toBe(true)
  })

  it('devuelve EXACTAMENTE el origin recibido, no el fallback', async () => {
    const { getCorsHeaders } = await import('../cors.ts')
    expect(getCorsHeaders(PREVIEW_RAMA)['Access-Control-Allow-Origin']).toBe(PREVIEW_RAMA)
    expect(getCorsHeaders(PREVIEW_HASH)['Access-Control-Allow-Origin']).toBe(PREVIEW_HASH)
  })

  it('validateOrigin los deja pasar', async () => {
    const { validateOrigin, getCorsHeaders } = await import('../cors.ts')
    expect(validateOrigin(PREVIEW_RAMA, getCorsHeaders(PREVIEW_RAMA))).toBeNull()
    expect(validateOrigin(PREVIEW_HASH, getCorsHeaders(PREVIEW_HASH))).toBeNull()
  })

  it('siguen aceptándose aunque ALLOWED_ORIGINS traiga otra cosa', async () => {
    stubDeno({ ALLOWED_ORIGINS: 'https://staging.example', ALLOW_VERCEL_PREVIEW_ORIGINS: 'true' })
    const { isOriginAllowed } = await import('../cors.ts')
    expect(isOriginAllowed(PREVIEW_RAMA)).toBe(true)
    expect(isOriginAllowed('https://staging.example')).toBe(true)
  })

  // ── Los negativos, que son el verdadero contenido de esta regla ───────────
  it('RECHAZA el preview de otro proyecto de Vercel', async () => {
    const { isOriginAllowed, getCorsHeaders } = await import('../cors.ts')
    // Vercel es un servicio público: cualquiera despliega ahí. Un comodín
    // `*.vercel.app` le regalaría un origen permitido a un atacante.
    expect(isOriginAllowed('https://proyecto-ajeno-git-main-otra-org-projects.vercel.app')).toBe(false)
    expect(isOriginAllowed('https://control-consumo-agua-git-main-otra-org-projects.vercel.app')).toBe(false)
    expect(
      getCorsHeaders('https://proyecto-ajeno-git-main-otra-org-projects.vercel.app')['Access-Control-Allow-Origin'],
    ).toBe('https://administratodo.com')
  })

  it('RECHAZA un dominio con sufijo malicioso', async () => {
    const { isOriginAllowed } = await import('../cors.ts')
    // El host permitido, pegado a un dominio del atacante. Un `startsWith()` o
    // un `includes()` lo aceptarían; el hostname completo, no.
    expect(
      isOriginAllowed(
        'https://control-consumo-agua-git-c1a22a-prestadora-de-servicios-projects.vercel.app.evil.com',
      ),
    ).toBe(false)
    expect(
      isOriginAllowed(
        'https://control-consumo-agua-git-c1a22a-prestadora-de-servicios-projects.vercel.app.evil.com/',
      ),
    ).toBe(false)
    // El truco del userinfo: lo que va antes de la @ parece el host permitido,
    // pero el host real es evil.com.
    expect(
      isOriginAllowed(
        'https://control-consumo-agua-git-c1a22a-prestadora-de-servicios-projects.vercel.app@evil.com',
      ),
    ).toBe(false)
    // Y el host permitido como subdominio de otro.
    expect(
      isOriginAllowed(
        'https://control-consumo-agua-git-c1a22a-prestadora-de-servicios-projects.vercel.app.attacker.io',
      ),
    ).toBe(false)
  })

  it('RECHAZA el mismo hostname sobre http', async () => {
    const { isOriginAllowed, getCorsHeaders } = await import('../cors.ts')
    const enClaro = PREVIEW_RAMA.replace('https://', 'http://')
    // Es un origen DISTINTO, y aceptarlo dejaría a un man-in-the-middle hablar
    // con las edge functions en nombre de la app.
    expect(isOriginAllowed(enClaro)).toBe(false)
    expect(getCorsHeaders(enClaro)['Access-Control-Allow-Origin']).toBe('https://administratodo.com')
  })

  // El patrón está escrito en minúsculas, pero los nombres de host son
  // insensibles a mayúsculas y `URL` los normaliza: `...-GIT-X-...` y
  // `...-git-x-...` son EL MISMO host, así que aceptarlo es lo correcto. Se
  // fija aquí para que quede claro que es la normalización de `URL` la que lo
  // resuelve, y no un descuido de la regex: quien la endurezca sabrá que esta
  // prueba existe.
  it('acepta el mismo host escrito en mayúsculas, porque URL lo normaliza', async () => {
    const { isOriginAllowed } = await import('../cors.ts')
    expect(
      isOriginAllowed('https://control-consumo-agua-GIT-C1A22A-prestadora-de-servicios-projects.vercel.app'),
    ).toBe(true)
  })

  it('RECHAZA lo que no es un origen: con ruta, con puerto o basura', async () => {
    const { isOriginAllowed } = await import('../cors.ts')
    expect(isOriginAllowed(`${PREVIEW_RAMA}/algo`)).toBe(false)
    expect(isOriginAllowed(`${PREVIEW_RAMA}?x=1`)).toBe(false)
    expect(isOriginAllowed(PREVIEW_RAMA.replace('.vercel.app', '.vercel.app:8443'))).toBe(false)
    expect(isOriginAllowed('no-es-una-url')).toBe(false)
    expect(isOriginAllowed('')).toBe(false)
  })

  it('RECHAZA hostnames que se parecen pero no cumplen el patrón', async () => {
    const { isOriginAllowed } = await import('../cors.ts')
    // Sin el prefijo del proyecto.
    expect(isOriginAllowed('https://prestadora-de-servicios-projects.vercel.app')).toBe(false)
    // El truncado admitido es EXACTAMENTE una letra menos. Ni dos, ni un
    // prefijo cualquiera: `agua?` no es una puerta a «lo que empiece por
    // control-consumo».
    expect(isOriginAllowed('https://control-consumo-ag-git-x-prestadora-de-servicios-projects.vercel.app')).toBe(false)
    expect(isOriginAllowed('https://control-consumo-git-x-prestadora-de-servicios-projects.vercel.app')).toBe(false)
    expect(isOriginAllowed('https://control-consumo-aguas-git-x-prestadora-de-servicios-projects.vercel.app')).toBe(false)
    // Sin nada entre el proyecto y el equipo: el patrón exige al menos un tramo.
    expect(isOriginAllowed('https://control-consumo-agua-prestadora-de-servicios-projects.vercel.app')).toBe(false)
    // Otro TLD.
    expect(isOriginAllowed('https://control-consumo-agua-git-x-prestadora-de-servicios-projects.vercel.dev')).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// La puerta de los previews está CERRADA por defecto
// ════════════════════════════════════════════════════════════════════════════
// Un preview de Vercel es código sin revisar: cualquiera con permiso de push
// abre una rama y estrena un origen que casa con el patrón. Contra el Supabase
// sandbox eso es aceptable —los datos son de juguete—; contra el de producción
// sería un origen permitido que puede leer respuestas autenticadas de clientes
// reales. La forma del host es idéntica en ambos casos, así que la distinción
// tiene que venir del entorno: ALLOW_VERCEL_PREVIEW_ORIGINS=true, definido
// SÓLO en el sandbox.
//
// Estas pruebas fijan las dos mitades: sin el flag no entra ni el preview más
// legítimo, y con el flag no entra nada más que los previews de este proyecto.
describe('_shared/cors — ALLOW_VERCEL_PREVIEW_ORIGINS', () => {
  const PREVIEW =
    'https://control-consumo-agu-git-c1a22a-prestadora-de-servicios-projects.vercel.app'

  it('POR DEFECTO (sin la variable) rechaza el preview', async () => {
    // `beforeEach` global deja el entorno sin ALLOWED_ORIGINS ni flag: es el
    // entorno de un proyecto Supabase recién desplegado, y también el de
    // producción.
    const { isOriginAllowed, isVercelPreviewOrigin, getCorsHeaders } = await import('../cors.ts')
    expect(isOriginAllowed(PREVIEW)).toBe(false)
    expect(isVercelPreviewOrigin(PREVIEW)).toBe(false)
    // Y el header cae al primer origen permitido, no al preview.
    expect(getCorsHeaders(PREVIEW)['Access-Control-Allow-Origin']).toBe('https://administratodo.com')
  })

  it('con el flag en «true» acepta el preview y devuelve su origen exacto', async () => {
    stubDeno({ ALLOW_VERCEL_PREVIEW_ORIGINS: 'true' })
    const { isOriginAllowed, getCorsHeaders, validateOrigin } = await import('../cors.ts')
    expect(isOriginAllowed(PREVIEW)).toBe(true)
    expect(getCorsHeaders(PREVIEW)['Access-Control-Allow-Origin']).toBe(PREVIEW)
    expect(validateOrigin(PREVIEW, getCorsHeaders(PREVIEW))).toBeNull()
  })

  it('tolera espacios y mayúsculas en el valor del secreto', async () => {
    // Un secreto se pega a mano; un espacio al final no debería costar una
    // tarde de 403 indistinguibles de un bug.
    stubDeno({ ALLOW_VERCEL_PREVIEW_ORIGINS: '  TRUE  ' })
    const { isOriginAllowed } = await import('../cors.ts')
    expect(isOriginAllowed(PREVIEW)).toBe(true)
  })

  it('NO acepta sinónimos de «true»: un flag laxo se enciende por accidente', async () => {
    for (const valor of ['1', 'yes', 'on', 'sí', 'false', '']) {
      stubDeno({ ALLOW_VERCEL_PREVIEW_ORIGINS: valor })
      const { isOriginAllowed } = await import('../cors.ts')
      expect(isOriginAllowed(PREVIEW), `«${valor}» no puede habilitar los previews`).toBe(false)
    }
  })

  it('el flag NO abre nada más: sigue exigiendo el proyecto, el equipo y https', async () => {
    stubDeno({ ALLOW_VERCEL_PREVIEW_ORIGINS: 'true' })
    const { isOriginAllowed } = await import('../cors.ts')
    expect(isOriginAllowed('https://proyecto-ajeno-git-main-otra-org-projects.vercel.app')).toBe(false)
    expect(isOriginAllowed(`${PREVIEW}.evil.com`)).toBe(false)
    expect(isOriginAllowed(PREVIEW.replace('https://', 'http://'))).toBe(false)
  })

  it('el flag NO afecta a los dominios de producción ni a ALLOWED_ORIGINS', async () => {
    // Encendido o apagado, la lista exacta se comporta igual. Si esto se rompe,
    // el flag habría dejado de ser una puerta extra para convertirse en un
    // interruptor general.
    for (const env of [{}, { ALLOW_VERCEL_PREVIEW_ORIGINS: 'true' }]) {
      stubDeno(env)
      const { isOriginAllowed } = await import('../cors.ts')
      expect(isOriginAllowed('https://administratodo.com')).toBe(true)
      expect(isOriginAllowed('https://evil.example')).toBe(false)
    }
  })
})
