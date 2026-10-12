// ════════════════════════════════════════════════════════════════════════════
// Guarda del arnés de las suites SQL (supabase/tests/*/run.sh): el cluster
// desechable se APAGA por el mismo camino que se arranca.
//
// Postgres se niega a correr como root, así que cada run.sh delega el arranque
// en el usuario `postgres` vía `correr`. Si el apagado no se delega igual, como
// root `pg_ctl stop` falla en silencio (`|| true`), el `rm -rf` borra el
// directorio de datos y el postmaster sigue vivo ocupando el puerto ~1 minuto:
// la suite siguiente en ese puerto muere con «could not start server» antes de
// correr una sola prueba. Así fallaban al azar los barridos de las suites; el
// patrón se había corregido suite a suite y seguía copiándose en las nuevas.
// ════════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TESTS = join(dirname(fileURLToPath(import.meta.url)), '../../supabase/tests')

/** Líneas (sin comentarios) que invocan `pg_ctl … <accion>`. */
function invocaciones(texto, accion) {
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('#') && /\bpg_ctl\b/.test(l) && new RegExp(`\\b${accion}\\b`).test(l))
}

/** Problemas del arnés de un run.sh; vacío si arranca y para por `correr`. */
function problemasDeParada(texto) {
  const arranques = invocaciones(texto, 'start')
  if (arranques.length === 0) return []
  const problemas = []
  const paradas = invocaciones(texto, 'stop')
  if (paradas.length === 0) problemas.push('arranca un cluster y nunca lo para')
  for (const l of paradas) {
    if (!l.startsWith('correr ')) problemas.push(`parada sin delegar en \`correr\`: ${l}`)
  }
  return problemas
}

describe('problemasDeParada', () => {
  const arranque = `correr "pg_ctl -D $DATA -o '-p $PUERTO -k $SOCK' -l $DATA/pg.log start" >/dev/null`

  it('acepta la parada delegada en correr', () => {
    const ok = `limpiar() {\n  correr "pg_ctl -D $DATA stop -m immediate" >/dev/null 2>&1 || true\n}\n${arranque}\n`
    expect(problemasDeParada(ok)).toEqual([])
  })

  it('rechaza la parada con pg_ctl a secas (la que como root falla en silencio)', () => {
    const malo = `limpiar() {\n  pg_ctl -D "$DATA" stop -m immediate >/dev/null 2>&1 || true\n}\n${arranque}\n`
    expect(problemasDeParada(malo)).toEqual([expect.stringContaining('parada sin delegar')])
  })

  it('rechaza un arranque sin parada y ignora los comentarios', () => {
    expect(problemasDeParada(`# pg_ctl -D x stop\n${arranque}\n`)).toEqual([
      'arranca un cluster y nunca lo para',
    ])
  })
})

describe('supabase/tests/*/run.sh', () => {
  const suites = readdirSync(TESTS).filter((d) => existsSync(join(TESTS, d, 'run.sh')))

  it('hay suites que revisar', () => {
    expect(suites.length).toBeGreaterThan(0)
  })

  it.each(suites)('%s para su cluster como lo arranca', (suite) => {
    expect(problemasDeParada(readFileSync(join(TESTS, suite, 'run.sh'), 'utf8'))).toEqual([])
  })
})
