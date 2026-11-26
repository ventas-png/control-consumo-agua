// Guardas estáticas de 20261226000000 (convergencia de las columnas de
// tareas_bloque a la forma de producción).
//
// La prueba que importa es la ejecutable —supabase/tests/tareas_bloque_columnas/
// run.sh: el escenario de producción da su huella, la migración es no-op sobre él
// y converge sobre el repositorio sin mover otro grupo—. Lo de aquí vigila lo que
// esa suite no ve: que la migración siga siendo un no-op sobre producción por
// construcción, que la entrada de drift ya no esté declarada y que la suite siga
// en CI.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(
  resolve('supabase/migrations/20261226000000_tareas_bloque_columnas_convergencia.sql'),
  'utf8',
)
// Sin los comentarios: lo que se ejecuta.
const codigo = sql.replace(/--[^\n]*/g, '')
const baseline = JSON.parse(readFileSync(resolve('scripts/schema-drift/drift-conocido.json'), 'utf8'))

describe('20261226000000 · no-op sobre producción por construcción', () => {
  it('cada ALTER vive dentro de un bloque guardado por el catálogo', () => {
    // Fuera del DO $$ … $$ no hay ninguna sentencia: un ALTER suelto correría
    // en producción aunque la columna ya tuviera esa forma.
    const fuera = codigo.replace(/DO \$\$[\s\S]*?\$\$;/g, '')
    expect(fuera).not.toMatch(/\b(ALTER|UPDATE|INSERT|DELETE|DROP|CREATE|COMMENT)\b/i)
    for (const col of ['foto_url', 'icono', 'created_at', 'orden']) {
      expect(codigo).toMatch(new RegExp(`attname = '${col}'`))
    }
  })

  it('no escribe nada que producción no tenga: ni comentarios ni datos', () => {
    expect(codigo).not.toMatch(/COMMENT ON/i)
    expect(codigo).not.toMatch(/\bUPDATE\s+public\.tareas_bloque\b/i)
  })

  it('las cuatro diferencias van hacia la forma de producción', () => {
    expect(codigo).toMatch(/ADD COLUMN foto_url text;/)
    expect(codigo).toMatch(/ADD COLUMN icono text DEFAULT '📋'::text;/)
    expect(codigo).toMatch(/ALTER COLUMN created_at SET NOT NULL;/)
    expect(codigo).toMatch(/ALTER COLUMN orden DROP NOT NULL;/)
  })

  it('una columna con otro tipo aborta en vez de adivinar', () => {
    expect(codigo).toMatch(/foto_url existe con otra forma[\s\S]*?ERRCODE = '55000'/)
    expect(codigo).toMatch(/icono existe con otro tipo[\s\S]*?ERRCODE = '55000'/)
  })
})

describe('20261226000000 · la baseline de drift encoge', () => {
  it('tabla:tareas_bloque/columnas ya no está declarada', () => {
    expect(baseline.grupos).not.toHaveProperty(['tabla:tareas_bloque/columnas'])
  })

  it('tabla:tareas_bloque/constraints sigue declarada: es otro grupo y no se tocó', () => {
    expect(baseline.grupos).toHaveProperty(['tabla:tareas_bloque/constraints'])
    expect(codigo).not.toMatch(/ADD CONSTRAINT|DROP CONSTRAINT/i)
  })
})

describe('20261226000000 · el sandbox sigue en CI', () => {
  it('coverage.yml corre supabase/tests/tareas_bloque_columnas/run.sh', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toMatch(/run: supabase\/tests\/tareas_bloque_columnas\/run\.sh/)
  })
})
