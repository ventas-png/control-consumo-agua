import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards ESTÁTICOS del cierre+consumo atómico (20260907001000).
//
// ALCANCE Y LÍMITE. Esto lee texto del repo; la verificación CONDUCTUAL vive
// en supabase/tests/cierre_consumo_atomico/run.sh (job rls-sandbox de
// coverage.yml): NEGATIVA primero, la carrera con DOS conexiones reales y
// barrera de advisory locks, el fallo que revierte todo, el cero terminal —
// contra Postgres real. Lo que se vigila AQUÍ son regresiones de texto que
// ninguna prueba conductual atraparía a tiempo:
//
//   1. El reclamo es UNA cláusula (`FOR UPDATE OF tbs`) más UN re-chequeo.
//      Quitar cualquiera de los dos no rompe ninguna prueba secuencial: sólo
//      reaparece el doble descuento bajo concurrencia real.
//   2. La validación del tipo JSON (`jsonb_typeof = 'number'`) es lo único que
//      separa un número finito de '"NaN"'::numeric. Un refactor «equivalente»
//      con cast desde texto reabre el envenenamiento del stock.
//   3. El frontend hace UNA llamada. Si a alguien se le ocurre «simplificar»
//      volviendo al UPDATE + RPC, nada conductual falla en jsdom.

const RAIZ = resolve('.')
const MIGRATIONS_DIR = join(RAIZ, 'supabase/migrations')
const MIG_CIERRE = '20260907001000_cerrar_tarea_y_consumir_insumos.sql'
const SANDBOX_DIR = join(RAIZ, 'supabase/tests/cierre_consumo_atomico')

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')

const sqlCierre = soloCodigo(readFileSync(join(MIGRATIONS_DIR, MIG_CIERRE), 'utf8'))

const cuerpo = (nombre: string) => {
  const m = sqlCierre.match(new RegExp(
    `CREATE OR REPLACE FUNCTION public\\.${nombre}\\(([\\s\\S]*?)\\n\\$\\$;`, 'i'))
  expect(m, `la migración no define ${nombre}`).not.toBeNull()
  return m![1]
}

const motor = cuerpo('tarea_bloque_consumir_reclamado')
const rpcCierre = cuerpo('cerrar_tarea_y_consumir_insumos')
const rpcVieja = cuerpo('consumir_insumos_tarea')

describe('20260907001000 · el reclamo es un lock, no idempotencia de fe', () => {
  it('el plan se recorre con FOR UPDATE y el filtro excluye lo descartado', () => {
    expect(motor).toMatch(/FOR UPDATE OF tbs/i)
    expect(motor).toMatch(/tbs\.movimiento_id IS NULL\s*\n?\s*AND tbs\.no_usado_en IS NULL/i)
  })

  it('el claim RE-COMPRUEBA bajo el lock, en el descarte y en el consumo', () => {
    // Son DOS UPDATEs con el mismo predicado de guarda. Si alguno lo pierde,
    // una fila que cambió bajo el lock se pisaría en silencio.
    const rechequeos = motor.match(/WHERE id = fila\.id\s*\n?\s*AND movimiento_id IS NULL AND no_usado_en IS NULL/gi)
    expect(rechequeos, 'faltan re-chequeos del claim').not.toBeNull()
    expect(rechequeos!.length).toBe(2)
  })

  it('un claim que no toca exactamente 1 fila ABORTA (jamás una salida huérfana)', () => {
    expect(motor).toMatch(/GET DIAGNOSTICS v_tocadas = ROW_COUNT/i)
    expect(motor).toMatch(/IF v_tocadas <> 1 THEN/i)
  })

  it('el motor NO es SECURITY DEFINER y las RPC sí: la autorización vive arriba', () => {
    expect(motor).not.toMatch(/SECURITY DEFINER/i)
    expect(rpcCierre).toMatch(/SECURITY DEFINER/i)
    expect(rpcVieja).toMatch(/SECURITY DEFINER/i)
  })
})

