// Pruebas del auditor de drift de esquema.
//
// Las de verdad son las NEGATIVAS: se inyecta una columna y una policy que
// ninguna migración declara y se comprueba que el auditor las ve y rompe. Sin
// eso, un auditor que siempre diga «todo bien» pasaría todas las pruebas
// positivas del mundo.
//
// La prueba negativa contra un Postgres real vive en el workflow
// (`auditar.mjs --prueba-negativa`), porque levantar un clúster dentro de
// vitest volvería lento `npm test` para todo el mundo. Aquí se prueba la misma
// lógica sobre huellas sintéticas, que es donde puede tener bugs: el
// comparador, el trinquete y la validación de la baseline.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  parsearHuella,
  calcularDrift,
  evaluar,
  verificarTrinquete,
  validarBaseline,
  clavesDeBaseline,
} from '../auditar.mjs'

const RAIZ = resolve('scripts/schema-drift')
const baselineReal = JSON.parse(readFileSync(resolve(RAIZ, 'drift-conocido.json'), 'utf8'))
const produccionReal = JSON.parse(readFileSync(resolve(RAIZ, 'huella-produccion.json'), 'utf8'))

/** Huella mínima de juguete, con una tabla sana. */
const HUELLA_BASE = [
  'tabla:clientes/columnas\taaaa11112222\t24',
  'tabla:clientes/policies\tbbbb11112222\t4',
  'tabla:security_logs/policies\tcccc11112222\t4',
].join('\n')

const baselineCon = (grupos) => ({ grupos })

describe('parsearHuella', () => {
  it('convierte líneas `clave\\thuella\\tn` en un mapa', () => {
    const m = parsearHuella(HUELLA_BASE)
    expect(m.size).toBe(3)
    expect(m.get('tabla:clientes/columnas')).toEqual({ huella: 'aaaa11112222', n: 24 })
  })

  it('ignora líneas vacías y recorta espacios', () => {
    expect(parsearHuella('\n  \na\tb\t1\n').size).toBe(1)
  })

  it('rechaza una línea mal formada en vez de tragársela', () => {
    // Una huella corrupta que se parsea a medias produciría un «sin drift»
    // falso, que es el peor resultado posible para un auditor.
    expect(() => parsearHuella('esto-no-tiene-tabuladores')).toThrow(/mal formada/)
  })
})

describe('calcularDrift', () => {
  it('no reporta nada cuando las dos huellas coinciden', () => {
    const h = parsearHuella(HUELLA_BASE)
    expect(calcularDrift(h, parsearHuella(HUELLA_BASE))).toEqual([])
  })

  it('detecta una COLUMNA inesperada (la huella del grupo cambia)', () => {
    const prod = parsearHuella(HUELLA_BASE)
    const repo = parsearHuella(HUELLA_BASE.replace('tabla:clientes/columnas\taaaa11112222\t24',
                                                   'tabla:clientes/columnas\tZZZZ99998888\t25'))
    const d = calcularDrift(prod, repo)
    expect(d).toHaveLength(1)
    expect(d[0].clave).toBe('tabla:clientes/columnas')
    expect(d[0].produccion).toBe('aaaa11112222 (24)')
    expect(d[0].repo).toBe('ZZZZ99998888 (25)')
  })

  it('detecta una POLICY inesperada', () => {
    const prod = parsearHuella(HUELLA_BASE)
    const repo = parsearHuella(HUELLA_BASE.replace('tabla:security_logs/policies\tcccc11112222\t4',
                                                   'tabla:security_logs/policies\tYYYY77776666\t5'))
    const d = calcularDrift(prod, repo)
    expect(d.map(x => x.clave)).toEqual(['tabla:security_logs/policies'])
  })

  it('un grupo que existe sólo de un lado cuenta como diferencia', () => {
    const prod = parsearHuella(HUELLA_BASE + '\ntabla:solo_prod/columnas\tdddd11112222\t3')
    const d = calcularDrift(prod, parsearHuella(HUELLA_BASE))
    expect(d).toHaveLength(1)
    expect(d[0].repo).toBe('AUSENTE')
  })
})

