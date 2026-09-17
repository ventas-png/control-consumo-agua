import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards ESTÁTICOS del cierre del `UPDATE` de `registros` (20260910235732).
//
// ALCANCE Y LÍMITE. Esto lee el SQL del repositorio. La verificación CONDUCTUAL
// —que el PATCH se rechace, que emitir calcule el IVA, que un residente no vea
// el reporte— corre contra un Postgres real en
// supabase/tests/proteger_update_registros/, que además empieza DEMOSTRANDO el
// agujero. Lo de aquí es lo que aquello no puede ver desde un PR sin base de
// datos: que la lista de columnas protegidas siga completa, y que nadie le
// agregue a las RPC de cobro el parámetro que las vaciaría de sentido.
// Tres migraciones: 20260910235732 puso el guard y las RPC; 20260911031701 le
// quitó la exención de `postgres` (que eximía a cualquier SECURITY DEFINER,
// porque corre como el dueño), serializó las transiciones con FOR UPDATE y sacó
// el plazo de vencimiento de la firma pública; 20260911042839 movió la
// conciliación del payfac a UNA transacción. Los guards leen el ESTADO FINAL:
// las posteriores re-declaran lo que toca, así que gana la última.
const MIGS = [
  'supabase/migrations/20260910235732_proteger_update_registros_y_cobro_autoritativo.sql',
  'supabase/migrations/20260911031701_cerrar_exencion_definer_y_serializar_cobro.sql',
  'supabase/migrations/20260911042839_conciliar_pago_externo_transaccional.sql',
  'supabase/migrations/20260911181200_revocar_execute_agua_cobro_auditar.sql',
].map((f) => resolve(f))

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const porMigracion = MIGS.map((f) => readFileSync(f, 'utf8').replace(/--[^\n]*/g, ''))
const codigo = porMigracion.join('\n')
/**
 * La ÚLTIMA declaración de una función en el orden de las migraciones: la que
 * queda instalada. Buscar la primera daría la versión que la segunda migración
 * corrigió, y los guards estarían mirando código muerto.
 */
function ultimaDeclaracion(nombre: string): string {
  const re = new RegExp(
    String.raw`CREATE OR REPLACE FUNCTION public\.${nombre}\(([\s\S]*?)\n\$\$;`,
    'g',
  )
  const todas = codigo.match(re) ?? []
  return todas.at(-1) ?? ''
}

/** El cuerpo del trigger, que es donde vive la clasificación de columnas. */
const guard = ultimaDeclaracion('agua_tg_registros_proteger_update')