describe('20260907001000 · el JSON se valida ANTES de escribir', () => {
  it('arreglo de objetos, y nada más', () => {
    expect(motor).toMatch(/jsonb_typeof\(p_consumos\) <> 'array'/)
    expect(motor).toMatch(/jsonb_typeof\(item\) <> 'object'/)
  })

  it('la cantidad exige el TIPO número: JSON no representa NaN ni Infinity', () => {
    // '"NaN"'::numeric pasa un `<= 0` (NaN no compara) y envenena el stock.
    // Exigir jsonb_typeof = 'number' es la prueba de finitud.
    expect(motor).toMatch(/jsonb_typeof\(item -> 'cantidad'\) <> 'number'/)
    expect(motor).toMatch(/v_cant < 0/)
  })

  it('duplicados y ajenos al plan se rechazan con nombre y apellido', () => {
    expect(motor).toMatch(/HAVING count\(\*\) > 1/i)
    expect(motor).toMatch(/no pertenece al plan/i)
  })
})

describe('20260907001000 · la RPC de cierre: una transacción o nada', () => {
  it('bloquea la fila de la tarea antes de decidir', () => {
    expect(rpcCierre).toMatch(/FOR UPDATE OF t\b/i)
  })

  it('mismo scope y mismas familias que el UPDATE de tareas_bloque', () => {
    expect(rpcCierre).toMatch(/PERFORM public\.assert_company_scope/i)
    for (const perm of ['tareas_personal', 'turnos', 'revision_tareas', 'prog_limpieza']) {
      expect(rpcCierre, `falta la familia ${perm}`)
        .toMatch(new RegExp(`condominios\\.tab\\.${perm}`))
    }
    // Administrar el almacén y consumir de él siguen siendo cosas distintas.
    expect(rpcCierre).not.toMatch(/condominios\.tab\.suministros/)
  })

  it('sólo cierra en completada; los otros finales conservan su camino', () => {
    expect(rpcCierre).toMatch(/IS DISTINCT FROM 'completada'/)
    expect(rpcCierre).toMatch(/ERRCODE = 'invalid_parameter_value'/)
  })

  it('el reintento sobre una tarea ya completada NO re-cierra: sólo el motor', () => {
    expect(rpcCierre).toMatch(/ELSIF v_estado = 'completada' THEN\s*\n?\s*NULL;/i)
  })

  it('el cliente llama a las RPC; el motor queda revocado', () => {
    expect(sqlCierre).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.tarea_bloque_consumir_reclamado\([^)]*\)\s*\n?\s*FROM PUBLIC, anon, authenticated/i)
    expect(sqlCierre).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.cerrar_tarea_y_consumir_insumos\(uuid, text, text, jsonb\) TO authenticated, service_role/i)
    expect(sqlCierre).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.cerrar_tarea_y_consumir_insumos\(uuid, text, text, jsonb\) FROM PUBLIC, anon/i)
  })
})

describe('20260907001000 · la RPC vieja se endurece, no se borra', () => {
  it('consumir exige una tarea YA cerrada en estado canónico final', () => {
    expect(rpcVieja).toMatch(/NOT IN \('completada', 'con_observacion', 'omitida'\)/)
    expect(rpcVieja).toMatch(/ERRCODE = 'check_violation'/)
  })

  it('misma firma (los llamadores no se rompen) y mismo motor con lock', () => {
    expect(rpcVieja).toMatch(/p_consumos jsonb DEFAULT '\[\]'::jsonb/)
    expect(rpcVieja).toMatch(/tarea_bloque_consumir_reclamado/)
    expect(rpcCierre).toMatch(/tarea_bloque_consumir_reclamado/)
  })
})

