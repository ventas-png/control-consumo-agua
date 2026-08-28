import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards ESTÁTICOS de la reparación del CHECK de estado de `tareas_bloque`
// (20260907000700).
//
// ALCANCE Y LÍMITE. Esto lee texto del repo; la verificación CONDUCTUAL vive
// en supabase/tests/reparar_estado_tareas_bloque/run.sh (job rls-sandbox de
// coverage.yml), que monta el homónimo incompatible sobre Postgres de verdad.
// Lo que se vigila AQUÍ son las regresiones de texto que ese sandbox no ve:
//
//   1. La migración compara DEFINICIONES (pg_get_constraintdef), no solo el
//      conname — que es el guard insuficiente de 20260907000100 que motivó
//      todo esto. Y convierte EXPLÍCITAMENTE los dos legacy con equivalencia
//      definida; para el resto ('en_curso') aborta: si alguien "simplifica"
//      el aborto en un mapeo mudo, deja de existir la decisión de producto.
//   2. El drift guard de producción exige este constraint POR DEFINICIÓN
//      desde la versión de esta migración. Si la entrada de
//      CONSTRAINTS_CRITICOS se retira o su `desdeVersion` deja de coincidir
//      con el archivo real, la vigilancia se apaga en silencio.
//   3. El sandbox está CABLEADO en CI. «El harness existía y no corría» ya
//      pasó dos veces en este repo (43 invariantes que solo corrían a mano).

const RAIZ = resolve('.')
const MIGRATIONS_DIR = join(RAIZ, 'supabase/migrations')
const MIG_REPARACION = '20260907000700_reparar_estado_tareas_bloque.sql'
const VERSION_REPARACION = MIG_REPARACION.split('_')[0]
const SANDBOX_DIR = join(RAIZ, 'supabase/tests/reparar_estado_tareas_bloque')

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')

const sqlReparacion = soloCodigo(
  readFileSync(join(MIGRATIONS_DIR, MIG_REPARACION), 'utf8'),
)
const guardProduccion = readFileSync(
  join(RAIZ, 'scripts/migraciones-vs-produccion.mjs'),
  'utf8',
)

