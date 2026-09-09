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
describe('_shared/cors — previews de Vercel de este proyecto', () => {
  // Dos previews DISTINTOS: uno con el sufijo de rama que pone Vercel y otro
  // con un hash. Con uno solo, un `includes()` de la cadena exacta pasaría la
  // prueba y seguiría estando roto.
  const PREVIEW_RAMA =
    'https://control-consumo-agua-git-c1a22a-prestadora-de-servicios-projects.vercel.app'
  const PREVIEW_HASH =
    'https://control-consumo-agua-46lcs36pjkasmnqmagmgfsdfyyus-prestadora-de-servicios-projects.vercel.app'

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
    stubDeno({ ALLOWED_ORIGINS: 'https://staging.example' })
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
    // Sin nada entre el proyecto y el equipo: el patrón exige al menos un tramo.
    expect(isOriginAllowed('https://control-consumo-agua-prestadora-de-servicios-projects.vercel.app')).toBe(false)
    // Otro TLD.
    expect(isOriginAllowed('https://control-consumo-agua-git-x-prestadora-de-servicios-projects.vercel.dev')).toBe(false)
  })
})
