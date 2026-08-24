import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards ESTÁTICOS de los catálogos operativos de limpieza (serie 20260904*).
//
// ALCANCE Y LÍMITE. Esto lee el SQL del repo; no ejecuta nada contra una base.
// Vigila que las reglas sigan ESCRITAS como deben, que es la regresión realista:
// el repo tiene un generador de policies RBAC por tabla (20260518000010) con un
// mapping `tabla → permiso único`; si alguien lo re-corre o copia su patrón,
// la escritura de áreas vuelve a gatearse SOLO por checklist_areas (y el rol
// Seguridad pierde el alta de áreas en silencio), o las policies de los puentes
// pierden el permiso del tab. También vigila que nadie "restaure" las policies
// legacy company_rw_* ni el ON DELETE CASCADE que destruía el historial.
// La verificación CONDUCTUAL vive en supabase/tests/limpieza_catalogos/run.sh,
// que corre en cada PR (job rls-sandbox de coverage.yml).

const MIGRATIONS_DIR = resolve('supabase/migrations')
const MIG_AREAS = '20260904000100_limpieza_area_catalogo_e_historial.sql'
const MIG_PLANTILLAS = '20260904000200_plantillas_catalogo_actividades.sql'
const MIG_PUENTES = '20260904000300_plantilla_tarea_recursos.sql'
const MIG_FINAL = '20260904000400_limpieza_integridad_final.sql'
const MIG_DEDUPE = '20260907000000_areas_dedupe_y_unicidad.sql'

const PERM_CHECKLIST = 'condominios.tab.checklist_areas'
const PERM_RONDAS = 'condominios.tab.rutas_ronda'
const PERM_LIMPIEZA = 'condominios.tab.prog_limpieza'
const PERM_PLANTILLAS = 'condominios.tab.plantillas_cargo'
const PERM_TAREAS = 'condominios.tab.tareas_personal'
const PERM_AREAS_MANAGE = 'condominios.areas.manage'

interface Policy { nombre: string; cuerpo: string; archivo: string }

const archivosOrdenados = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

/** Última definición de cada policy sobre `tabla`, en orden de migración. */
function policiesVigentes(tabla: string): Map<string, Policy> {
  const vigentes = new Map<string, Policy>()
  for (const archivo of archivosOrdenados) {
    const sql = readFileSync(join(MIGRATIONS_DIR, archivo), 'utf8')
    const re = new RegExp(
      `CREATE\\s+POLICY\\s+(?:"([^"]+)"|(\\w+))\\s+ON\\s+(?:public\\.)?"?${tabla}"?([\\s\\S]*?);`,
      'gi',
    )
    for (const m of sql.matchAll(re)) {
      vigentes.set(m[1] ?? m[2], { nombre: m[1] ?? m[2], cuerpo: m[3], archivo })
    }
  }
  return vigentes
}

/**
 * Última acción (create/drop) sobre una policy por nombre, recorriendo las
 * migraciones en orden. `policiesVigentes` solo ve los CREATE; esto detecta si
 * el último movimiento fue el DROP — que es lo que las 20260904* hacen con las
 * legacy — o si alguien la revivió después.
 */
