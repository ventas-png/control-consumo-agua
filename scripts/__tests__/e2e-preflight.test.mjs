// ════════════════════════════════════════════════════════════════════════════
// Contrato del preflight E2E: tabla de decisión, validación positiva y el YAML.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO QUE ESTO CIERRA (en dos capas). Primera: el job salió VERDE SIN
// EJECUTAR durante semanas — sin E2E_BASE_URL, un warning y éxito. Segunda: una
// denylist sola valida por exclusión, y una URL estable validaría un commit
// viejo. El contrato fijado aquí: falta variable → rojo; fork/Dependabot →
// rojo explicado; y el destino se demuestra a sí mismo — marcador
// environment=e2e-sandbox, ref de Supabase declarado y el MISMO sha del job.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  HOSTS_PRODUCCION,
  VARIABLES_CONDICIONALES,
  VARIABLES_OBLIGATORIAS,
  decidirDestino,
  INTERVALO_SONDEO_MS,
  decidirPreflight,
  esperarUrlsPorSha,
  leerMeta,
  main,
  resolverUrlsPorSha,
  validarBaseUrl,
  validarMetadata,
} from '../e2e-preflight.mjs'
import { construirMeta, refDeSupabaseUrl } from '../generar-e2e-meta.mjs'

// El VALOR del token jamás debe aparecer en un log ni en un motivo de rechazo;
// se elige una cadena inconfundible para poder afirmarlo por búsqueda.
const TOKEN_BYPASS = 'token-bypass-jamas-impreso-9f3a'

const COMPLETAS = {
  E2E_LOGIN_EMAIL: 'e2e@sandbox.invalid',
  E2E_LOGIN_PASSWORD: 'x',
  E2E_RESTRICTED_EMAIL: 'e2e-restricted@sandbox.invalid',
  E2E_RESTRICTED_PASSWORD: 'y',
  E2E_EXPECTED_SUPABASE_REF: 'sandboxref',
  E2E_VERCEL_BYPASS_TOKEN: TOKEN_BYPASS,
  SHA_ESPERADO: 'a'.repeat(40),
}
const ESPERADO = { sha: COMPLETAS.SHA_ESPERADO, ref: 'sandboxref' }
const META_OK = {
  commit_sha: COMPLETAS.SHA_ESPERADO,
  environment: 'e2e-sandbox',
  supabase_project_ref: 'sandboxref',
}

describe('inventario de variables', () => {
  it('las obligatorias: credenciales + la DECLARACIÓN del ref + el bypass de Vercel (la URL ya no, se resuelve por SHA)', () => {
    expect([...VARIABLES_OBLIGATORIAS].sort()).toEqual([
      'E2E_EXPECTED_SUPABASE_REF',
      'E2E_LOGIN_EMAIL',
      'E2E_LOGIN_PASSWORD',
      'E2E_RESTRICTED_EMAIL',
      'E2E_RESTRICTED_PASSWORD',
      'E2E_VERCEL_BYPASS_TOKEN',
    ])
  })

  it('las condicionales son el token efímero y el flag del PAC', () => {
    expect([...VARIABLES_CONDICIONALES].sort()).toEqual([
      'E2E_FISCAL_SANDBOX_READY',
      'E2E_INVITE_TOKEN',
    ])
  })

  it('los nombres de credenciales coinciden con los que lee e2e/fixtures/env.ts', () => {
    const env = readFileSync(resolve('e2e/fixtures/env.ts'), 'utf8')
    for (const v of ['E2E_LOGIN_EMAIL', 'E2E_LOGIN_PASSWORD', 'E2E_RESTRICTED_EMAIL', 'E2E_RESTRICTED_PASSWORD', ...VARIABLES_CONDICIONALES]) {
      expect(env, `env.ts no lee ${v}`).toContain(`'${v}'`)
    }
  })
})

describe('falta una variable obligatoria → rojo accionable', () => {
  for (const variable of VARIABLES_OBLIGATORIAS) {
    it(`sin ${variable} el preflight falla y la nombra`, () => {
      const env = { ...COMPLETAS }
      delete env[variable]
      const r = decidirPreflight(env)
      expect(r.decision).toBe('fail')
      expect(r.mensaje).toContain(variable)
      expect(r.mensaje).toMatch(/Settings → Secrets/)
    })
  }

  it('sin SHA_ESPERADO falla nombrando al workflow, no a los secretos', () => {
    const r = decidirPreflight({ ...COMPLETAS, SHA_ESPERADO: '' })
    expect(r.decision).toBe('fail')
    expect(r.mensaje).toMatch(/bug del workflow/)
  })

  it('con todo presente pasa a la fase de candidatos (no a verde directo)', () => {
    expect(decidirPreflight(COMPLETAS).decision).toBe('candidatos')
  })
})

describe('contextos sin secretos por diseño → rojo con explicación, no verde', () => {
  it('PR de fork → bloqueado', () => {
    const r = decidirPreflight({ ES_FORK: 'true', GITHUB_EVENT_NAME: 'pull_request' })
    expect(r.decision).toBe('bloqueado')
    expect(r.motivo.clave).toBe('fork')
  })

  it('PR de Dependabot → bloqueado', () => {
    const r = decidirPreflight({ GITHUB_ACTOR: 'dependabot[bot]', GITHUB_EVENT_NAME: 'pull_request' })
    expect(r.decision).toBe('bloqueado')
    expect(r.motivo.clave).toBe('dependabot')
  })

  it('push a main sin variables → fail liso, aunque el actor sea dependabot', () => {
    const r = decidirPreflight({ GITHUB_ACTOR: 'dependabot[bot]', GITHUB_EVENT_NAME: 'push' })
    expect(r.decision).toBe('fail')
    expect(r.motivo).toBeNull()
  })
})

