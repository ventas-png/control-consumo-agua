// Pruebas de la comparación de tres vías.
//
// Las nueve situaciones obligatorias se prueban acá, sobre mapas de huellas
// sintéticos, porque lo que puede tener bugs es la DECISIÓN, no el Postgres.
// Cada `it` está nombrado con la situación que cubre.
//
// La contraparte contra un catálogo real vive en el workflow
// (`auditar.mjs --prueba-tres-vias`), que construye M y R de verdad desde dos
// árboles de migraciones distintos y comprueba que una migración append-only
// produce exactamente los cambios planificados que se esperan.

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import {
  clasificarGrupo, clasificar, diffMigraciones, evaluarTresVias, informe, versionDe,
  SIN_CAMBIO, PLANIFICADO, RESUELTO, AMBIGUO,
} from '../tres-vias.mjs'
import { AUSENTE } from '../auditar.mjs'

const sha = (t) => createHash('sha256').update(t, 'utf8').digest('hex')

/** Construye un Map de huellas desde `{clave: 'semilla:n'}`. */
const mapa = (obj) => new Map(Object.entries(obj).map(([k, v]) => {
  const [semilla, n] = v.split(':')
  return [k, { huella: sha(semilla), n: Number(n) }]
}))

const val = (semilla, n) => `${sha(semilla)}:${n}`

/** Una baseline mínima pero válida. */
const baselineCon = (grupos) => ({ grupos })
const entrada = (produccion, repo) => ({ motivo: 'x'.repeat(20), desde: '2026-09-01', produccion, repo })

/** El diff de migraciones de un PR que agrega una sola migración limpia. */
const UNA_NUEVA = diffMigraciones(
  new Map([['20260101000000_a.sql', 'aaa']]),
  new Map([['20260101000000_a.sql', 'aaa'], ['20270101000000_b.sql', 'bbb']]),
)
/** El diff de un PR que no toca ninguna migración. */
const NINGUNA = diffMigraciones(new Map([['20260101000000_a.sql', 'aaa']]), new Map([['20260101000000_a.sql', 'aaa']]))

describe('clasificarGrupo: las cuatro reglas', () => {
  const p = val('p', 1), m = val('m', 1), r = val('r', 1)

  it('M == R → el PR no toca el objeto', () => {
    expect(clasificarGrupo(p, m, m)).toBe(SIN_CAMBIO)
    expect(clasificarGrupo(p, p, p)).toBe(SIN_CAMBIO)
  })

  it('P == M y R != M → cambio planificado', () => {
    expect(clasificarGrupo(p, p, r)).toBe(PLANIFICADO)
  })

  it('R == P y M != P → drift resuelto', () => {
    expect(clasificarGrupo(p, m, p)).toBe(RESUELTO)
  })

  it('los tres distintos → ambiguo', () => {
    expect(clasificarGrupo(p, m, r)).toBe(AMBIGUO)
  })

  it('AUSENTE es un valor como cualquier otro: una tabla nueva es planificada', () => {
    // Producción no la tiene, la base tampoco, el PR sí. No es drift: falta
    // desplegarla.
    expect(clasificarGrupo(AUSENTE, AUSENTE, r)).toBe(PLANIFICADO)
  })

  it('una tabla que sólo existe en producción y el PR no toca sigue siendo drift', () => {
    expect(clasificarGrupo(p, AUSENTE, AUSENTE)).toBe(SIN_CAMBIO)
  })
})

describe('clasificar: recorre la unión de claves de los tres mapas', () => {
  it('incluye claves que están en un solo mapa', () => {
    const g = clasificar(mapa({ a: 'p:1' }), mapa({ b: 'm:1' }), mapa({ c: 'r:1' }))
    expect(g.map(x => x.clave)).toEqual(['a', 'b', 'c'])
  })
})

