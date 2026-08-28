import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards ESTÁTICOS de la materialización de rutinas (20260907000300).
//
// ALCANCE Y LÍMITE. Esto lee el SQL del repo; no ejecuta nada. La verificación
// CONDUCTUAL —que empareje por jornada, que copie el snapshot, que la segunda
// corrida no duplique ni resucite lo anulado— vive en
// supabase/tests/materializar_rutinas/run.sh y corre en cada PR.
//
// Lo que se vigila AQUÍ es lo que el sandbox no vería, porque probaría la
// versión nueva sin notar lo que se perdió:
//
//   1. Que la RPC siga siendo SECURITY DEFINER **con su propio control**. Es la
//      combinación peligrosa del repo: DEFINER se salta la RLS, así que si
//      alguien quita el `assert_company_scope` o el chequeo de permiso, la
//      función escribe en `tareas_bloque` de CUALQUIER empresa y ninguna prueba
//      de conducta feliz lo nota.
//   2. Que el INSERT siga copiando y no leyendo por join. Sustituir las
//      columnas de snapshot por un `JOIN plantillas_tarea_cargo` compila, pasa
//      la prueba de "se generó la tarea"… y hace que editar el catálogo
//      reescriba el pasado.
//   3. Que la detección de existentes NO filtre por anulación. Agregarle
//      `AND tb.anulada_en IS NULL` al EXISTS es una línea, deja todo verde, y
//      hace que cada corrida resucite lo que alguien anuló.

const MIGRATIONS_DIR = resolve('supabase/migrations')
const MIG_MAT = '20260907000300_materializar_rutinas.sql'

const archivosOrdenados = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')

const sqlMat = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG_MAT), 'utf8'))

/** Cuerpo de la RPC, sin la cabecera de la migración. */
const cuerpoRpc = (() => {
  const m = sqlMat.match(
    /CREATE OR REPLACE FUNCTION public\.materializar_rutinas_turno\(([\s\S]*?)\n\$\$;/i,
  )
  if (!m) throw new Error('no se encontró la RPC materializar_rutinas_turno')
  return m[1]
})()

describe('20260907000300 · la SECURITY DEFINER trae su propio control', () => {
  it('es SECURITY DEFINER con search_path fijado', () => {
    expect(cuerpoRpc).toMatch(/SECURITY DEFINER/i)
    expect(cuerpoRpc).toMatch(/SET search_path = public, pg_temp/i)
  })

  it('llama a assert_company_scope con la empresa del proyecto', () => {
    // Sin esto la RPC escribe en tareas_bloque de cualquier empresa: DEFINER se
    // salta la RLS, así que este PERFORM ES el aislamiento.
    expect(cuerpoRpc).toMatch(/PERFORM public\.assert_company_scope\(v_company\)/i)
    // Y la empresa sale del proyecto, no de un argumento que el cliente elija.
    expect(cuerpoRpc).toMatch(
      /SELECT p\.company_id INTO v_company FROM public\.projects p WHERE p\.id = p_project_id/i,
    )
  })

  it('además exige el permiso del tab, y sólo los dos que corresponden', () => {
    const permisos = new Set(
      [...cuerpoRpc.matchAll(/user_has_permission\(\s*'([^']+)'\s*\)/g)].map(m => m[1]),
    )
    // El mismo par que acepta el INSERT de tareas_bloque en 20260907000100:
    // de quien es la rutina, y de quien administra el turno.
    expect([...permisos].sort()).toEqual([
      'condominios.tab.prog_limpieza',
      'condominios.tab.turnos',
    ])
    expect(cuerpoRpc).toMatch(/ERRCODE = '42501'/)
  })

  it('anon no puede invocarla', () => {
    expect(sqlMat).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.materializar_rutinas_turno\(uuid, date, date\)\s+FROM PUBLIC, anon/i,
    )
    expect(sqlMat).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.materializar_rutinas_turno\(uuid, date, date\)\s+TO authenticated, service_role/i,
    )
  })

  it('acota el rango antes de tocar nada', () => {
    expect(cuerpoRpc).toMatch(/ERRCODE = '22007'/)   // rango invertido
    expect(cuerpoRpc).toMatch(/ERRCODE = '22003'/)   // más de 400 días
    expect(cuerpoRpc).toMatch(/ERRCODE = '42704'/)   // proyecto inexistente
  })
})

