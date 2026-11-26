// Guardas estáticas de 20261225000100 (el paso opcional de una rutina deja de
// contar como pendiente).
//
// La prueba que importa es la ejecutable —supabase/tests/limpieza_opcional/
// run.sh: la tarea copia el paso, gana la exigencia, el calendario separa el
// opcional sin hacer, con nueve mutantes—. Lo de aquí vigila lo que esa suite no
// ve: que al reescribir las tres RPC no se haya perdido ninguna compuerta ni se
// haya expuesto nada más del personal, que la pantalla cuente con la misma
// regla y que la suite siga en CI.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const MIGRATIONS_DIR = resolve('supabase/migrations')
const MIG = '20261225000100_limpieza_pasos_opcionales.sql'
const MIG_CALENDARIO = '20261103000000_limpieza_calendario_rutinas.sql'

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')
const sql = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG), 'utf8'))
const sqlCalendario = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG_CALENDARIO), 'utf8'))

/** La definición de una función de la migración, de CREATE hasta su `$$;`. */
function funcion(fuente: string, nombre: string): string {
  const m = fuente.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nombre}\\(([\\s\\S]*?)\\n\\$\\$;`, 'i'))
  if (!m) throw new Error(`no se encontró ${nombre}`)
  return m[1]
}
const asignar = funcion(sql, 'limpieza_asignar_rutinas')
const calendario = funcion(sql, 'limpieza_calendario')
const materializar = funcion(sql, 'materializar_rutinas_turno')

/** Las columnas del INSERT INTO tareas_bloque de una función. */
const columnasInsert = (cuerpo: string) =>
  cuerpo.match(/INSERT INTO public\.tareas_bloque \(([\s\S]*?)\)\s*SELECT/i)![1].split(',').map(c => c.trim())

describe('20261225000100 · la columna', () => {
  it('nace obligatoria y no acepta NULL', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS obligatoria boolean NOT NULL DEFAULT true;/)
  })
})

describe('20261225000100 · la tarea COPIA el paso', () => {
  it('asignar y materializar escriben obligatoria en el INSERT', () => {
    expect(columnasInsert(asignar)).toContain('obligatoria')
    expect(columnasInsert(materializar)).toContain('obligatoria')
  })

  it('lo toman del PASO (rutina_actividades), no de la actividad', () => {
    expect(asignar).toMatch(/^\s*ra\.obligatoria,$/m)
    expect(materializar).toMatch(/bool_or\(ra\.obligatoria\)/)
  })

  it('dos pasos en la misma tarea: gana la exigencia, agrupando por actividad Y área', () => {
    expect(asignar).toMatch(/bool_or\(c\.obligatoria\) OVER \(PARTITION BY c\.plantilla_id, c\.area_id\)/)
    expect(materializar).toMatch(
      /bool_or\(ra\.obligatoria\) OVER \(\s*PARTITION BY b\.id, p\.id, COALESCE\(rz\.area_id, p\.area_id, r\.area_id\)\s*\)/,
    )
  })
})

describe('20261225000100 · el calendario', () => {
  it('pendiente es lo obligatorio; el opcional sin hacer va aparte', () => {
    expect(calendario).toMatch(
      /FILTER \(WHERE tb\.estado = 'pendiente' AND tb\.anulada_en IS NULL AND tb\.obligatoria\)::int AS pendientes/,
    )
    expect(calendario).toMatch(
      /FILTER \(WHERE NOT tb\.obligatoria AND tb\.estado NOT IN \('completada', 'con_observacion'\)\)::int AS opcionales_sin_hacer/,
    )
    expect(calendario).toMatch(/'opcionales_sin_hacer', x\.opcionales_sin_hacer/)
  })

  it('devuelve exactamente las mismas columnas que antes: nada más del personal', () => {
    // Es SECURITY DEFINER y se salta la RLS de personal_condominio: la
    // proyección mínima es la que vigila limpiezaCalendarioMigracion.test.ts
    // sobre 20261103000000, y aquí se exige que no haya crecido.
    const cabecera = (cuerpo: string) => cuerpo.match(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/i)![1]
    expect(cabecera(calendario)).toBe(cabecera(funcion(sqlCalendario, 'limpieza_calendario')))
  })
})

describe('20261225000100 · reescribir las RPC no perdió ninguna compuerta', () => {
  it('las tres siguen siendo SECURITY DEFINER con search_path fijado', () => {
    for (const cuerpo of [asignar, calendario]) {
      expect(cuerpo).toMatch(/SECURITY DEFINER\s+SET search_path = ''/)
    }
    expect(materializar).toMatch(/SECURITY DEFINER\s+SET search_path = public, pg_temp/)
  })

  it('asignar pasa por los controles comunes y bloquea el turno', () => {
    expect(asignar).toMatch(/FOR UPDATE;/)
    expect(asignar).toMatch(/PERFORM public\.limpieza_asegurar_turno_programable\(v_b\);/)
    expect(asignar).toMatch(/AND r\.project_id = v_b\.project_id\s+AND r\.company_id = v_b\.company_id/)
  })

  it('leer el calendario exige empresa, el tab de Limpieza y el condominio', () => {
    expect(calendario).toMatch(/PERFORM public\.assert_company_scope\(v_company\);/)
    expect(calendario).toMatch(/user_has_permission\('condominios\.tab\.prog_limpieza'\)/)
    expect(calendario).toMatch(/can_access_project\(p_project_id\)/)
    expect(calendario).toMatch(/p_hasta - p_desde > 92/)
  })

  it('materializar sigue con su control de empresa y de permiso', () => {
    expect(materializar).toMatch(/PERFORM public\.assert_company_scope\(v_company\);/)
    expect(materializar).toMatch(/user_has_permission\('condominios\.tab\.prog_limpieza'\)/)
    expect(materializar).toMatch(/user_has_permission\('condominios\.tab\.turnos'\)/)
  })

  it('anon no invoca ninguna', () => {
    for (const firma of [
      'limpieza_asignar_rutinas\\(uuid, uuid\\[\\]\\)',
      'limpieza_calendario\\(uuid, date, date\\)',
      'materializar_rutinas_turno\\(uuid, date, date\\)',
    ]) {
      expect(sql).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${firma} FROM PUBLIC, anon;`))
      expect(sql).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION public\\.${firma} TO authenticated, service_role;`))
    }
  })
})

describe('20261225000100 · la pantalla cuenta con la misma regla', () => {
  const sinComentarios = (f: string) => readFileSync(resolve(f), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')

  it('el cierre del turno usa puntajeCierre, no hechas / todas', () => {
    const tab = sinComentarios('src/components/condominios/tabs/TareasPersonalTab.tsx')
    expect(tab).toMatch(/const \{ puntaje \} = puntajeCierre\(ts\)/)
    expect(tab).not.toMatch(/completadas \/ ts\.length/)
  })

  it('el chip del calendario no compara hechas contra todas las tareas', () => {
    const vista = sinComentarios('src/components/condominios/tabs/limpieza/VistaCalendario.tsx')
    expect(vista).not.toMatch(/r\.hechas === r\.tareas/)
    expect(vista).toMatch(/rutinaCumplida\(r\)/)
  })
})

describe('20261225000100 · el sandbox sigue en CI', () => {
  it('coverage.yml corre supabase/tests/limpieza_opcional/run.sh', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toMatch(/run: supabase\/tests\/limpieza_opcional\/run\.sh/)
  })
})
