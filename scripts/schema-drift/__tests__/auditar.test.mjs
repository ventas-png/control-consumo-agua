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
import { createHash } from 'node:crypto'
import {
  parsearHuella,
  calcularDrift,
  evaluar,
  verificarTrinquete,
  validarBaseline,
  clavesDeBaseline,
  esHuellaValida,
  RE_HUELLA,
  RE_HUELLA_CON_N,
  AUSENTE,
} from '../auditar.mjs'

const RAIZ = resolve('scripts/schema-drift')
const baselineReal = JSON.parse(readFileSync(resolve(RAIZ, 'drift-conocido.json'), 'utf8'))
const produccionReal = JSON.parse(readFileSync(resolve(RAIZ, 'huella-produccion.json'), 'utf8'))

/** SHA-256 en hex, como el que produce `encode(sha256(...),'hex')` en Postgres. */
const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex')

const H_COLUMNAS = sha('clientes-columnas')
const H_POLICIES = sha('clientes-policies')
const H_SECLOGS = sha('securitylogs-policies')

/** Huella mínima de juguete, con una tabla sana. */
const HUELLA_BASE = [
  `tabla:clientes/columnas\t${H_COLUMNAS}\t24`,
  `tabla:clientes/policies\t${H_POLICIES}\t4`,
  `tabla:security_logs/policies\t${H_SECLOGS}\t4`,
].join('\n')

const baselineCon = (grupos) => ({ grupos })

describe('parsearHuella', () => {
  it('convierte líneas `clave\\thuella\\tn` en un mapa', () => {
    const m = parsearHuella(HUELLA_BASE)
    expect(m.size).toBe(3)
    expect(m.get('tabla:clientes/columnas')).toEqual({ huella: H_COLUMNAS, n: 24 })
  })

  it('ignora líneas vacías y recorta espacios', () => {
    expect(parsearHuella(`\n  \na\t${H_COLUMNAS}\t1\n`).size).toBe(1)
  })

  // «Estabilidad ante entradas equivalentes», en la capa de parseo: la misma
  // huella con otro final de línea, espacios sobrantes o líneas en blanco tiene
  // que dar EXACTAMENTE el mismo mapa. Si no, el auditor reportaría drift por
  // cómo se transportó el texto, no por lo que dice.
  it('entradas equivalentes producen el mismo mapa', () => {
    const canonico = parsearHuella(HUELLA_BASE)
    const variantes = [
      HUELLA_BASE + '\n',                                  // salto final
      HUELLA_BASE.replace(/\n/g, '\r\n'),                  // CRLF
      HUELLA_BASE.split('\n').map(l => `  ${l}  `).join('\n'), // espacios
      HUELLA_BASE.split('\n').join('\n\n'),                 // líneas en blanco
    ]
    for (const v of variantes) {
      expect([...parsearHuella(v).entries()]).toEqual([...canonico.entries()])
    }
  })

  it('rechaza una huella que no es SHA-256 de 64 hex', () => {
    // El md5 truncado a 12 hex que usaba la primera versión ya no se acepta:
    // 48 bits admiten colisiones, y una colisión aquí es drift invisible.
    expect(() => parsearHuella('tabla:x/columnas\taaaa11112222\t3')).toThrow(/SHA-256 de 64 hex/)
    expect(() => parsearHuella(`tabla:x/columnas\t${H_COLUMNAS.toUpperCase()}\t3`)).toThrow(/SHA-256/)
    expect(() => parsearHuella(`tabla:x/columnas\t${H_COLUMNAS}ff\t3`)).toThrow(/SHA-256/)
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
    const otro = sha('clientes-columnas-con-una-columna-de-mas')
    const repo = parsearHuella(HUELLA_BASE.replace(`tabla:clientes/columnas\t${H_COLUMNAS}\t24`,
                                                   `tabla:clientes/columnas\t${otro}\t25`))
    const d = calcularDrift(prod, repo)
    expect(d).toHaveLength(1)
    expect(d[0].clave).toBe('tabla:clientes/columnas')
    expect(d[0].produccion).toBe(`${H_COLUMNAS}:24`)
    expect(d[0].repo).toBe(`${otro}:25`)
  })

  it('detecta una POLICY inesperada', () => {
    const prod = parsearHuella(HUELLA_BASE)
    const repo = parsearHuella(HUELLA_BASE.replace(`tabla:security_logs/policies\t${H_SECLOGS}\t4`,
                                                   `tabla:security_logs/policies\t${sha('mas-una-policy')}\t5`))
    const d = calcularDrift(prod, repo)
    expect(d.map(x => x.clave)).toEqual(['tabla:security_logs/policies'])
  })

  it('un grupo que existe sólo de un lado cuenta como diferencia', () => {
    const prod = parsearHuella(HUELLA_BASE + `\ntabla:solo_prod/columnas\t${sha('solo-prod')}\t3`)
    const d = calcularDrift(prod, parsearHuella(HUELLA_BASE))
    expect(d).toHaveLength(1)
    expect(d[0].repo).toBe(AUSENTE)
  })
})

