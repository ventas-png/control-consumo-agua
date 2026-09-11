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
const MIG = resolve(
  'supabase/migrations/20260910235732_proteger_update_registros_y_cobro_autoritativo.sql',
)

/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const codigo = readFileSync(MIG, 'utf8').replace(/--[^\n]*/g, '')

/** El cuerpo del trigger, que es donde vive la clasificación de columnas. */
const guard = codigo.match(
  /CREATE OR REPLACE FUNCTION public\.agua_tg_registros_proteger_update\(\)[\s\S]*?\n\$\$;/,
)?.[0] ?? ''

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

  it('los roles exentos son una allowlist cerrada', () => {
    expect(guard).toContain("current_user IN ('service_role', 'postgres', 'supabase_admin')")
  })
})

describe('las RPC de cobro no aceptan el importe como parámetro', () => {
  /** Devuelve los nombres de los parámetros de una función del fichero. */
  function params(nombre: string): string[] {
    const firma = codigo.match(
      new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nombre}\\(([\\s\\S]*?)\\)\\s*\\nRETURNS`),
    )?.[1]
    expect(firma, `no se encontró la firma de ${nombre}`).toBeTruthy()
    return firma!.split(/,(?![^(]*\))/).map(p => p.trim().split(/\s+/)[0]).filter(Boolean)
  }

  it('emitir recibe el registro y, como mucho, los días de vencimiento', () => {
    expect(params('agua_factura_emitir')).toEqual(['p_registro_id', 'p_dias_vencimiento'])
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

  it('cada transición pasa por el guard de permiso y deja auditoría', () => {
    for (const fn of [
      'agua_factura_emitir', 'agua_factura_anular', 'agua_factura_registrar_pago',
      'agua_registro_marcar_mora', 'agua_registro_cambiar_estado',
    ]) {
      const cuerpo = codigo.match(
        new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`),
      )?.[0] ?? ''
      expect(cuerpo, `${fn}: sin guard de permiso`).toContain('public.agua_cobro_guard(')
      expect(cuerpo, `${fn}: sin auditoría`).toContain('public.agua_cobro_auditar(')
    }
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