describe('20260907001000 · el cero es terminal', () => {
  it('no_usado_en existe, con su CHECK de estado imposible', () => {
    expect(sqlCierre).toMatch(/ADD COLUMN IF NOT EXISTS no_usado_en timestamptz/i)
    expect(sqlCierre).toMatch(/CHECK \(movimiento_id IS NULL OR no_usado_en IS NULL\)/i)
  })

  it('el conjunto reclamable (índice parcial) excluye lo descartado', () => {
    expect(sqlCierre).toMatch(
      /idx_tbs_pendientes\s*\n?\s*ON public\.tarea_bloque_suministros\(tarea_id\)\s*\n?\s*WHERE movimiento_id IS NULL AND no_usado_en IS NULL/i)
  })

  it('el backfill del legado sólo toca filas sin sellar (re-aplicable)', () => {
    expect(sqlCierre).toMatch(
      /WHERE motivo_no_usado IS NOT NULL\s*\n?\s*AND movimiento_id IS NULL\s*\n?\s*AND no_usado_en IS NULL/i)
  })
})

describe('el frontend hace UNA operación', () => {
  const tab = readFileSync(
    join(RAIZ, 'src/components/condominios/tabs/TareasPersonalTab.tsx'), 'utf8')
  const mutations = readFileSync(
    join(RAIZ, 'src/domain/condominios/tabMutations.ts'), 'utf8')

  it('cerrarTareaYConsumir llama a la RPC atómica con p_estado completada', () => {
    expect(mutations).toMatch(/supabase\.rpc\('cerrar_tarea_y_consumir_insumos', \{/)
    expect(mutations).toMatch(/p_estado: 'completada'/)
    expect(mutations).toMatch(/p_motivo_sin_evidencia/)
  })

  it('la pantalla cierra por la RPC y YA NO por UPDATE + consumo aparte', () => {
    expect(tab).toMatch(/cerrarTareaYConsumir\(/)
    // El par viejo: si esto reaparece, volvimos al mundo de dos requests.
    expect(tab, 'la pantalla volvió a llamar la RPC de consumo suelta')
      .not.toMatch(/consumirInsumosTarea/)
  })

  it('lo sellado como «no usado» sale del conjunto pendiente de la UI', () => {
    expect(tab).toMatch(/!i\.movimiento_id && !i\.no_usado_en/)
    const tipos = readFileSync(join(RAIZ, 'src/types/condominios/operaciones.ts'), 'utf8')
    expect(tipos).toMatch(/no_usado_en\?: string \| null/)
  })
})

describe('el sandbox del cierre atómico existe y corre en CI', () => {
  it('los archivos del sandbox están completos', () => {
    for (const f of ['run.sh', 'pre.sql', 'seed.sql', 'pre_assert.sql', 'assert.sql',
                     'assert_concurrencia.sql', 'reassert.sql', 'postdeploy.sql']) {
      expect(existsSync(join(SANDBOX_DIR, f)), `falta ${f}`).toBe(true)
    }
  })

  it('la NEGATIVA aborta si los agujeros de #809 dejan de reproducirse', () => {
    const pre = readFileSync(join(SANDBOX_DIR, 'pre_assert.sql'), 'utf8')
    expect(pre).toMatch(/la vulnerabilidad ya no se reproduce/i)
    expect(pre).toMatch(/ROLLBACK/i)
  })

  it('la carrera usa una barrera real de advisory locks', () => {
    const runSh = readFileSync(join(SANDBOX_DIR, 'run.sh'), 'utf8')
    expect(runSh).toMatch(/pg_advisory_xact_lock_shared/)
    expect(runSh).toMatch(/pg_advisory_lock\(/)
  })

  it('coverage.yml cablea el run.sh (el harness que no corre no protege)', () => {
    const coverage = readFileSync(join(RAIZ, '.github/workflows/coverage.yml'), 'utf8')
    expect(coverage).toContain('supabase/tests/cierre_consumo_atomico/run.sh')
  })
})