function ultimaAccion(tabla: string, policy: string): 'create' | 'drop' | null {
  let accion: 'create' | 'drop' | null = null
  const reCreate = new RegExp(`CREATE\\s+POLICY\\s+"?${policy}"?\\s+ON\\s+(?:public\\.)?"?${tabla}"?`, 'i')
  const reDrop = new RegExp(`DROP\\s+POLICY\\s+(?:IF\\s+EXISTS\\s+)?"?${policy}"?\\s+ON\\s+(?:public\\.)?"?${tabla}"?`, 'i')
  for (const archivo of archivosOrdenados) {
    const sql = readFileSync(join(MIGRATIONS_DIR, archivo), 'utf8')
    // Índice de la ÚLTIMA aparición dentro del archivo, por si conviven ambas.
    const iCreate = sql.search(reCreate)
    const iDrop = sql.search(reDrop)
    if (iCreate === -1 && iDrop === -1) continue
    accion = iDrop > iCreate ? 'drop' : 'create'
  }
  return accion
}

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
function soloCodigo(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

describe('las policies legacy company_rw_* quedaron retiradas y no reviven', () => {
  it('company_rw_areas: su última acción registrada es el DROP', () => {
    expect(ultimaAccion('areas_condominio', 'company_rw_areas')).toBe('drop')
  })

  it('company_rw_plantillas_cargo: su última acción registrada es el DROP', () => {
    expect(ultimaAccion('plantillas_tarea_cargo', 'company_rw_plantillas_cargo')).toBe('drop')
  })
})

describe('policies de areas_condominio tras el ensanche', () => {
  const vigentes = policiesVigentes('areas_condominio')

  it('existen las cuatro operaciones', () => {
    for (const op of ['select', 'insert', 'update', 'delete']) {
      expect([...vigentes.keys()]).toContain(`areas_condominio_${op}`)
    }
  })

  it('el SELECT sigue abierto a la empresa (catálogo transversal, sin gate de permiso)', () => {
    const cuerpo = vigentes.get('areas_condominio_select')!.cuerpo
    expect(cuerpo).toMatch(/company_id = public\.get_my_company_id\(\)/)
    expect(cuerpo).not.toMatch(/user_has_permission/)
  })

  for (const nombre of ['areas_condominio_insert', 'areas_condominio_update']) {
    it(`${nombre} exige autorización ESPECÍFICA, no un tab consumidor`, () => {
      // Ver rutas_ronda o prog_limpieza (tabs que CONSUMEN el catálogo) no
      // puede bastar para administrarlo: hace falta el gate canónico o el
      // permiso dedicado.
      const cuerpo = vigentes.get(nombre)!.cuerpo
      expect(cuerpo).toContain(PERM_CHECKLIST)
      expect(cuerpo).toContain(PERM_AREAS_MANAGE)
      expect(cuerpo).not.toContain(PERM_RONDAS)
      expect(cuerpo).not.toContain(PERM_LIMPIEZA)
      expect(cuerpo).toMatch(/company_id = public\.get_my_company_id\(\)/)
    })
  }

  it('el permiso dedicado se siembra y se concede a los roles que ya administraban áreas', () => {
    const sql = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG_AREAS), 'utf8'))
    expect(sql).toMatch(/INSERT INTO public\.permissions[\s\S]*'condominios\.areas\.manage'/)
    // Operaciones/Mantenimiento y Seguridad/Guardia (ids fijos de 20260518000006).
    expect(sql).toMatch(/'00000000-0000-0000-0000-000000000004', 'condominios\.areas\.manage'/)
    expect(sql).toMatch(/'00000000-0000-0000-0000-000000000005', 'condominios\.areas\.manage'/)
  })

  it('el DELETE se gobierna por rol, no por el helper de permisos', () => {
    // user_has_permission devuelve true a cualquier clave para owner/admin
    // (20260518000008): un gate de permiso detrás del filtro de rol no filtra.
    const cuerpo = vigentes.get('areas_condominio_delete')!.cuerpo
    expect(cuerpo).not.toMatch(/user_has_permission/)
    expect(cuerpo).toMatch(/ANY\(ARRAY\['company_owner', ?'admin'\]\)/)
  })
})

describe('policies de plantillas_tarea_cargo tras el catálogo de actividades', () => {
  const vigentes = policiesVigentes('plantillas_tarea_cargo')

  it('el SELECT acepta plantillas_cargo, tareas_personal y prog_limpieza', () => {
    // prog_limpieza: el módulo Limpieza consulta el catálogo de actividades
    // sin requerir permisos del módulo Seguridad.
    const cuerpo = vigentes.get('plantillas_tarea_cargo_select')!.cuerpo
    expect(cuerpo).toContain(PERM_PLANTILLAS)
    expect(cuerpo).toContain(PERM_TAREAS)
    expect(cuerpo).toContain(PERM_LIMPIEZA)
  })

  for (const nombre of ['plantillas_tarea_cargo_insert', 'plantillas_tarea_cargo_update']) {
    it(`${nombre} se gatea SOLO por plantillas_cargo`, () => {
      const cuerpo = vigentes.get(nombre)!.cuerpo
      expect(cuerpo).toContain(PERM_PLANTILLAS)
      expect(cuerpo).not.toContain(PERM_TAREAS)
    })
  }

  it('el DELETE se gobierna por rol', () => {
    const cuerpo = vigentes.get('plantillas_tarea_cargo_delete')!.cuerpo
    expect(cuerpo).not.toMatch(/user_has_permission/)
    expect(cuerpo).toMatch(/ANY\(ARRAY\['company_owner', ?'admin'\]\)/)
  })
})