describe('20260907000300 · la tarea COPIA, no lee por join', () => {
  const SNAPSHOT = [
    'duracion_estimada_min',
    'checklist',
    'instrucciones_seguridad',
    'requiere_comentario',
    'requiere_checklist',
  ] as const

  it.each(SNAPSHOT)('%s existe como columna propia de tareas_bloque', col => {
    expect(sqlMat).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${col}\\b`, 'i'))
  })

  it('el INSERT escribe esas columnas desde la actividad', () => {
    const ins = cuerpoRpc.match(/INSERT INTO public\.tareas_bloque \(([\s\S]*?)\)\s*SELECT/i)
    expect(ins, 'no se encontró el INSERT en tareas_bloque').not.toBeNull()
    const columnas = ins![1].split(',').map(c => c.trim())
    for (const col of SNAPSHOT) {
      expect(columnas, `el INSERT dejó de copiar ${col}`).toContain(col)
    }
    // Y el linaje.
    expect(columnas).toContain('rutina_id')
    expect(columnas).toContain('plantilla_id')
  })

  it('la rutina que ya generó trabajo no se puede borrar', () => {
    expect(sqlMat).toMatch(
      /ADD CONSTRAINT tareas_bloque_rutina_fk[\s\S]{0,160}?ON DELETE RESTRICT/i,
    )
  })
})

describe('20260907000300 · idempotencia que respeta las decisiones', () => {
  it('la detección de existentes NO filtra por anulación', () => {
    // Agregar `AND tb.anulada_en IS NULL` aquí es una línea que deja todo verde
    // y hace que cada corrida resucite lo que alguien anuló con motivo.
    const ex = cuerpoRpc.match(
      /EXISTS \(\s*SELECT 1 FROM public\.tareas_bloque tb([\s\S]*?)\)\s*AS ya_existe/i,
    )
    expect(ex, 'no se encontró el EXISTS de ya_existe').not.toBeNull()
    expect(ex![1]).toMatch(/tb\.bloque_id = b\.id/)
    expect(ex![1]).toMatch(/tb\.plantilla_id = p\.id/)
    expect(ex![1], 'el EXISTS empezó a ignorar las anuladas: van a revivir')
      .not.toMatch(/anulada/i)
  })

  it('el INSERT lleva ON CONFLICT DO NOTHING', () => {
    expect(cuerpoRpc).toMatch(/ON CONFLICT DO NOTHING/i)
  })

  it('el índice que sostiene esa idempotencia sigue declarado en 20260907000100', () => {
    // Si alguien lo quita allá, aquí el ON CONFLICT deja de tener a qué agarrarse.
    const paridad = soloCodigo(
      readFileSync(join(MIGRATIONS_DIR, '20260907000100_tareas_bloque_paridad.sql'), 'utf8'),
    )
    expect(paridad).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_tareas_bloque_plantilla[\s\S]*?\(\s*bloque_id\s*,\s*plantilla_id\s*\)/i,
    )
  })

  it('no toca bloques cerrados ni rutinas o actividades dadas de baja', () => {
    expect(cuerpoRpc).toMatch(/bloque_cerrado_en IS NULL/i)
    expect(cuerpoRpc).toMatch(/bloque_estado NOT IN \('completado', 'incompleto'\)/i)
    expect(cuerpoRpc).toMatch(/AND r\.activa/i)
    expect(cuerpoRpc).toMatch(/AND p\.activo/i)
    // La rutina sin jornada no se materializa a ciegas.
    expect(cuerpoRpc).toMatch(/r\.plantilla_horario_id IS NOT NULL/i)
  })

  it('empareja por jornada Y por proyecto, no sólo por jornada', () => {
    const join = cuerpoRpc.match(
      /JOIN public\.bloques_turno\s+b\s+ON([\s\S]*?)WHERE/i,
    )
    expect(join).not.toBeNull()
    expect(join![1]).toMatch(/b\.plantilla_horario_id = r\.plantilla_horario_id/i)
    expect(join![1], 'sin el proyecto, una jornada homónima de otro condominio entraría')
      .toMatch(/b\.project_id = r\.project_id/i)
  })

  it('lo nuevo entra detrás de lo que el bloque ya tenía', () => {
    expect(cuerpoRpc).toMatch(/COALESCE\(MAX\(tb\.orden\), -1\)/i)
    expect(cuerpoRpc).toMatch(/bs\.max_orden \+ c\.pos/i)
    // Denso pese a los huecos del `orden` de la receta.
    expect(cuerpoRpc).toMatch(/row_number\(\) OVER \(/i)
  })
})

describe('20260907000300 · el guard de append-only sigue contento', () => {
  it('es la última migración de la serie y nadie la reescribió después', () => {
    const posteriores = archivosOrdenados.filter(f => f > MIG_MAT)
    const culpables = posteriores.filter(f =>
      /materializar_rutinas_turno/.test(soloCodigo(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))),
    )
    // Que exista una migración posterior no es problema; redefinir ESTA RPC sin
    // pasar por aquí, sí — este guard dejaría de vigilar la versión viva.
    expect(culpables).toEqual([])
  })
})