describe('diffMigraciones', () => {
  it('separa agregadas, eliminadas y modificadas por hash de blob', () => {
    const d = diffMigraciones(
      new Map([['20260101000000_a.sql', 'aaa'], ['20260102000000_b.sql', 'bbb'], ['20260103000000_c.sql', 'ccc']]),
      new Map([['20260101000000_a.sql', 'aaa'], ['20260102000000_b.sql', 'OTRO'], ['20270101000000_d.sql', 'ddd']]),
    )
    expect(d.agregadas).toEqual(['20270101000000_d.sql'])
    expect(d.eliminadas).toEqual(['20260103000000_c.sql'])
    expect(d.modificadas).toEqual(['20260102000000_b.sql'])
    expect(d.apendiceLimpio).toBe(false)
  })

  it('una migración con versión anterior a la última existente está intercalada', () => {
    const d = diffMigraciones(
      new Map([['20260601000000_a.sql', 'aaa']]),
      new Map([['20260601000000_a.sql', 'aaa'], ['20260101000000_antes.sql', 'zzz']]),
    )
    expect(d.desordenadas).toEqual(['20260101000000_antes.sql'])
    expect(d.apendiceLimpio).toBe(false)
  })

  it('agregar al final es un apéndice limpio', () => {
    expect(UNA_NUEVA.agregadas).toEqual(['20270101000000_b.sql'])
    expect(UNA_NUEVA.apendiceLimpio).toBe(true)
  })

  it('versionDe toma el prefijo hasta el primer guion bajo', () => {
    expect(versionDe('20260907001300_cerrar_lectura.sql')).toBe('20260907001300')
  })
})

// ══════════════════════════════════════════════════════════════════════════
// Las nueve situaciones obligatorias
// ══════════════════════════════════════════════════════════════════════════

