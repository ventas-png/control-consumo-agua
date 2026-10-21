import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards ESTÁTICOS de 20261103000200 (borrar exige «Eliminar» del tab en
// Mantenimiento, Incidentes, Asambleas, Checklist de áreas y Permisos de obra).
//
// ALCANCE Y LÍMITE. Esto lee el SQL y el código del repo; no ejecuta nada. La
// verificación CONDUCTUAL —quién borra, quién da de baja un ticket, quién lo
// restaura, que editar siga igual— vive en supabase/tests/borrado_por_permiso/
// run.sh, con siete mutantes, y corre en cada PR (job rls-sandbox de
// coverage.yml).
//
// Lo que se vigila AQUÍ es lo que ese arnés no puede afirmar sobre sí mismo:
//
//   1. Que la base pregunte por el MISMO tab que la pantalla. El botón se
//      decide con ctx.canDelete('<tab>') en tabRegistry; la policy, con
//      condominios_puede_actuar('<tab>', 'delete'). Si un día se renombra uno
//      y no el otro, el arnés sigue verde (prueba la base contra sí misma) y
//      la pantalla ofrece un botón que la base rechaza, o al revés.
//   2. Que la baja de tickets siga siendo RESTRICTIVA y con un nombre que
//      `rbac_install_company_policies` no arrase.
//   3. Que el arnés siga registrado en CI.

const MIG = resolve('supabase/migrations/20261103000200_condominios_borrar_exige_permiso_delete.sql')
/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const sql = readFileSync(MIG, 'utf8').replace(/--[^\n]*/g, '')
const registro = readFileSync(resolve('src/components/condominios/tabRegistry.tsx'), 'utf8')

/** Cuerpo de la CREATE POLICY `nombre` (hasta su `;`). */
function policy(nombre: string): string {
  const m = sql.match(new RegExp(`CREATE POLICY ${nombre} ON[\\s\\S]*?;`))
  if (!m) throw new Error(`no se encontró la policy ${nombre}`)
  return m[0]
}

/** El tab con el que tabRegistry decide el botón Eliminar de `componente`. */
function tabDelBoton(componente: string): string {
  const linea = registro.split('\n').find(l => l.includes(`<${componente} `))
  const m = linea?.match(/canDelete=\{ctx\.canDelete\('([a-z_]+)'\)\}/)
  if (!m) throw new Error(`${componente} no recibe canDelete en tabRegistry`)
  return m[1]
}

const BORRADO_FISICO = [
  { tabla: 'incidentes_seguridad', componente: 'IncidentesTab' },
  { tabla: 'asambleas',            componente: 'AsambleasTab' },
  { tabla: 'checklist_areas',      componente: 'ChecklistAreasTab' },
  { tabla: 'permisos_obra_unidad', componente: 'PermisosObraTab' },
]

describe('20261103000200 · el DELETE pregunta por el mismo tab que el botón', () => {
  it.each(BORRADO_FISICO)('$tabla ↔ $componente', ({ tabla, componente }) => {
    const cuerpo = policy(`${tabla}_delete`)
    expect(cuerpo).toMatch(new RegExp(`ON public\\.${tabla}\\s+FOR DELETE TO authenticated`))
    expect(cuerpo).toContain(`condominios_puede_actuar('${tabDelBoton(componente)}', 'delete')`)
    // Dentro de la empresa, y sin la regla de rol de antes.
    expect(cuerpo).toContain('company_id = (SELECT public.get_my_company_id())')
    expect(cuerpo).not.toMatch(/current_user_role/)
  })
})

describe('20261103000200 · la baja lógica de tickets', () => {
  const cuerpo = policy('tickets_mantenimiento_baja_exige_eliminar')

  it('pregunta por el mismo tab que el botón de MantenimientoTab', () => {
    const condicion = `condominios_puede_actuar('${tabDelBoton('MantenimientoTab')}', 'delete')`
    // En USING (restaurar) y en WITH CHECK (dar de baja).
    expect(cuerpo.split(condicion).length - 1).toBe(2)
  })

  it('es RESTRICTIVA, de UPDATE, y su nombre no lo arrasa el instalador genérico', () => {
    expect(cuerpo).toMatch(/AS RESTRICTIVE\s+FOR UPDATE TO authenticated/)
    // rbac_install_company_policies borra las que terminan en _(select|insert|update|delete|sel|ins|upd|del).
    expect('tickets_mantenimiento_baja_exige_eliminar').not.toMatch(/_(select|insert|update|delete|sel|ins|upd|del)$/)
  })

  it('no toca el DELETE físico de tickets', () => {
    expect(sql).not.toMatch(/POLICY tickets_mantenimiento_delete/)
  })
})

describe('20261103000200 · el arnés corre en CI', () => {
  it('está cableado en coverage.yml (si no, no corre nunca)', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toContain('supabase/tests/borrado_por_permiso/run.sh')
  })
})
