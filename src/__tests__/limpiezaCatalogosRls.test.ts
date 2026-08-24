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
const MIG_AREAS = '20260904000000_limpieza_area_catalogo_e_historial.sql'
const MIG_PLANTILLAS = '20260904000100_plantillas_catalogo_actividades.sql'
const MIG_PUENTES = '20260904000200_plantilla_tarea_recursos.sql'

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
        // DELETE incluido A PROPÓSITO (desviación documentada en 20260904000200):
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

  it('el cargo nuevo va controlado por trigger, solo en INSERT', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.plantillas_cargo_valida_cargo/)
    expect(sql).toMatch(/BEFORE INSERT ON public\.plantillas_tarea_cargo/)
    // Nunca BEFORE UPDATE: re-validaría filas legadas con cargo libre.
    expect(sql).not.toMatch(/BEFORE INSERT OR UPDATE ON public\.plantillas_tarea_cargo/)
    expect(sql).toMatch(/'conserje', 'guardia', 'jardinero', 'mantenimiento', 'administrador', 'otro'/)
  })
})