describe('validación POSITIVA de la metadata (la primera defensa)', () => {
  it('acepta el despliegue que demuestra las tres cosas', () => {
    expect(validarMetadata(META_OK, ESPERADO).ok).toBe(true)
  })

  it('despliegue con SHA ANTERIOR → rechazado nombrando ambos commits', () => {
    const r = validarMetadata({ ...META_OK, commit_sha: 'b'.repeat(40) }, ESPERADO)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('b'.repeat(40))
    expect(r.motivo).toContain(ESPERADO.sha)
    expect(r.motivo).toMatch(/despliegue viejo/)
  })

  it('project ref INCORRECTO → rechazado nombrando el declarado y el real', () => {
    const r = validarMetadata({ ...META_OK, supabase_project_ref: 'otro' }, ESPERADO)
    expect(r.ok).toBe(false)
    expect(r.motivo).toContain('"otro"')
    expect(r.motivo).toContain('sandboxref')
  })

  it('marcador de sandbox AUSENTE (environment=no-e2e o faltante) → rechazado', () => {
    expect(validarMetadata({ ...META_OK, environment: 'no-e2e' }, ESPERADO).ok).toBe(false)
    const sinCampo = { ...META_OK }
    delete sinCampo.environment
    const r = validarMetadata(sinCampo, ESPERADO)
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/aunque no estén en ninguna denylist/)
  })

  it('sin /e2e-meta.json → rechazado (un despliegue anterior a este PR no puede demostrarse)', () => {
    const r = validarMetadata(null, ESPERADO)
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/no publica \/e2e-meta\.json/)
  })

  it('commit_sha nulo (build local) → rechazado', () => {
    expect(validarMetadata({ ...META_OK, commit_sha: null }, ESPERADO).ok).toBe(false)
  })
})

describe('la denylist sobrevive como SEGUNDA defensa', () => {
  for (const host of HOSTS_PRODUCCION) {
    it(`a https://${host} ni se le consulta la metadata`, () => {
      const r = validarBaseUrl(`https://${host}`)
      expect(r.ok).toBe(false)
      expect(r.motivo).toMatch(/PRODUCCIÓN|producción/)
    })
  }

  it('subdominios de los dominios raíz de producción, http remoto y URL malformada', () => {
    expect(validarBaseUrl('https://app.administratodo.com').ok).toBe(false)
    expect(validarBaseUrl('http://preview.example.com').ok).toBe(false)
    expect(validarBaseUrl('http://localhost:5173').ok).toBe(true)
    expect(validarBaseUrl('no-es-una-url').ok).toBe(false)
  })

  it('cubre TODOS los hosts de producción de vercel.json', () => {
    const vercel = readFileSync(resolve('vercel.json'), 'utf8')
    const patron = vercel.match(/"value":\s*"\(([^"]+)\)"/)
    expect(patron).not.toBeNull()
    for (const h of patron[1].split('|').map((x) => x.replace(/\\\\./g, '.'))) {
      expect(HOSTS_PRODUCCION, `host de producción sin vetar: ${h}`).toContain(h)
    }
  })

  it('un ALIAS NO RECONOCIDO no entra por la denylist: lo tumba la validación positiva', () => {
    // La denylist no lo conoce (ok de forma), pero sin metadata no valida.
    expect(validarBaseUrl('https://alias-sospechoso.vercel.app').ok).toBe(true)
    const d = decidirDestino([{ url: 'https://alias-sospechoso.vercel.app', meta: null, errorFetch: 'HTTP 404' }], ESPERADO)
    expect(d.ok).toBe(false)
    expect(d.motivos[0]).toMatch(/no respondió \/e2e-meta\.json/)
  })
})

describe('decidirDestino: elige el primer candidato que se demuestra', () => {
  it('salta producción y el SHA viejo, elige el válido', () => {
    const d = decidirDestino(
      [
        { url: 'https://administratodo.com', meta: null },
        { url: 'https://viejo.vercel.app', meta: { ...META_OK, commit_sha: 'c'.repeat(40) } },
        { url: 'https://bueno.vercel.app', meta: META_OK },
      ],
      ESPERADO,
    )
    expect(d).toEqual({ ok: true, url: 'https://bueno.vercel.app' })
  })

  it('sin candidatos → fallo que explica de dónde salen (Deployments API + E2E_BASE_URL)', () => {
    const d = decidirDestino([], ESPERADO)
    expect(d.ok).toBe(false)
    expect(d.motivos[0]).toMatch(/Deployments/)
    expect(d.motivos[0]).toMatch(/E2E_BASE_URL/)
  })

  it('todos inválidos → fallo que enumera cada candidato con su motivo', () => {
    const d = decidirDestino(
      [
        { url: 'https://administratodo.com', meta: null },
        { url: 'https://viejo.vercel.app', meta: { ...META_OK, commit_sha: 'c'.repeat(40) } },
      ],
      ESPERADO,
    )
    expect(d.ok).toBe(false)
    expect(d.motivos).toHaveLength(2)
  })
})

describe('resolverUrlsPorSha (fetch inyectado)', () => {
  const fetchFalso = (rutas) => async (url) => {
    for (const [patron, respuesta] of rutas) if (String(url).includes(patron)) return respuesta
    return { ok: false, status: 404 }
  }

  it('junta los environment_url de los statuses en success, sin duplicados', async () => {
    const f = fetchFalso([
      ['/deployments?', { ok: true, json: async () => [{ id: 1 }, { id: 2 }] }],
      ['/deployments/1/statuses', { ok: true, json: async () => [{ state: 'success', environment_url: 'https://a.vercel.app' }] }],
      ['/deployments/2/statuses', { ok: true, json: async () => [{ state: 'success', environment_url: 'https://a.vercel.app' }] }],
    ])
    expect(await resolverUrlsPorSha({ repo: 'o/r', sha: 'x', token: 't', fetchImpl: f })).toEqual(['https://a.vercel.app'])
  })

  it('sin token o sin repo no llama a nada y devuelve vacío', async () => {
    expect(await resolverUrlsPorSha({ repo: '', sha: 'x', token: '', fetchImpl: () => { throw new Error('no debía llamar') } })).toEqual([])
  })

  it('una API caída no revienta el preflight: devuelve lo que tenga', async () => {
    const f = async () => { throw new Error('red rota') }
    expect(await resolverUrlsPorSha({ repo: 'o/r', sha: 'x', token: 't', fetchImpl: f })).toEqual([])
  })
})

