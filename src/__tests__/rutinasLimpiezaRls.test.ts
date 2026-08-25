import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards ESTÁTICOS de las rutinas de limpieza (20260905000200).
//
// ALCANCE Y LÍMITE. Esto lee el SQL del repo; no ejecuta nada contra una base.
// La verificación CONDUCTUAL —que el motor efectivamente rechace un área de
// otro proyecto, que el trigger imponga el tenant, que prog_limpieza vea sus
// rutinas y la empresa vecina no— vive en supabase/tests/rutinas_limpieza/run.sh
// y corre en cada PR (job rls-sandbox de coverage.yml).
//
// Lo que se vigila AQUÍ es distinto y el sandbox no lo vería, porque probaría
// la versión nueva sin notar lo que se perdió:
//
//   1. Que las CUATRO FKs sigan siendo COMPUESTAS. Reescribir
//      `FOREIGN KEY (area_id, company_id, project_id)` como `FOREIGN KEY
//      (area_id)` deja la tabla funcionando y todas las pruebas de conducta
//      felices — salvo la de mover el tenant, que es exactamente la que nadie
//      piensa en escribir. Es una regresión de una línea.
//   2. Que el gate siga siendo `prog_limpieza` y NO se cuele un permiso del
//      módulo Seguridad para administrar rutinas.
//   3. Que las anclas UNIQUE existan: sin ellas la FK compuesta ni siquiera se
//      puede declarar, y el arreglo tentador es quitarle columnas a la FK.

const MIGRATIONS_DIR = resolve('supabase/migrations')
const MIG_RUTINAS = '20260905000200_rutinas_limpieza.sql'

const PERM_LIMPIEZA = 'condominios.tab.prog_limpieza'

const archivosOrdenados = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')

const codigo = new Map(
  archivosOrdenados.map(f => [f, soloCodigo(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))]),
)
const sqlRutinas = codigo.get(MIG_RUTINAS)!

/** Permisos nombrados dentro de un fragmento de SQL. */
const permisosDe = (sql: string) =>
  new Set([...sql.matchAll(/user_has_permission\(\s*'([^']+)'\s*\)/g)].map(m => m[1]))

/** Cuerpo de cada `CREATE POLICY` de la migración, por nombre. */
function policiesDeclaradas(): Map<string, string> {
  const out = new Map<string, string>()
  const re = /CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+(?:public\.)?"?([a-z_]+)"?([\s\S]*?);/gi
  for (const m of sqlRutinas.matchAll(re)) out.set(m[1], m[3])
  return out
}
const POLICIES = policiesDeclaradas()

describe('20260905000200 · el tenant se congela con FKs COMPUESTAS', () => {
  // (constraint, columna principal, tabla referenciada)
  const COMPUESTAS: Array<[string, string, string]> = [
    ['rutinas_limpieza_area_fk', 'area_id', 'areas_condominio'],
    ['rutinas_limpieza_horario_fk', 'plantilla_horario_id', 'plantillas_horario'],
    ['rutina_act_rutina_fk', 'rutina_id', 'rutinas_limpieza'],
    ['rutina_act_plantilla_fk', 'plantilla_tarea_id', 'plantillas_tarea_cargo'],
  ]

  it.each(COMPUESTAS)('%s lleva company_id y project_id en la FK', (nombre, col, referida) => {
    const m = sqlRutinas.match(
      new RegExp(
        `CONSTRAINT\\s+${nombre}\\s+FOREIGN KEY\\s*\\(([^)]*)\\)\\s*REFERENCES\\s+public\\.${referida}\\s*\\(([^)]*)\\)`,
        'i',
      ),
    )
    expect(m, `no se declara ${nombre} hacia ${referida}`).not.toBeNull()

    const origen = m![1].split(',').map(s => s.trim())
    const destino = m![2].split(',').map(s => s.trim())
    expect(origen, `${nombre} dejó de ser compuesta: el tenant deja de congelarse`)
      .toEqual([col, 'company_id', 'project_id'])
    expect(destino).toEqual(['id', 'company_id', 'project_id'])
  })

  it('las anclas UNIQUE que esas FKs necesitan quedan declaradas', () => {
    // Sin el ancla, la FK compuesta no se puede declarar — y el arreglo
    // tentador es quitarle columnas a la FK, que es justo la regresión.
    for (const ancla of ['areas_id_tenant_uq', 'plantillas_horario_id_tenant_uq']) {
      expect(sqlRutinas, `falta el ancla ${ancla}`).toMatch(
        new RegExp(`ADD CONSTRAINT ${ancla} UNIQUE \\(id, company_id, project_id\\)`, 'i'),
      )
    }
    // La de la propia rutina va inline, y la de plantillas viene de 20260904000100.
    expect(sqlRutinas).toMatch(/CONSTRAINT rutinas_id_tenant_uq UNIQUE \(id, company_id, project_id\)/i)
    expect(codigo.get('20260904000100_plantillas_catalogo_actividades.sql')!)
      .toMatch(/plantillas_cargo_id_tenant_uq UNIQUE \(id, company_id, project_id\)/i)
  })

  it('el trigger sella el tenant desde la rutina y no confía en el cliente', () => {
    expect(sqlRutinas).toMatch(/CREATE TRIGGER trg_rutina_act_coherente/i)
    const fn = sqlRutinas.match(
      /CREATE OR REPLACE FUNCTION public\.rutina_actividad_coherente\(\)([\s\S]*?)\n\$\$;/i,
    )
    expect(fn).not.toBeNull()
    expect(fn![1], 'el tenant debe imponerse desde la rutina').toMatch(
      /NEW\.company_id\s*:=\s*v_rutina\.company_id/,
    )
    expect(fn![1]).toMatch(/NEW\.project_id\s*:=\s*v_rutina\.project_id/)
    // Distinguir "de otro tenant" de "no existe" es el motivo de la SECURITY
    // DEFINER: con dos códigos de error distintos.
    expect(fn![1]).toMatch(/ERRCODE = 'foreign_key_violation'/)
    expect(fn![1]).toMatch(/ERRCODE = 'check_violation'/)
  })

  it('la SECURITY DEFINER nueva revoca EXECUTE de PUBLIC (regla (e) del guard)', () => {
    expect(sqlRutinas).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.rutina_actividad_coherente\(\)\s+FROM PUBLIC, anon, authenticated/i,
    )
  })
})

describe('20260905000200 · RBAC: las rutinas son de Limpieza', () => {
  it('declara las cuatro policies de cada tabla', () => {
    for (const t of ['rutinas_limpieza', 'rutina_actividades']) {
      for (const op of ['select', 'insert', 'update', 'delete']) {
        expect([...POLICIES.keys()], `falta ${t}_${op}`).toContain(`${t}_${op}`)
      }
    }
  })

  it.each([...['rutinas_limpieza', 'rutina_actividades'].flatMap(t =>
    ['select', 'insert', 'update', 'delete'].map(op => `${t}_${op}`))])(
    '%s se gatea SOLO con prog_limpieza', policy => {
      const permisos = permisosDe(POLICIES.get(policy)!)
      expect([...permisos], `${policy} debe nombrar exactamente ${PERM_LIMPIEZA}`)
        .toEqual([PERM_LIMPIEZA])
    })

  it('el DELETE va por permiso del tab y no por owner/admin', () => {
    // Desviación deliberada del convenio, igual que en 20260904000200: quitar un
    // paso es edición de catálogo, no destrucción de historial. Con owner/admin,
    // el operador que sí edita la rutina sufriría deletes silenciosos de 0 filas.
    for (const policy of ['rutinas_limpieza_delete', 'rutina_actividades_delete']) {
      expect(POLICIES.get(policy)!).not.toMatch(/current_user_role\(\)/)
    }
  })

  it('ninguna policy abre por sola pertenencia a la empresa', () => {
    for (const [nombre, cuerpo] of POLICIES) {
      if (!/get_my_company_id/.test(cuerpo)) continue
      expect(permisosDe(cuerpo).size, `${nombre} sin gate RBAC: entra toda la empresa`)
        .toBeGreaterThan(0)
    }
  })

  it('anon queda fuera y authenticated pasa por RLS', () => {
    expect(sqlRutinas).toMatch(
      /REVOKE ALL ON public\.rutinas_limpieza, public\.rutina_actividades FROM PUBLIC, anon/i,
    )
    expect(sqlRutinas).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]{0,120}TO authenticated/i)
  })
})

