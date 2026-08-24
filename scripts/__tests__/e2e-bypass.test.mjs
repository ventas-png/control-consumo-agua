// ════════════════════════════════════════════════════════════════════════════
// Contrato del bypass de Vercel: el token viaja SOLO al origen del Preview.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO QUE ESTO CIERRA: la primera implementación puso el token en
// use.extraHTTPHeaders. Playwright envía esos headers con TODAS las
// solicitudes del contexto — también hacia otros orígenes (Supabase, CDNs,
// analytics) — así que el secreto se filtraba a terceros. El contrato nuevo:
// una única petición de siembra contra el origen exacto de E2E_BASE_URL, y de
// ahí en adelante sólo la COOKIE (que el navegador scope-a por origen).
//
// Se demuestra con DOS servidores HTTP locales reales: uno hace de Preview y
// el otro de "cualquier otro origen". El token tiene que llegar al primero y
// JAMÁS al segundo — ni en headers, ni en la URL, ni vía cookie compartida.
import { createServer } from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  HEADER_BYPASS,
  HEADER_SIEMBRA_COOKIE,
  RUTA_ESTADO,
  sembrarCookieDeBypass,
  urlDeSiembra,
} from '../../e2e/fixtures/vercelBypass'
import {
  HEADER_BYPASS as HEADER_BYPASS_PREFLIGHT,
  HEADER_SIEMBRA_COOKIE as HEADER_COOKIE_PREFLIGHT,
  MAX_SALTOS_MISMO_ORIGEN,
  leerMeta,
} from '../e2e-preflight.mjs'

const TOKEN = 'token-bypass-de-prueba-b7c1'
const COOKIE_DE_VERCEL = '_vercel_jwt=cookie-simulada-del-preview'

/** Servidor local que registra cada petición (url + headers). El "Preview"
 *  responde como Vercel: siembra la cookie de bypass en su propio origen. */
function servidorEspia({ siembraCookie }) {
  const recibidas = []
  const server = createServer((req, res) => {
    recibidas.push({ url: req.url, headers: { ...req.headers } })
    if (siembraCookie) res.setHeader('set-cookie', `${COOKIE_DE_VERCEL}; Path=/; HttpOnly`)
    res.setHeader('content-type', 'application/json')
    res.end('{}')
  })
  return new Promise((resolver) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolver({ server, recibidas, origen: `http://127.0.0.1:${port}` })
    })
  })
}

// Doble mínimo de APIRequestContext: hace peticiones HTTP REALES y guarda las
// cookies POR ORIGEN, igual que el navegador — así la "navegación" posterior
// sólo puede enviar a cada origen lo que ese origen sembró.
function peticionConJar() {
  const jarPorOrigen = new Map()
  return {
    jarPorOrigen,
    async get(url, opciones = {}) {
      const r = await fetch(url, { headers: opciones.headers ?? {} })
      const sc = r.headers.get('set-cookie')
      if (sc) jarPorOrigen.set(new URL(url).origin, sc.split(';')[0])
      return r
    },
    // La "navegación": adjunta SOLO las cookies del origen destino, sin headers extra.
    async navegar(url) {
      const cookie = jarPorOrigen.get(new URL(url).origin)
      return fetch(url, { headers: cookie ? { cookie } : {} })
    },
  }
}

let preview
let otroOrigen

beforeAll(async () => {
  preview = await servidorEspia({ siembraCookie: true })
  otroOrigen = await servidorEspia({ siembraCookie: false })
})

afterAll(() => {
  preview.server.close()
  otroOrigen.server.close()
})

