// ════════════════════════════════════════════════════════════════════════════
// Contrato del preflight E2E: la tabla de decisión y el YAML que la invoca.
// ════════════════════════════════════════════════════════════════════════════
// EL FALLO QUE ESTO CIERRA. El job `e2e` salió VERDE SIN EJECUTAR durante
// semanas: sin E2E_BASE_URL emitía un warning y terminaba en éxito. Estas
// pruebas fijan el contrato contrario —falta una variable → rojo; fork y
// Dependabot → rojo con explicación; destino de producción → rojo— y lo atan
// al YAML real, para que un refactor del workflow no lo afloje en silencio.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  HOSTS_PRODUCCION,
  VARIABLES_CONDICIONALES,
  VARIABLES_OBLIGATORIAS,
  decidirPreflight,
  validarBaseUrl,
} from '../e2e-preflight.mjs'

const COMPLETAS = {
  E2E_BASE_URL: 'https://control-consumo-agu-git-estable-prestadora.vercel.app',
  E2E_LOGIN_EMAIL: 'e2e@sandbox.invalid',
  E2E_LOGIN_PASSWORD: 'x',
  E2E_RESTRICTED_EMAIL: 'e2e-restricted@sandbox.invalid',
  E2E_RESTRICTED_PASSWORD: 'y',
}

