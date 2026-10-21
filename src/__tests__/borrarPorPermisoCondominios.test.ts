import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards de FORMA de 20261104000100 (borrar en cinco pestañas de condominios
// exige `.delete`). La conducta —87 casos antes y después, siete mutantes— se
// verifica ejecutando la cadena completa en
// supabase/tests/borrar_por_permiso_condominios/. Aquí queda lo que ese harness
// no ve porque probaría la versión nueva contra sí misma:
//   · que el id de tab de cada policy sea el MISMO que la UI pasa a
//     `ctx.canDelete(...)` en tabRegistry.tsx. Un typo ('permisos_obra_unidad'
//     en vez de 'permisos_obra') es SQL válido y deja la policy mirando una
//     clave que nadie tiene: fail-closed, pero la base volvería a decir otra
//     cosa que la UI;
//   · que la regla venga del helper compartido y no del rol legado;
//   · y que el harness siga cableado en CI.

const MIG = resolve('supabase/migrations/20261104000100_condominios_borrar_exige_permiso_delete.sql')
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')
const sql = soloCodigo(readFileSync(MIG, 'utf8'))
const registry = readFileSync(resolve('src/components/condominios/tabRegistry.tsx'), 'utf8')

/** El cuerpo de `CREATE POLICY "<nombre>" … ;`. */
function policy(nombre: string): string {
  const m = sql.match(new RegExp(`CREATE POLICY "${nombre}"[\\s\\S]*?\\);`))
  expect(m, `falta CREATE POLICY "${nombre}"`).not.toBeNull()
  return m![0]
}

const BORRADO_FISICO = [
  { tabla: 'incidentes_seguridad', tab: 'incidentes', componente: 'IncidentesTab' },
  { tabla: 'asambleas', tab: 'asambleas', componente: 'AsambleasTab' },
  { tabla: 'checklist_areas', tab: 'checklist_areas', componente: 'ChecklistAreasTab' },
  { tabla: 'permisos_obra_unidad', tab: 'permisos_obra', componente: 'PermisosObraTab' },
] as const

describe('20261104000100 — DELETE físico con la regla de canDelete', () => {
  it.each(BORRADO_FISICO)('$tabla: la policy usa el tab «$tab», el mismo que pasa la UI', ({ tabla, tab, componente }) => {
    expect(sql).toContain(`DROP POLICY IF EXISTS "${tabla}_delete" ON public.${tabla};`)
    const p = policy(`${tabla}_delete`)
    expect(p).toMatch(/FOR DELETE TO authenticated/)
    expect(p).toContain(`(SELECT public.condominios_puede_actuar('${tab}', 'delete'))`)
    expect(p).toContain('company_id = (SELECT public.get_my_company_id())')
    expect(p).toContain('(SELECT public.is_super_admin())')
    expect(p, 'la regla ya no decide por el rol legado').not.toMatch(/current_user_role/)

    const linea = registry.split('\n').find(l => l.includes(`<${componente} `))
    expect(linea, `${componente} no está en tabRegistry.tsx`).toBeDefined()
    expect(linea).toContain(`canDelete={ctx.canDelete('${tab}')}`)
  })
})

describe('20261104000100 — borrado lógico de tickets', () => {
  it('USING y WITH CHECK condicionan deleted_at a .delete de mantenimiento', () => {
    expect(sql).toContain('DROP POLICY IF EXISTS "tickets_mantenimiento_update" ON public.tickets_mantenimiento;')
    const p = policy('tickets_mantenimiento_update')
    const [using, withCheck] = p.split(/WITH CHECK/)
    expect(withCheck, 'falta el WITH CHECK').toBeDefined()
    for (const lado of [using, withCheck]) {
      expect(lado).toMatch(/deleted_at IS NULL\s+OR \(SELECT public\.condominios_puede_actuar\('mantenimiento', 'delete'\)\)/)
      // La visibilidad del tab se conserva: editar un ticket vivo no cambia.
      expect(lado).toContain("(SELECT public.user_has_permission('condominios.tab.mantenimiento'))")
      expect(lado).toContain('company_id = (SELECT public.get_my_company_id())')
    }
    expect(registry).toContain("canDelete={ctx.canDelete('mantenimiento')}")
  })

  it('no toca el DELETE físico de tickets (lo usa la purga, no la pestaña)', () => {
    expect(sql).not.toMatch(/CREATE POLICY "tickets_mantenimiento_delete"/)
  })
})

describe('20261104000100 — autoverificación y CI', () => {
  it('termina con un bloque que aborta si alguna policy no quedó', () => {
    expect(sql).toMatch(/DO \$\$[\s\S]*EXACTAMENTE una policy permisiva de DELETE[\s\S]*EXACTAMENTE una policy permisiva de UPDATE[\s\S]*END\s*\$\$;\s*$/)
  })

  it('el harness ejecutable está cableado en CI', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toContain('supabase/tests/borrar_por_permiso_condominios/run.sh')
  })
})