for (const tabla of ['plantilla_tarea_suministros', 'plantilla_tarea_herramientas']) {
  describe(`policies de ${tabla}`, () => {
    const vigentes = policiesVigentes(tabla)

    it('existen las cuatro operaciones', () => {
      for (const op of ['select', 'insert', 'update', 'delete']) {
        expect([...vigentes.keys()]).toContain(`${tabla}_${op}`)
      }
    })

    it('el SELECT acepta plantillas_cargo, tareas_personal y prog_limpieza, acotado a la empresa', () => {
      const cuerpo = vigentes.get(`${tabla}_select`)!.cuerpo
      expect(cuerpo).toContain(PERM_PLANTILLAS)
      expect(cuerpo).toContain(PERM_TAREAS)
      expect(cuerpo).toContain(PERM_LIMPIEZA)
      expect(cuerpo).toMatch(/company_id = public\.get_my_company_id\(\)/)
    })

    for (const op of ['insert', 'update', 'delete']) {
      it(`${op} se gatea por plantillas_cargo y queda acotado a la empresa`, () => {
        // DELETE incluido A PROPÓSITO (desviación documentada en 20260904000300):
        // quitar un recurso de una plantilla es edición de catálogo, no
        // destrucción de historial — eso lo protegen los RESTRICT.
        const cuerpo = vigentes.get(`${tabla}_${op}`)!.cuerpo
        expect(cuerpo).toContain(PERM_PLANTILLAS)
        expect(cuerpo).toMatch(/company_id = public\.get_my_company_id\(\)/)
      })
    }
  })
}

describe('protección del historial y del backfill (texto de las migraciones)', () => {
  const sqlAreas = readFileSync(join(MIGRATIONS_DIR, MIG_AREAS), 'utf8')
  const sqlPlantillas = readFileSync(join(MIGRATIONS_DIR, MIG_PLANTILLAS), 'utf8')
  const sqlPuentes = readFileSync(join(MIGRATIONS_DIR, MIG_PUENTES), 'utf8')

  it('la FK de ejecuciones se recrea RESTRICT y solo si sigue en CASCADE', () => {
    const codigo = soloCodigo(sqlAreas)
    expect(codigo).toMatch(/confdeltype = 'c'/)
    expect(codigo).toMatch(/REFERENCES public\.programacion_limpieza\(id\) ON DELETE RESTRICT/)
  })

  it('ninguna migración posterior devuelve esa FK a CASCADE', () => {
    const posteriores = archivosOrdenados.filter(f => f > MIG_AREAS)
    const infractores = posteriores.filter(f =>
      /REFERENCES\s+public\.programacion_limpieza\(id\)\s+ON\s+DELETE\s+CASCADE/i.test(
        soloCodigo(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')),
      ),
    )
    expect(infractores).toEqual([])
  })

  it('area_id nace RESTRICT, nullable y con el snapshot `area` intacto', () => {
    const codigo = soloCodigo(sqlAreas)
    expect(codigo).toMatch(/ADD COLUMN IF NOT EXISTS area_id uuid\s*\n?\s*REFERENCES public\.areas_condominio\(id\) ON DELETE RESTRICT/)
    // El backfill compara con el normalizador pero JAMÁS reescribe los textos
    // históricos: ni `area` ni `cargo` aparecen como destino de un SET.
    expect(codigo).not.toMatch(/SET\s+area\s*=/i)
    expect(soloCodigo(sqlPlantillas)).not.toMatch(/SET\s+cargo\s*=/i)
  })

  it('el backfill es idempotente y no resuelve ambiguos', () => {
    const codigo = soloCodigo(sqlAreas)
    // Solo toca filas sin vincular…
    expect(codigo).toMatch(/pl\.area_id IS NULL/)
    // …y descarta grupos con más de una coincidencia normalizada.
    expect(codigo).toMatch(/NOT EXISTS[\s\S]*otra\.id <> a\.id/)
  })

  it('los CHECK del catálogo de actividades están declarados', () => {
    const codigo = soloCodigo(sqlPlantillas)
    expect(codigo).toMatch(/plantillas_cargo_servicio_check/)
    expect(codigo).toMatch(/duracion_estimada_min IS NULL OR duracion_estimada_min > 0/)
    expect(codigo).toMatch(/jsonb_typeof\(checklist\) = 'array'/)
  })

  it('los puentes sellan el tenant con SECURITY DEFINER revocada y validan empresa Y proyecto', () => {
    const codigo = soloCodigo(sqlPuentes)
    expect(codigo).toMatch(/SECURITY DEFINER/)
    expect(codigo).toMatch(/REVOKE EXECUTE ON FUNCTION public\.plantilla_recurso_coherente\(\) FROM PUBLIC, anon, authenticated/)
    expect(codigo).toMatch(/NEW\.company_id := v_plantilla\.company_id/)
    expect(codigo).toMatch(/NEW\.project_id := v_plantilla\.project_id/)
    expect(codigo).toMatch(/check_violation/)
  })

  it('los puentes nacen con RLS, UNIQUE anti-duplicado y cantidad positiva', () => {
    const codigo = soloCodigo(sqlPuentes)
    expect(codigo).toMatch(/plantilla_tarea_suministros\s+ENABLE ROW LEVEL SECURITY/)
    expect(codigo).toMatch(/plantilla_tarea_herramientas ENABLE ROW LEVEL SECURITY/)
    expect(codigo).toMatch(/UNIQUE \(plantilla_tarea_id, suministro_id\)/)
    expect(codigo).toMatch(/UNIQUE \(plantilla_tarea_id, inventario_id\)/)
    expect(codigo).toMatch(/CHECK \(cantidad > 0\)/)
  })
})

describe('historial de ejecuciones: inmutable desde la aplicación', () => {
  const vigentes = policiesVigentes('ejecuciones_limpieza')

  it('el DELETE queda reservado a soporte de plataforma (ni owner ni admin)', () => {
    const cuerpo = vigentes.get('ejecuciones_limpieza_delete')!.cuerpo
    expect(cuerpo).toMatch(/is_super_admin\(\)/)
    expect(cuerpo).not.toMatch(/company_owner/)
    expect(cuerpo).not.toMatch(/current_user_role/)
  })

  it('la anulación lógica existe, exige motivo y sella al autor', () => {
    const sql = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG_AREAS), 'utf8'))
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS anulada_en/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS motivo_anulacion/)
    expect(sql).toMatch(/ejec_limpieza_anulacion_check/)
    expect(sql).toMatch(/btrim\(coalesce\(motivo_anulacion, ''\)\) <> ''/)
    expect(sql).toMatch(/sellar_cierre\('anulada_en', 'anulada_por'\)/)
  })

  it('ninguna pantalla borra ejecuciones de limpieza', () => {
    // El historial se anula; un deleteCondominioRow('ejecuciones_limpieza', …)
    // en cualquier componente sería un borrado físico de evidencia.
    const archivos: string[] = []
    const recorrer = (dir: string) => {
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const ruta = join(dir, entrada.name)
        if (entrada.isDirectory()) recorrer(ruta)
        else if (/\.tsx?$/.test(entrada.name)) archivos.push(ruta)
      }
    }
    recorrer(resolve('src/components'))
    const infractores = archivos.filter(f =>
      /delete\w*\(\s*['"]ejecuciones_limpieza['"]/.test(readFileSync(f, 'utf8')),
    )
    expect(infractores).toEqual([])
  })
})