describe('evaluar', () => {
  const A = `${sha('a')}:24`
  const B = `${sha('b')}:25`
  const drift = [{ clave: 'tabla:clientes/columnas', produccion: A, repo: B }]

  it('drift no declarado es DRIFT NUEVO y rompe', () => {
    const v = evaluar(drift, baselineCon({}))
    expect(v.ok).toBe(false)
    expect(v.nuevo.map(d => d.clave)).toEqual(['tabla:clientes/columnas'])
  })

  it('drift declarado con las MISMAS huellas no rompe', () => {
    const v = evaluar(drift, baselineCon({
      'tabla:clientes/columnas': { motivo: 'x'.repeat(20), desde: '2026-09-01', produccion: A, repo: B },
    }))
    expect(v.ok).toBe(true)
    expect(v.esperado).toHaveLength(1)
  })

  it('drift declarado cuyas huellas CAMBIARON es DRIFT AGRAVADO y rompe', () => {
    // Es el caso que destapó la primera prueba negativa real: una policy nueva
    // en `security_logs`, que ya estaba en la baseline, no rompía nada. Una
    // baseline por clave apaga la alarma justo donde más importa.
    const v = evaluar(drift, baselineCon({
      'tabla:clientes/columnas': { motivo: 'x'.repeat(20), desde: '2026-09-01', produccion: A, repo: `${sha('otra')}:26` },
    }))
    expect(v.ok).toBe(false)
    expect(v.agravado).toHaveLength(1)
    expect(v.nuevo).toHaveLength(0)
    expect(v.agravado[0].esperadoRepo).toBe(`${sha('otra')}:26`)
  })

  it('una entrada de la baseline que ya no corresponde a drift rompe, para forzar la poda', () => {
    const v = evaluar([], baselineCon({
      'tabla:vieja/columnas': { motivo: 'x'.repeat(20), desde: '2026-09-01', produccion: A, repo: B },
    }))
    expect(v.ok).toBe(false)
    expect(v.resuelto).toEqual(['tabla:vieja/columnas'])
  })

  it('sin drift y sin baseline: verde', () => {
    expect(evaluar([], baselineCon({})).ok).toBe(true)
  })
})

describe('trinquete: la baseline sólo puede encoger', () => {
  const conClaves = (...cs) => baselineCon(Object.fromEntries(cs.map(c =>
    [c, { motivo: 'x'.repeat(20), desde: '2026-09-01', produccion: `${sha(c)}:1`, repo: `${sha(c + 'r')}:1` }])))

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
    expect(validarBaseline(baselineCon({ k: { motivo: 'porque sí', desde: '2026-09-01', produccion: `${sha('a')}:1`, repo: `${sha('b')}:1` } })))
      .toContainEqual(expect.stringMatching(/motivo/))
  })

  it('rechaza una huella que no es SHA-256 — incluido el md5 truncado anterior', () => {
    const p = validarBaseline(baselineCon({
      k: { motivo: 'x'.repeat(20), desde: '2026-09-01', produccion: 'aaaa11112222 (24)', repo: `${sha('b')}:1` },
    }))
    expect(p.join(' ')).toMatch(/sha256 de 64 hex/i)
  })

  it('acepta AUSENTE como lado de una diferencia', () => {
    expect(validarBaseline(baselineCon({
      k: { motivo: 'x'.repeat(20), desde: '2026-09-01', produccion: `${sha('a')}:1`, repo: AUSENTE },
    }))).toEqual([])
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

  it('la huella de producción sólo guarda `sha256:n` — nunca DDL crudo ni nada reversible', () => {
    for (const [clave, valor] of Object.entries(produccionReal.grupos)) {
      expect(valor, `valor inesperado en ${clave}`).toMatch(RE_HUELLA_CON_N)
    }
    expect(produccionReal.algoritmo).toBe('sha256')
  })

  it('la baseline fija huellas SHA-256 completas en los dos lados', () => {
    for (const [clave, e] of Object.entries(baselineReal.grupos)) {
      expect(esHuellaValida(e.produccion), `${clave}.produccion = ${e.produccion}`).toBe(true)
      expect(esHuellaValida(e.repo), `${clave}.repo = ${e.repo}`).toBe(true)
      expect(e.produccion, `${clave} no debería estar en la baseline si no difiere`).not.toBe(e.repo)
    }
  })

  it('ninguna huella versionada quedó truncada', () => {
    // `AUSENTE` no lleva `:n`; todo lo demás es `<sha256>:<n>` y se compara
    // sobre la parte del hash.
    const soloHash = (v) => (v === AUSENTE ? AUSENTE : String(v).split(':')[0])
    const truncadas = [
      ...Object.entries(produccionReal.grupos).map(([k, v]) => [k, soloHash(v)]),
      ...Object.entries(baselineReal.grupos).flatMap(([k, e]) =>
        [[`${k}/prod`, soloHash(e.produccion)], [`${k}/repo`, soloHash(e.repo)]]),
    ].filter(([, h]) => h !== AUSENTE && !RE_HUELLA.test(h))
    expect(truncadas, 'huellas que no son SHA-256 de 64 hex').toEqual([])
  })

  it('declara cuándo se capturó, para que un verde viejo no se lea como fresco', () => {
    expect(produccionReal.capturada).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
