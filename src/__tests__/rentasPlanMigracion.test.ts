import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { activacionPorModulos } from '../components/landing/Pricing'

// Guards de FORMA de 20261126000000 (Rentas como tercer módulo del plan). La
// conducta —planes, interruptores que mueven el plan, candado, cobro y tope de
// las propiedades independientes, panel— se EJECUTA en
// supabase/tests/rentas_plan/run.sh. Aquí queda lo que ese arnés no ve: que
// está en CI, que las funciones reescritas conservan sus compuertas y que el
// precio que anuncia la página pública es el que la base cobra.

const MIG = resolve('supabase/migrations/20261126000000_rentas_tercer_modulo_del_plan.sql')
const sql = readFileSync(MIG, 'utf8').replace(/--[^\n]*/g, '')
const cuerpo = (nombre: string) => {
  const i = sql.indexOf(`FUNCTION public.${nombre}(`)
  expect(i, nombre).toBeGreaterThan(-1)
  return sql.slice(i, sql.indexOf('$function$;', i) > -1 ? sql.indexOf('$function$;', i) : sql.indexOf('$$;', i))
}

describe('20261126000000 — forma de la migración', () => {
  it('las funciones de cobro reescritas conservan la compuerta de sesión sin empresa', () => {
    for (const fn of ['calculate_monthly_total_cents', 'get_company_usage']) {
      expect(cuerpo(fn), fn).toMatch(/if public\.sesion_api_sin_empresa\(\) or not \(\s+public\.is_super_admin\(\)\s+or p_company_id = public\.get_my_company_id\(\)/)
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(uuid\\) FROM PUBLIC, anon`))
    }
    expect(cuerpo('get_superadmin_empresas')).toMatch(/IF NOT public\.is_super_admin\(\) THEN/)
  })

  it('toda SECURITY DEFINER nueva va con search_path fijo y cerrada a PUBLIC y anon', () => {
    for (const fn of ['companies_modulos_plan', 'rentas_tope_unidades', 'create_trial_subscription']) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC, anon, authenticated`))
    }
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.rentas_propiedades_independientes\(uuid\) FROM PUBLIC, anon, authenticated/)
    expect(sql).not.toMatch(/SECURITY DEFINER\s+AS/)
  })

  it('las vistas se recrean cerradas y con el índice único que necesita el refresco en caliente', () => {
    for (const mv of ['mv_superadmin_empresa_counts', 'mv_superadmin_plataforma']) {
      expect(sql, mv).toMatch(new RegExp(`DROP MATERIALIZED VIEW IF EXISTS public\\.${mv};`))
      expect(sql, mv).toMatch(new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${mv}_pk`))
      expect(sql, mv).toMatch(new RegExp(`REVOKE ALL ON public\\.${mv} FROM PUBLIC, anon, authenticated`))
    }
    // La dependiente se borra antes que la base.
    expect(sql.indexOf('DROP MATERIALIZED VIEW IF EXISTS public.mv_superadmin_plataforma;'))
      .toBeLessThan(sql.indexOf('DROP MATERIALIZED VIEW IF EXISTS public.mv_superadmin_empresa_counts;'))
  })

  it('el candado congela los tres módulos y conserva lo que ya congelaba', () => {
    const c = cuerpo('lock_companies_billing_columns')
    for (const col of ['servicio_agua', 'servicio_condominios', 'servicio_rentas', 'activa', 'signup_source', 'suspended_at', 'suspended_reason', 'max_projects', 'max_units']) {
      expect(c, col).toMatch(new RegExp(`NEW\\.${col}\\s+:= OLD\\.${col}`))
    }
  })
})

describe('el precio público es el que cobra la base', () => {
  it('activación por número de módulos: 10 / 15 / 20', () => {
    expect([1, 2, 3].map(activacionPorModulos)).toEqual([10, 15, 20])
    const planes = [...sql.matchAll(/\('(rentas_only|agua_rentas|condominios_rentas|suite)',[\s\S]*?(\d{4}), (true|false), (true|false),/g)]
      .map(m => ({ code: m[1], base: Number(m[2]), modulos: 1 + Number(m[3] === 'true') + Number(m[4] === 'true') }))
    expect(planes.map(p => p.code).sort()).toEqual(['agua_rentas', 'condominios_rentas', 'rentas_only', 'suite'])
    for (const p of planes) expect(p.base, p.code).toBe(activacionPorModulos(p.modulos) * 100)
  })
})

describe('arnés ejecutable', () => {
  it('existe, corre mutantes y está cableado en coverage.yml', () => {
    const run = readFileSync(resolve('supabase/tests/rentas_plan/run.sh'), 'utf8')
    expect(run).toMatch(/20261126000000_rentas_tercer_modulo_del_plan\.sql/)
    expect((run.match(/^mutante rentm\d /gm) ?? []).length).toBeGreaterThanOrEqual(7)
    for (const f of ['assert.sql', 'fixture_plan.sql', 'huella.sql']) {
      expect(existsSync(resolve(`supabase/tests/rentas_plan/${f}`)), f).toBe(true)
    }
    expect(readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')).toMatch(/run: supabase\/tests\/rentas_plan\/run\.sh/)
  })
})
