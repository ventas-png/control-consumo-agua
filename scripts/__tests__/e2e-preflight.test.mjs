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
import { readFileSync } from 'node:fs'
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
    const reloj = relojFalso()
    const urls = await esperarUrlsPorSha(
      base({ fetchImpl: listoTrasIntentos(Number.POSITIVE_INFINITY), tiempoMaxMs: 60_000, ...reloj }),
    )
    expect(urls).toEqual([])
    expect(reloj.transcurrido).toBeLessThanOrEqual(60_000)
  })

  it('con tiempoMaxMs 0 hace UN intento y no duerme (caso E2E_BASE_URL explícita)', async () => {
    const reloj = relojFalso()
    let consultas = 0
    const f = async (url) => {
      if (String(url).includes('/deployments?')) consultas += 1
      return { ok: true, json: async () => [] }
    }
    expect(await esperarUrlsPorSha(base({ fetchImpl: f, tiempoMaxMs: 0, ...reloj }))).toEqual([])
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
