// ════════════════════════════════════════════════════════════════════════════
// `fingerprint.sql` es portable, y el fail-closed vive en los llamadores
// ════════════════════════════════════════════════════════════════════════════
//
// EL FALLO QUE ESTO CIERRA. El archivo llevaba `\set ON_ERROR_STOP on` en su
// cabecera. Esa línea la interpreta psql, no el servidor: el Editor SQL de
// Supabase —el ÚNICO camino soportado para refrescar `huella-produccion.json` a
// mano, porque no existe una credencial directa que sirva (ver
// `decision-net-pg_net.md`)— manda el texto tal cual y respondía ERROR 42601.
// El procedimiento manual documentado no podía ejecutarse.
//
// Quitar la línea abre un agujero si no se hace nada más: con `-f`, psql corre
// cada sentencia en su propia transacción, así que tras abortar el guard de
// separadores seguiría hasta el SELECT final y emitiría una huella que el guard
// acaba de declarar no fiable. Un auditor que falla ABIERTO es peor que uno que
// no mide.
//
// Estas pruebas son las BARATAS —texto, sin base— y corren en cada `npm test`:
// que el archivo siga siendo portable y que ningún llamador se olvide de la
// bandera. El comportamiento real de los dos caminos, con un objeto culpable
// inyectado en un Postgres de verdad, se mide en
// `auditar.mjs --prueba-portabilidad`, que corre en el workflow del auditor.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

import { esInvocacionDeFingerprint } from '../auditar.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const DIR = join(AQUI, '..')
const leer = ruta => readFileSync(join(DIR, ruta), 'utf8')

const SQL = leer('fingerprint.sql')
const WRAPPER = leer('fingerprint.psql')

describe('fingerprint.sql es SQL portable', () => {
  it('NO contiene ninguna meta-instrucción de psql', () => {
    // Una meta-instrucción es una línea que empieza por `\`. Los `\x1e` de la
    // serialización viven DENTRO de literales, nunca al principio de la línea,
    // así que este criterio no los toca.
    const metas = SQL.split('\n')
      .map((linea, i) => ({ n: i + 1, linea }))
      .filter(({ linea }) => /^\s*\\/.test(linea))
    expect(
      metas,
      `el Editor SQL de Supabase manda el texto tal cual y responde 42601: ` +
      metas.map(m => `línea ${m.n}: ${m.linea.trim()}`).join(' · '),
    ).toEqual([])
  })

  it('en particular, `\\set ON_ERROR_STOP` ya no está dentro (es la regresión)', () => {
    expect(SQL).not.toMatch(/^\s*\\set\s+ON_ERROR_STOP/m)
  })

  it('el guard fail-closed SIGUE ahí: portable no significa permisivo', () => {
    // Quitar la bandera y de paso el guard habría «arreglado» el 42601 dejando
    // el auditor sin la comprobación que impide medir mal.
    expect(SQL).toMatch(/RAISE EXCEPTION 'SEPARADOR DE LA HUELLA DENTRO DEL CONTENIDO/)
    expect(SQL).toMatch(/DO \$centinela\$/)
  })
})

describe('el envoltorio de psql', () => {
  it('existe y pone la bandera', () => {
    expect(existsSync(join(DIR, 'fingerprint.psql'))).toBe(true)
    expect(WRAPPER).toMatch(/^\s*\\set\s+ON_ERROR_STOP\s+on/m)
  })

  it('incluye el .sql con `\\ir`, que resuelve relativo al archivo y no al CWD', () => {
    // Con `\i` sólo funcionaría invocando psql desde la raíz del repositorio.
    expect(WRAPPER).toMatch(/^\s*\\ir\s+fingerprint\.sql/m)
    expect(WRAPPER).not.toMatch(/^\s*\\i\s+fingerprint\.sql/m)
  })
})

// Ésta es la que impide que el arreglo se deshaga solo: quien agregue mañana un
// llamador nuevo sin la bandera lo verá en rojo acá, y no en una huella emitida
// después de que el guard dijera que no midiera.
describe('todo llamador de fingerprint.sql por psql pasa ON_ERROR_STOP=1', () => {
  const FUENTES = ['auditar.mjs', 'reconstruir.mjs']

  // El criterio de «esto es una invocación» sale de auditar.mjs y no se copia
  // acá: si las dos formas de vigilarlo pudieran discrepar, una de ellas estaría
  // dando un verde que la otra no respalda.
  const invocaciones = FUENTES.flatMap(archivo =>
    leer(archivo).split('\n')
      .map((linea, i) => ({ archivo, n: i + 1, linea }))
      .filter(({ linea }) => esInvocacionDeFingerprint(linea)),
  )

  it('hay invocaciones que vigilar (si no, esta prueba no vigila nada)', () => {
    expect(invocaciones.length).toBeGreaterThan(0)
  })

  for (const { archivo, n, linea } of invocaciones) {
    it(`${archivo}:${n} pasa la bandera`, () => {
      expect(linea, `sin ON_ERROR_STOP=1 psql seguiría tras el guard y emitiría una huella no fiable`)
        .toMatch(/ON_ERROR_STOP=1/)
    })
  }
})

describe('los dos caminos están documentados y medidos', () => {
  it('el workflow corre --prueba-portabilidad', () => {
    const yml = readFileSync(join(DIR, '../../.github/workflows/schema-drift.yml'), 'utf8')
    expect(yml).toContain('--prueba-portabilidad')
  })

  it('auditar.mjs implementa esa prueba y la despacha', () => {
    const auditar = leer('auditar.mjs')
    expect(auditar).toMatch(/async function pruebaPortabilidad\(\)/)
    expect(auditar).toMatch(/bandera\('--prueba-portabilidad'\)/)
  })

  it('el README explica el camino del Editor SQL y el de psql', () => {
    const readme = leer('README.md')
    expect(readme).toMatch(/Editor SQL/)
    expect(readme).toContain('fingerprint.psql')
    expect(readme, 'el procedimiento manual tiene que decir qué se pega y dónde')
      .toMatch(/42601/)
  })
})
