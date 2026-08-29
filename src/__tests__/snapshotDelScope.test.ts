import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards ESTÁTICOS del fix de seguridad del snapshot (20260907000800).
//
// ALCANCE Y LÍMITE. Esto lee texto del repo; la verificación CONDUCTUAL vive
// en supabase/tests/snapshot_del_scope/run.sh (job rls-sandbox de
// coverage.yml): dos compañías y dos proyectos contra Postgres real, con la
// NEGATIVA primero. Lo que se vigila AQUÍ son regresiones de texto:
//
//   1. La vulnerabilidad era UNA cláusula: `WHERE id = NEW.plantilla_id` sin
//      tenant, dentro de un SECURITY DEFINER. Cualquier refactor que "limpie"
//      el WHERE compuesto la reintroduce en silencio.
//   2. El fail-closed puede degradarse a un `RETURN NEW` sin que ninguna
//      prueba de camino feliz lo note.
//   3. El REVOKE de las funciones y el search_path fijo son una línea cada
//      uno: fáciles de perder en un CREATE OR REPLACE posterior.

const RAIZ = resolve('.')
const MIGRATIONS_DIR = join(RAIZ, 'supabase/migrations')
const MIG_ORIGINAL = '20260907000600_snapshot_al_crear_tarea.sql'
const MIG_SCOPE = '20260907000800_snapshot_y_referencias_del_scope.sql'
const SANDBOX_DIR = join(RAIZ, 'supabase/tests/snapshot_del_scope')

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')

const sqlScope = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG_SCOPE), 'utf8'))

/** Cuerpo de una función en el SQL de la migración de scope. */
function cuerpoDe(fn: string): string {
  const m = sqlScope.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\)([\\s\\S]*?)\\n\\$\\$;`, 'i'),
  )
  expect(m, `no se encontró la función ${fn} en ${MIG_SCOPE}`).not.toBeNull()
  return m![1]
}

describe('20260907000800 · el snapshot exige el scope del bloque', () => {
  const snapshot = cuerpoDe('tarea_copiar_snapshot_plantilla')

  it('la migración original de #810 sigue intacta (append-only)', () => {
    // El archivo existe y conserva su forma vulnerable DOCUMENTADA — la
    // reparación es una migración nueva, no una edición de la historia.
    const original = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG_ORIGINAL), 'utf8'))
    expect(original).toMatch(/WHERE id = NEW\.plantilla_id;/)
    expect(existsSync(join(MIGRATIONS_DIR, MIG_SCOPE))).toBe(true)
  })

  it('resuelve compañía y proyecto DESDE EL BLOQUE y los exige en el lookup', () => {
    expect(snapshot).toMatch(/FROM public\.bloques_turno/i)
    expect(snapshot).toMatch(
      /WHERE id = NEW\.plantilla_id\s+AND company_id = v_company\s+AND project_id = v_project/i,
    )
    // La cláusula desnuda de 20260907000600 no puede volver.
    expect(snapshot).not.toMatch(/WHERE id = NEW\.plantilla_id;/)
  })

  it('falla CERRADO: NOT FOUND ya no es un RETURN NEW silencioso', () => {
    const notFound = snapshot.match(/IF NOT FOUND THEN([\s\S]*?)END IF;/i)
    expect(notFound).not.toBeNull()
    expect(notFound![1]).toMatch(/RAISE EXCEPTION/i)
    expect(notFound![1]).not.toMatch(/RETURN NEW/i)
  })

  it('el guard reutilizable cubre las TRES referencias, en INSERT y UPDATE', () => {
    const guard = cuerpoDe('tarea_referencias_del_scope')
    for (const ref of ['plantilla_id', 'area_id', 'rutina_id']) {
      expect(guard, `el guard no valida ${ref}`).toMatch(new RegExp(`NEW\\.${ref}`))
    }
    expect(sqlScope).toMatch(
      /CREATE TRIGGER trg_referencias_del_scope\s+BEFORE INSERT OR UPDATE ON public\.tareas_bloque/i,
    )
    // El orden alfabético es lo que hace correr el guard ANTES de la copia.
    expect('trg_referencias_del_scope' < 'trg_tarea_copiar_snapshot').toBe(true)
  })

  it('sin oráculo de existencia ni datos ajenos en los errores', () => {
    // Todos los rechazos usan foreign_key_violation y el texto solo repite el
    // UUID del llamador (formato %): nunca columnas de la fila ajena.
    const raises = sqlScope.match(/RAISE EXCEPTION 'REFERENCIA FUERA DE ALCANCE[^']*'/gi) ?? []
    expect(raises.length).toBeGreaterThanOrEqual(4)
    for (const r of raises) {
      expect(r).not.toMatch(/titulo|checklist|instrucciones|company|compañ/i)
    }
    const conErrcode = sqlScope.match(/ERRCODE = 'foreign_key_violation'/gi) ?? []
    expect(conErrcode.length).toBeGreaterThanOrEqual(4)
  })

  it('search_path fijo y REVOKE en las dos funciones', () => {
    const declaraciones = sqlScope.match(/CREATE OR REPLACE FUNCTION[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = public, pg_temp/gi) ?? []
    expect(declaraciones.length).toBe(2)
    expect(sqlScope).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.tarea_copiar_snapshot_plantilla\(\) FROM PUBLIC, anon, authenticated/,
    )
    expect(sqlScope).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.tarea_referencias_del_scope\(\) FROM PUBLIC, anon, authenticated/,
    )
  })

  it('OLD solo se toca dentro de la rama UPDATE (el guard también corre en INSERT)', () => {
    const guard = cuerpoDe('tarea_referencias_del_scope')
    // Toda referencia a OLD vive tras el IF TG_OP = 'UPDATE' anidado; un AND
    // plano no garantiza el orden de evaluación y reventaría cada INSERT.
    const antesDeUpdate = guard.slice(0, guard.indexOf("TG_OP = 'UPDATE'"))
    expect(antesDeUpdate).not.toMatch(/\bOLD\./)
    expect(guard).toMatch(/IF TG_OP = 'UPDATE' THEN\s+IF NEW\.bloque_id IS NOT DISTINCT FROM OLD\.bloque_id THEN/i)
  })
})

describe('el sandbox del scope existe y corre en CI', () => {
  it('los archivos del sandbox están completos', () => {
    for (const f of ['run.sh', 'seed.sql', 'pre_assert.sql', 'assert.sql', 'reassert.sql']) {
      expect(existsSync(join(SANDBOX_DIR, f)), `falta ${f}`).toBe(true)
    }
  })

  it('la NEGATIVA reproduce el ataque antes de la reparación', () => {
    const pre = soloCodigo(readFileSync(join(SANDBOX_DIR, 'pre_assert.sql'), 'utf8'))
    expect(pre).toMatch(/SECRETO-B/)
    expect(pre).toMatch(/la vulnerabilidad ya no se reproduce/i)
  })

  it('coverage.yml cablea el run.sh (el harness que no corre no protege)', () => {
    const coverage = readFileSync(join(RAIZ, '.github/workflows/coverage.yml'), 'utf8')
    expect(coverage).toContain('supabase/tests/snapshot_del_scope/run.sh')
  })
})
