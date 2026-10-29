import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards de FORMA de 20261115000000 (llamadas de atención y sanciones con acuse
// firmado). La conducta —quién emite, quién lee, los dos modos de acuse, la
// anulación, la inmutabilidad— se verificó ejecutando la migración contra el
// esquema reconstruido (ver el PR). Aquí quedan los filos que un test de
// conducta no ve, los mismos que motivaron los guards de rrhh_config.

const MIG = resolve('supabase/migrations/20261115000000_rrhh_llamadas_atencion.sql')
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')
const sql = soloCodigo(readFileSync(MIG, 'utf8'))

describe('20261115000000 — forma de la migración', () => {
  it('ningún LIKE ejecutable usa un guion bajo sin escapar', () => {
    const infractores: string[] = []
    for (const m of sql.matchAll(/LIKE\s+'([^']*)'/g)) {
      const patron = m[1]
      if (/(^|[^\\])_/.test(patron)) infractores.push(patron)
    }
    expect(infractores, `patrones con comodín accidental: ${infractores.join(', ')}`).toEqual([])
  })

  it('la guarda de 6 claves RBAC existe y la categoría es recursos_humanos', () => {
    expect(sql).toMatch(/IF v_claves <> 6 THEN/)
    expect(sql).toMatch(/'condominios\.tab\.llamadas_atencion', 'recursos_humanos'/)
  })

  it('toda SECURITY DEFINER nueva queda cerrada a PUBLIC y anon', () => {
    const definer = [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.(\w+)\(([^)]*)\)[\s\S]*?SECURITY DEFINER/g)]
      .map(m => m[1])
    expect(definer.sort()).toEqual(['rrhh_llamada_acusar', 'rrhh_llamada_anular', 'rrhh_llamada_coherente', 'rrhh_llamada_es_mia', 'rrhh_llamada_notificar', 'rrhh_llamadas_mias'])
    for (const fn of definer) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE (ALL|EXECUTE) ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon`))
    }
    // Las de trigger ni siquiera para authenticated.
    for (const fn of ['rrhh_llamada_coherente', 'rrhh_llamada_notificar']) {
      expect(sql, fn).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC, anon, authenticated`))
    }
    // Todas con search_path vacío.
    expect((sql.match(/SET search_path = ''/g) ?? []).length).toBeGreaterThanOrEqual(definer.length)
  })

  it('la tabla no tiene policy de UPDATE: el acuse y la anulación entran sólo por las RPCs', () => {
    expect(sql).not.toMatch(/CREATE POLICY \w+ ON public\.llamadas_atencion_personal FOR UPDATE/)
    expect(sql).toMatch(/GRANT SELECT, INSERT, DELETE ON public\.llamadas_atencion_personal TO authenticated/)
    expect(sql).toMatch(/AND cmd = 'UPDATE'/)
  })

  it('FK compuesta por tenant al empleado, con SET NULL sólo sobre personal_id', () => {
    expect(sql).toMatch(/FOREIGN KEY \(personal_id, company_id, project_id\)\s+REFERENCES public\.personal_condominio \(id, company_id, project_id\)\s+ON DELETE SET NULL \(personal_id\)/)
    expect(sql).toMatch(/v_setcols IS DISTINCT FROM 1/)
  })

  it('la RLS de lectura tiene la rama propia (sin permiso del tab) y la del tab va envuelta', () => {
    expect(sql).toMatch(/OR public\.rrhh_llamada_es_mia\(id::text\)\);/)
    expect(sql).toMatch(/\(SELECT COALESCE\(public\.user_has_permission\('condominios\.tab\.llamadas_atencion'\), false\)\)/)
  })

  it('el aviso al empleado va a Mi perfil y nunca impide emitir', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.rrhh_llamada_notificar\(\)([\s\S]*?)\n\$\$;/)!
    expect(fn[1]).toMatch(/'rrhh_llamada_atencion', v_titulo, v_cuerpo, 'perfil'/)
    expect(fn[1]).toMatch(/EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/)
  })

  it('el acuse exige que la firma esté bajo <project>/<carta>/ y ya subida al bucket privado', () => {
    const fn = sql.match(/CREATE OR REPLACE FUNCTION public\.rrhh_llamada_acusar\(([\s\S]*?)\n\$\$;/)!
    expect(fn[1]).toMatch(/v_row\.project_id::text \|\| '\/' \|\| v_row\.id::text/)
    expect(fn[1]).toMatch(/o\.bucket_id = 'rrhh-llamadas-atencion' AND o\.name = v_firma/)
    expect(sql).toMatch(/VALUES \('rrhh-llamadas-atencion', 'rrhh-llamadas-atencion', false,/)
    expect(sql).not.toMatch(/CREATE POLICY "rrhh_llamadas_update"/)
  })
})