describe('20260905000200 · la receta no se contradice a sí misma', () => {
  it('la misma actividad no se repite dentro de una rutina', () => {
    expect(sqlRutinas).toMatch(
      /CONSTRAINT rutina_act_unica UNIQUE \(rutina_id, plantilla_tarea_id\)/i,
    )
  })

  it('dos rutinas del mismo proyecto no comparten nombre normalizado', () => {
    const idx = sqlRutinas.match(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_rutinas_nombre_normalizado([\s\S]*?);/i,
    )
    expect(idx).not.toBeNull()
    expect(idx![1]).toMatch(/\(project_id, public\.areas_normalizar_nombre\(nombre\)\)/i)
    // TOTAL, no parcial por `activa`: chocar con una rutina inactiva también es
    // duplicado — se reactiva, no se recrea (mismo criterio que las áreas).
    expect(idx![1]).not.toMatch(/WHERE/i)
  })

  it('el borrado distingue definición de catálogo referenciado', () => {
    // La rutina se lleva sus pasos…
    expect(sqlRutinas).toMatch(
      /CONSTRAINT rutina_act_rutina_fk[\s\S]{0,200}?ON DELETE CASCADE/i,
    )
    // …pero lo que vive en un catálogo no se borra por debajo.
    for (const fk of ['rutina_act_plantilla_fk', 'rutinas_limpieza_area_fk', 'rutinas_limpieza_horario_fk']) {
      expect(sqlRutinas, `${fk} debería ser RESTRICT`).toMatch(
        new RegExp(`CONSTRAINT ${fk}[\\s\\S]{0,200}?ON DELETE RESTRICT`, 'i'),
      )
    }
  })

  it('el servicio y el nombre no son texto libre', () => {
    expect(sqlRutinas).toMatch(/CONSTRAINT rutinas_limpieza_nombre_check CHECK \(btrim\(nombre\) <> ''\)/i)
    expect(sqlRutinas).toMatch(/CONSTRAINT rutinas_limpieza_servicio_check/i)
  })

  it('el autor lo sella la BD en ambas tablas', () => {
    const sellos = [...sqlRutinas.matchAll(
      /CREATE TRIGGER trg_sellar_creado_por\s+BEFORE INSERT OR UPDATE ON public\.([a-z_]+)/gi,
    )].map(m => m[1]).sort()
    expect(sellos).toEqual(['rutina_actividades', 'rutinas_limpieza'])
    expect(sqlRutinas).toMatch(/sellar_actor\('creado_por', 'forzar'\)/)
  })
})
