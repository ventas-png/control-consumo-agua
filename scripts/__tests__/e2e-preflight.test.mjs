// ════════════════════════════════════════════════════════════════════════════
// Contrato del preflight E2E: tabla de decisión, validación positiva y el YAML.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO QUE ESTO CIERRA (en dos capas). Primera: el job salió VERDE SIN
// EJECUTAR durante semanas — sin E2E_BASE_URL, un warning y éxito. Segunda: una
// denylist sola valida por exclusión, y una URL estable validaría un commit
// viejo. El contrato fijado aquí: falta variable → rojo; fork/Dependabot →
// rojo explicado; y el destino se demuestra a sí mismo — marcador
// environment=e2e-sandbox, ref de Supabase declarado y el MISMO sha del job.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  HOSTS_PRODUCCION,
  VARIABLES_CONDICIONALES,
  VARIABLES_OBLIGATORIAS,
  decidirDestino,
  decidirPreflight,
  main,
  resolverUrlsPorSha,
  validarBaseUrl,
  validarMetadata,
} from '../e2e-preflight.mjs'
import { construirMeta, refDeSupabaseUrl } from '../generar-e2e-meta.mjs'

const COMPLETAS = {
  E2E_LOGIN_EMAIL: 'e2e@sandbox.invalid',
  E2E_LOGIN_PASSWORD: 'x',
  E2E_RESTRICTED_EMAIL: 'e2e-restricted@sandbox.invalid',
  E2E_RESTRICTED_PASSWORD: 'y',
  E2E_EXPECTED_SUPABASE_REF: 'sandboxref',
  SHA_ESPERADO: 'a'.repeat(40),
}
const ESPERADO = { sha: COMPLETAS.SHA_ESPERADO, ref: 'sandboxref' }
const META_OK = {
  commit_sha: COMPLETAS.SHA_ESPERADO,
  environment: 'e2e-sandbox',
  supabase_project_ref: 'sandboxref',
}

describe('inventario de variables', () => {
  it('las obligatorias: credenciales + la DECLARACIÓN del ref (la URL ya no, se resuelve por SHA)', () => {
    expect([...VARIABLES_OBLIGATORIAS].sort()).toEqual([
      'E2E_EXPECTED_SUPABASE_REF',
      'E2E_LOGIN_EMAIL',
      'E2E_LOGIN_PASSWORD',
      'E2E_RESTRICTED_EMAIL',
      'E2E_RESTRICTED_PASSWORD',
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

describe('el YAML invoca el contrato (no una copia)', () => {
  const yml = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
  const jobE2e = yml.slice(yml.indexOf('  e2e:'), yml.indexOf('  rls-sandbox:'))

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

  it('E2E_EXPECTED_SUPABASE_REF llega desde secrets', () => {
    expect(jobE2e).toContain('E2E_EXPECTED_SUPABASE_REF: ${{ secrets.E2E_EXPECTED_SUPABASE_REF }}')
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