describe('el token llega SOLO al origen del Preview', () => {
  it('la siembra manda los dos headers al Preview, con el token fuera de la URL', async () => {
    const req = peticionConJar()
    const hecho = await sembrarCookieDeBypass(req, preview.origen, TOKEN)
    expect(hecho).toBe(true)

    expect(preview.recibidas).toHaveLength(1)
    const p = preview.recibidas[0]
    expect(p.headers[HEADER_BYPASS]).toBe(TOKEN)
    expect(p.headers[HEADER_SIEMBRA_COOKIE]).toBe('true')
    expect(p.url).toBe('/e2e-meta.json')
    expect(p.url).not.toContain(TOKEN)
    expect(urlDeSiembra(preview.origen)).not.toContain(TOKEN)
  })

  it('el segundo origen no recibió NINGUNA petición durante la siembra', () => {
    expect(otroOrigen.recibidas).toHaveLength(0)
  })

  it('navegar después al OTRO origen: ni token, ni cookie del Preview, en ninguna parte', async () => {
    const req = peticionConJar()
    await sembrarCookieDeBypass(req, preview.origen, TOKEN)
    await req.navegar(`${otroOrigen.origen}/pagina`)

    expect(otroOrigen.recibidas).toHaveLength(1)
    const ajena = otroOrigen.recibidas[0]
    expect(ajena.headers[HEADER_BYPASS]).toBeUndefined()
    expect(ajena.headers[HEADER_SIEMBRA_COOKIE]).toBeUndefined()
    const todo = JSON.stringify(ajena)
    expect(todo).not.toContain(TOKEN)
    expect(todo).not.toContain(COOKIE_DE_VERCEL)
  })

  it('navegar al PROPIO Preview usa la cookie sembrada — la credencial es la cookie, no el token', async () => {
    const req = peticionConJar()
    await sembrarCookieDeBypass(req, preview.origen, TOKEN)
    const antes = preview.recibidas.length
    await req.navegar(`${preview.origen}/`)

    const propia = preview.recibidas[antes]
    expect(propia.headers.cookie).toBe(COOKIE_DE_VERCEL)
    expect(propia.headers[HEADER_BYPASS]).toBeUndefined()
  })

  it('sin token no hace ninguna petición (local contra un dev server sin protección)', async () => {
    const req = peticionConJar()
    const antes = preview.recibidas.length
    expect(await sembrarCookieDeBypass(req, preview.origen, '')).toBe(false)
    expect(await sembrarCookieDeBypass(req, '', TOKEN)).toBe(false)
    expect(preview.recibidas).toHaveLength(antes)
  })
})

