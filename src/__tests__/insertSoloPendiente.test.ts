import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards ESTÁTICOS del endurecimiento del alta (20260907000900).
//
// ALCANCE Y LÍMITE. Esto lee texto del repo; la verificación CONDUCTUAL vive
// en supabase/tests/insert_solo_pendiente/run.sh (job rls-sandbox de
// coverage.yml): NEGATIVA primero, las tres familias de permisos, el rol
// admin, y el gate de cierre intacto — contra Postgres real. Lo que se vigila
// AQUÍ son regresiones de texto:
//
//   1. El contrato del alta son SIETE cláusulas dentro de un WITH CHECK.
//      Quitar una sola al re-declarar la policy reabre esa puerta
//      en silencio: nada conductual falla hasta que alguien la explota.
//   2. La lista de permisos y la forma envuelta (#799) tienen que sobrevivir
//      al endurecimiento: cerrar la puerta de atrás no puede cerrar la de
//      adelante.
//   3. El drift guard vigila la EXPRESIÓN desde la versión correcta.

const RAIZ = resolve('.')
const MIGRATIONS_DIR = join(RAIZ, 'supabase/migrations')
const MIG_INSERT = '20260907000900_insert_solo_pendiente.sql'
const VERSION_INSERT = MIG_INSERT.split('_')[0]
const SANDBOX_DIR = join(RAIZ, 'supabase/tests/insert_solo_pendiente')

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')

const sqlInsert = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG_INSERT), 'utf8'))
const guardProduccion = readFileSync(
  join(RAIZ, 'scripts/migraciones-vs-produccion.mjs'),
  'utf8',
)

const politica = (() => {
  const m = sqlInsert.match(
    /CREATE POLICY "tareas_bloque_insert" ON public\.tareas_bloque([\s\S]*?);/i,
  )
  expect(m, 'la migración no re-declara tareas_bloque_insert').not.toBeNull()
  return m![1]
})()

describe('20260907000900 · la tarea nace pendiente y sin sellos', () => {
  it('es una policy de INSERT para authenticated, con WITH CHECK', () => {
    expect(politica).toMatch(/FOR INSERT TO authenticated/i)
    expect(politica).toMatch(/WITH CHECK/i)
  })

  it('el contrato del alta: pendiente y los seis NULL, cláusula por cláusula', () => {
    expect(politica).toMatch(/estado = 'pendiente'/)
    for (const col of ['completada_en', 'completado_por', 'anulada_en',
                       'anulada_por', 'motivo_anulacion', 'motivo_sin_evidencia']) {
      expect(politica, `falta ${col} IS NULL`).toMatch(new RegExp(`${col} IS NULL`))
    }
  })

  it('conserva la puerta de adelante: las tres familias, envueltas como exige #799', () => {
    for (const perm of ['condominios.tab.tareas_personal', 'condominios.tab.turnos',
                        'condominios.tab.prog_limpieza']) {
      expect(politica, `se perdió el permiso ${perm}`).toContain(`'${perm}'`)
    }
    expect(politica).toMatch(/\(SELECT public\.is_super_admin\(\)\)/i)
    expect(politica).toMatch(/\(SELECT public\.user_has_permission\(/i)
    expect(politica).toMatch(/b\.company_id = \(SELECT public\.get_my_company_id\(\)\)/i)
  })

  it('NO toca el gate de UPDATE ni la policy de UPDATE (la transición queda como #806)', () => {
    expect(sqlInsert).not.toMatch(/tareas_bloque_update/i)
    expect(sqlInsert).not.toMatch(/exigir_evidencia/i)
    expect(sqlInsert).not.toMatch(/CREATE TRIGGER/i)
  })

  it('la materialización escribe pendiente LITERAL (la RPC no pasa por la RLS)', () => {
    const rpc = soloCodigo(readFileSync(
      join(MIGRATIONS_DIR, '20260907000300_materializar_rutinas.sql'), 'utf8'))
    const ins = rpc.match(/INSERT INTO public\.tareas_bloque \(([\s\S]*?)ON CONFLICT/i)
    expect(ins).not.toBeNull()
    expect(ins![1]).toContain("'pendiente'")
  })
})

describe('drift guard · la expresión de la policy se vigila desde la versión correcta', () => {
  const bloqueEntrada = (() => {
    const desde = guardProduccion.indexOf("policy: 'tareas_bloque_insert'")
    if (desde === -1) return null
    const abre = guardProduccion.lastIndexOf('{', desde)
    const hasta = guardProduccion.indexOf('},', desde)
    return guardProduccion.slice(abre, hasta === -1 ? undefined : hasta + 1)
  })()

  it('POLICIES_CRITICAS declara tareas_bloque_insert con su contrato', () => {
    expect(guardProduccion).toMatch(/POLICIES_CRITICAS/)
    expect(bloqueEntrada, 'no hay entrada para tareas_bloque_insert').not.toBeNull()
    expect(bloqueEntrada!).toMatch(/tabla:\s*'tareas_bloque'/)
    expect(bloqueEntrada!).toMatch(/cmd:\s*'INSERT'/)
    expect(bloqueEntrada!).toContain("estado = 'pendiente'")
    expect(bloqueEntrada!).toContain('(motivo_sin_evidencia IS NULL)')
  })

  it('el gate desdeVersion apunta al archivo que existe en el repo', () => {
    const m = bloqueEntrada!.match(/desdeVersion:\s*'(\d+)'/)
    expect(m).not.toBeNull()
    expect(m![1]).toBe(VERSION_INSERT)
  })
})

describe('el sandbox del alta existe y corre en CI', () => {
  it('los archivos del sandbox están completos', () => {
    for (const f of ['run.sh', 'pre.sql', 'seed.sql', 'pre_assert.sql',
                     'assert.sql', 'reassert.sql', 'postdeploy.sql']) {
      expect(existsSync(join(SANDBOX_DIR, f)), `falta ${f}`).toBe(true)
    }
  })

  it('la NEGATIVA reproduce el alta pre-cerrada antes de la reparación', () => {
    const pre = soloCodigo(readFileSync(join(SANDBOX_DIR, 'pre_assert.sql'), 'utf8'))
    expect(pre).toMatch(/'completada'/)
    expect(pre).toMatch(/la vulnerabilidad ya no se reproduce/i)
  })

  it('coverage.yml cablea el run.sh (el harness que no corre no protege)', () => {
    const coverage = readFileSync(join(RAIZ, '.github/workflows/coverage.yml'), 'utf8')
    expect(coverage).toContain('supabase/tests/insert_solo_pendiente/run.sh')
  })
})