describe('inventario de variables', () => {
  it('las obligatorias son exactamente las cinco que exigen los specs troncales', () => {
    expect([...VARIABLES_OBLIGATORIAS].sort()).toEqual([
      'E2E_BASE_URL',
      'E2E_LOGIN_EMAIL',
      'E2E_LOGIN_PASSWORD',
      'E2E_RESTRICTED_EMAIL',
      'E2E_RESTRICTED_PASSWORD',
    ])
  })

  it('las condicionales son el token efímero y el flag del PAC — con razón estructural, no por comodidad', () => {
    expect([...VARIABLES_CONDICIONALES].sort()).toEqual([
      'E2E_FISCAL_SANDBOX_READY',
      'E2E_INVITE_TOKEN',
    ])
  })

  it('los nombres coinciden con los que lee e2e/fixtures/env.ts', () => {
    const env = readFileSync(resolve('e2e/fixtures/env.ts'), 'utf8')
    for (const v of [...VARIABLES_OBLIGATORIAS, ...VARIABLES_CONDICIONALES]) {
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

  it('sin ninguna, el mensaje enumera las cinco', () => {
    const r = decidirPreflight({})
    expect(r.decision).toBe('fail')
    for (const v of VARIABLES_OBLIGATORIAS) expect(r.mensaje).toContain(v)
  })

  it('las condicionales ausentes NO tumban el preflight, y el mensaje lo declara', () => {
    const r = decidirPreflight(COMPLETAS)
    expect(r.decision).toBe('run')
    expect(r.mensaje).toContain('omitidos DECLARADOS')
    expect(r.mensaje).toContain('E2E_INVITE_TOKEN')
  })
})

describe('contextos sin secretos por diseño → rojo con explicación, no verde', () => {
  it('PR de fork → bloqueado (exit 1), nombrando al fork', () => {
    const r = decidirPreflight({ ES_FORK: 'true', GITHUB_EVENT_NAME: 'pull_request' })
    expect(r.decision).toBe('bloqueado')
    expect(r.motivo.clave).toBe('fork')
    expect(r.mensaje).toMatch(/rojo a propósito/)
  })

  it('PR de Dependabot → bloqueado (exit 1)', () => {
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

describe('la guarda de destino: nunca producción', () => {
  for (const host of HOSTS_PRODUCCION) {
    it(`rechaza https://${host}`, () => {
      const r = decidirPreflight({ ...COMPLETAS, E2E_BASE_URL: `https://${host}` })
      expect(r.decision).toBe('fail')
      expect(r.mensaje).toMatch(/RECHAZADO/)
    })
  }

  it('rechaza subdominios de los dominios raíz de producción', () => {
    for (const url of ['https://app.administratodo.com', 'https://x.administratodo.app', 'https://pre.prestadoradeserviciosbasicos.com']) {
      expect(validarBaseUrl(url).ok, url).toBe(false)
    }
  })

  it('rechaza http hacia hosts remotos (credenciales en claro) pero admite localhost', () => {
    expect(validarBaseUrl('http://preview.example.com').ok).toBe(false)
    expect(validarBaseUrl('http://localhost:5173').ok).toBe(true)
    expect(validarBaseUrl('http://127.0.0.1:5173').ok).toBe(true)
  })

  it('rechaza una URL malformada', () => {
    expect(validarBaseUrl('no-es-una-url').ok).toBe(false)
  })

  it('admite un preview/estable de Vercel por https', () => {
    expect(validarBaseUrl('https://control-consumo-agu-git-estable-prestadora.vercel.app').ok).toBe(true)
  })

  it('la lista de hosts prohibidos cubre TODOS los hosts de producción de vercel.json', () => {
    // vercel.json es la declaración de producción de la propia app: si alguien
    // añade un dominio allí y no aquí, la guarda queda coja sin que nada avise.
    const vercel = readFileSync(resolve('vercel.json'), 'utf8')
    const patron = vercel.match(/"value":\s*"\(([^"]+)\)"/)
    expect(patron, 'no se encontró el patrón de hosts en vercel.json').not.toBeNull()
    const hosts = patron[1].split('|').map((h) => h.replace(/\\\\./g, '.'))
    for (const h of hosts) {
      expect(HOSTS_PRODUCCION, `host de producción sin vetar: ${h}`).toContain(h)
    }
  })
})

describe('el YAML invoca el contrato (no una copia)', () => {
  const yml = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
  const jobE2e = yml.slice(yml.indexOf('  e2e:'), yml.indexOf('  rls-sandbox:'))

  it('el paso de preflight ejecuta scripts/e2e-preflight.mjs con el contexto de fork', () => {
    expect(jobE2e).toContain('run: node scripts/e2e-preflight.mjs')
    expect(jobE2e).toContain('ES_FORK: ${{ github.event.pull_request.head.repo.fork }}')
    expect(jobE2e).toContain('GITHUB_EVENT_NAME: ${{ github.event_name }}')
  })

  it('el camino no-op verde desapareció', () => {
    // La forma vieja: un output run=false que dejaba todos los pasos en skip y
    // el job en verde. Ninguna de sus piezas puede sobrevivir.
    expect(jobE2e).not.toContain('run=false')
    expect(jobE2e).not.toMatch(/steps\.gate\.outputs\.run/)
    expect(jobE2e).not.toMatch(/::warning title=E2E omitido/)
  })

  it('instalación, type-check y Playwright corren SIN condición (post-preflight)', () => {
    for (const paso of ['Install dependencies', 'Install Playwright (on-demand)', 'Type-check e2e', 'Run E2E']) {
      const i = jobE2e.indexOf(`- name: ${paso}`)
      expect(i, `falta el paso ${paso}`).toBeGreaterThan(-1)
      const bloque = jobE2e.slice(i, jobE2e.indexOf('- name:', i + 1))
      expect(bloque, `${paso} quedó condicionado`).not.toMatch(/\n\s+if:/)
    }
  })

  it('el verificador corre DESPUÉS de Run E2E', () => {
    const iRun = jobE2e.indexOf('- name: Run E2E')
    const iVerif = jobE2e.indexOf('run: node scripts/e2e-verificar.mjs')
    expect(iRun).toBeGreaterThan(-1)
    expect(iVerif).toBeGreaterThan(iRun)
  })

  it('el reporte se sube con always(), también en rojo', () => {
    const i = jobE2e.indexOf('- name: Upload Playwright report')
    const bloque = jobE2e.slice(i)
    expect(bloque).toMatch(/if:\s*\$\{\{\s*always\(\)\s*\}\}/)
    expect(bloque).toContain('playwright-results.json')
  })

  it('el config de Playwright genera el JSON que el verificador exige', () => {
    const cfg = readFileSync(resolve('e2e/playwright.config.ts'), 'utf8')
    expect(cfg).toContain("['json', { outputFile: 'playwright-results.json' }]")
  })
})