describe('la configuración no puede volver a filtrar el token', () => {
  const config = readFileSync(resolve('e2e/playwright.config.ts'), 'utf8')
  const setupFuente = readFileSync(resolve('e2e/bypass.setup.ts'), 'utf8')
  // El config EXPLICA en comentarios por qué no usa extraHTTPHeaders; el
  // candado aplica al código ejecutable.
  const configEjecutable = config
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n')

  it('playwright.config.ts NO tiene extraHTTPHeaders ni el header del bypass', () => {
    expect(configEjecutable).not.toContain('extraHTTPHeaders')
    expect(configEjecutable).not.toContain('x-vercel-protection-bypass')
    expect(configEjecutable).not.toContain('E2E_VERCEL_BYPASS_TOKEN')
  })

  it('el proyecto chromium carga el storageState del setup y DEPENDE de él', () => {
    expect(config).toContain('storageState: RUTA_ESTADO')
    expect(config).toMatch(/dependencies:\s*\['setup'\]/)
    expect(config).toMatch(/testMatch:\s*\/bypass\\\.setup\\\.ts\$\//)
  })

  it('el proyecto setup corre sin trace/video/screenshot: la petición con el token no queda grabada', () => {
    const i = config.indexOf("name: 'setup'")
    const bloque = config.slice(i, config.indexOf("name: 'chromium'"))
    expect(bloque).toContain("trace: 'off'")
    expect(bloque).toContain("video: 'off'")
    expect(bloque).toContain("screenshot: 'off'")
  })

  it('bypass.setup.ts siembra con la fixture y guarda el estado compartido', () => {
    expect(setupFuente).toContain('sembrarCookieDeBypass')
    expect(setupFuente).toContain('request.storageState({ path: RUTA_ESTADO })')
  })

  it('ningún spec del navegador toca el token: sólo el setup lo lee', () => {
    for (const f of readdirSync(resolve('e2e')).filter((x) => x.endsWith('.e2e.ts'))) {
      const fuente = readFileSync(resolve('e2e', f), 'utf8')
      expect(fuente, `${f} no debe leer el token`).not.toContain('E2E_VERCEL_BYPASS_TOKEN')
    }
  })

  it('el estado de cookies queda fuera de git y fuera de los artifacts del workflow', () => {
    expect(RUTA_ESTADO.endsWith('.estado/bypass-storage.json')).toBe(true)
    expect(readFileSync(resolve('.gitignore'), 'utf8')).toContain('e2e/.estado/')
    // El workflow sube playwright-report/, test-results/ y el JSON del
    // reporter; el estado con la cookie no puede estar entre esos paths.
    const yml = readFileSync(resolve('.github/workflows/e2e.yml'), 'utf8')
    expect(yml).not.toContain('.estado')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Diagnóstico cuando la protección NO deja pasar (corrida real 2026-08-24).
// ════════════════════════════════════════════════════════════════════════════
// El preflight reportó «no respondió /e2e-meta.json (fetch failed)» y con eso
// era imposible saber si el problema era DNS, TLS o el bypass: Vercel responde
// 3xx hacia su pantalla de autenticación y `fetch` seguía el redirect hasta
// morir con un error genérico. Ahora el redirect NO se sigue y el motivo real
// del transporte (`cause`) viaja en el mensaje.
describe('leerMeta clasifica el rechazo de la protección en vez de esconderlo', () => {
  const TOKEN = 'token-bypass-de-prueba-b7c1'
  const SSO = 'https://vercel.com/sso-api?url=https%3A%2F%2Fx.vercel.app&_vercel_share=SHARE_SECRETO_123'
  const respuesta = (status, location) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => (k.toLowerCase() === 'location' ? location : null) },
    json: async () => ({}),
  })

  it('pide el recurso SIN seguir redirects', async () => {
    let init = null
    await leerMeta('https://p.vercel.app', async (_u, i) => { init = i; return respuesta(200) }, TOKEN)
    expect(init.redirect).toBe('manual')
  })

  it('un 3xx hacia el SSO se reporta como bypass no aceptado, nombrando la variable', async () => {
    const { meta, errorFetch } = await leerMeta('https://p.vercel.app', async () => respuesta(302, SSO), TOKEN)
    expect(meta).toBeNull()
    expect(errorFetch).toContain('HTTP 302')
    expect(errorFetch).toContain('E2E_VERCEL_BYPASS_TOKEN')
    expect(errorFetch).toMatch(/Deployment Protection/)
  })

  it('el destino del redirect se recorta: ni el _vercel_share ni el token quedan en el log', async () => {
    const { errorFetch } = await leerMeta('https://p.vercel.app', async () => respuesta(302, SSO), TOKEN)
    expect(errorFetch).toContain('https://vercel.com/sso-api')
    expect(errorFetch).not.toContain('SHARE_SECRETO_123')
    expect(errorFetch).not.toContain('_vercel_share')
    expect(errorFetch).not.toContain(TOKEN)
  })

  it('un 401 conserva el mismo diagnóstico accionable', async () => {
    const { errorFetch } = await leerMeta('https://p.vercel.app', async () => respuesta(401), TOKEN)
    expect(errorFetch).toContain('E2E_VERCEL_BYPASS_TOKEN')
    expect(errorFetch).not.toContain(TOKEN)
  })

  it('un fallo de transporte expone la causa real (undici la esconde bajo "fetch failed")', async () => {
    const roto = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } })
    const { errorFetch } = await leerMeta('https://p.vercel.app', async () => { throw roto }, TOKEN)
    expect(errorFetch).toContain('fetch failed')
    expect(errorFetch).toContain('ENOTFOUND')
    expect(errorFetch).not.toContain(TOKEN)
  })

  // ── Las DOS clases de 3xx ──────────────────────────────────────────────────
  // Tratarlas igual costó la corrida 32751852528: el Preview respondió
  // «HTTP 307 → /e2e-meta.json» —Vercel sembrando la cookie de bypass, con el
  // token ACEPTADO— y el preflight lo reportó como token rechazado.
  const conSetCookie = (status, location, setCookie) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (k) => (k.toLowerCase() === 'location' ? location : null),
      getSetCookie: () => (setCookie ? [setCookie] : []),
    },
    json: async () => ({}),
  })

  /** fetch que responde con la secuencia dada, uno por llamada, y registra todo. */
  const secuencia = (...respuestas) => {
    const visto = []
    let i = 0
    const f = async (u, init) => {
      // Tope duro: si el corte de saltos desapareciera, esto falla en el acto
      // en vez de dejar la suite girando hasta el timeout.
      if (visto.length > MAX_SALTOS_MISMO_ORIGEN + 1) throw new Error('siguió redirects sin fin')
      visto.push({ url: String(u), headers: { ...init.headers } })
      return respuestas[Math.min(i++, respuestas.length - 1)]
    }
    return { f, visto }
  }

  it('un 307 al MISMO origen es la siembra de la cookie: se sigue y la metadata se lee', async () => {
    const META = { commit_sha: 'abc', environment: 'e2e-sandbox', supabase_project_ref: 'r' }
    const ok = { status: 200, ok: true, headers: { get: () => null, getSetCookie: () => [] }, json: async () => META }
    const { f, visto } = secuencia(conSetCookie(307, '/e2e-meta.json', '_vercel_jwt=JWT123; Path=/; HttpOnly'), ok)
    const { meta, errorFetch } = await leerMeta('https://p.vercel.app', f, TOKEN)
    expect(errorFetch).toBeNull()
    expect(meta).toEqual(META)
    expect(visto).toHaveLength(2)
  })

  it('la cookie sembrada viaja en el salto siguiente, junto con el header del bypass', async () => {
    const ok = { status: 200, ok: true, headers: { get: () => null, getSetCookie: () => [] }, json: async () => ({}) }
    const { f, visto } = secuencia(conSetCookie(307, '/e2e-meta.json', '_vercel_jwt=JWT123; Path=/; HttpOnly'), ok)
    await leerMeta('https://p.vercel.app', f, TOKEN)
    expect(visto[0].headers.cookie).toBeUndefined()
    expect(visto[1].headers.cookie).toBe('_vercel_jwt=JWT123')
    expect(visto[1].headers[HEADER_BYPASS]).toBe(TOKEN)
    // El header sigue yendo al MISMO origen y a ningún otro.
    expect(visto.every((v) => v.url.startsWith('https://p.vercel.app/'))).toBe(true)
  })

  it('un Location RELATIVO se resuelve contra la URL actual, no contra la raíz del proceso', async () => {
    const ok = { status: 200, ok: true, headers: { get: () => null, getSetCookie: () => [] }, json: async () => ({}) }
    const { f, visto } = secuencia(conSetCookie(307, '/e2e-meta.json?ok=1'), ok)
    await leerMeta('https://p.vercel.app', f, TOKEN)
    expect(visto[1].url).toBe('https://p.vercel.app/e2e-meta.json?ok=1')
  })

  it('un 3xx que CRUZA de origen corta ahí: el token nunca se manda al segundo origen', async () => {
    const { f, visto } = secuencia(conSetCookie(302, SSO))
    const { meta, errorFetch } = await leerMeta('https://p.vercel.app', f, TOKEN)
    expect(meta).toBeNull()
    expect(errorFetch).toContain('E2E_VERCEL_BYPASS_TOKEN')
    expect(visto).toHaveLength(1)
    expect(visto[0].url).toBe('https://p.vercel.app/e2e-meta.json')
    expect(visto.some((v) => v.url.includes('vercel.com'))).toBe(false)
  })

  it('un bucle de redirects del mismo origen se corta en MAX_SALTOS_MISMO_ORIGEN', async () => {
    const { f, visto } = secuencia(conSetCookie(307, '/e2e-meta.json'))
    const { meta, errorFetch } = await leerMeta('https://p.vercel.app', f, TOKEN)
    expect(meta).toBeNull()
    expect(errorFetch).toContain(`más de ${MAX_SALTOS_MISMO_ORIGEN} redirects`)
    expect(errorFetch).not.toContain(TOKEN)
    expect(visto).toHaveLength(MAX_SALTOS_MISMO_ORIGEN + 1)
  })

  it('un 3xx sin Location no se sigue a ciegas', async () => {
    const { errorFetch } = await leerMeta('https://p.vercel.app', async () => respuesta(307), TOKEN)
    expect(errorFetch).toContain('sin Location')
    expect(errorFetch).toContain('E2E_VERCEL_BYPASS_TOKEN')
  })

  it('preflight y fixture no pueden divergir en el nombre de los headers', () => {
    expect(HEADER_BYPASS_PREFLIGHT).toBe(HEADER_BYPASS)
    expect(HEADER_COOKIE_PREFLIGHT).toBe(HEADER_SIEMBRA_COOKIE)
  })
})
