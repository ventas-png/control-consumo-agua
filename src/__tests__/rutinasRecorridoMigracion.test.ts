import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards ESTÁTICOS de 20261102000000 (rutinas como recorrido por áreas).
//
// ALCANCE Y LÍMITE. Esto lee el SQL del repo; no ejecuta nada. La verificación
// CONDUCTUAL —guardar el recorrido entero o nada, la RLS por empresa y permiso,
// el área y el orden de cada tarea materializada— vive en
// supabase/tests/rutinas_recorrido/run.sh, con nueve mutantes, y corre en cada
// PR (job rls-sandbox de coverage.yml).
//
// Lo que se vigila AQUÍ es lo que una edición posterior podría aflojar sin que
// ninguna prueba de conducta feliz lo note:
//
//   1. Que la RPC de guardado siga siendo SECURITY INVOKER. Pasarla a DEFINER
//      «para que funcione» la saca de la RLS: escribiría en las rutinas de
//      cualquier empresa, y el camino feliz seguiría verde.
//   2. Que la tabla de paradas conserve sus FKs COMPUESTAS y el gate del tab.
//   3. Que el paso cuelgue de la parada de SU rutina (FK a (id, rutina_id)).
//   4. Que el job que corre el sandbox siga registrado.

const MIGRATIONS_DIR = resolve('supabase/migrations')
const MIG = '20261102000000_rutinas_recorrido_por_areas.sql'
const PERM_LIMPIEZA = 'condominios.tab.prog_limpieza'

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

describe('20261102000000 · guardar_recorrido_rutina escribe bajo la RLS de quien llama', () => {
  const { cabecera, cuerpo } = funcion('guardar_recorrido_rutina')

  it('es SECURITY INVOKER con search_path vacío, nunca DEFINER', () => {
    expect(cabecera).toMatch(/SECURITY INVOKER/i)
    expect(cabecera).not.toMatch(/SECURITY DEFINER/i)
    expect(cabecera).toMatch(/SET search_path = ''/i)
  })

  it('bloquea la rutina antes de reconciliar (dos guardados no se mezclan)', () => {
    expect(cuerpo).toMatch(/FROM public\.rutinas_limpieza r\s+WHERE r\.id = p_rutina_id\s+FOR UPDATE/i)
    // Y el bloqueo va ANTES de la primera escritura.
    expect(cuerpo.search(/FOR UPDATE/i)).toBeLessThan(cuerpo.search(/DELETE FROM/i))
  })

  it('valida la foto entera antes de escribir nada', () => {
    const primeraEscritura = cuerpo.search(/DELETE FROM|INSERT INTO/i)
    for (const regla of [/ERRCODE = 'invalid_parameter_value'/, /aparece dos veces en el recorrido/, /aparece dos veces en la misma parada/]) {
      const pos = cuerpo.search(regla)
      expect(pos, `falta la validación ${regla}`).toBeGreaterThan(-1)
      expect(pos, `la validación ${regla} va después de escribir`).toBeLessThan(primeraEscritura)
    }
  })

  it('anon no puede invocarla', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.guardar_recorrido_rutina\(uuid, jsonb\) FROM PUBLIC, anon;/i,
    )
    expect(sql).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.guardar_recorrido_rutina\(uuid, jsonb\) TO authenticated, service_role;/i,
    )
  })
})

describe('20261102000000 · la parada congela su tenant', () => {
  it.each([
    ['rutina_areas_rutina_fk', 'rutina_id', 'rutinas_limpieza', 'CASCADE'],
    ['rutina_areas_area_fk', 'area_id', 'areas_condominio', 'RESTRICT'],
  ])('%s es COMPUESTA (… company_id, project_id) hacia %s', (nombre, col, tabla, accion) => {
    expect(sql).toMatch(new RegExp(
      `CONSTRAINT ${nombre}\\s+FOREIGN KEY \\(${col}, company_id, project_id\\)\\s+` +
      `REFERENCES public\\.${tabla}\\(id, company_id, project_id\\) ON DELETE ${accion}`, 'i'))
  })

  it('el paso cuelga de la parada de SU rutina, y se va con ella', () => {
    expect(sql).toMatch(/CONSTRAINT rutina_areas_id_rutina_uq UNIQUE \(id, rutina_id\)/i)
    expect(sql).toMatch(
      /ADD CONSTRAINT rutina_act_parada_fk\s+FOREIGN KEY \(rutina_area_id, rutina_id\)\s+REFERENCES public\.rutina_areas\(id, rutina_id\) ON DELETE CASCADE/i,
    )
  })

  it('el trigger de coherencia sella el tenant desde la rutina y no se expone', () => {
    const { cabecera, cuerpo } = funcion('rutina_area_coherente')
    expect(cabecera).toMatch(/SECURITY DEFINER/i)
    expect(cuerpo).toMatch(/NEW\.company_id := v_rutina\.company_id;/)
    expect(cuerpo).toMatch(/NEW\.project_id := v_rutina\.project_id;/)
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.rutina_area_coherente\(\) FROM PUBLIC, anon, authenticated;/i,
    )
    expect(sql).toMatch(
      /CREATE TRIGGER trg_rutina_area_coherente\s+BEFORE INSERT OR UPDATE OF rutina_id, area_id, company_id, project_id\s+ON public\.rutina_areas/i,
    )
  })

  it('la misma actividad cabe en varias paradas, no dos veces en la misma', () => {
    expect(sql).toMatch(
      /ADD CONSTRAINT rutina_act_unica_parada\s+UNIQUE NULLS NOT DISTINCT \(rutina_id, rutina_area_id, plantilla_tarea_id\)/i,
    )
    // Se retira el viejo DESPUÉS de crear el nuevo.
    expect(sql.search(/DROP CONSTRAINT rutina_act_unica;/)).toBeGreaterThan(
      sql.search(/ADD CONSTRAINT rutina_act_unica_parada/),
    )
  })
})

describe('20261102000000 · RLS de rutina_areas con el gate del tab y nada más', () => {
  const policies = new Map(
    [...sql.matchAll(/CREATE POLICY "(rutina_areas_[a-z]+)" ON public\.rutina_areas([\s\S]*?);/gi)]
      .map(m => [m[1], m[2]]),
  )

  it('las cuatro operaciones tienen policy', () => {
    expect([...policies.keys()].sort()).toEqual([
      'rutina_areas_delete', 'rutina_areas_insert', 'rutina_areas_select', 'rutina_areas_update',
    ])
    expect(sql).toMatch(/ALTER TABLE public\.rutina_areas ENABLE ROW LEVEL SECURITY;/i)
    expect(sql).toMatch(/REVOKE ALL ON public\.rutina_areas FROM PUBLIC, anon;/i)
  })

  it.each(['rutina_areas_select', 'rutina_areas_insert', 'rutina_areas_update', 'rutina_areas_delete'])(
    '%s exige la empresa del usuario Y sólo el permiso de Limpieza', nombre => {
      const cuerpo = policies.get(nombre)!
      expect(cuerpo).toMatch(/company_id = \(SELECT public\.get_my_company_id\(\)\)/)
      const permisos = new Set([...cuerpo.matchAll(/user_has_permission\('([^']+)'\)/g)].map(m => m[1]))
      expect([...permisos]).toEqual([PERM_LIMPIEZA])
    },
  )
})

describe('20261102000000 · el sandbox conductual sigue en CI', () => {
  it('coverage.yml corre supabase/tests/rutinas_recorrido/run.sh', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toMatch(/run: supabase\/tests\/rutinas_recorrido\/run\.sh/)
  })
})