describe('evaluarTresVias: las nueve situaciones', () => {
  // Un universo chico: dos objetos que producción y la base describen igual,
  // y uno con drift ya declarado en la baseline.
  const P = mapa({ 'tabla:a/grants': 'g1:28', 'tabla:a/columnas': 'c1:10', 'tabla:b/indices': 'iprod:5' })
  const M = mapa({ 'tabla:a/grants': 'g1:28', 'tabla:a/columnas': 'c1:10', 'tabla:b/indices': 'irepo:4' })
  const BASELINE = baselineCon({ 'tabla:b/indices': entrada(val('iprod', 5), val('irepo', 4)) })

  it('1. un PR sin cambios de esquema pasa', () => {
    const v = evaluarTresVias({ P, M, R: M, baseline: BASELINE, migraciones: NINGUNA })
    expect(v.ok).toBe(true)
    expect(v.planificados).toHaveLength(0)
    expect(v.esperado.map(g => g.clave)).toEqual(['tabla:b/indices'])
  })

  it('2. una migración append-only que revoca un grant con P == M es CAMBIO PLANIFICADO y pasa', () => {
    // Es literalmente el caso de #828: producción tiene 28 grants, la base
    // describe los mismos 28, el PR baja a 26.
    const R = mapa({ 'tabla:a/grants': 'g2:26', 'tabla:a/columnas': 'c1:10', 'tabla:b/indices': 'irepo:4' })
    const v = evaluarTresVias({ P, M, R, baseline: BASELINE, migraciones: UNA_NUEVA })
    expect(v.ok).toBe(true)
    expect(v.planificados.map(g => g.clave)).toEqual(['tabla:a/grants'])
    expect(v.nuevo).toHaveLength(0)
    expect(informe(v).join('\n')).toMatch(/CAMBIO PLANIFICADO/)
  })

  it('2b. el cambio planificado NO se agrega a la baseline', () => {
    const R = mapa({ 'tabla:a/grants': 'g2:26', 'tabla:a/columnas': 'c1:10', 'tabla:b/indices': 'irepo:4' })
    const v = evaluarTresVias({ P, M, R, baseline: BASELINE, migraciones: UNA_NUEVA })
    // Pasa con la baseline INTACTA: 1 entrada, la de siempre.
    expect(v.ok).toBe(true)
    expect(Object.keys(BASELINE.grupos)).toEqual(['tabla:b/indices'])
    expect(informe(v).join('\n')).toMatch(/NO se agregan a drift-conocido/)
  })

  it('3. una migración que agrega una tabla es CAMBIO PLANIFICADO y pasa', () => {
    // La tabla no existe ni en producción ni en la base: AUSENTE en los dos.
    const R = new Map([...M, ...mapa({ 'tabla:nueva/columnas': 'n1:3', 'tabla:nueva/grants': 'n2:4' })])
    const v = evaluarTresVias({ P, M, R, baseline: BASELINE, migraciones: UNA_NUEVA })
    expect(v.ok).toBe(true)
    expect(v.planificados.map(g => g.clave)).toEqual(['tabla:nueva/columnas', 'tabla:nueva/grants'])
    for (const g of v.planificados) expect(g.p).toBe(AUSENTE)
  })

  it('4. resolver drift conocido pasa y reduce la baseline', () => {
    // El PR alinea `tabla:b/indices` con producción y retira la entrada.
    const R = mapa({ 'tabla:a/grants': 'g1:28', 'tabla:a/columnas': 'c1:10', 'tabla:b/indices': 'iprod:5' })
    const v = evaluarTresVias({ P, M, R, baseline: baselineCon({}), migraciones: UNA_NUEVA })
    expect(v.ok).toBe(true)
    expect(v.resueltos.map(g => g.clave)).toEqual(['tabla:b/indices'])
    expect(informe(v).join('\n')).toMatch(/DRIFT RESUELTO/)
  })

  it('4b. resolver el drift SIN podar la baseline falla, para forzar la poda', () => {
    const R = mapa({ 'tabla:a/grants': 'g1:28', 'tabla:a/columnas': 'c1:10', 'tabla:b/indices': 'iprod:5' })
    const v = evaluarTresVias({ P, M, R, baseline: BASELINE, migraciones: UNA_NUEVA })
    expect(v.ok).toBe(false)
    expect(v.podaPendiente).toEqual(['tabla:b/indices'])
  })

  it('5. drift nuevo en un objeto que el PR no toca falla', () => {
    // M == R: el PR no participa. Producción se movió por fuera.
    const Pmovida = mapa({ 'tabla:a/grants': 'g1:28', 'tabla:a/columnas': 'INTRUSO:11', 'tabla:b/indices': 'iprod:5' })
    const v = evaluarTresVias({ P: Pmovida, M, R: M, baseline: BASELINE, migraciones: UNA_NUEVA })
    expect(v.ok).toBe(false)
    expect(v.nuevo.map(g => g.clave)).toEqual(['tabla:a/columnas'])
    expect(v.planificados).toHaveLength(0)
    expect(informe(v).join('\n')).toMatch(/DRIFT NUEVO/)
  })

  // Regresión: el informe imprimía «undefined» en las dos secciones donde la
  // huella ES el diagnóstico. `nuevo` y `agravado` salen de `evaluar`, que
  // nombra los lados `produccion`/`repo`; el informe los leía como `p`/`r`. El
  // veredicto era correcto, así que ningún assert sobre `ok` lo veía, y
  // comprobar sólo el título tampoco. Se comprueban las huellas.
  it('5c. el informe imprime las huellas de DRIFT NUEVO, no «undefined»', () => {
    const Pmovida = mapa({ 'tabla:a/grants': 'g1:28', 'tabla:a/columnas': 'INTRUSO:11', 'tabla:b/indices': 'iprod:5' })
    const texto = informe(evaluarTresVias({ P: Pmovida, M, R: M, baseline: BASELINE, migraciones: UNA_NUEVA })).join('\n')
    expect(texto).not.toMatch(/undefined/)
    expect(texto).toContain(val('INTRUSO', 11))
    expect(texto).toContain(val('c1', 10))
  })

  it('5d. el informe imprime las huellas de DRIFT AGRAVADO, no «undefined»', () => {
    const Pmovida = mapa({ 'tabla:a/grants': 'g1:28', 'tabla:a/columnas': 'c1:10', 'tabla:b/indices': 'OTRA:6' })
    const texto = informe(evaluarTresVias({ P: Pmovida, M, R: M, baseline: BASELINE, migraciones: NINGUNA })).join('\n')
    expect(texto).not.toMatch(/undefined/)
    expect(texto).toContain(val('OTRA', 6))       // lo que hay ahora
    expect(texto).toContain(val('iprod', 5))      // lo que la baseline esperaba
  })

  it('5b. un grupo baselineado cuyas huellas cambian sigue siendo DRIFT AGRAVADO', () => {
    // La baseline declara UNA diferencia concreta, no barra libre en esa tabla.
    const Pmovida = mapa({ 'tabla:a/grants': 'g1:28', 'tabla:a/columnas': 'c1:10', 'tabla:b/indices': 'OTRA:6' })
    const v = evaluarTresVias({ P: Pmovida, M, R: M, baseline: BASELINE, migraciones: NINGUNA })
    expect(v.ok).toBe(false)
    expect(v.agravado.map(g => g.clave)).toEqual(['tabla:b/indices'])
  })

  it('6. modificar una migración histórica falla, aunque el catálogo no se mueva', () => {
    const migraciones = diffMigraciones(
      new Map([['20260101000000_a.sql', 'aaa']]),
      new Map([['20260101000000_a.sql', 'REESCRITA']]),
    )
    const v = evaluarTresVias({ P, M, R: M, baseline: BASELINE, migraciones })
    expect(v.ok).toBe(false)
    expect(v.migraciones.modificadas).toEqual(['20260101000000_a.sql'])
    expect(informe(v).join('\n')).toMatch(/MIGRACIONES HISTÓRICAS MODIFICADAS/)
  })

  it('6b. borrar una migración histórica falla', () => {
    const migraciones = diffMigraciones(
      new Map([['20260101000000_a.sql', 'aaa'], ['20260102000000_b.sql', 'bbb']]),
      new Map([['20260101000000_a.sql', 'aaa']]),
    )
    expect(evaluarTresVias({ P, M, R: M, baseline: BASELINE, migraciones }).ok).toBe(false)
  })

  it('6c. intercalar una migración con versión anterior falla', () => {
    const migraciones = diffMigraciones(
      new Map([['20260601000000_a.sql', 'aaa']]),
      new Map([['20260601000000_a.sql', 'aaa'], ['20260101000000_antes.sql', 'zzz']]),
    )
    const v = evaluarTresVias({ P, M, R: M, baseline: BASELINE, migraciones })
    expect(v.ok).toBe(false)
    expect(informe(v).join('\n')).toMatch(/MIGRACIONES INTERCALADAS/)
  })

  it('7. cambiar el esquema sin agregar ninguna migración falla', () => {
    // R construye el catálogo APLICANDO archivos. Si se movió sin migración
    // nueva, lo que cambió fue el andamiaje: un esquema que nadie va a desplegar.
    const R = mapa({ 'tabla:a/grants': 'g2:26', 'tabla:a/columnas': 'c1:10', 'tabla:b/indices': 'irepo:4' })
    const v = evaluarTresVias({ P, M, R, baseline: BASELINE, migraciones: NINGUNA })
    expect(v.ok).toBe(false)
    expect(v.cambioSinMigracion.map(g => g.clave)).toEqual(['tabla:a/grants'])
    expect(informe(v).join('\n')).toMatch(/SIN MIGRACIÓN NUEVA/)
  })

  it('8. P, M y R los tres distintos falla como CAMBIO AMBIGUO', () => {
    // Producción tiene una cosa, la base otra, y el PR una tercera. No se puede
    // saber si arregla o empeora, así que se cierra en falso.
    const R = mapa({ 'tabla:a/grants': 'g1:28', 'tabla:a/columnas': 'c1:10', 'tabla:b/indices': 'TERCERA:9' })
    const v = evaluarTresVias({ P, M, R, baseline: BASELINE, migraciones: UNA_NUEVA })
    expect(v.ok).toBe(false)
    expect(v.ambiguos.map(g => g.clave)).toEqual(['tabla:b/indices'])
    expect(v.planificados).toHaveLength(0)
    expect(v.resueltos).toHaveLength(0)
    expect(informe(v).join('\n')).toMatch(/CAMBIO AMBIGUO/)
  })

  it('8b. el ambiguo falla incluso con una migración append-only impecable', () => {
    // Tener migración nueva NO convierte lo ambiguo en planificado.
    const R = mapa({ 'tabla:a/grants': 'g1:28', 'tabla:a/columnas': 'c1:10', 'tabla:b/indices': 'TERCERA:9' })
    for (const migraciones of [UNA_NUEVA, NINGUNA]) {
      expect(evaluarTresVias({ P, M, R, baseline: BASELINE, migraciones }).ok).toBe(false)
    }
  })

  it('9. ampliar drift-conocido no sirve para tapar drift nuevo', () => {
    // Declarar el drift nuevo en la baseline lo saca de `nuevo`… y entonces lo
    // detiene el trinquete, que se verifica contra la baseline de la rama base.
    // Las dos puertas, no una.
    const Pmovida = mapa({ 'tabla:a/grants': 'g1:28', 'tabla:a/columnas': 'INTRUSO:11', 'tabla:b/indices': 'iprod:5' })
    const ampliada = baselineCon({
      ...BASELINE.grupos,
      'tabla:a/columnas': entrada(val('INTRUSO', 11), val('c1', 10)),
    })
    const v = evaluarTresVias({ P: Pmovida, M, R: M, baseline: ampliada, migraciones: UNA_NUEVA })
    expect(v.nuevo).toHaveLength(0)      // la baseline lo declara…
    expect(Object.keys(ampliada.grupos)).toHaveLength(2) // …pero creció,
    expect(Object.keys(BASELINE.grupos)).toHaveLength(1) // y el trinquete
    // compara exactamente eso: 2 entradas contra 1 en la rama base.
  })
})