describe('integridad multiempresa: FKs compuestas', () => {
  const sqlPuentes = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG_PUENTES), 'utf8'))
  const sqlPlantillas = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG_PLANTILLAS), 'utf8'))

  it('los padres exponen el ancla UNIQUE (id, company_id, project_id)', () => {
    expect(sqlPlantillas).toMatch(/plantillas_cargo_id_tenant_uq UNIQUE \(id, company_id, project_id\)/)
    expect(sqlPuentes).toMatch(/suministros_id_tenant_uq UNIQUE \(id, company_id, project_id\)/)
    expect(sqlPuentes).toMatch(/inventario_id_tenant_uq UNIQUE \(id, company_id, project_id\)/)
  })

  it('cada puente referencia al padre y al recurso POR EL TRÍO completo', () => {
    for (const fk of ['pt_suministro_plantilla_fk', 'pt_suministro_recurso_fk',
                      'pt_herramienta_plantilla_fk', 'pt_herramienta_recurso_fk']) {
      expect(sqlPuentes).toContain(fk)
    }
    expect(sqlPuentes).toMatch(/FOREIGN KEY \(plantilla_tarea_id, company_id, project_id\)/)
    expect(sqlPuentes).toMatch(/FOREIGN KEY \(suministro_id, company_id, project_id\)/)
    expect(sqlPuentes).toMatch(/FOREIGN KEY \(inventario_id, company_id, project_id\)/)
  })

  it('las tablas nuevas llevan GRANT de mínimo privilegio', () => {
    expect(sqlPuentes).toMatch(/REVOKE ALL ON public\.plantilla_tarea_suministros, public\.plantilla_tarea_herramientas FROM PUBLIC, anon/)
    expect(sqlPuentes).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE/)
    expect(sqlPuentes).toMatch(/TO authenticated/)
  })

  it('la cantidad de insumos usa la precisión del stock de suministros', () => {
    expect(sqlPuentes).toMatch(/cantidad\s+numeric\(10,2\)/)
  })
})

