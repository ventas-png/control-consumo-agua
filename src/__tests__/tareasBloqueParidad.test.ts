import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards ESTÁTICOS de la paridad de `tareas_bloque` (20260907000100).
//
// ALCANCE Y LÍMITE. Esto lee el SQL del repo; no ejecuta nada contra una base.
// La verificación CONDUCTUAL vive en supabase/tests/tareas_bloque_paridad/run.sh
// (job rls-sandbox de coverage.yml) y prueba las 10 invariantes sobre Postgres
// de verdad. Lo que se vigila AQUÍ es distinto: que las reglas sigan ESCRITAS,
// porque las tres regresiones realistas son de texto, no de comportamiento.
//
//   1. El generador de policies RBAC por tabla (20260518000010) mapea
//      `tabla → permiso ÚNICO`. Si alguien lo re-corre o copia su patrón,
//      `tareas_bloque` vuelve a gatearse solo por `panel_turno` — un permiso
//      que NINGÚN consumidor real de la tabla tiene — y cuatro tabs se apagan
//      en silencio. El sandbox no lo vería: probaría la policy nueva.
//   2. Las policies legadas `company_rw_*` (FOR ALL, solo empresa) se anulan
//      por OR con cualquier gate RBAC. Volver a declararlas deja la tabla
//      abierta a toda la empresa sin que falle una sola prueba de conducta.
//   3. El bug que motivó la migración es UN CARACTER: `completado_en` donde la
//      columna es `completada_en`. Nadie lo ve leyendo por encima, y el
//      resultado es 42703 en runtime. Se vigila que no vuelva a colarse.

const MIGRATIONS_DIR = resolve('supabase/migrations')
const MIG_PARIDAD = '20260907000100_tareas_bloque_paridad.sql'
// Donde vive hoy la reparación de la RPC: llegó a `main` antes que esta
// migración y aquí se retiró la copia duplicada (ver el guard de abajo).
const MIG_HOTFIX_RPC = '20260906000200_reparar_sellado_y_actividad_tareas_bloque.sql'

const PERM_TAREAS = 'condominios.tab.tareas_personal'
const PERM_TURNOS = 'condominios.tab.turnos'
const PERM_REVISION = 'condominios.tab.revision_tareas'
const PERM_DESEMPENO = 'condominios.tab.desempeno_personal'
const PERM_LIMPIEZA = 'condominios.tab.prog_limpieza'

const archivosOrdenados = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

/**
 * SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos.
 * Es imprescindible, no cosmético — varias migraciones documentan su reversa
 * pegando el `CREATE POLICY` original comentado (20260820000000:72), y sin
 * quitarlo el reconstructor cree que la legada revivió.
 */
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')

const codigo = new Map(
  archivosOrdenados.map(f => [f, soloCodigo(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))]),
)
const sqlParidad = codigo.get(MIG_PARIDAD)!

interface Policy { nombre: string; cuerpo: string; archivo: string }

/** Última definición de cada policy sobre `tabla`, recorriendo en orden. */
function policiesVigentes(tabla: string): Map<string, Policy> {
  const vigentes = new Map<string, Policy>()
  for (const archivo of archivosOrdenados) {
    const sql = codigo.get(archivo)!
    const reCreate = new RegExp(
      `CREATE\\s+POLICY\\s+(?:"([^"]+)"|(\\w+))\\s+ON\\s+(?:public\\.)?"?${tabla}"?([\\s\\S]*?);`,
      'gi',
    )
    for (const m of sql.matchAll(reCreate)) {
      const nombre = m[1] ?? m[2]
      vigentes.set(nombre, { nombre, cuerpo: m[3], archivo })
    }
    const reDrop = new RegExp(
      `DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?(?:"([^"]+)"|(\\w+))\\s+ON\\s+(?:public\\.)?"?${tabla}"?`,
      'gi',
    )
    for (const m of sql.matchAll(reDrop)) {
      const nombre = m[1] ?? m[2]
      // Un DROP seguido de su CREATE en el mismo archivo es re-declaración; el
      // CREATE ya se registró arriba y vuelve a registrarse abajo si toca.
      const reRedeclara = new RegExp(
        `CREATE\\s+POLICY\\s+"?${nombre}"?\\s+ON\\s+(?:public\\.)?"?${tabla}"?`, 'i',
      )
      if (!reRedeclara.test(sql)) vigentes.delete(nombre)
    }
  }
  return vigentes
}