// ── el trinquete y las tres vías son puertas independientes ────────────────
describe('ampliar la baseline sigue prohibido (el trinquete, verificado aparte)', () => {
  it('la comparación de tres vías NO reemplaza al trinquete', async () => {
    const { verificarTrinquete } = await import('../auditar.mjs')
    const chica = baselineCon({ a: entrada(val('p', 1), val('r', 1)) })
    const grande = baselineCon({ a: entrada(val('p', 1), val('r', 1)), b: entrada(val('p2', 1), val('r2', 1)) })
    expect(verificarTrinquete(grande, chica).ok).toBe(false)
    expect(verificarTrinquete(chica, grande).ok).toBe(true)
  })
})

// ── ninguna sección del informe puede imprimir «undefined» ─────────────────
//
// Una red por encima de los casos puntuales: el informe se arma con plantillas,
// y un nombre de campo equivocado no rompe nada — imprime «undefined» y sigue.
// El veredicto queda bien y el diagnóstico se pierde, que es la peor
// combinación: verde o rojo correcto, y nadie puede ver por qué.
describe('el informe nunca imprime «undefined»', () => {
  const P = mapa({ a: 'p:1', b: 'p:1', c: 'p:1', d: 'p:1' })
  const M = mapa({ a: 'p:1', b: 'm:1', c: 'p:1', d: 'm:1' })
  const R = mapa({ a: 'r:1', b: 'p:1', c: 'x:1', d: 'z:1' })
  const conTodo = baselineCon({
    b: entrada(val('p', 1), val('m', 1)),
    d: entrada(val('p', 1), val('m', 1)),
  })

  for (const [nombre, migraciones] of [['con migración nueva', UNA_NUEVA], ['sin migración', NINGUNA]]) {
    it(`cubriendo planificado, resuelto, ambiguo y poda — ${nombre}`, () => {
      const v = evaluarTresVias({ P, M, R, baseline: conTodo, migraciones })
      const texto = informe(v).join('\n')
      expect(texto).not.toMatch(/undefined/)
      expect(texto).not.toMatch(/\[object Object\]/)
    })
  }

  it('cubriendo migraciones eliminadas, modificadas e intercaladas', () => {
    const migraciones = diffMigraciones(
      new Map([['20260601000000_a.sql', 'aaa'], ['20260602000000_b.sql', 'bbb']]),
      new Map([['20260601000000_a.sql', 'REESCRITA'], ['20260101000000_antes.sql', 'zzz']]),
    )
    const texto = informe(evaluarTresVias({ P, M, R, baseline: conTodo, migraciones })).join('\n')
    expect(texto).not.toMatch(/undefined/)
  })
})

// ── el ciclo de imports resuelve ───────────────────────────────────────────
//
// `tres-vias.mjs` importa `AUSENTE` y `clavesDeBaseline` de `auditar.mjs`, y
// `auditar.mjs` importa las reglas de `tres-vias.mjs`. Es un ciclo, y funciona
// porque nada se usa en tiempo de evaluación del módulo. Duplicar `AUSENTE`
// para evitarlo sería dejar que las dos copias se separen — en un auditor de
// drift, precisamente.
describe('el ciclo de imports entre auditar.mjs y tres-vias.mjs', () => {
  it('resuelve cargando cualquiera de los dos primero', async () => {
    const a = await import('../auditar.mjs')
    const t = await import('../tres-vias.mjs')
    expect(t.valorDe(new Map(), 'lo-que-sea')).toBe(a.AUSENTE)
  })
})