describe('reglas del catálogo de actividades', () => {
  const sql = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG_PLANTILLAS), 'utf8'))

  it('requiere_checklist exige pasos con texto (CHECK con función IMMUTABLE)', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.plantilla_checklist_valido/)
    expect(sql).toMatch(/IMMUTABLE/)
    expect(sql).toMatch(/plantillas_cargo_checklist_oblig_check/)
    expect(sql).toMatch(/NOT requiere_checklist OR public\.plantilla_checklist_valido\(checklist\)/)
  })

  it('20260904000300 declaró el trigger de cargo solo en INSERT', () => {
    // Se fija el estado HISTÓRICO de este archivo, que es inmutable. La forma
    // vigente la pone 20260904000400 (ver el bloque de integridad final): allí
    // se demuestra que sí se puede validar el UPDATE de `cargo` sin romper las
    // filas legadas, que era el motivo declarado para dejarlo en INSERT.
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.plantillas_cargo_valida_cargo/)
    expect(sql).toMatch(/BEFORE INSERT ON public\.plantillas_tarea_cargo/)
    expect(sql).toMatch(/'conserje', 'guardia', 'jardinero', 'mantenimiento', 'administrador', 'otro'/)
  })
})

describe('20260904000400 · integridad final', () => {
  const sql = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG_FINAL), 'utf8'))

  it('el ancla UNIQUE de áreas lleva el trío completo', () => {
    // Sin ella la FK compuesta no es declarable: PostgreSQL exige un índice
    // único que cubra EXACTAMENTE las columnas referenciadas.
    expect(sql).toMatch(
      /ADD CONSTRAINT areas_id_tenant_uq UNIQUE \(id, company_id, project_id\)/,
    )
  })

  it('la FK de area_id pasa a ser compuesta y sigue siendo RESTRICT', () => {
    expect(sql).toMatch(/FOREIGN KEY \(area_id, company_id, project_id\)/)
    expect(sql).toMatch(
      /REFERENCES public\.areas_condominio \(id, company_id, project_id\)/,
    )
    expect(sql).toMatch(/ON DELETE RESTRICT/)
    // company_id sola no alcanza: dejaría pasar un área de otro proyecto de la
    // MISMA empresa. El sandbox lo prueba ejecutándolo (invariante 30).
    expect(sql).not.toMatch(/FOREIGN KEY \(area_id, company_id\)\s*\n\s*REFERENCES/)
  })

  it('descubre la FK vieja por catálogo en vez de asumir su nombre', () => {
    // Es anónima (la declaró un ADD COLUMN … REFERENCES inline), así que el
    // nombre lo puso PostgreSQL y puede diferir entre entornos.
    expect(sql).toMatch(/FROM pg_constraint/)
    expect(sql).toMatch(/conkey\s*=\s*ARRAY\[v_attnum\]/)
    expect(sql).not.toMatch(/DROP CONSTRAINT programacion_limpieza_area_id_fkey/)
  })

  it('el trigger de cargo cubre INSERT y UPDATE OF cargo', () => {
    expect(sql).toMatch(
      /BEFORE INSERT OR UPDATE OF cargo ON public\.plantillas_tarea_cargo/,
    )
  })

  it('y sólo valida cuando el cargo CAMBIA', () => {
    // EL FILO DE TODO EL ARREGLO. `UPDATE OF cargo` no dispara si el UPDATE no
    // menciona la columna, pero sí dispara con `SET cargo = cargo` — que es lo
    // que genera cualquier ORM que reescriba la fila entera. Sin este guard,
    // una fila legada con cargo de texto libre se vuelve ineditable.
    expect(sql).toMatch(/TG_OP = 'INSERT' OR NEW\.cargo IS DISTINCT FROM OLD\.cargo/)
  })

  it('el desvinculado de áreas cruzadas conserva el texto y avisa', () => {
    // Poner area_id a NULL es una escritura de datos: no puede pasar callada.
    expect(sql).toMatch(/SET area_id = NULL/)
    expect(sql).toMatch(/RAISE NOTICE 'LIMPIEZA_INTEGRIDAD/)
    // El snapshot `area` NO se toca: es lo que deja la fila mostrable como
    // «pendiente de vincular» en vez de vacía.
    expect(sql).not.toMatch(/SET area_id = NULL,\s*area\s*=/)
  })

  it('el sandbox aplica la cuarta migración y la re-aplica', () => {
    const runSh = readFileSync(resolve('supabase/tests/limpieza_catalogos/run.sh'), 'utf8')
    expect(runSh).toContain(MIG_FINAL)
    // Dos veces: la serie y la pasada de idempotencia.
    expect(runSh.match(/\$MIG_FINAL/g) ?? []).toHaveLength(2)
  })
})