describe('20260907000700 · la migración repara por DEFINICIÓN, no por nombre', () => {
  it('lee la definición real con pg_get_constraintdef antes de decidir', () => {
    expect(sqlReparacion).toMatch(/pg_get_constraintdef/i)
    // Y el conname solo aparece como filtro de la lectura, no como guard de
    // existencia tipo `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE
    // conname = ...)` — el patrón exacto que dejó vivo al homónimo.
    expect(sqlReparacion).not.toMatch(
      /IF\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_constraint/i,
    )
  })

  it('dropea el homónimo y re-declara el dominio canónico', () => {
    expect(sqlReparacion).toMatch(/DROP CONSTRAINT tareas_bloque_estado_check\b/i)
    expect(sqlReparacion).toMatch(/ADD CONSTRAINT tareas_bloque_estado_check\s+CHECK/i)
    expect(sqlReparacion).toMatch(
      /CHECK \(estado IN \('pendiente', 'completada', 'con_observacion', 'omitida'\)\)/,
    )
  })

  it('convierte EXPLÍCITAMENTE los dos legacy con equivalencia definida', () => {
    expect(sqlReparacion).toMatch(
      /SET\s+estado\s*=\s*'completada'\s+WHERE\s+estado\s*=\s*'completado'/i,
    )
    expect(sqlReparacion).toMatch(
      /SET\s+estado\s*=\s*'omitida'\s+WHERE\s+estado\s*=\s*'omitido'/i,
    )
  })

  it('para en_curso NO hay equivalencia muda: se aborta con mensaje', () => {
    // Ningún UPDATE puede tocar 'en_curso': mapearlo es una decisión de
    // producto que nadie documentó.
    expect(sqlReparacion).not.toMatch(/UPDATE[\s\S]*?'en_curso'/i)
    // El aborto existe y nombra el problema.
    expect(sqlReparacion).toMatch(/RAISE EXCEPTION/i)
    expect(sqlReparacion).toMatch(/fuera del dominio canónico/i)
  })

  it('VALIDA el constraint: el NOT VALID de 20260907000100 no puede sobrevivir', () => {
    expect(sqlReparacion).toMatch(
      /VALIDATE CONSTRAINT tareas_bloque_estado_check/i,
    )
  })

  it('ninguna migración posterior vuelve a tocar el constraint sin pasar por aquí', () => {
    const posteriores = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql') && f > MIG_REPARACION)
      .filter(f =>
        /tareas_bloque_estado_check/i.test(
          soloCodigo(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')),
        ),
      )
    // Si esto falla no es prohibición: es aviso de que la nueva migración debe
    // actualizar también CONSTRAINTS_CRITICOS del drift guard, o producción y
    // guard quedarán exigiendo definiciones distintas.
    expect(posteriores).toEqual([])
  })
})

describe('drift guard · la definición se vigila desde la versión correcta', () => {
  it('CONSTRAINTS_CRITICOS declara tareas_bloque_estado_check', () => {
    expect(guardProduccion).toMatch(/CONSTRAINTS_CRITICOS/)
    expect(guardProduccion).toMatch(/constraint:\s*'tareas_bloque_estado_check'/)
    expect(guardProduccion).toMatch(/tabla:\s*'tareas_bloque'/)
  })

  it('el gate desdeVersion apunta al archivo que existe en el repo', () => {
    // Si la migración se renumera (regla (d) del guard, antes del merge) y la
    // entrada no se actualiza, el gate no se abre nunca: la vigilancia se
    // apaga sin que nada falle.
    const m = guardProduccion.match(/desdeVersion:\s*'(\d+)'/)
    expect(m, 'CONSTRAINTS_CRITICOS sin desdeVersion').not.toBeNull()
    expect(m![1]).toBe(VERSION_REPARACION)
  })

  it('exige los cuatro cánones en la definición esperada, sin vocabulario legacy', () => {
    const entrada = guardProduccion.match(/definicion:\s*\n?\s*"([^"]+)"/)
    expect(entrada).not.toBeNull()
    for (const canon of ['pendiente', 'completada', 'con_observacion', 'omitida']) {
      expect(entrada![1]).toContain(`'${canon}'`)
    }
    expect(entrada![1]).not.toContain("'completado'")
    expect(entrada![1]).not.toContain("'omitido'")
    expect(entrada![1]).not.toContain("'en_curso'")
  })
})

describe('el sandbox conductual existe y corre en CI', () => {
  it('los archivos del sandbox están completos', () => {
    for (const f of [
      'run.sh', 'fixture.sql', 'fixture_limpio.sql', 'seed_en_curso.sql',
      'pre_assert.sql', 'assert.sql', 'reassert.sql', 'assert_abort.sql',
      'assert_limpio.sql', 'postdeploy.sql',
    ]) {
      expect(existsSync(join(SANDBOX_DIR, f)), `falta ${f}`).toBe(true)
    }
  })

  it('el fixture de producción arranca con el constraint viejo BAJO EL MISMO NOMBRE', () => {
    // No un esquema limpio: la migración es un no-op ahí y el escenario
    // probaría lo contrario de lo que dice reproducir.
    const fixture = soloCodigo(readFileSync(join(SANDBOX_DIR, 'fixture.sql'), 'utf8'))
    expect(fixture).toMatch(/CONSTRAINT tareas_bloque_estado_check/i)
    expect(fixture).toMatch(/'en_curso',\s*'completado',\s*'omitido'/)
  })

  it('coverage.yml cablea el run.sh (el harness que no corre no protege)', () => {
    const coverage = readFileSync(join(RAIZ, '.github/workflows/coverage.yml'), 'utf8')
    expect(coverage).toContain('supabase/tests/reparar_estado_tareas_bloque/run.sh')
  })
})