describe('el UPDATE no puede reescribir la lectura', () => {
  // La lista que enumeró la auditoría, literal. Si alguien saca una de aquí,
  // esta prueba lo dice antes de que el PATCH vuelva a entrar.
  const INMUTABLES = [
    'contador_id', 'project_id', 'cliente_id', 'cliente_nombre',
    'fecha', 'fecha_lectura_anterior', 'dias_servicio',
    'lectura_anterior', 'lectura_actual', 'consumo',
    'tarifa_aplicada', 'tarifa_exceso_aplicada', 'canon_aplicado',
    'monto_calculado', 'tipo_cobro', 'secuencia',
    'idempotency_key', 'origen', 'es_reset', 'lectura_final_retirada',
    'mes', 'created_at', 'creado_por',
  ]

  it.each(INMUTABLES)('«%s» se compara contra OLD y se rechaza', (col) => {
    expect(guard).toContain(`NEW.${col}`)
    expect(guard).toMatch(
      new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM OLD\\.${col}\\s+THEN '${col}'`),
    )
  })

  it('el rechazo de una columna inmutable es 42501, no un aviso', () => {
    expect(guard).toMatch(/es inmutable[\s\S]*?USING ERRCODE = '42501'/)
  })
})

describe('el cobro sólo cambia por su RPC', () => {
  const DE_COBRO = [
    'estado', 'factura_estado', 'monto_pagado', 'fecha_pago',
    'fecha_vencimiento', 'iva_tasa', 'iva_monto', 'monto_con_iva',
    'total_a_pagar', 'mora_monto', 'mora_aplicada_at', 'regla_mora_id',
    'emitida_at', 'pagada_at', 'vencida_at', 'anulada_at',
  ]

  it.each(DE_COBRO)('«%s» exige la llave de capacidad', (col) => {
    expect(guard).toMatch(
      new RegExp(`NEW\\.${col}\\s+IS DISTINCT FROM OLD\\.${col}\\s+THEN '${col}'`),
    )
  })

  it('la llave de capacidad es un GUC local, no un parámetro del cliente', () => {
    expect(guard).toContain("current_setting('agua.cobro_autoritativo', true)")
    // `true` en set_config = local a la transacción: no sobrevive a la petición.
    expect(codigo).toMatch(/set_config\('agua\.cobro_autoritativo', 'on', true\)/)
    expect(codigo).toMatch(/set_config\('agua\.cobro_autoritativo', 'off', true\)/)
  })

  it('el trigger es SECURITY INVOKER: si no, current_user es el dueño y la allowlist no significa nada', () => {
    expect(guard).not.toMatch(/SECURITY DEFINER/)
  })

  it('la ÚNICA exención por rol es service_role', () => {
    // `postgres` y `supabase_admin` se quitaron: toda función SECURITY DEFINER
    // corre como el DUEÑO, así que nombrarlos eximía a cualquier DEFINER del
    // esquema — incluida una invocable por `authenticated`.
    expect(guard).toContain("current_user = 'service_role'")
    expect(guard).not.toContain("'postgres'")
    expect(guard).not.toContain("'supabase_admin'")
  })

  it('la corrección del histórico tiene su propia llave, distinta de la del cobro', () => {
    expect(guard).toContain("current_setting('agua.lectura_correccion_autorizada', true)")
    // Y ninguna función de la aplicación la enciende: es para una migración
    // revisada, con `SET LOCAL`, no para un camino de producto.
    expect(codigo).not.toMatch(/set_config\('agua\.lectura_correccion_autorizada'/)
  })
})

describe('las RPC de cobro no aceptan el importe como parámetro', () => {
  /** Devuelve los nombres de los parámetros de una función del fichero. */
  function params(nombre: string): string[] {
    const re = new RegExp(
      String.raw`CREATE OR REPLACE FUNCTION public\.${nombre}\(([\s\S]*?)\)\s*\nRETURNS`,
      'g',
    )
    const todas = [...codigo.matchAll(re)]
    expect(todas.length, `no se encontró la firma de ${nombre}`).toBeGreaterThan(0)
    // La última: es la que queda instalada.
    const firma = todas.at(-1)![1]
    return firma.split(/,(?![^(]*\))/).map(p => p.trim().split(/\s+/)[0]).filter(Boolean)
  }

  it('emitir recibe SÓLO el registro: el plazo de vencimiento no es del cliente', () => {
    // El plazo decide cuándo aplica la mora, o sea cuánto se cobra de más: sale
    // de `reglas_mora_config` o del valor seguro del servidor.
    expect(params('agua_factura_emitir')).toEqual(['p_registro_id'])
    // Y la firma de dos argumentos se elimina, no se deja como sobrecarga.
    expect(codigo).toContain('DROP FUNCTION IF EXISTS public.agua_factura_emitir(uuid, integer);')
  })

  it('anular recibe el registro y el motivo', () => {
    expect(params('agua_factura_anular')).toEqual(['p_registro_id', 'p_motivo'])
  })

  it('registrar pago recibe el monto — y nada más que decida el saldo', () => {
    // Ni `p_monto_pagado`, ni `p_estado`, ni `p_factura_estado`: el abonado
    // acumulado y la transición los calcula el servidor sobre la fila.
    expect(params('agua_factura_registrar_pago')).toEqual([
      'p_registro_id', 'p_monto', 'p_fecha_pago',
    ])
  })

  it('cambiar estado no puede fijar "pagado"', () => {
    expect(codigo).toMatch(
      /IF p_estado = 'pagado' THEN[\s\S]*?USING ERRCODE = '42501'/,
    )
  })

  it('cada transición pasa por el guard de permiso, bloquea la fila y deja auditoría', () => {
    for (const fn of [
      'agua_factura_emitir', 'agua_factura_anular', 'agua_factura_registrar_pago',
      'agua_registro_marcar_mora', 'agua_registro_cambiar_estado',
    ]) {
      const cuerpo = ultimaDeclaracion(fn)
      expect(cuerpo, `${fn}: no se encontró la declaración final`).not.toBe('')
      expect(cuerpo, `${fn}: sin guard de permiso`).toContain('public.agua_cobro_guard(')
      // El bloqueo es lo que serializa las transiciones financieras por
      // registro: sin él, dos abonos simultáneos parten del mismo abonado
      // previo y uno se pierde.
      expect(cuerpo, `${fn}: no bloquea la fila`).toContain('public.agua_cobro_bloquear(')
      expect(cuerpo, `${fn}: sin auditoría`).toContain('public.agua_cobro_auditar(')
    }
  })

  it('el pago del proveedor también bloquea, y es la única excepción de rol', () => {
    // `confirm-charge` acreditaba el abono del payfac con un UPDATE genérico
    // que sumaba en JavaScript sobre un `monto_pagado` leído sin bloquear.
    const cuerpo = ultimaDeclaracion('agua_registro_acreditar_pago_externo')
    expect(cuerpo, 'no se encontró la RPC del proveedor de pago').not.toBe('')
    expect(cuerpo).toContain('public.agua_cobro_bloquear(')
    expect(cuerpo).toContain('public.agua_cobro_auditar(')
    // El GRANT no basta: una SECURITY DEFINER corre como el dueño, que tiene
    // EXECUTE implícito. Por eso comprueba además el rol efectivo.
    expect(cuerpo).toContain("v_rol <> 'service_role'")
    expect(codigo).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.agua_registro_acreditar_pago_externo\([^)]*\)\s*\n?\s*FROM PUBLIC, anon, authenticated/,
    )
    expect(codigo).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.agua_registro_acreditar_pago_externo\([^)]*\)\s*\n?\s*TO service_role/,
    )
  })

  it('el bloqueo es un FOR UPDATE de verdad, y no es API', () => {
    expect(ultimaDeclaracion('agua_cobro_bloquear')).toContain('FOR UPDATE')
    expect(codigo).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.agua_cobro_bloquear\([^)]*\) FROM PUBLIC, anon, authenticated/,
    )
  })

  it('la capacidad de los caminos de sistema va por FUNCIÓN, no por rol', () => {
    // La llave se enciende al entrar y se apaga al salir: vive mientras esa
    // función corre y no una sentencia más. Es lo que sustituye a la exención
    // de `postgres`.
    for (const fn of ['agua_cerrar_ciclo_nucleo', 'agua_mora_cron_aplicar']) {
      const cuerpo = ultimaDeclaracion(fn)
      expect(cuerpo, `${fn} enciende la llave`).toContain(
        "set_config('agua.cobro_autoritativo', 'on', true)",
      )
      expect(cuerpo, `${fn} la apaga al salir`).toContain(
        "set_config('agua.cobro_autoritativo', v_llave_previa, true)",
      )
    }
    // La mora va por una ENVOLTURA y no reescribiendo la función real: esa tiene
    // drift declarado contra producción, y tocarla desde el repositorio dejaría
    // el auditor de tres vías en ambiguo.
    expect(codigo).not.toContain('CREATE OR REPLACE FUNCTION public.aplicar_mora_facturas_vencidas')
    expect(codigo).toContain("'SELECT public.agua_mora_cron_aplicar();'")
  })

  it('agua_cobro_auditar es un helper interno: ningún rol de API lo ejecuta', () => {
    // 20260910235732 la creó con un `GRANT EXECUTE … TO authenticated` que no
    // hacía falta: no es una RPC, es el escritor de security_logs que usan por
    // dentro las seis transiciones. El asesor de seguridad de Supabase lo marcó
    // sobre la Preview de #847 y 20260911181200 lo revoca.
    //
    // Que el cuerpo exija la llave `agua.cobro_autoritativo` NO lo salvaba: con
    // el GRANT puesto y la llave encendida, `authenticated` escribía la fila —
    // medido, es el mutante de la invariante 41. Hacen falta las dos defensas.
    expect(codigo).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.agua_cobro_auditar\([^)]*\)\s*\n?\s*FROM PUBLIC, anon, authenticated, service_role/,
    )
    // Y no vuelve a concederse después. El orden importa: un GRANT posterior
    // reabriría lo que el REVOKE cierra, y el texto se lee en orden documental.
    const trasRevoke = codigo.slice(
      codigo.lastIndexOf('REVOKE EXECUTE ON FUNCTION public.agua_cobro_auditar'),
    )
    expect(trasRevoke).not.toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.agua_cobro_auditar/,
    )
  })

  it('revocar el helper no cierra las RPC públicas de cobro', () => {
    // El contrapunto: «no queden avisos» no es el objetivo. Las RPC de cobro
    // TIENEN que seguir siendo ejecutables por `authenticated` — son la API del
    // módulo, y su autorización es su guard de permiso, no su ACL.
    for (const firma of [
      'public.agua_factura_emitir(uuid)',
      'public.agua_factura_anular(uuid, text)',
      'public.agua_factura_registrar_pago(uuid, numeric, date)',
      'public.agua_registro_marcar_mora(uuid[])',
      'public.agua_registro_cambiar_estado(uuid, text)',
    ]) {
      const escapada = firma.replace(/[.()[\]]/g, (c) => '\\' + c)
      expect(codigo, `${firma} dejó de ser API`).toMatch(
        new RegExp(`GRANT\\s+EXECUTE ON FUNCTION ${escapada} TO authenticated`),
      )
    }
  })

  it('la llave NUNCA va en proconfig: Supabase no puede aplicarlo', () => {
    // `ALTER FUNCTION … SET "agua.cobro_autoritativo"` (y la cláusula `SET` de
    // un `CREATE FUNCTION`) guardan el par en `proconfig`. Para un GUC de clase
    // personalizada —un placeholder— eso exige SUPERUSUARIO, y el `postgres` de
    // una Supabase gestionada no lo es: la migración aborta con
    // `42501 permission denied to set parameter` y se lleva por delante toda la
    // cadena detrás. Pasó en la Supabase Preview de #847 el 2026-09-11. El
    // arnés de SQL no lo veía porque su Postgres de `initdb` sí es superusuario.
    expect(codigo).not.toMatch(/SET\s+"agua\.[\w]+"\s*(=|TO)/)
  })

  it('ninguna de ellas queda ejecutable por anon', () => {
    for (const fn of [
      'agua_factura_emitir', 'agua_factura_anular', 'agua_factura_registrar_pago',
      'agua_registro_marcar_mora', 'agua_registro_cambiar_estado',
    ]) {
      expect(codigo).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`))
    }
    // El guard y el cuerpo del trigger no son API: tampoco para authenticated.
    expect(codigo).toMatch(/REVOKE EXECUTE ON FUNCTION public\.agua_cobro_guard\([^)]*\) FROM PUBLIC, anon, authenticated/)
    expect(codigo).toMatch(/REVOKE EXECUTE ON FUNCTION public\.agua_tg_registros_proteger_update\(\) FROM PUBLIC, anon, authenticated/)
  })
})

