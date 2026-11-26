// Guardas estáticas de 20261230000500 (herramientas de un turno con su nombre:
// RPC herramientas_del_turno).
//
// La prueba que importa es la ejecutable —supabase/tests/herramientas_turno/
// run.sh: quién lee, sólo lo del turno y de su condominio, el vínculo legado a
// Inventario, con trece mutantes—. Lo de aquí vigila lo que esa suite no ve:
//
//   1. Que la RPC —SECURITY DEFINER, se salta la RLS de Equipos e Inventario—
//      siga proyectando del catálogo SÓLO nombre y estado. Agregar «una columna
//      más» (serie, valor de compra, costo, proveedor, ubicación) la publicaría
//      a todo el que trabaja un turno, y ninguna prueba feliz fallaría.
//   2. Que no se haya resuelto abriendo los catálogos: la migración no toca
//      policies ni grants de tabla.
//   3. Que la pantalla pida las herramientas a la RPC y no vuelva al embed
//      que la RLS deja en null.
//   4. Que el sandbox siga en CI.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const MIGRATIONS_DIR = resolve('supabase/migrations')
const MIG = '20261230000500_herramientas_del_turno.sql'

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')
const sql = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG), 'utf8'))

const m = sql.match(/CREATE OR REPLACE FUNCTION public\.herramientas_del_turno\(([\s\S]*?)AS \$\$([\s\S]*?)\n\$\$;/i)
if (!m) throw new Error('no se encontró herramientas_del_turno')
const [, cabecera, cuerpo] = m

describe('20261230000500 · proyecta lo mínimo del catálogo', () => {
  it('devuelve exactamente actividad, recurso, cantidad, obligatoria, nombre y estado', () => {
    const columnas = cabecera.match(/RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/i)![1]
      .split(',').map(c => c.trim().split(/\s+/)[0])
    expect(columnas).toEqual(['plantilla_tarea_id', 'equipo_id', 'inventario_id', 'cantidad', 'obligatoria', 'nombre', 'estado'])
  })

  it('de equipos_comunes y de inventario_condominio sólo lee nombre y estado (y la llave del JOIN)', () => {
    expect(cuerpo).toMatch(/LEFT JOIN public\.equipos_comunes e\s+ON e\.id = h\.equipo_id/)
    expect(cuerpo).toMatch(/LEFT JOIN public\.inventario_condominio i ON i\.id = h\.inventario_id/)
    for (const alias of ['e', 'i']) {
      const leidas = new Set([...cuerpo.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, 'g'))].map(x => x[1]))
      expect([...leidas].sort()).toEqual(['estado', 'id', 'nombre'])
    }
    for (const sensible of ['serial', 'numero_serie', 'valor_compra', 'costo_unitario', 'proveedor', 'ubicacion', 'notas', 'foto_url', 'descripcion']) {
      expect(cuerpo).not.toMatch(new RegExp(`\\b${sensible}\\b`))
    }
  })

  it('sólo las actividades de las tareas de ESE turno, y la puente de su condominio', () => {
    expect(cuerpo).toMatch(/WHERE t\.bloque_id = p_bloque_id AND t\.plantilla_id IS NOT NULL/)
    expect(cuerpo).toMatch(/h\.company_id = v_company\s+AND h\.project_id = v_project/)
  })
})

describe('20261230000500 · quién la invoca', () => {
  it('SECURITY DEFINER, STABLE y search_path vacío', () => {
    expect(cabecera).toMatch(/STABLE\s+SECURITY DEFINER\s+SET search_path = ''/)
  })

  it('exige la empresa, un tab que trabaje el turno y el condominio, ANTES de leer', () => {
    expect(cuerpo).toMatch(/PERFORM public\.assert_company_scope\(v_company\);/)
    for (const tab of ['tareas_personal', 'turnos', 'revision_tareas', 'prog_limpieza']) {
      expect(cuerpo).toMatch(new RegExp(`user_has_permission\\('condominios\\.tab\\.${tab}'\\)`))
    }
    expect(cuerpo).toMatch(/can_access_project\(v_project\)/)
    const lectura = cuerpo.search(/RETURN QUERY/)
    for (const control of [/assert_company_scope/, /user_has_permission/, /can_access_project/]) {
      expect(cuerpo.search(control)).toBeLessThan(lectura)
    }
  })

  it('no la abre ni a Desempeño ni a los tabs de los catálogos', () => {
    for (const tab of ['desempeno_personal', 'equipos', 'inventario']) {
      expect(cuerpo).not.toMatch(new RegExp(`condominios\\.tab\\.${tab}'`))
    }
  })

  it('anon no la invoca; authenticated y service_role sí', () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.herramientas_del_turno\(uuid\) FROM PUBLIC, anon;/)
    expect(sql).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.herramientas_del_turno\(uuid\) TO authenticated, service_role;/)
  })

  it('no se resolvió abriendo los catálogos: ni policies, ni RLS, ni grants de tabla', () => {
    expect(sql).not.toMatch(/\bPOLICY\b/i)
    expect(sql).not.toMatch(/ALTER TABLE/i)
    expect(sql).not.toMatch(/GRANT\s+(SELECT|ALL)/i)
  })
})

describe('20261230000500 · la pantalla', () => {
  const codigo = (f: string) => readFileSync(resolve(f), 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '')

  it('la preparación pide las herramientas a la RPC del turno', () => {
    const consultas = codigo('src/domain/condominios/tabQueries.ts')
    const f = consultas.match(/export async function fetchHerramientasDelTurno\([\s\S]*?\n\}/)![0]
    expect(f).toMatch(/db\.rpc\('herramientas_del_turno', \{ p_bloque_id: bloqueId \}\)/)
    expect(f).not.toMatch(/equipos_comunes|inventario_condominio/)
    expect(codigo('src/components/condominios/tabs/TareasPersonalTab.tsx')).toMatch(/await fetchHerramientasDelTurno\(bloqueId\)/)
  })

  it('el nombre sale de la RPC, no del embed', () => {
    const dominio = codigo('src/domain/condominios/ejecucionGuiada.ts')
    expect(dominio).toMatch(/nombre: h\.nombre \?\? 'Herramienta'/)
    expect(dominio).not.toMatch(/herramientaNombre/)
  })

  it('nadie vuelve a la lectura anterior', () => {
    function fuentes(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const ruta = join(dir, e.name)
        if (e.isDirectory()) return e.name === '__tests__' ? [] : fuentes(ruta)
        return /\.tsx?$/.test(e.name) ? [ruta] : []
      })
    }
    for (const f of fuentes(resolve('src'))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/fetchHerramientasDePlantillas/)
    }
  })
})

describe('20261230000500 · el sandbox sigue en CI', () => {
  it('coverage.yml corre supabase/tests/herramientas_turno/run.sh', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toMatch(/run: supabase\/tests\/herramientas_turno\/run\.sh/)
  })
})
