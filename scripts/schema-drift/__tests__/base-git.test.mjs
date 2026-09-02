// De dónde sale M, y qué pasa cuando no se puede saber.
//
// Todo con un `git` inyectado: lo que se prueba es la DECISIÓN, no git. Y lo
// que más importa es que ningún error se degrade a «no hay nada que comparar»
// — si un checkout incompleto se leyera como «la base no tiene migraciones»,
// el esquema entero pasaría por cambio planificado de este PR y la comparación
// de tres vías quedaría apagada en silencio.

import { describe, it, expect } from 'vitest'
import { migracionesEnRef, resolverRefBase, exigirRefCompleta, DIR_EN_GIT } from '../base-git.mjs'

/** git falso: `respuestas` mapea el primer argumento a stdout, o a un Error. */
const gitFalso = (respuestas) => (args) => {
  const r = respuestas[args[0]]
  const v = typeof r === 'function' ? r(args) : r
  if (v instanceof Error) throw v
  if (v === undefined) throw new Error(`git ${args[0]}: sin respuesta simulada`)
  return v
}

/** Salida de `ls-tree -r -z`: registros separados por NUL. */
const lsTree = (...rutas) =>
  rutas.map(r => `100644 blob ${r.hash}\t${DIR_EN_GIT}/${r.nombre}`).join('\0') + '\0'

const OK_REF = { 'rev-parse': '', 'cat-file': '' }

describe('exigirRefCompleta', () => {
  it('una ref inexistente lanza señalando fetch-depth', () => {
    const git = gitFalso({ 'rev-parse': new Error('fatal: Needed a single revision') })
    expect(() => exigirRefCompleta('origin/inventada', git)).toThrow(/fetch-depth: 0/)
  })

  it('un clon superficial lanza en vez de seguir', () => {
    const git = gitFalso({ 'rev-parse': '', 'cat-file': new Error('could not get object info') })
    expect(() => exigirRefCompleta('origin/main', git)).toThrow(/superficial/)
  })

  it('una ref completa no lanza', () => {
    expect(() => exigirRefCompleta('origin/main', gitFalso(OK_REF))).not.toThrow()
  })
})

describe('migracionesEnRef', () => {
  it('devuelve nombre → hash de blob', () => {
    const git = gitFalso({
      ...OK_REF,
      'ls-tree': lsTree({ nombre: '20260101000000_a.sql', hash: 'aaa' },
                        { nombre: '20260102000000_b.sql', hash: 'bbb' }),
    })
    expect([...migracionesEnRef('origin/main', git)]).toEqual([
      ['20260101000000_a.sql', 'aaa'],
      ['20260102000000_b.sql', 'bbb'],
    ])
  })

  it('ignora lo que no sea un .sql', () => {
    const git = gitFalso({
      ...OK_REF,
      'ls-tree': lsTree({ nombre: '20260101000000_a.sql', hash: 'aaa' }, { nombre: 'README.md', hash: 'ccc' }),
    })
    expect([...migracionesEnRef('origin/main', git).keys()]).toEqual(['20260101000000_a.sql'])
  })

  it('un directorio VACÍO en la base lanza en vez de devolver un mapa vacío', () => {
    // Sería el peor falso negativo posible: con M vacío, las 450 migraciones
    // pasarían por «cambio planificado de este PR» y no quedaría nada auditado.
    const git = gitFalso({ ...OK_REF, 'ls-tree': '' })
    expect(() => migracionesEnRef('origin/main', git)).toThrow(/no tiene ninguna migración/)
  })

  it('un fallo de ls-tree se propaga con el mensaje de git', () => {
    const git = gitFalso({ ...OK_REF, 'ls-tree': new Error('fatal: not a tree object') })
    expect(() => migracionesEnRef('origin/main', git)).toThrow(/not a tree object/)
  })
})

// ── Regla 6: qué ref es M según el evento ──────────────────────────────────
describe('resolverRefBase', () => {
  it('en pull_request usa el merge-base, no la punta de la rama base', () => {
    // Si la base avanzó desde que se abrió el PR, comparar contra su punta le
    // atribuiría al PR cambios que no hizo.
    const git = gitFalso({ 'rev-parse': '', 'merge-base': 'abc1234\n' })
    const r = resolverRefBase({ evento: 'pull_request', baseRef: 'origin/main' }, git)
    expect(r.ref).toBe('abc1234')
    expect(r.origen).toMatch(/merge-base/)
  })

  it('en pull_request, una rama base ausente del checkout lanza', () => {
    const git = gitFalso({ 'rev-parse': new Error('no such ref') })
    expect(() => resolverRefBase({ evento: 'pull_request', baseRef: 'origin/main' }, git))
      .toThrow(/fetch-depth: 0/)
  })

  it('en push usa github.event.before cuando existe', () => {
    const git = gitFalso({ 'rev-parse': (a) => (a[3] === 'antes111^{commit}' ? '' : new Error('no')) })
    const r = resolverRefBase({ evento: 'push', antes: 'antes111' }, git)
    expect(r).toEqual({ ref: 'antes111', origen: 'github.event.before' })
  })

  it('en push cae al primer padre si `before` no resuelve (push forzado)', () => {
    const git = gitFalso({ 'rev-parse': (a) => (a[3] === 'HEAD^^{commit}' ? '' : new Error('no')) })
    expect(resolverRefBase({ evento: 'push', antes: 'borrado' }, git).origen).toBe('primer padre')
  })

  it('el `before` de todo ceros de una rama nueva no se toma por una ref', () => {
    const git = gitFalso({ 'rev-parse': (a) => (a[3] === 'HEAD^^{commit}' ? '' : new Error('no')) })
    const r = resolverRefBase({ evento: 'push', antes: '0000000000000000000000000000000000000000' }, git)
    expect(r.origen).toBe('primer padre')
  })

  it('sin `before` y sin padre lanza en vez de degradar a dos vías', () => {
    const git = gitFalso({ 'rev-parse': new Error('no') })
    expect(() => resolverRefBase({ evento: 'push', antes: '' }, git)).toThrow(/no se degrada a dos/)
  })
})