describe('evaluar', () => {
  const drift = [{ clave: 'tabla:clientes/columnas', produccion: 'a (24)', repo: 'b (25)' }]

  it('drift no declarado es DRIFT NUEVO y rompe', () => {
    const v = evaluar(drift, baselineCon({}))
    expect(v.ok).toBe(false)
    expect(v.nuevo.map(d => d.clave)).toEqual(['tabla:clientes/columnas'])
  })

  it('drift declarado con las MISMAS huellas no rompe', () => {
    const v = evaluar(drift, baselineCon({
      'tabla:clientes/columnas': { motivo: 'x'.repeat(20), desde: '2026-09-01', produccion: 'a (24)', repo: 'b (25)' },
    }))
    expect(v.ok).toBe(true)
    expect(v.esperado).toHaveLength(1)
  })

  it('drift declarado cuyas huellas CAMBIARON es DRIFT AGRAVADO y rompe', () => {
    // Es el caso que destapó la primera prueba negativa real: una policy nueva
    // en `security_logs`, que ya estaba en la baseline, no rompía nada. Una
    // baseline por clave apaga la alarma justo donde más importa.
    const v = evaluar(drift, baselineCon({
      'tabla:clientes/columnas': { motivo: 'x'.repeat(20), desde: '2026-09-01', produccion: 'a (24)', repo: 'OTRA (26)' },
    }))
    expect(v.ok).toBe(false)
    expect(v.agravado).toHaveLength(1)
    expect(v.nuevo).toHaveLength(0)
    expect(v.agravado[0].esperadoRepo).toBe('OTRA (26)')
  })

  it('una entrada de la baseline que ya no corresponde a drift rompe, para forzar la poda', () => {
    const v = evaluar([], baselineCon({
      'tabla:vieja/columnas': { motivo: 'x'.repeat(20), desde: '2026-09-01', produccion: 'a', repo: 'b' },
    }))
    expect(v.ok).toBe(false)
    expect(v.resuelto).toEqual(['tabla:vieja/columnas'])
  })

  it('sin drift y sin baseline: verde', () => {
    expect(evaluar([], baselineCon({})).ok).toBe(true)
  })
})

describe('trinquete: la baseline sólo puede encoger', () => {
  const conClaves = (...cs) => baselineCon(Object.fromEntries(cs.map(c => [c, { motivo: 'x'.repeat(20), desde: '2026-09-01', produccion: 'a', repo: 'b' }])))

  it('agregar una entrada rompe', () => {
    const t = verificarTrinquete(conClaves('a', 'b'), conClaves('a'))
    expect(t.ok).toBe(false)
    expect(t.agregadas).toEqual(['b'])
  })

  it('retirar una entrada está permitido', () => {
    const t = verificarTrinquete(conClaves('a'), conClaves('a', 'b'))
    expect(t.ok).toBe(true)
    expect(t.retiradas).toEqual(['b'])
  })

  it('dejarla igual está permitido', () => {
    expect(verificarTrinquete(conClaves('a'), conClaves('a')).ok).toBe(true)
  })
})

describe('validarBaseline', () => {
  it('exige motivo, fecha y las dos huellas', () => {
    const p = validarBaseline(baselineCon({ 'k': {} }))
    expect(p.join(' ')).toMatch(/motivo/)
    expect(p.join(' ')).toMatch(/desde/)
    expect(p.join(' ')).toMatch(/produccion/)
    expect(p.join(' ')).toMatch(/repo/)
  })

  it('rechaza un motivo demasiado corto para explicar nada', () => {
    expect(validarBaseline(baselineCon({ 'k': { motivo: 'porque sí', desde: '2026-09-01', produccion: 'a', repo: 'b' } })))
      .toContainEqual(expect.stringMatching(/motivo/))
  })
})

describe('los archivos versionados', () => {
  it('la baseline real es válida y cada entrada explica su porqué', () => {
    expect(validarBaseline(baselineReal)).toEqual([])
  })

  it('la baseline real no declara grupos que la huella de producción no conoce', () => {
    const conocidos = new Set(Object.keys(produccionReal.grupos))
    const huerfanas = [...clavesDeBaseline(baselineReal)].filter(c => !conocidos.has(c))
    expect(huerfanas, 'entradas de baseline sin contrapartida en la instantánea de producción').toEqual([])
  })

  it('NO guardan datos, contraseñas, tokens ni cadenas de conexión', () => {
    // La huella son hashes y conteos; la baseline es prosa. Si alguna vez se
    // cambia el formato y se empieza a volcar DDL crudo, esto lo delata antes
    // de que un secreto llegue al repositorio.
    const sospechosos = [
      /\bpostgres(ql)?:\/\//i,            // cadena de conexión
      /\bsb_(secret|publishable)_[A-Za-z0-9]/,  // claves de Supabase
      /\bey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./, // JWT
      /\bsk_(live|test)_[A-Za-z0-9]{16,}/,      // Stripe
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /\b(password|contrasena|secret|token|api[_-]?key)\s*[:=]\s*["'][^"']{8,}/i,
    ]
    for (const [nombre, ruta] of [['huella-produccion.json', 'huella-produccion.json'],
                                  ['drift-conocido.json', 'drift-conocido.json']]) {
      const texto = readFileSync(resolve(RAIZ, ruta), 'utf8')
      for (const re of sospechosos) {
        expect(re.test(texto), `${nombre} contiene algo con forma de secreto: ${re}`).toBe(false)
      }
    }
  })

  it('la huella de producción sólo guarda `md5(12):n` — nunca DDL crudo', () => {
    for (const [clave, valor] of Object.entries(produccionReal.grupos)) {
      expect(valor, `valor inesperado en ${clave}`).toMatch(/^[0-9a-f]{12}:\d+$/)
    }
  })

  it('declara cuándo se capturó, para que un verde viejo no se lea como fresco', () => {
    expect(produccionReal.capturada).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
