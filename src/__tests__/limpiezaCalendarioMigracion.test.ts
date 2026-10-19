import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards ESTÁTICOS de 20261103000000 (calendario de limpieza: rutinas por
// persona y día de turno).
//
// ALCANCE Y LÍMITE. Esto lee el SQL y el código del repo; no ejecuta nada. La
// verificación CONDUCTUAL —que ver no alcance para asignar, que día pasado y
// turno cerrado se rechacen, que lo trabajado no se quite, el orden de las
// tareas— vive en supabase/tests/limpieza_calendario/run.sh, con catorce
// mutantes, y corre en cada PR (job rls-sandbox de coverage.yml).
//
// Lo que se vigila AQUÍ es lo que una edición posterior podría aflojar sin que
// ninguna prueba de conducta feliz lo note:
//
//   1. Que la lectura del mes —SECURITY DEFINER, se salta la RLS del tab
//      Personal— siga proyectando SÓLO nombre, cargo y estado de la persona.
//      Agregar «una columna más» del expediente (salario, DPI, cuenta) la
//      publicaría a todo el que ve Limpieza, y ninguna prueba feliz fallaría.
//   2. Que escribir exija la ACCIÓN del tab (condominios_puede_actuar), no la
//      visibilidad, y el acceso al proyecto.
//   3. Que las RPC no las invoque anon y los helpers internos no se expongan.
//   4. Que la pantalla ya no ofrezca «Generar tareas» por jornada.
//   5. Que el job que corre el sandbox siga registrado.

const MIGRATIONS_DIR = resolve('supabase/migrations')
const MIG = '20261103000000_limpieza_calendario_rutinas.sql'

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')
const sql = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG), 'utf8'))

/** Encabezado de una función (hasta el `AS $$`) y su cuerpo. */
function funcion(nombre: string): { cabecera: string; cuerpo: string } {
  const m = sql.match(
    new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nombre}\\(([\\s\\S]*?)AS \\$\\$([\\s\\S]*?)\\n\\$\\$;`, 'i'),
  )
  if (!m) throw new Error(`no se encontró la función ${nombre}`)
  return { cabecera: m[1], cuerpo: m[2] }
}

describe('20261103000000 · la lectura del mes proyecta lo mínimo de cada persona', () => {
  const { cabecera, cuerpo } = funcion('limpieza_calendario')

  it('devuelve sólo nombre, cargo y estado del personal', () => {
    const columnasPersona = [...cabecera.matchAll(/\bpersonal_(\w+)\s+\w+/g)].map(m => m[1]).sort()
    expect(columnasPersona).toEqual(['cargo', 'estado', 'id', 'nombre'])
    for (const sensible of ['salario', 'dpi', 'telefono', 'email', 'numero_cuenta', 'banco', 'nit', 'direccion', 'contactos_emergencia']) {
      expect(cabecera).not.toMatch(new RegExp(`\\b${sensible}\\b`))
      expect(cuerpo).not.toMatch(new RegExp(`pc\\.${sensible}\\b`))
    }
    // Del alias de personal_condominio sólo se leen esas tres columnas (y la llave del JOIN).
    const leidas = new Set([...cuerpo.matchAll(/\bpc\.(\w+)/g)].map(m => m[1]))
    expect([...leidas].sort()).toEqual(['cargo', 'estado', 'id', 'nombre'])
  })

  it('exige el tab de Limpieza, la empresa y el acceso al proyecto', () => {
    expect(cabecera).toMatch(/SECURITY DEFINER/i)
    expect(cabecera).toMatch(/SET search_path = ''/i)
    expect(cuerpo).toMatch(/PERFORM public\.assert_company_scope\(v_company\);/)
    expect(cuerpo).toMatch(/user_has_permission\('condominios\.tab\.prog_limpieza'\)/)
    expect(cuerpo).toMatch(/can_access_project\(p_project_id\)/)
  })
})

describe('20261103000000 · escribir exige la ACCIÓN del tab y el proyecto', () => {
  it('el control común pide condominios_puede_actuar(prog_limpieza, edit) y can_access_project', () => {
    const { cuerpo } = funcion('limpieza_asegurar_turno_programable')
    expect(cuerpo).toMatch(/condominios_puede_actuar\('prog_limpieza', 'edit'\)/)
    expect(cuerpo).not.toMatch(/user_has_permission\('condominios\.tab\.prog_limpieza'\)/)
    expect(cuerpo).toMatch(/can_access_project\(p_bloque\.project_id\)/)
    expect(cuerpo).toMatch(/assert_company_scope\(p_bloque\.company_id\)/)
  })

  it.each(['limpieza_asignar_rutinas', 'limpieza_quitar_rutina'])('%s bloquea el turno y pasa por el control común', nombre => {
    const { cabecera, cuerpo } = funcion(nombre)
    expect(cabecera).toMatch(/SECURITY DEFINER/i)
    expect(cabecera).toMatch(/SET search_path = ''/i)
    expect(cuerpo).toMatch(/FROM public\.bloques_turno WHERE id = p_bloque_id FOR UPDATE;/)
    expect(cuerpo).toMatch(/PERFORM public\.limpieza_asegurar_turno_programable\(v_b\);/)
    // El control va ANTES de escribir.
    expect(cuerpo.search(/limpieza_asegurar_turno_programable/)).toBeLessThan(cuerpo.search(/INSERT INTO|DELETE FROM/))
  })

  it('quitar niega lo trabajado con la MISMA definición que lee el calendario', () => {
    expect(funcion('limpieza_quitar_rutina').cuerpo).toMatch(/public\.limpieza_tarea_trabajada\(t\)/)
    expect(funcion('limpieza_calendario').cuerpo).toMatch(/public\.limpieza_tarea_trabajada\(tb\)/)
  })
})

describe('20261103000000 · exposición', () => {
  it.each([
    ['limpieza_calendario(uuid, date, date)'],
    ['limpieza_asignar_rutinas(uuid, uuid[])'],
    ['limpieza_quitar_rutina(uuid, uuid)'],
  ])('anon no invoca %s; authenticated sí', firma => {
    const f = firma.replace(/[()[\]]/g, '\\$&')
    expect(sql).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${f} FROM PUBLIC, anon;`, 'i'))
    expect(sql).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION public\\.${f} TO authenticated, service_role;`, 'i'))
  })

  it.each([
    ['limpieza_tarea_trabajada(public.tareas_bloque)'],
    ['limpieza_asegurar_turno_programable(public.bloques_turno)'],
  ])('el helper interno %s no lo invoca authenticated', firma => {
    const f = firma.replace(/[().]/g, '\\$&')
    expect(sql).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${f} FROM PUBLIC, anon, authenticated;`, 'i'))
  })
})

describe('20261103000000 · la pantalla', () => {
  function archivosUI(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
      const ruta = join(dir, e.name)
      if (e.isDirectory()) return e.name === '__tests__' ? [] : archivosUI(ruta)
      return /\.tsx?$/.test(e.name) ? [ruta] : []
    })
  }

  it('ya no ofrece «Generar tareas» por jornada: ningún componente llama a materializar_rutinas_turno', () => {
    const llaman = archivosUI(resolve('src/components'))
      .filter(f => /materializarRutinasTurno|materializar_rutinas_turno/.test(readFileSync(f, 'utf8')))
    expect(llaman).toEqual([])
  })

  it('coverage.yml corre supabase/tests/limpieza_calendario/run.sh', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toMatch(/run: supabase\/tests\/limpieza_calendario\/run\.sh/)
  })
})
