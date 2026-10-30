import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards de FORMA de 20261118000000 (renta de equipo: el inventario dice qué se
// presta a un costo, la reserva cobra tarifa + renta). La conducta —el CHECK
// del toggle, la cuota con el total, la renta congelada por línea, la
// sobrecarga vieja retirada— se verificó
// ejecutando la migración contra el esquema reconstruido (ver el PR). Aquí
// quedan los filos que un test de conducta no ve.

const MIG = resolve('supabase/migrations/20261118000000_inventario_renta_equipo.sql')
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')
const sql = soloCodigo(readFileSync(MIG, 'utf8'))

describe('20261118000000 — forma de la migración', () => {
  it('ningún LIKE ejecutable usa un guion bajo sin escapar', () => {
    const infractores: string[] = []
    for (const m of sql.matchAll(/LIKE\s+'([^']*)'/g)) {
      const patron = m[1]
      if (/(^|[^\\])_/.test(patron)) infractores.push(patron)
    }
    expect(infractores, `patrones con comodín accidental: ${infractores.join(', ')}`).toEqual([])
  })

  it('toda SECURITY DEFINER queda cerrada a PUBLIC y anon; las internas y las de trigger, también a authenticated', () => {
    const definer = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)[\s\S]*?SECURITY DEFINER/g)].map(m => m[1])
    expect(definer.sort()).toEqual([
      'portal_equipos_amenidad', 'portal_reservar_amenidad', 'prestamo_valida_disponibilidad',
      'reserva_equipos_registrar_solicitud', 'reserva_equipos_renta', 'reserva_equipos_solicitar',
    ])
    for (const fn of definer) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE (ALL|EXECUTE) ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`))
    }
    for (const fn of ['reserva_equipos_renta', 'reserva_equipos_registrar_solicitud', 'prestamo_valida_disponibilidad']) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`))
    }
    // Las que el cliente sí llama conservan su GRANT a authenticated.
    for (const fn of ['portal_reservar_amenidad', 'portal_equipos_amenidad', 'reserva_equipos_solicitar']) {
      expect(sql, fn).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated`))
    }
  })

  it('la sobrecarga vieja de reserva_equipos_solicitar se retira antes de crear la nueva y la guarda lo comprueba', () => {
    const drop = sql.indexOf('DROP FUNCTION IF EXISTS public.reserva_equipos_solicitar(uuid, jsonb);')
    const create = sql.indexOf('CREATE OR REPLACE FUNCTION public.reserva_equipos_solicitar(')
    expect(drop).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(drop)
    expect(sql).toMatch(/p_generar_cargo boolean DEFAULT false/)
    expect(sql).toMatch(/pg_get_function_identity_arguments\(p\.oid\) = 'p_reserva_id uuid, p_equipos jsonb'/)
  })

  it('el toggle encendido exige renta > 0 y la renta nunca es negativa (CHECK en la base, no sólo en la pantalla)', () => {
    expect(sql).toMatch(/inventario_renta_coherente CHECK \(\s*\(costo_renta_unidad IS NULL OR costo_renta_unidad >= 0\)\s*AND \(NOT prestable_con_costo OR \(costo_renta_unidad IS NOT NULL AND costo_renta_unidad > 0\)\)\)/)
    expect(sql).toMatch(/prestamos_equipo_renta_no_negativa CHECK/)
    expect(sql).toMatch(/conname = 'inventario_renta_coherente'/)
  })

  it('la RPC del portal cobra tarifa + renta en la misma cuota y devuelve la renta calculada (no una columna)', () => {
    const portal = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.portal_reservar_amenidad('), sql.indexOf('CREATE OR REPLACE FUNCTION public.portal_equipos_amenidad('))
    expect(portal).toMatch(/v_renta := COALESCE\(public\.reserva_equipos_renta\(v_amen\.id, p_equipos\), 0\);/)
    expect(portal).toMatch(/v_total := \(CASE WHEN v_aplica THEN v_tarifa ELSE 0 END\) \+ v_renta;/)
    expect(portal).toMatch(/IF v_estado = 'confirmada' AND v_cobra AND p_metodo_pago = 'cargar_unidad' THEN/)
    expect(portal).toMatch(/'amenidad', v_total,/)
    expect(portal).toMatch(/'monto_renta_equipo', NULLIF\(v_renta, 0\), 'monto_total_cobro', v_total/)
    expect(portal).toMatch(/UPDATE public\.prestamos_equipo\s+SET cuota_renta_id = v_cuota_id/)
  })

  it('no toca reservas_amenidades (grupo con drift declarado), no agrega índices a prestamos_equipo ni toca policies', () => {
    expect(sql).not.toMatch(/ALTER TABLE public\.reservas_amenidades/)
    expect(sql).not.toMatch(/CREATE TRIGGER/)
    expect(sql).not.toMatch(/CREATE INDEX/)
    expect(sql).not.toMatch(/CREATE POLICY|DROP POLICY/)
  })
})