describe('fusión de áreas duplicadas (20260907000000)', () => {
  const sql = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG_DEDUPE), 'utf8'))

  it('re-apunta las CUATRO FKs entrantes, ninguna menos', () => {
    // Si alguien añade una quinta FK a areas_condominio y no la suma aquí, la
    // fusión dejaría filas apuntando a un área retirada.
    for (const tabla of ['puntos_control_ruta', 'plantillas_tarea_cargo',
                         'tareas_bloque', 'programacion_limpieza']) {
      expect(sql).toMatch(new RegExp(`UPDATE public\\.${tabla}[\\s\\S]*?SET area_id = f\\.ganadora_id`))
    }
  })

  it('el conjunto de FKs del guard coincide con las declaradas en las migraciones', () => {
    // Fuente de verdad: todo REFERENCES … areas_condominio de cualquier migración.
    const tablasConFk = new Set<string>()
    for (const archivo of archivosOrdenados) {
      const texto = soloCodigo(readFileSync(join(MIGRATIONS_DIR, archivo), 'utf8'))
      // CREATE TABLE: la tabla es la del CREATE; ADD COLUMN: la del ALTER.
      const reCreate = /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?(\w+)([\s\S]*?);/gi
      for (const m of texto.matchAll(reCreate)) {
        if (/REFERENCES\s+(?:public\.)?areas_condominio/i.test(m[2])) tablasConFk.add(m[1])
      }
      const reAlter = /ALTER TABLE(?: ONLY)?\s+(?:public\.)?(\w+)([\s\S]*?);/gi
      for (const m of texto.matchAll(reAlter)) {
        if (/REFERENCES\s+(?:public\.)?areas_condominio/i.test(m[2])) tablasConFk.add(m[1])
      }
    }
    expect([...tablasConFk].sort()).toEqual([
      'plantillas_tarea_cargo', 'programacion_limpieza', 'puntos_control_ruta', 'tareas_bloque',
    ])
  })

  it('verifica fail-closed ANTES de retirar nada', () => {
    const posVerif = sql.indexOf('v_huerfanas')
    const posDelete = sql.indexOf('DELETE FROM public.areas_condominio')
    expect(posVerif).toBeGreaterThan(-1)
    expect(posDelete).toBeGreaterThan(posVerif)
    expect(sql).toMatch(/RAISE EXCEPTION 'areas_dedupe abortado/)
    // El cruce de tenant se comprueba por JOIN al padre en las dos tablas que
    // no tienen project_id propio.
    expect(sql).toMatch(/JOIN public\.rutas_ronda/)
    expect(sql).toMatch(/JOIN public\.bloques_turno/)
  })

  it('particiona por proyecto y elige superviviente de forma determinista', () => {
    expect(sql).toMatch(/PARTITION BY a\.project_id, public\.areas_normalizar_nombre\(a\.nombre\)/)
    expect(sql).toMatch(/a\.activo DESC/)
    expect(sql).toMatch(/a\.created_at ASC NULLS LAST/)
    expect(sql).toMatch(/a\.id ASC/)
  })

  it('el UNIQUE es TOTAL, no parcial por activo', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS uq_areas_nombre_normalizado/)
    expect(sql).toMatch(/ON public\.areas_condominio \(project_id, public\.areas_normalizar_nombre\(nombre\)\)/)
    // Un parcial WHERE activo contradiría el mensaje de la UI ("reactívala").
    const idx = sql.slice(sql.indexOf('uq_areas_nombre_normalizado'))
    expect(idx.slice(0, 200)).not.toMatch(/WHERE\s+activo/)
  })

  it('no reescribe ningún texto histórico', () => {
    expect(sql).not.toMatch(/SET\s+nombre\s*=/i)
    expect(sql).not.toMatch(/SET\s+area\s*=/i)
  })
})
