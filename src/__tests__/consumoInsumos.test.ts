import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards del consumo de insumos (20260905000500).
//
// LA VERIFICACIÓN CONDUCTUAL vive en supabase/tests/consumo_insumos/run.sh: que
// el stock baje, que baje una sola vez y que la autorización cruce bien son
// hechos del motor y allí se ejecutan de verdad.
//
// LO QUE ESE SANDBOX NO PUEDE VER es lo que se PIERDE al reescribir la
// migración, porque probaría la versión nueva. Aquí se fijan los filos que, si
// alguien los desafila, dejarían una migración que pasa todas sus pruebas y aun
// así está mal:
//
//   · la idempotencia es UNA línea (`movimiento_id IS NULL`). Quitarla no
//     rompe ninguna prueba que no la busque, y vacía el almacén al segundo
//     intento de cierre.
//   · el gate de la RPC NO debe incluir `condominios.tab.suministros`: si
//     alguien lo agrega «por coherencia», el conserje —que es quien cierra las
//     tareas— deja de poder consumir y la función entera pierde sentido.
//   · `assert_company_scope` y el REVOKE son requisitos del migrations-guard,
//     pero el guard mira el repo entero y no dice POR QUÉ importan aquí.

const MIG = resolve('supabase/migrations/20260905000500_consumo_insumos.sql')
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')
const sql = soloCodigo(readFileSync(MIG, 'utf8'))

const cuerpoRpc = (() => {
  const m = sql.match(
    /CREATE OR REPLACE FUNCTION public\.consumir_insumos_tarea\(([\s\S]*?)\n\$\$;/i,
  )
  if (!m) throw new Error('no se encontró consumir_insumos_tarea')
  return m[1]
})()

const cuerpoCopia = (() => {
  const m = sql.match(
    /CREATE OR REPLACE FUNCTION public\.tarea_copiar_insumos_plantilla\(\)([\s\S]*?)\n\$\$;/i,
  )
  if (!m) throw new Error('no se encontró tarea_copiar_insumos_plantilla')
  return m[1]
})()

describe('20260905000500 · la idempotencia no es opcional', () => {
  it('la RPC sólo toca filas sin movimiento', () => {
    // Es TODA la protección contra descontar dos veces. Sin este filtro, un
    // reintento de cierre —o dos pestañas abiertas— vacían el almacén.
    expect(cuerpoRpc).toMatch(/tbs\.movimiento_id IS NULL/i)
  })

  it('escribe el movimiento de vuelta en el plan', () => {
    // Sin esto el filtro de arriba nunca deja de coincidir y la idempotencia
    // no existe, por más que la línea siga escrita.
    expect(cuerpoRpc).toMatch(/SET movimiento_id = v_mov/i)
  })

  it('el plan no admite el mismo insumo dos veces en una tarea', () => {
    expect(sql).toMatch(/CONSTRAINT tbs_unico UNIQUE \(tarea_id, suministro_id\)/i)
  })
})

describe('20260905000500 · la autorización es el punto de la RPC', () => {
  it('llama assert_company_scope antes de escribir', () => {
    // SECURITY DEFINER se salta la RLS: este guard ES el control.
    expect(cuerpoRpc).toMatch(/PERFORM public\.assert_company_scope/i)
  })

  it('se gatea por los permisos de la TAREA', () => {
    for (const permiso of ['tareas_personal', 'turnos', 'revision_tareas', 'prog_limpieza']) {
      expect(cuerpoRpc, `falta el gate de ${permiso}`)
        .toMatch(new RegExp(`condominios\\.tab\\.${permiso}`))
    }
    expect(cuerpoRpc).toMatch(/RAISE EXCEPTION 'no autorizado'/i)
  })

  it('NO exige el permiso del almacén', () => {
    // Si alguien lo agrega «por coherencia», el conserje deja de poder cerrar
    // consumiendo — que es exactamente el problema que esta RPC vino a resolver,
    // porque `movimientos_suministro_insert` ya exige ese permiso.
    expect(cuerpoRpc).not.toMatch(/condominios\.tab\.suministros/)
  })

  it('las dos funciones nuevas revocan PUBLIC', () => {
    // Regla (e) del migrations-guard, y aquí importa el doble: la de copia lee
    // el catálogo de suministros saltándose la RLS.
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.tarea_copiar_insumos_plantilla\(\) FROM PUBLIC/i)
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.consumir_insumos_tarea\(uuid, jsonb\) FROM PUBLIC/i)
  })
})

