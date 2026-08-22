// ════════════════════════════════════════════════════════════════════════════
// Contrato del verificador post-ejecución E2E.
// ════════════════════════════════════════════════════════════════════════════
// Playwright sale con exit 0 cuando TODO quedó skipped: para él, cero fallos.
// Este verificador convierte esa no-ejecución en rojo. Las pruebas fijan cada
// regla con reportes sintéticos con la forma real del reporter JSON de
// Playwright (suites → specs → tests → status/annotations).
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  SPECS_CONDICIONALES,
  SPECS_OBLIGATORIOS,
  resumir,
  verificar,
} from '../e2e-verificar.mjs'

const t = (status, razon) => ({
  status,
  annotations: razon ? [{ type: 'skip', description: razon }] : [],
})
const spec = (file, tests) => ({ specs: [{ file, tests }] })
const TODOS = [...SPECS_OBLIGATORIOS, ...SPECS_CONDICIONALES.map((c) => c.archivo)]
const reporteCompleto = (estadoPorArchivo = {}) => ({
  suites: TODOS.map((f) => {
    const estado = estadoPorArchivo[f] ?? 'expected'
    return spec(f, [t(estado, estado === 'skipped' ? `razón de ${f}` : undefined)])
  }),
})

describe('las listas de specs espejan el directorio e2e/', () => {
  it('cada spec declarado existe en disco', () => {
    const enDisco = readdirSync(resolve('e2e')).filter((f) => f.endsWith('.e2e.ts'))
    for (const f of TODOS) expect(enDisco, `declarado pero ausente: ${f}`).toContain(f)
  })

  it('ningún spec del disco se quedó sin declarar', () => {
    // El complemento: un spec nuevo que nadie clasifique quedaría fuera de la
    // contabilidad y podría skipearse para siempre sin que el job lo note.
    const enDisco = readdirSync(resolve('e2e')).filter((f) => f.endsWith('.e2e.ts'))
    expect([...enDisco].sort()).toEqual([...TODOS].sort())
  })

  it('cada condicional apunta a una variable que su spec realmente lee', () => {
    for (const { archivo, variable } of SPECS_CONDICIONALES) {
      const gate = { E2E_INVITE_TOKEN: 'hasInviteToken', E2E_FISCAL_SANDBOX_READY: 'FISCAL_SANDBOX_READY' }[variable]
      const fuente = readFileSync(resolve('e2e', archivo), 'utf8')
      expect(fuente, `${archivo} no usa el gate de ${variable}`).toContain(gate)
    }
  })
})

describe('reglas de no-ejecución', () => {
  it('reporte sin pruebas → rojo', () => {
    const { fallos } = verificar(resumir({ suites: [] }), {})
    expect(fallos).toHaveLength(1)
    expect(fallos[0]).toMatch(/NINGUNA prueba/)
  })

  it('todas skipped → rojo, aunque Playwright hubiera salido 0', () => {
    const rep = reporteCompleto(Object.fromEntries(TODOS.map((f) => [f, 'skipped'])))
    const { fallos } = verificar(resumir(rep), {})
    expect(fallos).toHaveLength(1)
    expect(fallos[0]).toMatch(/SKIPPED: la suite no verificó nada/)
  })

  it('todo ejecutado → verde sin omisiones', () => {
    const { fallos, declarados, totales } = verificar(resumir(reporteCompleto()), {})
    expect(fallos).toEqual([])
    expect(declarados).toEqual([])
    expect(totales.ejecutadas).toBe(TODOS.length)
  })

  for (const obligatorio of SPECS_OBLIGATORIOS) {
    it(`${obligatorio} enteramente skipped → rojo que lo nombra y cita la razón`, () => {
      const rep = reporteCompleto({ [obligatorio]: 'skipped' })
      const { fallos } = verificar(resumir(rep), {})
      expect(fallos).toHaveLength(1)
      expect(fallos[0]).toContain(obligatorio)
      expect(fallos[0]).toContain(`razón de ${obligatorio}`)
    })
  }

  it('un spec obligatorio AUSENTE del reporte → rojo (borrado o renombrado)', () => {
    const rep = { suites: TODOS.filter((f) => f !== 'auth-login.e2e.ts').map((f) => spec(f, [t('expected')])) }
    const { fallos } = verificar(resumir(rep), {})
    expect(fallos.some((f) => f.includes('AUSENTE') && f.includes('auth-login.e2e.ts'))).toBe(true)
  })
})

describe('condicionales: omisión declarada, jamás silenciosa', () => {
  it('sin la variable → no es fallo, pero queda DECLARADO con el porqué', () => {
    const rep = reporteCompleto({ 'invitation-accept.e2e.ts': 'skipped', 'fiscal-timbrar.e2e.ts': 'skipped' })
    const { fallos, declarados } = verificar(resumir(rep), {})
    expect(fallos).toEqual([])
    expect(declarados).toHaveLength(2)
    expect(declarados.join('\n')).toMatch(/token fresco de un solo uso/)
    expect(declarados.join('\n')).toMatch(/PAC sandbox/)
  })

  for (const { archivo, variable } of SPECS_CONDICIONALES) {
    it(`${variable} presente y ${archivo} skipped → rojo`, () => {
      const rep = reporteCompleto({ [archivo]: 'skipped' })
      const { fallos } = verificar(resumir(rep), { [variable]: '1' })
      expect(fallos).toHaveLength(1)
      expect(fallos[0]).toContain(variable)
      expect(fallos[0]).toMatch(/falso verde parcial/)
    })
  }
})

describe('resumir: la forma real del reporter JSON', () => {
  it('camina suites anidadas (describe dentro de describe)', () => {
    const rep = {
      suites: [
        {
          file: 'auth-login.e2e.ts',
          specs: [],
          suites: [spec('auth-login.e2e.ts', [t('expected'), t('skipped', 'x')])],
        },
      ],
    }
    const c = resumir(rep).get('auth-login.e2e.ts')
    expect(c).toMatchObject({ total: 2, ejecutadas: 1, skipped: 1 })
    expect(c.razonesSkip).toEqual(['x'])
  })

  it('flaky y unexpected cuentan como EJECUTADAS (corrieron; su veredicto es de Playwright)', () => {
    const rep = { suites: [spec('auth-login.e2e.ts', [t('flaky'), t('unexpected')])] }
    const c = resumir(rep).get('auth-login.e2e.ts')
    expect(c.ejecutadas).toBe(2)
  })
})
