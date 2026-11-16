import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { RENTAS_DATA_MODULE_KEYS, rentasPermissionKey } from '../lib/moduleConfig'
import { CATEGORIAS_GASTO, POLITICAS_CANCELACION } from '../domain/rentas/finanzas'

// Guards de FORMA de 20261128000000 (Finanzas de Rentas). La conducta —siembra
// de conceptos, desglose de las dos fuentes de reservas, gastos, RBAC— se
// EJECUTA en supabase/tests/rentas_finanzas/run.sh. Aquí queda lo que ese arnés
// no ve: que está en CI y que los catálogos del cliente son los de la base.

const MIG = resolve('supabase/migrations/20261128000000_rentas_finanzas.sql')
const sql = readFileSync(MIG, 'utf8').replace(/--[^\n]*/g, '')
const lista = (re: RegExp) => [...(re.exec(sql)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map(m => m[1])

describe('20261128000000 — forma de la migración', () => {
  it('las tres tablas nacen con RLS, sin privilegios para anon y con policies escritas una por una', () => {
    for (const t of ['rentas_conceptos', 'rentas_liquidaciones', 'rentas_gastos']) {
      expect(sql, t).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`))
    }
    expect(sql).toMatch(/REVOKE ALL ON public\.rentas_conceptos, public\.rentas_liquidaciones, public\.rentas_gastos\s+FROM PUBLIC, anon, authenticated/)
    expect((sql.match(/CREATE POLICY rentas_(conceptos|liquidaciones|gastos)_\w+ ON public\.rentas_\w+ FOR (SELECT|INSERT|UPDATE|DELETE) TO authenticated/g) ?? []).length).toBe(11)
    expect(sql).not.toMatch(/EXECUTE format\([^)]*CREATE POLICY/)
    // Los conceptos no se borran por la API.
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE ON public\.rentas_conceptos TO authenticated/)
  })

  it('cada policy exige el servicio contratado y evalúa los permisos una vez por consulta', () => {
    expect((sql.match(/\(SELECT public\.rentas_servicio_activo\(\)\)/g) ?? []).length).toBe(12)
    expect(sql).not.toMatch(/[^(]\bpublic\.user_has_permission\(/.source.replace('[^(]', '(?<!COALESCE\\()'))
  })

  it('toda SECURITY DEFINER va con search_path fijo y cerrada a la API', () => {
    for (const fn of ['rentas_concepto_coherente()', 'rentas_sembrar_conceptos(uuid)', 'companies_rentas_conceptos()', 'rentas_liquidacion_coherente()']) {
      expect(sql, fn).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated`)
    }
    expect(sql).not.toMatch(/SECURITY DEFINER\s+AS/)
  })

  it('no toca reservas_str más que como destino de una FK', () => {
    expect(sql).not.toMatch(/(ALTER TABLE|CREATE POLICY \w+ ON|DROP POLICY IF EXISTS \w+ ON|CREATE TRIGGER \w+\s+(BEFORE|AFTER)[^;]+ON) public\.reservas_str/)
    expect(sql).toMatch(/REFERENCES public\.reservas_str\(id\) ON DELETE CASCADE/)
  })
})

describe('los catálogos del cliente son los de la base', () => {
  it('el módulo Finanzas usa las claves que siembra la migración', () => {
    expect(RENTAS_DATA_MODULE_KEYS).toContain('rentas_finanzas')
    expect(rentasPermissionKey('rentas_finanzas', 'edit')).toBe('rentas.finanzas.edit')
    expect(sql).toMatch(/SELECT 'rentas\.finanzas\.' \|\| a\.akey/)
  })
  it('categorías de gasto y políticas de cancelación', () => {
    expect(lista(/categoria IN \(([^)]+)\)/).sort()).toEqual([...CATEGORIAS_GASTO].sort())
    expect(lista(/politica_cancelacion IN \(([^)]+)\)/).sort()).toEqual([...POLITICAS_CANCELACION].sort())
  })
})

describe('arnés ejecutable', () => {
  it('existe, corre mutantes y está cableado en coverage.yml', () => {
    const run = readFileSync(resolve('supabase/tests/rentas_finanzas/run.sh'), 'utf8')
    expect(run).toMatch(/20261128000000_rentas_finanzas\.sql/)
    expect((run.match(/^mutante rentm\d /gm) ?? []).length).toBeGreaterThanOrEqual(6)
    for (const f of ['assert.sql', 'huella.sql']) expect(existsSync(resolve(`supabase/tests/rentas_finanzas/${f}`)), f).toBe(true)
    expect(readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')).toMatch(/run: supabase\/tests\/rentas_finanzas\/run\.sh/)
  })
})