describe('20260905000500 · copia y no join', () => {
  it('congela nombre y unidad del catálogo', () => {
    // Sin el snapshot, renombrar un insumo reescribiría lo que la orden de
    // aquel día pedía — el mismo principio de 20260905000300.
    expect(sql).toMatch(/nombre_suministro\s+text\s+NOT NULL/i)
    expect(sql).toMatch(/unidad_medida\s+text\s+NOT NULL/i)
    expect(cuerpoCopia).toMatch(/s\.nombre,\s*s\.unidad_medida/)
  })

  it('el trigger cubre TODAS las altas y no sólo la RPC de materializar', () => {
    // Hay tres rutas de alta con plantilla; un trigger sobre la tabla las cubre
    // a las tres. Moverlo dentro de materializar_rutinas_turno dejaría sin
    // insumos a las dos manuales.
    expect(sql).toMatch(/CREATE TRIGGER trg_tarea_copiar_insumos\s+AFTER INSERT ON public\.tareas_bloque/i)
  })

  it('no arrastra insumos dados de baja', () => {
    expect(cuerpoCopia).toMatch(/AND s\.activo/)
  })

  it('la tarea ad-hoc no revienta el alta', () => {
    // Sin esta salida temprana, crear una tarea suelta fallaría.
    expect(cuerpoCopia).toMatch(/NEW\.plantilla_id IS NULL[\s\S]{0,60}RETURN NEW/i)
  })
})

describe('20260905000500 · el motor de existencias no se duplica', () => {
  it('consume insertando un movimiento, no tocando stock_actual', () => {
    // `movimientos_suministro` es la única fuente del stock desde 20260821000200,
    // y un UPDATE directo a `stock_actual` lo revierte un trigger en silencio:
    // escribirlo aquí no descontaría nada y parecería que sí.
    expect(cuerpoRpc).toMatch(/INSERT INTO public\.movimientos_suministro/i)
    expect(cuerpoRpc, 'se está escribiendo el stock a mano')
      .not.toMatch(/UPDATE public\.suministros_condominio/i)
  })

  it('la salida queda trazada al origen', () => {
    expect(cuerpoRpc).toMatch(/'tareas_bloque', p_tarea_id/)
  })

  it('la falta de stock avisa y no bloquea', () => {
    // Bloquear haría que el histórico mienta sin reponer nada; el piso en 0 ya
    // lo pone `suministros_tg_stock`.
    expect(cuerpoRpc).toMatch(/v_faltante := v_faltante \|\| jsonb_build_object/i)
    expect(cuerpoRpc, 'la falta de stock no debe abortar')
      .not.toMatch(/RAISE EXCEPTION[^;]*stock/i)
  })

  it('la cantidad declarada manda sobre la planificada', () => {
    expect(cuerpoRpc).toMatch(/COALESCE\(\(c\.item ->> 'cantidad'\)::numeric, tbs\.cantidad_planificada\)/i)
  })

  it('cantidad 0 no genera movimiento pero deja constancia', () => {
    expect(cuerpoRpc).toMatch(/fila\.cantidad <= 0/i)
    expect(cuerpoRpc).toMatch(/SET motivo_no_usado =/i)
  })
})

describe('20260905000500 · el sandbox conductual está cableado a CI', () => {
  it('el job rls-sandbox ejecuta consumo_insumos', () => {
    // La lección de #785: un sandbox que CI no corre no protege nada.
    const wf = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(wf).toMatch(/supabase\/tests\/consumo_insumos\/run\.sh/)
  })

  it('el runner del sandbox existe', () => {
    const runSh = join(resolve('supabase/tests/consumo_insumos'), 'run.sh')
    expect(() => readFileSync(runSh, 'utf8')).not.toThrow()
  })
})
