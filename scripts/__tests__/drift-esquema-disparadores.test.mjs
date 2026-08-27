// ════════════════════════════════════════════════════════════════════════════
// drift-esquema NO puede dispararse por `push`
// ════════════════════════════════════════════════════════════════════════════
// EL ROJO FALSO QUE ESTO IMPIDE. La primera versión del workflow tenía un
// disparador `push` con `paths-ignore: supabase/migrations/**`, pensando que así
// esquivaba la carrera con apply-migrations-prod. No la esquiva, y produjo un
// rojo falso en su PRIMER uso real: en el merge de #797 (run 33111303280) leyó
// el catálogo de producción a las 20:01:49 y el apply terminó a las 20:01:58,
// así que reportó como drift las diez columnas que esa misma migración estaba
// reparando.
//
// La causa es la semántica de `paths-ignore`: GitHub omite el run sólo si TODOS
// los archivos del push casan con el patrón, y aquel push tocaba migraciones Y
// coverage.yml, supabase/tests/** y el allowlist. No existe forma de expresar
// «omitir si ALGÚN archivo es una migración», así que la única defensa es no
// tener el disparador.
//
// Y no se pierde nada: el drift de esquema sólo cambia cuando se APLICAN
// migraciones. Un push que no las toca no puede alterar el esquema real.
// ════════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WORKFLOW = join(RAIZ, '.github/workflows/drift-esquema.yml')

/** Claves de primer nivel del bloque `on:` — sin parser de YAML en el repo. */
function disparadores() {
  const lineas = readFileSync(WORKFLOW, 'utf8').split('\n')
  const iOn = lineas.findIndex((l) => l === 'on:')
  if (iOn === -1) throw new Error(`No se encontró el bloque \`on:\` en ${WORKFLOW}`)

  const claves = []
  for (let i = iOn + 1; i < lineas.length; i += 1) {
    const l = lineas[i]
    if (l.trim() === '' || l.trimStart().startsWith('#')) continue
    if (!l.startsWith('  ')) break            // se acabó el bloque
    const m = l.match(/^ {2}(\w+):/)          // sólo el primer nivel
    if (m) claves.push(m[1])
  }
  return claves
}

describe('drift-esquema · disparadores', () => {
  it('NO se dispara por `push`: la carrera con el apply no se puede esquivar con paths-ignore', () => {
    expect(disparadores()).not.toContain('push')
  })

  it('se dispara tras el apply, por horario y a mano', () => {
    // workflow_run es el único momento en que el esquema real pudo cambiar por
    // una migración; schedule atrapa los cambios hechos fuera de banda.
    expect(disparadores()).toEqual(
      expect.arrayContaining(['workflow_run', 'schedule', 'workflow_dispatch']),
    )
  })

  it('el workflow_run espera al de aplicar migraciones, no a otro', () => {
    const yml = readFileSync(WORKFLOW, 'utf8')
    expect(yml).toContain("workflows: ['Apply Migrations to Production']")
  })
})
