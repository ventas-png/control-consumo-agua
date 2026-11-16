import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RENTAS_ACTIONS, RENTAS_DATA_MODULE_KEYS, rentasPermissionKey } from '../lib/moduleConfig'
import { RENTAS_MODULE_GROUPS } from '../lib/rentasPermissions'

// Guards de FORMA de 20261125000000 (Manejo de Rentas). La conducta —servicio
// por empresa, alcance por proyecto, una sola fuente de reservas por propiedad,
// RBAC por módulo— se EJECUTA en supabase/tests/rentas_modulo/run.sh contra un
// Postgres desechable. Aquí queda lo que ese arnés no puede afirmar de sí
// mismo: que está cableado en CI, y que el front pide exactamente las claves
// que la migración siembra.

const MIG = resolve('supabase/migrations/20261125000000_rentas_modulo.sql')
const sql = readFileSync(MIG, 'utf8').replace(/--[^\n]*/g, '')
const TABLAS = ['rentas_propiedades', 'rentas_reservas', 'rentas_contratos', 'rentas_inventario']

describe('20261125000000 — forma de la migración', () => {
  it('ningún LIKE ejecutable usa un guion bajo sin escapar', () => {
    const infractores = [...sql.matchAll(/LIKE\s+'([^']*)'/g)].map(m => m[1]).filter(p => /(^|[^\\])_/.test(p))
    expect(infractores).toEqual([])
  })

  it('el servicio nace apagado y las cuatro tablas activan RLS y se cierran a anon', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS servicio_rentas boolean NOT NULL DEFAULT false/)
    for (const t of TABLAS) expect(sql, t).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`))
    expect(sql).toMatch(/REVOKE ALL ON public\.rentas_propiedades, public\.rentas_reservas,\s+public\.rentas_contratos, public\.rentas_inventario\s+FROM PUBLIC, anon, authenticated/)
  })

  it('toda SECURITY DEFINER va con search_path vacío y cerrada a PUBLIC y anon; las de trigger, también a authenticated', () => {
    const definer = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)[\s\S]*?SECURITY DEFINER/g)].map(m => m[1]).sort()
    expect(definer).toEqual(['rentas_hija_coherente', 'rentas_propiedad_accesible', 'rentas_propiedad_coherente', 'rentas_servicio_activo'])
    for (const fn of definer) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`))
    }
    for (const fn of ['rentas_hija_coherente', 'rentas_propiedad_coherente']) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC, anon, authenticated`))
    }
    expect((sql.match(/SET search_path = ''/g) ?? []).length).toBe(definer.length)
  })

  it('las tablas hijas cuelgan de la propiedad por llave COMPUESTA con la empresa', () => {
    for (const t of ['rentas_reservas', 'rentas_contratos', 'rentas_inventario']) {
      expect(sql, t).toMatch(new RegExp(
        `CONSTRAINT ${t}_propiedad_fk\\s+FOREIGN KEY \\(propiedad_id, company_id\\)\\s+REFERENCES public\\.rentas_propiedades \\(id, company_id\\) ON DELETE CASCADE`))
    }
  })

  it('toda escritura pide el servicio contratado', () => {
    // 4 policies de propiedades + 4 del molde de las hijas (una por comando).
    expect((sql.match(/\(SELECT public\.rentas_servicio_activo\(\)\)/g) ?? []).length).toBe(8)
  })
})

describe('el front pide las claves que la migración siembra', () => {
  it('módulos y acciones del catálogo coinciden con moduleConfig y con la matriz de roles', () => {
    const modulos = [...sql.matchAll(/\('(\w+)',\s+'[^']+'\)/g)].map(m => m[1])
    for (const m of RENTAS_DATA_MODULE_KEYS) expect(modulos).toContain(m.replace(/^rentas_/, ''))
    for (const a of RENTAS_ACTIONS) expect(sql).toMatch(new RegExp(`\\('${a}',\\s+'`))
    expect(sql).toMatch(/IF v_claves <> 16 THEN/)
    expect(RENTAS_MODULE_GROUPS.flatMap(g => g.tabs).sort()).toEqual(
      RENTAS_DATA_MODULE_KEYS.flatMap(m => RENTAS_ACTIONS.map(a => rentasPermissionKey(m, a))).sort())
    expect(rentasPermissionKey('rentas_propiedades', 'edit')).toBe('rentas.propiedades.edit')
  })

  it('cada clave que usan las policies existe en el catálogo sembrado', () => {
    const usadas = new Set([...sql.matchAll(/'(rentas\.[a-z]+\.[a-z]+)'/g)].map(m => m[1]))
    const validas = new Set(RENTAS_DATA_MODULE_KEYS.flatMap(m => RENTAS_ACTIONS.map(a => rentasPermissionKey(m, a))))
    for (const k of usadas) expect(validas.has(k), k).toBe(true)
  })
})

describe('arnés ejecutable', () => {
  it('existe, corre mutantes y está cableado en coverage.yml', () => {
    const run = readFileSync(resolve('supabase/tests/rentas_modulo/run.sh'), 'utf8')
    expect(run).toMatch(/20261125000000_rentas_modulo\.sql/)
    expect((run.match(/^mutante rentm\d /gm) ?? []).length).toBeGreaterThanOrEqual(5)
    for (const f of ['assert.sql', 'datos.sql', 'fixture_rentas.sql', 'huella.sql']) {
      expect(existsSync(resolve(`supabase/tests/rentas_modulo/${f}`)), f).toBe(true)
    }
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toMatch(/run: supabase\/tests\/rentas_modulo\/run\.sh/)
  })
})