const POLICIES_TAREAS = policiesVigentes('tareas_bloque')
const POLICIES_REVISIONES = policiesVigentes('revisiones_tarea')
const POLICIES_BLOQUES = policiesVigentes('bloques_turno')

/** Permisos nombrados dentro del cuerpo de una policy. */
const permisosDe = (cuerpo: string) =>
  new Set([...cuerpo.matchAll(/user_has_permission\(\s*'([^']+)'\s*\)/g)].map(m => m[1]))

describe('20260907000100 · las legadas company_rw_* quedaron retiradas', () => {
  it.each([
    ['tareas_bloque', POLICIES_TAREAS, 'company_rw_tareas_bloque'],
    ['revisiones_tarea', POLICIES_REVISIONES, 'company_rw_revisiones_tarea'],
  ])('%s ya no tiene su policy legada', (_tabla, policies, legada) => {
    expect([...(policies as Map<string, Policy>).keys()]).not.toContain(legada)
  })

  it('ninguna policy vigente del motor de turnos abre por sola pertenencia a la empresa', () => {
    // El patrón peligroso: FOR ALL (o sin FOR) con `company_id = get_my_company_id()`
    // y SIN un solo user_has_permission. Eso se OR-ea con los gates RBAC y los
    // vuelve decorativos.
    const todas = [...POLICIES_TAREAS.values(), ...POLICIES_REVISIONES.values(),
                   ...POLICIES_BLOQUES.values()]
    const abiertas = todas.filter(
      p => /get_my_company_id/.test(p.cuerpo)
        && permisosDe(p.cuerpo).size === 0
        && !/FOR\s+DELETE/i.test(p.cuerpo),
    )
    expect(
      abiertas.map(p => `${p.nombre} (${p.archivo})`),
      'policy sin gate RBAC: cualquier miembro de la empresa entra',
    ).toEqual([])
  })
})

describe('20260907000100 · el re-gateo nombra a los consumidores REALES', () => {
  // `panel_turno` era el gate nominal y PanelTurnoTab no toca la tabla: quienes
  // la leen son tareas_personal, revision_tareas, desempeno_personal y turnos.
  it.each([
    ['tareas_bloque_select', PERM_TAREAS], ['tareas_bloque_select', PERM_TURNOS],
    ['tareas_bloque_select', PERM_REVISION], ['tareas_bloque_select', PERM_DESEMPENO],
    ['tareas_bloque_select', PERM_LIMPIEZA],
  ])('%s acepta %s', (policy, permiso) => {
    expect(permisosDe(POLICIES_TAREAS.get(policy)!.cuerpo)).toContain(permiso)
  })

  it('la cadena de RLS es coherente: el padre acepta todo lo que acepta la hija', () => {
    // Las policies de tareas_bloque derivan el tenant con un EXISTS sobre
    // bloques_turno, y ese EXISTS TAMBIÉN pasa por la RLS del padre. Nombrar un
    // permiso en la hija no sirve de nada si el padre no lo acepta — es
    // exactamente el fallo que costó el assert 7 del sandbox.
    const hija = permisosDe(POLICIES_TAREAS.get('tareas_bloque_select')!.cuerpo)
    const padre = permisosDe(POLICIES_BLOQUES.get('bloques_turno_select')!.cuerpo)
    expect([...hija].filter(p => !padre.has(p))).toEqual([])
  })

  it('la escritura del bloque no se regala a los tabs de solo lectura', () => {
    for (const policy of ['bloques_turno_insert', 'bloques_turno_update']) {
      const permisos = permisosDe(POLICIES_BLOQUES.get(policy)!.cuerpo)
      expect(permisos, `${policy} no debería aceptar ${PERM_REVISION}`).not.toContain(PERM_REVISION)
      expect(permisos, `${policy} no debería aceptar ${PERM_DESEMPENO}`).not.toContain(PERM_DESEMPENO)
      expect(permisos).toContain(PERM_LIMPIEZA)
    }
  })

  it('revisiones_tarea estrena gate RBAC y no se abre a Limpieza', () => {
    for (const policy of ['revisiones_tarea_select', 'revisiones_tarea_insert',
                          'revisiones_tarea_update']) {
      const permisos = permisosDe(POLICIES_REVISIONES.get(policy)!.cuerpo)
      expect(permisos.size, `${policy} sin permisos`).toBeGreaterThan(0)
      expect(permisos).toContain(PERM_REVISION)
      expect(permisos, 'revisar el trabajo ajeno no es cosa de Limpieza').not.toContain(PERM_LIMPIEZA)
    }
  })

  it('el borrado de la tarea ejecutada está cerrado: se anula, no se borra', () => {
    const cuerpo = POLICIES_TAREAS.get('tareas_bloque_delete')!.cuerpo
    expect(cuerpo).toMatch(/completada_en\s+IS\s+NULL/i)
    // El envoltorio `(SELECT …)` es indiferente aquí —lo exige rlsInitplan y
    // no cambia a quién deja borrar—, así que el patrón lo admite.
    expect(cuerpo).toMatch(/current_user_role\(\)\)?\s*=\s*ANY/i)
    expect(permisosDe(cuerpo).size, 'el DELETE no se abre por permiso de tab').toBe(0)
  })
})

describe('20260907000100 · el hito de cierre apunta a la columna que existe', () => {
  it('el trigger de sellado usa completada_en, no el completado_en inexistente', () => {
    const trigger = sqlParidad.match(
      /CREATE TRIGGER trg_sellar_cierre[\s\S]*?sellar_cierre\(([^)]*)\)/i,
    )
    expect(trigger, 'no se declaró trg_sellar_cierre sobre tareas_bloque').not.toBeNull()
    expect(trigger![1]).toContain("'completada_en'")
    expect(trigger![1]).toContain("'completado_por'")
  })

  it('la RPC actividad_equipo lee la columna que existe', () => {
    // La reparación NO vive en esta migración. Cuando se escribió, sí: traía
    // una copia literal de la RPC con el nombre corregido. Pero 20260906000200
    // llegó antes a `main` e hizo exactamente eso, así que repetirla aquí
    // dejaría dos copias de 200 líneas destinadas a divergir. El guard sigue
    // vigilando lo mismo —que la RPC no vuelva a leer la columna fantasma—,
    // apuntando a donde de verdad está.
    const sqlHotfix = codigo.get(MIG_HOTFIX_RPC)
    expect(sqlHotfix, `falta ${MIG_HOTFIX_RPC}`).toBeDefined()
    const rpc = sqlHotfix!.match(
      /CREATE OR REPLACE FUNCTION public\.actividad_equipo\(([\s\S]*?)\n\$\$;/i,
    )
    expect(rpc, 'debe re-declarar actividad_equipo').not.toBeNull()
    expect(rpc![1]).toMatch(/tb\.completada_en/)
    expect(rpc![1], 'volvió a colarse el typo que da 42703').not.toMatch(/\bcompletado_en\b/)
  })

  it('ninguna migración posterior reintroduce tareas_bloque.completado_en', () => {
    const culpables = archivosOrdenados
      .filter(f => f > MIG_PARIDAD)
      .filter(f => /\btareas_bloque\b[\s\S]{0,4000}?\bcompletado_en\b/.test(codigo.get(f)!))
    expect(culpables).toEqual([])
  })
})

describe('20260907000100 · paridad de evidencia con ejecuciones_limpieza', () => {
  it('la anulación lógica exige motivo y la sella la BD', () => {
    expect(sqlParidad).toMatch(/ADD CONSTRAINT tareas_bloque_anulacion_check/i)
    expect(sqlParidad).toMatch(/CREATE TRIGGER trg_tareas_bloque_anulacion/i)
    expect(sqlParidad).toMatch(/sellar_cierre\(\s*'anulada_en'\s*,\s*'anulada_por'\s*\)/i)
  })

  it('estado y prioridad dejan de ser texto libre', () => {
    expect(sqlParidad).toMatch(/ADD CONSTRAINT tareas_bloque_estado_check/i)
    expect(sqlParidad).toMatch(/ADD CONSTRAINT tareas_bloque_prioridad_check/i)
  })

  it('cargar plantillas dos veces ya no duplica la tarea', () => {
    const idx = sqlParidad.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_tareas_bloque_plantilla([\s\S]*?);/i,
    )
    expect(idx).not.toBeNull()
    expect(idx![1]).toMatch(/\(\s*bloque_id\s*,\s*plantilla_id\s*\)/i)
    // Parcial: las tareas ad-hoc (plantilla_id NULL) no se ven afectadas.
    expect(idx![1]).toMatch(/WHERE\s+plantilla_id\s+IS\s+NOT\s+NULL/i)
  })
})