// ── La carrera contra el build de Vercel ─────────────────────────────────────
// El workflow arranca con el push y Vercel tarda ~1 min: consultar la API una
// sola vez perdía la carrera SIEMPRE (run 32750004367 murió a los 40 s con "no
// hay ningún candidato" y el Preview quedó Ready 12 s después). Esperar no
// afloja nada: agotada la ventana, [] y el job rojo igual.
describe('esperarUrlsPorSha (sondeo con reloj y espera inyectados)', () => {
  /** Reloj falso: cada dormida adelanta el tiempo, nadie duerme de verdad. */
  const relojFalso = () => {
    let t = 0
    return { ahora: () => t, dormir: async (ms) => { t += ms }, get transcurrido() { return t } }
  }

  /** fetch que devuelve [] las primeras `fallos` veces y luego una URL. */
  const listoTrasIntentos = (fallos) => {
    let n = 0
    return async (url) => {
      const s = String(url)
      if (s.includes('/deployments?')) {
        n += 1
        return { ok: true, json: async () => (n > fallos ? [{ id: 1 }] : []) }
      }
      return { ok: true, json: async () => [{ state: 'success', environment_url: 'https://tarde.vercel.app' }] }
    }
  }

  const base = (extra) => ({ repo: 'o/r', sha: 'abcdef1234567890', token: 't', registrar: () => {}, ...extra })

  it('devuelve la URL en el primer intento sin dormir cuando ya está desplegado', async () => {
    const reloj = relojFalso()
    const urls = await esperarUrlsPorSha(base({ fetchImpl: listoTrasIntentos(0), ...reloj }))
    expect(urls).toEqual(['https://tarde.vercel.app'])
    expect(reloj.transcurrido).toBe(0)
  })

  it('sigue sondeando mientras Vercel construye y devuelve la URL cuando aparece', async () => {
    const reloj = relojFalso()
    const urls = await esperarUrlsPorSha(base({ fetchImpl: listoTrasIntentos(3), ...reloj }))
    expect(urls).toEqual(['https://tarde.vercel.app'])
    expect(reloj.transcurrido).toBe(3 * INTERVALO_SONDEO_MS)
  })

  it('agotada la ventana devuelve vacío: el fail-closed se mantiene', async () => {
    // El reloj avanza al dormir y la dormida REVIENTA pasadas las que caben en
    // la ventana: si el corte desaparece, esto falla en el acto en vez de
    // colgar la suite hasta el timeout.
    let dormidas = 0
    const reloj = relojFalso()
    const dormir = async (ms) => {
      if ((dormidas += 1) > 60_000 / INTERVALO_SONDEO_MS) throw new Error('sondeó más allá de la ventana')
      await reloj.dormir(ms)
    }
    const urls = await esperarUrlsPorSha(
      base({
        fetchImpl: listoTrasIntentos(Number.POSITIVE_INFINITY),
        tiempoMaxMs: 60_000,
        ahora: reloj.ahora,
        dormir,
      }),
    )
    expect(urls).toEqual([])
    expect(reloj.transcurrido).toBeLessThanOrEqual(60_000)
    expect(dormidas).toBe(4) // duerme en 0/15/30/45s; a los 60s ya no cabe otro
  })

  it('con tiempoMaxMs 0 hace UN intento y no duerme (caso E2E_BASE_URL explícita)', async () => {
    const reloj = relojFalso()
    let consultas = 0
    const f = async (url) => {
      if (String(url).includes('/deployments?')) consultas += 1
      return { ok: true, json: async () => [] }
    }
    const dormirProhibido = async () => { throw new Error('no debía dormir con tiempoMaxMs 0') }
    expect(
      await esperarUrlsPorSha(base({ fetchImpl: f, tiempoMaxMs: 0, ahora: reloj.ahora, dormir: dormirProhibido })),
    ).toEqual([])
    expect(consultas).toBe(1)
    expect(reloj.transcurrido).toBe(0)
  })

  it('sin repo o sin token no sondea: devolvería siempre lo mismo', async () => {
    const reloj = relojFalso()
    const f = () => { throw new Error('no debía consultar') }
    expect(await esperarUrlsPorSha(base({ repo: '', fetchImpl: f, ...reloj }))).toEqual([])
    expect(await esperarUrlsPorSha(base({ token: '', fetchImpl: f, ...reloj }))).toEqual([])
    expect(reloj.transcurrido).toBe(0)
  })

  it('el log de espera no imprime tokens ni URLs de API, sólo el sha corto y los segundos', async () => {
    const reloj = relojFalso()
    const lineas = []
    await esperarUrlsPorSha(
      base({ fetchImpl: listoTrasIntentos(1), registrar: (l) => lineas.push(l), ...reloj }),
    )
    const texto = lineas.join('\n')
    expect(texto).toContain('abcdef12')
    expect(texto).not.toContain('abcdef1234567890')
    expect(texto).not.toContain('api.github.com')
  })

  it('con E2E_BASE_URL explícita main NO espera a Vercel: una consulta y a evaluar', async () => {
    let consultas = 0
    const f = async (url) => {
      const s = String(url)
      if (s.includes('/deployments?')) {
        consultas += 1
        return { ok: true, json: async () => [] }
      }
      if (s.includes('e2e-meta.json')) return { ok: true, status: 200, json: async () => META_OK }
      return { ok: false, status: 404 }
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      // Sin avanzar el reloj: si main esperase, esta promesa no resolvería.
      const code = await main(
        { ...COMPLETAS, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't', E2E_BASE_URL: 'https://estable.vercel.app' },
        f,
      )
      expect(code).toBe(0)
    } finally {
      vi.useRealTimers()
      log.mockRestore()
    }
    expect(consultas).toBe(1)
  })

  it('main espera al despliegue tardío en vez de fallar en el primer intento', async () => {
    let consultas = 0
    const f = async (url) => {
      const s = String(url)
      if (s.includes('/deployments?')) {
        consultas += 1
        return { ok: true, json: async () => (consultas > 2 ? [{ id: 7 }] : []) }
      }
      if (s.includes('/statuses')) {
        return { ok: true, json: async () => [{ state: 'success', environment_url: 'https://tarde.vercel.app' }] }
      }
      return { ok: true, status: 200, json: async () => META_OK }
    }
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.useFakeTimers()
    try {
      const corriendo = main({ ...COMPLETAS, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' }, f)
      await vi.advanceTimersByTimeAsync(INTERVALO_SONDEO_MS * 3)
      expect(await corriendo).toBe(0)
    } finally {
      vi.useRealTimers()
      log.mockRestore()
    }
    expect(consultas).toBe(3)
  })
})

describe('main de punta a punta (fetch inyectado)', () => {
  const conDeploy = (meta) => async (url) => {
    const s = String(url)
    if (s.includes('/deployments?')) return { ok: true, json: async () => [{ id: 7 }] }
    if (s.includes('/statuses')) return { ok: true, json: async () => [{ state: 'success', environment_url: 'https://deploy-del-sha.vercel.app' }] }
    if (s.includes('e2e-meta.json')) return { ok: true, json: async () => meta }
    return { ok: false, status: 404 }
  }

  it('resuelve el despliegue del SHA, lo valida y sale 0', async () => {
    const code = await main({ ...COMPLETAS, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' }, conDeploy(META_OK))
    expect(code).toBe(0)
  })

  it('el despliegue del SHA con metadata vieja → sale 1', async () => {
    const code = await main(
      { ...COMPLETAS, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 't' },
      conDeploy({ ...META_OK, commit_sha: 'd'.repeat(40) }),
    )
    expect(code).toBe(1)
  })

  it('E2E_BASE_URL estática entra como candidato sometido a lo mismo', async () => {
    const soloMeta = async (url) => {
      const s = String(url)
      if (s.includes('e2e-meta.json')) return { ok: true, json: async () => META_OK }
      return { ok: false, status: 404 }
    }
    const code = await main({ ...COMPLETAS, E2E_BASE_URL: 'https://estable.vercel.app' }, soloMeta)
    expect(code).toBe(0)
  })
})

describe('la metadata que publica el build (generar-e2e-meta.mjs)', () => {
  it('el ref sale del hostname de VITE_SUPABASE_URL', () => {
    expect(refDeSupabaseUrl('https://sandboxref.supabase.co')).toBe('sandboxref')
    expect(refDeSupabaseUrl('')).toBeNull()
    expect(refDeSupabaseUrl('no-url')).toBeNull()
  })

  it('el marcador sólo aparece con VITE_E2E_ENVIRONMENT=e2e-sandbox exacto', () => {
    expect(construirMeta({ VITE_E2E_ENVIRONMENT: 'e2e-sandbox' }).environment).toBe('e2e-sandbox')
    expect(construirMeta({ VITE_E2E_ENVIRONMENT: 'production' }).environment).toBe('no-e2e')
    expect(construirMeta({}).environment).toBe('no-e2e')
  })

  it('el sha viene de Vercel o de Actions; un build local queda en null (y el preflight lo rechaza)', () => {
    expect(construirMeta({ VERCEL_GIT_COMMIT_SHA: 'v1' }).commit_sha).toBe('v1')
    expect(construirMeta({ GITHUB_SHA: 'g1' }).commit_sha).toBe('g1')
    expect(construirMeta({}).commit_sha).toBeNull()
  })

  it('no publica nada más que las tres claves', () => {
    expect(Object.keys(construirMeta({ VITE_SUPABASE_ANON_KEY: 'jamás' })).sort()).toEqual([
      'commit_sha',
      'environment',
      'supabase_project_ref',
    ])
  })

  it('el build lo genera (package.json) — sin el archivo no hay validación positiva posible', () => {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    expect(pkg.scripts.build).toContain('generar-e2e-meta.mjs')
  })
})

describe('dependencias FIJADAS, no instalación dinámica', () => {
  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))

  it('@playwright/test y @types/node están en package.json con versión exacta', () => {
    for (const dep of ['@playwright/test', '@types/node']) {
      const v = pkg.devDependencies[dep]
      expect(v, `${dep} no está en devDependencies`).toBeTruthy()
      expect(v, `${dep} no está fijada (${v})`).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('el lockfile las registra en la misma versión', () => {
    const lock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8'))
    expect(lock.packages['node_modules/@playwright/test'].version).toBe(pkg.devDependencies['@playwright/test'])
    expect(lock.packages['node_modules/@types/node'].version).toBe(pkg.devDependencies['@types/node'])
  })
})

describe('Vercel Deployment Protection — bypass fail-closed, token jamás impreso', () => {
  afterEach(() => vi.restoreAllMocks())

  const espiarConsola = () => {
    const impreso = []
    vi.spyOn(console, 'log').mockImplementation((...a) => impreso.push(a.join(' ')))
    vi.spyOn(console, 'error').mockImplementation((...a) => impreso.push(a.join(' ')))
    return impreso
  }

  it('leerMeta envía los DOS headers del bypass al pedir /e2e-meta.json', async () => {
    let headersVistos = null
    const f = async (_url, init) => {
      headersVistos = init.headers
      return { ok: true, status: 200, json: async () => META_OK }
    }
    const { meta } = await leerMeta('https://protegido.vercel.app', f, TOKEN_BYPASS)
    expect(meta).toEqual(META_OK)
    expect(headersVistos['x-vercel-protection-bypass']).toBe(TOKEN_BYPASS)
    expect(headersVistos['x-vercel-set-bypass-cookie']).toBe('true')
  })

  it('sin token no envía headers de bypass (local contra un dev server sin protección)', async () => {
    let headersVistos = null
    const f = async (_url, init) => {
      headersVistos = init.headers
      return { ok: true, status: 200, json: async () => META_OK }
    }
    await leerMeta('http://localhost:5173', f, '')
    expect(headersVistos['x-vercel-protection-bypass']).toBeUndefined()
    expect(headersVistos['x-vercel-set-bypass-cookie']).toBeUndefined()
  })

  it('token INVÁLIDO (la protección responde 401) → diagnóstico accionable que nombra la VARIABLE, no el valor', async () => {
    const f = async () => ({ ok: false, status: 401 })
    const { meta, errorFetch } = await leerMeta('https://protegido.vercel.app', f, TOKEN_BYPASS)
    expect(meta).toBeNull()
    expect(errorFetch).toContain('401')
    expect(errorFetch).toMatch(/Deployment Protection/)
    expect(errorFetch).toContain('E2E_VERCEL_BYPASS_TOKEN')
    expect(errorFetch).not.toContain(TOKEN_BYPASS)
  })

  it('un 403 recibe el mismo trato que el 401', async () => {
    const f = async () => ({ ok: false, status: 403 })
    const { errorFetch } = await leerMeta('https://protegido.vercel.app', f, TOKEN_BYPASS)
    expect(errorFetch).toMatch(/Deployment Protection/)
    expect(errorFetch).not.toContain(TOKEN_BYPASS)
  })

  it('Preview PROTEGIDO pero accesible con el token → main valida y sale 0, sin imprimir el token', async () => {
    const impreso = espiarConsola()
    const f = async (url, init) => {
      const s = String(url)
      if (s.includes('e2e-meta.json')) {
        // El "Preview protegido": sin el header correcto, 401.
        if (init?.headers?.['x-vercel-protection-bypass'] !== TOKEN_BYPASS) return { ok: false, status: 401 }
        return { ok: true, status: 200, json: async () => META_OK }
      }
      return { ok: false, status: 404 }
    }
    const code = await main({ ...COMPLETAS, E2E_BASE_URL: 'https://protegido.vercel.app' }, f)
    expect(code).toBe(0)
    expect(impreso.join('\n')).not.toContain(TOKEN_BYPASS)
  })

  it('token inválido de punta a punta → main sale 1 con el diagnóstico y nada impreso contiene el token', async () => {
    const impreso = espiarConsola()
    const f = async (url) => {
      if (String(url).includes('e2e-meta.json')) return { ok: false, status: 401 }
      return { ok: false, status: 404 }
    }
    const code = await main({ ...COMPLETAS, E2E_BASE_URL: 'https://protegido.vercel.app' }, f)
    expect(code).toBe(1)
    const todo = impreso.join('\n')
    expect(todo).toMatch(/Deployment Protection/)
    expect(todo).not.toContain(TOKEN_BYPASS)
  })

  it('el navegador recibe el bypass como COOKIE de origen, nunca como header global', () => {
    // El contrato completo (dos orígenes locales, cookie scope-ada, setup sin
    // trace) vive en scripts/__tests__/e2e-bypass.test.mjs. Aquí queda el
    // candado mínimo: extraHTTPHeaders con el token NO puede volver al config.
    const config = readFileSync(resolve('e2e/playwright.config.ts'), 'utf8')
    // Fuera de comentarios: el config EXPLICA por qué no usa extraHTTPHeaders,
    // y esa mención documental está bien — la ejecutable no.
    const sinComentarios = config
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n')
    expect(sinComentarios).not.toContain('extraHTTPHeaders')
    expect(sinComentarios).toContain('storageState: RUTA_ESTADO')
    expect(sinComentarios).toMatch(/dependencies:\s*\['setup'\]/)
  })
})

// El helper de login hacía clic en /iniciar sesión/i sin acotar y, con el modal
// abierto, el nav aporta un segundo botón con ese mismo nombre accesible:
// strict mode violation y 13 specs caídos en la primera corrida real
// (run 32752735170). El clic tiene que quedar DENTRO del diálogo.
describe('el helper de login no puede volver a chocar con el botón del nav', () => {
  const auth = readFileSync(resolve('e2e/fixtures/auth.ts'), 'utf8')

  it('el submit se acota al role="dialog", no a la página entera', () => {
    const iLogin = auth.indexOf('export async function login(')
    expect(iLogin).toBeGreaterThan(0)
    const cuerpo = auth.slice(iLogin)
    expect(cuerpo).toContain('await botonEnviarLogin(page).click()')
    // Sin ningún clic al botón SIN acotar dentro de login().
    expect(cuerpo).not.toMatch(/^\s*await page\s*\n?\s*\.?getByRole\('button', \{ name: \/iniciar sesión\/i \}\)\.click\(\)/m)
  })

  it('el acotador usa el rol del diálogo, no el título (que cambia con el idioma)', () => {
    expect(auth).toContain("const dialogoDeLogin = (page: Page) => page.getByRole('dialog')")
    expect(auth).toMatch(
      /export function botonEnviarLogin\(page: Page\) \{\s*\n\s*return dialogoDeLogin\(page\)\.getByRole\('button', \{ name: \/iniciar sesión\/i \}\)/,
    )
  })

  it('NINGÚN spec envía el formulario con un clic sin acotar: todos pasan por botonEnviarLogin', () => {
    // auth-login.e2e.ts conservaba su propio clic a page.getByRole(...) y siguió
    // reventando por strict mode cuando login() ya estaba arreglado.
    for (const archivo of readdirSync(resolve('e2e')).filter((f) => f.endsWith('.e2e.ts'))) {
      const texto = readFileSync(resolve('e2e', archivo), 'utf8')
      const clicsSinAcotar = texto
        .split('\n')
        .filter((l) => /getByRole\('button', \{ name: \/iniciar sesión\/i \}\)/.test(l))
        // El trigger del NAV (modal cerrado) sí es page-wide y usa .first().
        .filter((l) => !l.includes('.first()'))
      expect(clicsSinAcotar, `${archivo} envía el formulario sin acotar al diálogo`).toEqual([])
    }
  })

  it('el fallo de login dice POR QUÉ, no sólo que el campo sigue visible', () => {
    const auth = readFileSync(resolve('e2e/fixtures/auth.ts'), 'utf8')
    // Lee el mensaje que la app deja en el modal…
    expect(auth).toMatch(/\[role="alert"\], \.login-error/)
    // …y distingue "el backend rechazó" de "el submit no produjo respuesta".
    expect(auth).toContain('La app mostró:')
    expect(auth).toContain('La app NO mostró ningún mensaje de error')
    // La causa original no se tira: el stack de Playwright sigue disponible.
    expect(auth).toContain('{ cause: e }')
  })

  it('el modal de Nav.tsx sigue siendo un role="dialog": el selector no puede quedar huérfano', () => {
    const nav = readFileSync(resolve('src/components/landing/Nav.tsx'), 'utf8')
    expect(nav).toMatch(/role="dialog"/)
  })
})

// El verificador leyó playwright-results.json desde la raíz y no estaba: con
// una ruta relativa, Playwright lo dejó en otro sitio y el paso murió con
// ENOENT aunque la suite había corrido entera (run 32753812314).
// Un getByLabel de Playwright NO encuentra un <label> suelto: exige asociación
// real (htmlFor→id, envoltura o aria-label). LecturasSection tenía los labels
// sin asociar, así que `getByLabel('Seleccionar Unidad')` no resolvía y dos
// specs OBLIGATORIOS se auto-skipeaban con «UI de lecturas no disponible para
// este rol» — un mensaje que culpaba al rol de un defecto de accesibilidad.
// Esto ata las dos puntas: cada label que un spec direccione por getByLabel
// tiene que estar asociado a un control en la app.
describe('los labels que los specs direccionan están asociados a su control', () => {
  const specs = readdirSync(resolve('e2e'))
    .filter((f) => f.endsWith('.e2e.ts'))
    .map((f) => readFileSync(resolve('e2e', f), 'utf8'))

  /** Los textos que los specs buscan con getByLabel(/…/i). */
  const etiquetasBuscadas = [
    ...new Set(specs.flatMap((t) => [...t.matchAll(/getByLabel\(\/([^/]+)\/i\)/g)].map((m) => m[1]))),
  ]

  const fuentes = new Map()
  const leerFuente = (ruta) => {
    if (!fuentes.has(ruta)) fuentes.set(ruta, readFileSync(ruta, 'utf8'))
    return fuentes.get(ruta)
  }

  it('los specs efectivamente usan getByLabel (si no, esta prueba no vigila nada)', () => {
    expect(etiquetasBuscadas.length).toBeGreaterThan(0)
  })

  for (const etiqueta of etiquetasBuscadas) {
    it(`"${etiqueta}" está asociada a un control`, () => {
      // Se busca el <label> por su texto en los componentes de la app.
      const candidatos = execSync(
        `grep -rl ">${etiqueta}</label>" src --include=*.tsx || true`,
        { encoding: 'utf8' },
      )
        .split('\n')
        .filter(Boolean)

      // Si ningún componente declara ese texto como <label>, el spec lo
      // resuelve por otra vía (aria-label, envoltura) y aquí no hay nada que
      // exigir; lo que NO puede pasar es un <label> suelto.
      if (candidatos.length === 0) return

      for (const ruta of candidatos) {
        const fuente = leerFuente(ruta)
        const linea = fuente
          .split('\n')
          .find((l) => l.includes(`>${etiqueta}</label>`))
        expect(linea, `${ruta}: <label>${etiqueta}</label> sin htmlFor`).toMatch(/htmlFor="([^"]+)"/)
        const id = linea.match(/htmlFor="([^"]+)"/)[1]
        expect(fuente, `${ruta}: htmlFor="${id}" no tiene ningún control con ese id`).toContain(`id="${id}"`)
      }
    })
  }

  it('ningún htmlFor de LecturasSection apunta a un id inexistente', () => {
    const fuente = readFileSync(resolve('src/components/lecturas/LecturasSection.tsx'), 'utf8')
    const ids = [...fuente.matchAll(/htmlFor="([^"]+)"/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) expect(fuente, `htmlFor="${id}" huérfano`).toContain(`id="${id}"`)
  })
})

// Las secciones de dinero tienen acciones MASIVAS en la barra («Emitir
// facturas», «📤 Emitir período») que se renderizan SIEMPRE, aunque la tabla no
// tenga una sola fila. Un getByRole('button', { name: /Emitir/i }).first()
// agarraba una de ellas: la prueba abría un diálogo de confirmación, la
// aserción encontraba el texto "Emitida" en otro sitio de la página y pasaba
// EN VERDE sin haber emitido nada — exactamente el falso verde que este PR
// existe para eliminar (run 32778903667: la cuota E2E-PENDIENTE seguía en
// 'pendiente' con emitida_at nulo después de que la prueba "pasara").
describe('los caminos de dinero no pueden confundir la acción masiva con la de fila', () => {
  const specsDeDinero = ['agua-lectura-cobro.e2e.ts', 'condominios-cuota.e2e.ts']

  /** Sin las líneas de comentario: el propio comentario que explica la trampa
   *  nombra el localizador prohibido, y lo que se vigila es el CÓDIGO. */
  const codigoDe = (archivo) =>
    readFileSync(resolve('e2e', archivo), 'utf8')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n')

  for (const archivo of specsDeDinero) {
    const texto = codigoDe(archivo)

    it(`${archivo} direcciona el botón por su title de FILA, no por /Emitir/i`, () => {
      expect(texto).toMatch(/button\[title\^?=/)
      // El localizador ambiguo no puede volver.
      expect(texto).not.toMatch(/getByRole\('button', \{ name: \/Emitir\/i \}\)/)
      expect(texto).not.toMatch(/getByRole\('button', \{ name: \/Pagar\/i \}\)/)
    })

    it(`${archivo} afirma que el botón de la fila DESAPARECE, no que exista un texto`, () => {
      // toHaveCount(antes - 1) prueba la transición; getByText(/Emitida/) no.
      expect(texto).toMatch(/toHaveCount\(antes - 1/)
      expect(texto).not.toMatch(/getByText\(\/Emitida\/i\)/)
      expect(texto).not.toMatch(/getByText\(\/Pagada\/i\)/)
    })
  }

  it('los titles que los specs buscan existen en los componentes', () => {
    const titulos = specsDeDinero.flatMap((a) =>
      [...codigoDe(a).matchAll(/button\[title\^?="([^"]+)"\]/g)].map((m) => m[1]),
    )
    expect(titulos.length).toBeGreaterThan(0)
    for (const t of titulos) {
      const hallado = execSync(`grep -rl 'title="${t}' src --include=*.tsx || true`, { encoding: 'utf8' }).trim()
      expect(hallado, `ningún componente declara title="${t}…"`).not.toBe('')
    }
  })
})

describe('el reporte JSON aterriza donde el verificador lo busca', () => {
  const config = readFileSync(resolve('e2e/playwright.config.ts'), 'utf8')

  it('el reporter json usa una ruta ABSOLUTA anclada a la raíz del repo', () => {
    expect(config).toContain("['json', { outputFile: RUTA_REPORTE_JSON }]")
    expect(config).toMatch(/const RAIZ_DEL_REPO = join\(dirname\(fileURLToPath\(import\.meta\.url\)\), '\.\.'\)/)
    expect(config).toMatch(/RUTA_REPORTE_JSON = join\(RAIZ_DEL_REPO, 'playwright-results\.json'\)/)
    // La relativa suelta no puede volver.
    expect(config).not.toContain("outputFile: 'playwright-results.json'")
  })

  it('el verificador y el workflow apuntan a ese mismo nombre', () => {
    const verificador = readFileSync(resolve('scripts/e2e-verificar.mjs'), 'utf8')
    expect(verificador).toContain("ruta = 'playwright-results.json'")
    const yml = readFileSync(resolve('.github/workflows/e2e.yml'), 'utf8')
    expect(yml).toContain('playwright-results.json')
  })
})

describe('el YAML invoca el contrato (no una copia)', () => {
  const jobE2e = readFileSync(resolve('.github/workflows/e2e.yml'), 'utf8')

  it('vive en su PROPIO workflow: coverage.yml ya no tiene job e2e', () => {
    const cov = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    // Fuera de comentarios (el header de coverage.yml SEÑALA a e2e.yml, y eso
    // está bien): ni job e2e, ni pasos de Playwright, ni el grupo del sandbox.
    const sinComentarios = cov
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n')
    expect(sinComentarios).not.toMatch(/^ {2}e2e:/m)
    expect(sinComentarios.toLowerCase()).not.toContain('playwright')
    expect(sinComentarios).not.toContain('e2e-shared-sandbox')
  })

  it('se dispara en pull_request y workflow_dispatch — y NO en push a main (no hay deployment e2e-sandbox del SHA de main)', () => {
    const lineas = jobE2e.split('\n')
    const iOn = lineas.findIndex((l) => /^on:\s*$/.test(l))
    expect(iOn).toBeGreaterThanOrEqual(0)
    const seccionOn = []
    for (const l of lineas.slice(iOn + 1)) {
      if (/^\S/.test(l)) break
      seccionOn.push(l)
    }
    const texto = seccionOn.join('\n')
    expect(texto).toMatch(/^ {2}pull_request:/m)
    expect(texto).toMatch(/^ {2}workflow_dispatch:/m)
    expect(texto).not.toMatch(/^ {2}push:/m)
    // Como clave en TODO el workflow, no sólo en la sección on:
    expect(lineas.some((l) => /^\s*pull_request_target\s*:/.test(l))).toBe(false)
  })

  it('preflight con contexto de fork, SHA del HEAD del PR (no el merge commit) y token', () => {
    expect(jobE2e).toContain('run: node scripts/e2e-preflight.mjs')
    expect(jobE2e).toContain('ES_FORK: ${{ github.event.pull_request.head.repo.fork }}')
    expect(jobE2e).toContain('SHA_ESPERADO: ${{ github.event.pull_request.head.sha || github.sha }}')
    expect(jobE2e).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}')
  })

  it('concurrency: grupo fijo del sandbox compartido, sin cancelar en curso', () => {
    expect(jobE2e).toMatch(/concurrency:\s*\n\s+group: e2e-shared-sandbox\s*\n\s+cancel-in-progress: false/)
  })

  it('permissions mínimos: contents + deployments de lectura', () => {
    expect(jobE2e).toMatch(/permissions:\s*\n\s+contents: read\s*\n(\s*#[^\n]*\n)*\s+deployments: read/)
  })

  it('Run E2E usa la URL VALIDADA del preflight, no el secreto en crudo', () => {
    const i = jobE2e.indexOf('- name: Run E2E')
    const bloque = jobE2e.slice(i, jobE2e.indexOf('- name:', i + 1))
    expect(bloque).toContain('E2E_BASE_URL: ${{ steps.preflight.outputs.url }}')
  })

  it('el verificador corre AUNQUE Playwright falle: el recuento no se pierde con el rojo', () => {
    // En la corrida 32752735170 Playwright falló y este paso quedó skipped: se
    // perdió saber cuántas pruebas corrieron y cuántas se omitieron.
    const i = jobE2e.indexOf('- name: Verificar que la suite ejecutó pruebas de verdad')
    expect(i).toBeGreaterThan(0)
    const bloque = jobE2e.slice(i, jobE2e.indexOf('- name:', i + 1))
    expect(bloque).toContain('node scripts/e2e-verificar.mjs')
    expect(bloque).toMatch(/if:\s*\$\{\{\s*!cancelled\(\)/)
    // Y se salta sólo cuando Playwright ni arrancó (no hay reporte que leer).
    expect(bloque).toContain("steps.playwright.outcome != 'skipped'")
    expect(jobE2e).toMatch(/- name: Run E2E\n\s+id: playwright\b/)
  })

  it('la instalación dinámica con caret desapareció: npm ci + sólo el binario del navegador', () => {
    expect(jobE2e).not.toContain('npm i -D --no-save')
    expect(jobE2e).not.toContain('@playwright/test@^')
    expect(jobE2e).toContain('run: npm ci')
    expect(jobE2e).toContain('npx playwright install --with-deps chromium')
  })

  it('el camino no-op verde sigue muerto', () => {
    expect(jobE2e).not.toContain('run=false')
    expect(jobE2e).not.toMatch(/steps\.gate\.outputs\.run/)
    expect(jobE2e).not.toMatch(/::warning title=E2E omitido/)
  })

  it('E2E_EXPECTED_SUPABASE_REF y E2E_VERCEL_BYPASS_TOKEN llegan desde secrets', () => {
    expect(jobE2e).toContain('E2E_EXPECTED_SUPABASE_REF: ${{ secrets.E2E_EXPECTED_SUPABASE_REF }}')
    expect(jobE2e).toContain('E2E_VERCEL_BYPASS_TOKEN: ${{ secrets.E2E_VERCEL_BYPASS_TOKEN }}')
  })

  it('el verificador corre DESPUÉS de Run E2E y el reporte se sube con always()', () => {
    expect(jobE2e.indexOf('run: node scripts/e2e-verificar.mjs')).toBeGreaterThan(jobE2e.indexOf('- name: Run E2E'))
    const i = jobE2e.indexOf('- name: Upload Playwright report')
    expect(jobE2e.slice(i)).toMatch(/if:\s*\$\{\{\s*always\(\)\s*\}\}/)
  })

  it('sin service_role por ningún lado (fuera del comentario que declara su ausencia)', () => {
    const sinComentarios = jobE2e
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n')
    expect(sinComentarios.toLowerCase()).not.toContain('service_role')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Un spec no puede afirmar un texto que la app nunca dice.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO QUE ESTO CIERRA (run 32888464432).
// agua-lectura-validaciones esperaba ver /Consumo Negativo|mayor o igual a la
// anterior/ tras meter una lectura negativa. Ninguna de las dos frases existe
// en el código: el mensaje real de validarLectura es «La lectura actual no
// puede ser negativa.». La prueba no podía pasar NUNCA — y su fallo,
// «element(s) not found» tras 15 s, se lee igual que una regresión de la app.
// Quince minutos de corrida y tres reintentos para descubrir que el error
// estaba en la prueba.
//
// Esto es estático: cuesta milisegundos y falla con el nombre del archivo.
describe('los textos que los specs afirman tienen que existir en la app', () => {
  const fuentesDeSrc = (() => {
    const acc = []
    const recorrer = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, e.name)
        if (e.isDirectory()) recorrer(p)
        else if (/\.tsx?$/.test(e.name)) acc.push(readFileSync(p, 'utf8'))
      }
    }
    recorrer(resolve('src'))
    return acc.join('\n')
  })()

  /** Alternativas literales de un getByText(/a|b/): 'a', 'b'. */
  const alternativas = (patron) =>
    patron
      .split('|')
      .map((a) => a.trim())
      .filter((a) => a.length > 0)

  const casos = []
  for (const archivo of readdirSync(resolve('e2e')).filter((f) => f.endsWith('.e2e.ts'))) {
    const fuente = readFileSync(resolve('e2e', archivo), 'utf8')
    for (const m of fuente.matchAll(/getByText\(\/([^/]+)\//g)) {
      casos.push({ archivo, patron: m[1] })
    }
  }

  it('hay textos que comprobar (si esto cae a cero, el extractor se rompió)', () => {
    // Sin este piso, borrar el regex de arriba dejaría la guarda verde y vacía.
    expect(casos.length).toBeGreaterThan(0)
  })

  it.each(casos)('$archivo: /$patron/ aparece en src/', ({ patron }) => {
    // Basta con que UNA alternativa exista: /Timbrado|Rechazado/ afirma un
    // estado u otro, no los dos a la vez.
    const encontradas = alternativas(patron).filter((a) => fuentesDeSrc.includes(a))
    expect(encontradas.length).toBeGreaterThan(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Las dos aserciones espejo del formulario de lecturas no pueden invertirse.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO QUE ESTO CIERRA (run 32888464432). «captura una lectura de medidor»
// afirmaba que tras pulsar «Guardar Lectura» el botón SEGUÍA visible, con el
// comentario "el form sigue operable". Está al revés: LecturasSection sólo
// llama a limpiarFormulario() en los caminos de guardado, y eso desmonta el
// bloque {contadorSeleccionado && …} con el botón dentro. Un rechazo de
// validación hace `return notify(...)` antes y deja el formulario en pantalla.
// O sea: la prueba pasaba cuando la lectura NO se guardaba.
//
// No salió como rojo sino como "flaky" — el primer intento guardó de verdad y
// falló, el reintento no guardó y pasó. Un verde falso disfrazado de
// intermitencia, que es la forma más cara de todas.
//
// El par sólo prueba algo mientras siga siendo un par: éxito = desaparece,
// rechazo = permanece. Invertir cualquiera de los dos lo rompe en silencio.
describe('éxito y rechazo del guardado de lecturas se afirman al revés uno del otro', () => {
  const cobro = readFileSync(resolve('e2e/agua-lectura-cobro.e2e.ts'), 'utf8')
  const validaciones = readFileSync(resolve('e2e/agua-lectura-validaciones.e2e.ts'), 'utf8')
  const sinComentarios = (s) =>
    s.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')

  it('captura exitosa: el botón de guardar DESAPARECE', () => {
    expect(sinComentarios(cobro)).toMatch(/expect\(guardar\)\.toBeHidden\(/)
    expect(sinComentarios(cobro)).not.toMatch(/expect\(guardar\)\.toBeVisible\(/)
  })

  it('rechazo por consumo negativo: el botón de guardar PERMANECE', () => {
    expect(sinComentarios(validaciones)).toMatch(/expect\(guardar\)\.toBeVisible\(/)
    expect(sinComentarios(validaciones)).not.toMatch(/expect\(guardar\)\.toBeHidden\(/)
  })

  it('la lectura que se captura NO es una constante (clave natural anti-duplicado)', () => {
    // uq_registros_llave_natural es (contador_id, lectura_actual, fecha): con
    // un valor fijo, la segunda corrida del mismo día choca con el índice y el
    // guardado se rechaza — la prueba se caería sin que nada esté roto.
    expect(sinComentarios(cobro)).toMatch(/fill\(lectura\)/)
    expect(sinComentarios(cobro)).toMatch(/Date\.now\(\)/)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// Los caminos de dinero CREAN lo que consumen: la suite no se queda sin datos.
// ════════════════════════════════════════════════════════════════════════════
// EL PROBLEMA QUE ESTO CIERRA. Emitir gasta una cuota pendiente; pagar gasta
// una emitida; emitir factura gasta un cargo pendiente. Con los datos venidos
// de una siembra manual por SQL, la suite pasaba UNA vez: el run 32889832167
// quedó en verde y la corrida SIGUIENTE se habría omitido con «sin cuotas
// pendientes» — un skip inesperado, o sea rojo, sin que nada estuviera roto.
// Un verde que sólo ocurre una vez no es un verde, es una foto.
//
// La garantía es que cada prueba destructiva fabrique su precondición por la
// misma UI que después ejercita. Si alguien la quita y vuelve a apoyarse en
// datos preexistentes, esto se pone rojo antes de que la suite lo descubra
// una corrida tarde.
describe('los specs de dinero fabrican su propia precondición', () => {
  const cuota = readFileSync(resolve('e2e/condominios-cuota.e2e.ts'), 'utf8')
  const cobro = readFileSync(resolve('e2e/agua-lectura-cobro.e2e.ts'), 'utf8')
  const sembrar = readFileSync(resolve('e2e/fixtures/sembrar.ts'), 'utf8')
  const sinComentarios = (s) =>
    s.split('\n').filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*')).join('\n')

  it('las DOS pruebas de cuota crean la cuota antes de emitir o pagar', () => {
    // Dos llamadas: una por prueba. Pagar necesita además emitirla primero,
    // porque el alta las crea pendientes.
    const llamadas = sinComentarios(cuota).match(/crearCuotaPendiente\(page\)/g) ?? []
    expect(llamadas).toHaveLength(2)
  })

  it('la prueba del cargo de agua captura su lectura antes de emitir', () => {
    // Un registro de lectura nace con factura_estado 'pendiente': capturar ES
    // crear el cargo. No vale confiar en que la prueba de arriba ya lo hizo —
    // las pruebas no pueden depender del orden de ejecución.
    expect(sinComentarios(cobro)).toMatch(/capturarLectura\(page\)/)
  })

  it('ningún spec de dinero se omite por falta del dato TRANSACCIONAL', () => {
    // La distinción importa. Hay dos clases de precondición:
    //
    //   · el dato TRANSACCIONAL —la cuota pendiente, el cargo por facturar—,
    //     que la prueba consume y que ahora fabrica ella misma. Omitirse por
    //     esto es la regresión que este bloque persigue.
    //   · el FIXTURE DEL TENANT —una unidad, un contador con tarifa vigente—,
    //     que es alta de administración y queda fuera del alcance de un spec
    //     de dinero. Su ausencia sigue siendo un skip, y el verificador lo
    //     pondrá en rojo igual: es una señal fail-closed sobre el entorno, no
    //     sobre el código, y ahí el rojo es la respuesta correcta.
    //
    // Por eso se prohíben las razones concretas que confesaban lo primero, no
    // cualquier mención a sembrar.
    const PROHIBIDAS = [/sin cuotas pendientes/i, /sin cuotas cobrables/i, /sin cargos pendientes/i]
    for (const [nombre, fuente] of [['cuota', cuota], ['cobro', cobro]]) {
      const razones = [...sinComentarios(fuente).matchAll(/test\.skip\([^,]+,\s*'([^']*)'/g)].map((m) => m[1])
      expect(razones.length, `${nombre} debería tener guardas de runtime`).toBeGreaterThan(0)
      for (const razon of razones) {
        for (const prohibida of PROHIBIDAS) {
          expect(razon, `${nombre}: "${razon}" espera el dato en vez de crearlo`).not.toMatch(prohibida)
        }
      }
    }
  })

  it('el alta CONFIRMA que creó la fila, no sólo que pulsó Guardar', () => {
    // Sin esta aserción, un alta fallida se manifestaría más tarde como un
    // skip confuso en la prueba que la consume.
    expect(sinComentarios(sembrar)).toMatch(/toHaveCount\(antes \+ 1/)
  })

  it('la cuota creada NO vence hoy: nacería vencida y no se podría cobrar', () => {
    expect(sinComentarios(sembrar)).toMatch(/30 \* 86_400_000/)
  })
})
