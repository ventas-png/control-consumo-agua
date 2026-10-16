import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards de FORMA de 20261031000300 (catálogos RRHH por condominio). La conducta
// se verifica ejecutando la migración contra un Postgres desechable en
// supabase/tests/rrhh_catalogos/ (A–H + 6 mutantes). Aquí quedan los filos que
// un test de conducta no ve porque probaría la versión nueva:
//   · que cada CHECK literal se retire DESPUÉS de instalar el trigger que lo
//     sustituye (nunca una ventana sin regla);
//   · que los triggers validen sólo cuando el valor CAMBIA (IS DISTINCT FROM):
//     sin eso, toda fila con un cargo apagado o legado dejaría de poder editarse;
//   · los SQLSTATE que la pantalla traduce (23503 en uso, 23514 inmutable/forma);
//   · que las DEFINER nuevas no queden ejecutables por anon/PUBLIC;
//   · el LIKE con guion bajo escapado (la trampa de 20260907001200);
//   · la guarda de 6 claves RBAC; y que el harness siga cableado en CI.

const MIG = resolve('supabase/migrations/20261031000300_rrhh_catalogos_cargos_y_turnos.sql')
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')
const sql = soloCodigo(readFileSync(MIG, 'utf8'))

const posDe = (texto: string) => {
  const i = sql.indexOf(texto)
  expect(i, `no se encontró: ${texto}`).toBeGreaterThan(-1)
  return i
}

describe('20261031000300 — forma de la migración', () => {
  it('cada CHECK literal se retira después del trigger que lo sustituye', () => {
    expect(posDe('CREATE TRIGGER trg_prog_limpieza_catalogo_rrhh'))
      .toBeLessThan(posDe('DROP CONSTRAINT IF EXISTS prog_limpieza_cargo_check'))
    expect(posDe('CREATE TRIGGER trg_prog_limpieza_catalogo_rrhh'))
      .toBeLessThan(posDe('DROP CONSTRAINT IF EXISTS prog_limpieza_turno_check'))
    expect(posDe('CREATE TRIGGER trg_ejec_limpieza_turno_rrhh'))
      .toBeLessThan(posDe('DROP CONSTRAINT IF EXISTS ejec_limpieza_turno_check'))
    // Y los validadores existen antes que cualquier trigger que los llame.
    expect(posDe('CREATE OR REPLACE FUNCTION public.rrhh_cargo_valido'))
      .toBeLessThan(posDe('CREATE OR REPLACE FUNCTION public.rrhh_personal_valida_catalogo'))
  })

  it('los cuatro triggers de validación miran el cambio, no la fila (IS DISTINCT FROM)', () => {
    for (const fn of ['rrhh_personal_valida_catalogo', 'plantillas_cargo_valida_cargo',
                      'rrhh_prog_limpieza_valida_catalogo', 'rrhh_ejec_limpieza_valida_turno']) {
      const m = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\)([\\s\\S]*?)\\n\\$\\$;`))
      expect(m, fn).not.toBeNull()
      expect(m![1], fn).toMatch(/IS DISTINCT FROM OLD\./)
      expect(m![1], fn).toMatch(/TG_OP = 'INSERT'/)
      expect(m![1], fn).toMatch(/ERRCODE = 'check_violation'/)
    }
  })

  it('la siembra y el backfill cubren proyectos existentes y nuevos', () => {
    expect(sql).toMatch(/FOR r IN SELECT p\.id, p\.company_id FROM public\.projects p LOOP/)
    expect(sql).toMatch(/AFTER INSERT ON public\.projects/)
    expect(sql).toMatch(/ON CONFLICT \(project_id, codigo\) DO NOTHING/)
    expect(sql).toContain("RAISE WARNING 'rrhh_sembrar_on_project(%): %'")
  })

  it('los SQLSTATE que traduce la pantalla', () => {
    expect(sql).toMatch(/RRHH_CARGO_EN_USO[\s\S]{0,300}ERRCODE = 'foreign_key_violation'/)
    expect(sql).toMatch(/RRHH_TURNO_EN_USO[\s\S]{0,300}ERRCODE = 'foreign_key_violation'/)
    expect(sql).toMatch(/RRHH_CATALOGO_INMUTABLE[\s\S]{0,200}ERRCODE = 'check_violation'/)
  })

  it('las SECURITY DEFINER nuevas no quedan para anon ni PUBLIC; las internas tampoco para authenticated', () => {
    const definers = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(rrhh_\w+)\(([^)]*)\)[\s\S]{0,200}?SECURITY DEFINER/g)]
      .map(m => m[1])
    expect(definers.length).toBeGreaterThanOrEqual(8)
    for (const fn of definers) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`))
    }
    for (const fn of ['rrhh_sembrar_defaults', 'rrhh_sembrar_on_project', 'rrhh_cargo_uso', 'rrhh_turno_uso',
                      'rrhh_catalogo_coherente', 'rrhh_tg_cargo_borrable', 'rrhh_tg_turno_borrable']) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`))
    }
  })

  it('ningún LIKE ejecutable usa un guion bajo sin escapar', () => {
    const infractores: string[] = []
    for (const m of sql.matchAll(/LIKE\s+'([^']*)'/g)) {
      if (/(^|[^\\])_/.test(m[1])) infractores.push(m[1])
    }
    expect(infractores, `patrones con comodín accidental: ${infractores.join(', ')}`).toEqual([])
  })

  it('RBAC: 6 claves, categoría recursos_humanos, herencia sólo allow → allow, guarda que aborta', () => {
    expect(sql).toContain("('condominios.tab.rrhh_config', 'recursos_humanos'")
    expect(sql).toMatch(/WHERE rp\.effect = 'allow'[\s\S]{0,200}condominios\.tab\.personal/)
    expect(sql).toMatch(/IF v_claves <> 6 THEN\s*RAISE EXCEPTION/)
  })

  it('plantillas_import_evaluar lee el catálogo activo y ya no tiene la lista literal', () => {
    const m = sql.match(/CREATE OR REPLACE FUNCTION public\.plantillas_import_evaluar([\s\S]*?)\n\$\$;/)
    expect(m).not.toBeNull()
    expect(m![1]).toMatch(/FROM public\.rrhh_cargos c[\s\S]{0,120}AND c\.activo/)
    expect(m![1]).not.toMatch(/v_cargos\s+constant/)
    expect(m![1]).toContain('Este condominio no tiene cargos activos')
  })

  it('el harness ejecutable está cableado en CI', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toContain('supabase/tests/rrhh_catalogos/run.sh')
  })
})
