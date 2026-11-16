import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { COLUMNA_MODULO, MODULOS_SERVICIO } from '../lib/modulosProyecto'

// Guards de FORMA de 20261127000000 (módulos por proyecto). La conducta —quién
// mueve los interruptores, el «al menos uno», el portal y Rentas— se EJECUTA en
// supabase/tests/modulos_por_proyecto/run.sh. Aquí queda lo que ese arnés no
// ve: que está en CI, que el front y la base nombran igual las columnas y que
// portal_mis_unidades conserva lo que ya hacía.

const MIG = resolve('supabase/migrations/20261127000000_modulos_por_proyecto.sql')
const sql = readFileSync(MIG, 'utf8').replace(/--[^\n]*/g, '')

describe('20261127000000 — forma de la migración', () => {
  it('las columnas del front son las de la base, NOT NULL y encendidas por defecto', () => {
    for (const m of MODULOS_SERVICIO) {
      expect(sql, m).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${COLUMNA_MODULO[m]}\\s+boolean NOT NULL DEFAULT true`))
    }
  })

  it('el trigger de projects sólo se dispara al tocar los interruptores y decide por la sesión que escribe', () => {
    expect(sql).toMatch(/BEFORE UPDATE OF modulo_agua, modulo_condominios, modulo_rentas ON public\.projects/)
    const guard = sql.slice(sql.indexOf('FUNCTION public.projects_modulos_guard()'), sql.indexOf('trg_projects_modulos_guard'))
    expect(guard).not.toMatch(/SECURITY DEFINER/)
    expect(guard).toMatch(/SET search_path = ''/)
    expect(guard).toMatch(/NOT public\.is_super_admin\(\)\s+AND NOT public\.is_company_owner\(\)/)
  })

  it('portal_mis_unidades conserva la redacción del contacto del propietario y sus permisos', () => {
    const portal = sql.slice(sql.indexOf('FUNCTION public.portal_mis_unidades()'), sql.indexOf('$fn$;'))
    expect(portal).toMatch(/SECURITY DEFINER SET search_path = public/)
    expect(portal).toMatch(/'propietario_telefono', NULL, 'propietario_email', NULL/)
    expect(portal).toMatch(/WHERE u\.activo = true/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.portal_mis_unidades\(\) FROM public, anon/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.portal_mis_unidades\(\) TO authenticated/)
  })

  it('la compuerta de Rentas es SECURITY DEFINER con search_path fijo y cerrada a los roles de la API', () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.rentas_propiedad_modulo_proyecto\(\) FROM PUBLIC, anon, authenticated/)
    expect(sql).not.toMatch(/SECURITY DEFINER\s+AS/)
  })

  it('la suite ejecutable y la reversión existen, y la suite corre en CI', () => {
    expect(existsSync(resolve('supabase/tests/modulos_por_proyecto/run.sh'))).toBe(true)
    expect(existsSync(resolve('scripts/reversion-modulos-por-proyecto.sql'))).toBe(true)
    expect(readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')).toMatch(/supabase\/tests\/modulos_por_proyecto\/run\.sh/)
  })
})