describe('el reporte exige la autorización de registros_select', () => {
  const reporte = codigo.match(
    /CREATE OR REPLACE FUNCTION public\.agua_lecturas_inconsistencias\([\s\S]*?\n\$\$;/,
  )?.[0] ?? ''

  it('pide uno de los permisos de lectura de agua, no sólo la empresa', () => {
    for (const permiso of [
      'agua.tabla.view', 'agua.lecturas.view', 'agua.dashboard.view',
      'agua.cobros.view', 'agua.mapa.view',
    ]) {
      expect(reporte).toContain(`user_has_permission('${permiso}')`)
    }
  })

  it('deja fuera al residente: el portal le enseña sus filas, no el agregado', () => {
    expect(reporte).toContain("public.current_user_role() IS DISTINCT FROM 'cliente'")
  })

  it('conserva la empresa y el acceso al proyecto', () => {
    expect(reporte).toContain('public.get_my_company_id()')
    expect(reporte).toContain('public.can_access_project(p.id)')
  })

  it('sigue siendo STABLE: un reporte que escribe no es un reporte', () => {
    expect(reporte).toMatch(/LANGUAGE sql\s*\nSTABLE/)
  })
})

describe('la conciliación del payfac ocurre en UNA transacción', () => {
  const rpc = ultimaDeclaracion('conciliar_pago_externo')

  it('existe y recibe SÓLO el id de la solicitud', () => {
    expect(rpc, 'no se encontró conciliar_pago_externo').not.toBe('')
    const firma = rpc.slice(0, rpc.indexOf(')'))
    expect(firma).toContain('p_payment_request_id uuid')
    // Un segundo parámetro sería una vía para que el edge dictara el monto, el
    // ítem o la referencia — que es justo lo que esta RPC existe para impedir.
    expect(firma.match(/p_[a-z_]+\s+[a-z]/g) ?? []).toHaveLength(1)
  })

  it('bloquea la solicitud antes de mirarla', () => {
    expect(rpc).toMatch(/FROM public\.payment_requests[\s\S]*?FOR UPDATE/)
  })

  it('bloquea también el ítem que acredita', () => {
    expect(rpc).toMatch(/FROM public\.registros[\s\S]*?FOR UPDATE/)
    expect(rpc).toMatch(/FROM public\.cuotas_condominio[\s\S]*?FOR UPDATE/)
  })

  it('una solicitud ya conciliada sale sin acreditar', () => {
    expect(rpc).toContain("v_pr.estado = 'succeeded'")
    expect(rpc).toContain("'ya_conciliado', true")
  })

  it('la idempotencia es un UNIQUE, no una consulta previa', () => {
    expect(codigo).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_pagos_payment_request\s*\n?\s*ON public\.pagos \(payment_request_id\)/,
    )
    expect(rpc).toContain('ON CONFLICT (payment_request_id) DO NOTHING')
  })

  it('y el conflicto CORTA: no puede tragarse el duplicado y seguir acreditando', () => {
    // Medido por mutación: dejando que el conflicto siguiera de largo, dos
    // confirmaciones concurrentes acreditaban DOS veces (invariante 34). El
    // índice único no sirve de nada si el código ignora lo que significa.
    const trasConflicto = rpc.slice(rpc.indexOf('ON CONFLICT (payment_request_id)'))
    const cierre = trasConflicto.indexOf("'ya_conciliado', true")
    const acredita = trasConflicto.indexOf('agua_registro_acreditar_pago_externo')
    expect(cierre, 'tras el conflicto no hay salida temprana').toBeGreaterThan(-1)
    expect(cierre, 'el conflicto sigue de largo hasta acreditar').toBeLessThan(acredita)
  })

  it('acredita el recibo por la RPC autoritativa, no con un UPDATE propio', () => {
    expect(rpc).toContain('public.agua_registro_acreditar_pago_externo(')
    expect(rpc).not.toMatch(/UPDATE public\.registros\b/)
  })

  it('sólo service_role, y con chequeo de rol efectivo', () => {
    expect(codigo).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.conciliar_pago_externo\([^)]*\)\s*\n?\s*FROM PUBLIC, anon, authenticated/,
    )
    expect(codigo).toMatch(
      /GRANT\s+EXECUTE ON FUNCTION public\.conciliar_pago_externo\([^)]*\)\s*\n?\s*TO service_role/,
    )
    expect(rpc).toContain("v_rol <> 'service_role'")
  })
})
