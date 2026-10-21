import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards ESTÁTICOS de 20261103000200, 000300 y 000400: en Mantenimiento,
// Incidentes, Asambleas, Checklist de áreas y Permisos de obra, crear exige
// «Crear» del tab, editar «Editar» y borrar «Eliminar», también en la base.
//
// ALCANCE Y LÍMITE. Esto lee el SQL y el código del repo; no ejecuta nada. La
// verificación CONDUCTUAL —quién crea, borra, da de baja, edita y restaura;
// entre empresas, con y sin WHERE; el Kanban; el residente— vive en
// supabase/tests/acciones_por_permiso/run.sh, con veinte mutantes, y corre en
// cada PR (job rls-sandbox de coverage.yml).
//
// Lo que se vigila AQUÍ es lo que ese arnés no puede afirmar sobre sí mismo:
//
//   1. Que la base pregunte por el MISMO tab que la pantalla. Los botones se
//      deciden con ctx.canCreate / canEdit / canDelete('<tab>') en
//      tabRegistry; las policies, con condominios_puede_actuar('<tab>', …). Si
//      un día se renombra uno y no el otro, el arnés sigue verde (prueba la
//      base contra sí misma) y la pantalla ofrece un botón que la base
//      rechaza, o al revés.
//   2. Que las dos policies de tickets sigan siendo RESTRICTIVAS y con nombres
//      que `rbac_install_company_policies` no arrase.
//   3. Que el alta de tickets conserve la rama del residente (portal).
//   4. Que el arnés siga registrado en CI.

const BORRAR = resolve('supabase/migrations/20261103000200_condominios_borrar_exige_permiso_delete.sql')
const EDITAR = resolve('supabase/migrations/20261103000300_condominios_editar_exige_permiso_edit.sql')
const CREAR = resolve('supabase/migrations/20261103000400_condominios_crear_exige_permiso_create.sql')
/** SQL sin comentarios de línea: lo que la BD ejecuta, no lo que explicamos. */
const soloCodigo = (ruta: string) => readFileSync(ruta, 'utf8').replace(/--[^\n]*/g, '')
const sqlBorrar = soloCodigo(BORRAR)
const sqlEditar = soloCodigo(EDITAR)
const sqlCrear = soloCodigo(CREAR)
const registro = readFileSync(resolve('src/components/condominios/tabRegistry.tsx'), 'utf8')

/** Cuerpo de la CREATE POLICY `nombre` (hasta su `;`). */
function policy(sql: string, nombre: string): string {
  const m = sql.match(new RegExp(`CREATE POLICY ${nombre} ON[\\s\\S]*?;`))
  if (!m) throw new Error(`no se encontró la policy ${nombre}`)
  return m[0]
}

/** El tab con el que tabRegistry decide la acción `accion` de `componente`. */
function tabDe(componente: string, accion: 'canCreate' | 'canEdit' | 'canDelete'): string {
  const linea = registro.split('\n').find(l => l.includes(`<${componente} `))
  const m = linea?.match(new RegExp(`${accion}=\\{ctx\\.${accion}\\('([a-z_]+)'\\)\\}`))
  if (!m) throw new Error(`${componente} no recibe ${accion} en tabRegistry`)
  return m[1]
}

/** Veces que aparece `texto` en `cuerpo`. */
const veces = (cuerpo: string, texto: string) => cuerpo.split(texto).length - 1

const CUATRO_TABLAS = [
  { tabla: 'incidentes_seguridad', componente: 'IncidentesTab' },
  { tabla: 'asambleas',            componente: 'AsambleasTab' },
  { tabla: 'checklist_areas',      componente: 'ChecklistAreasTab' },
  { tabla: 'permisos_obra_unidad', componente: 'PermisosObraTab' },
]

describe('20261103000200 · el DELETE pregunta por el mismo tab que el botón', () => {
  it.each(CUATRO_TABLAS)('$tabla ↔ $componente', ({ tabla, componente }) => {
    const cuerpo = policy(sqlBorrar, `${tabla}_delete`)
    expect(cuerpo).toMatch(new RegExp(`ON public\\.${tabla}\\s+FOR DELETE TO authenticated`))
    expect(cuerpo).toContain(`condominios_puede_actuar('${tabDe(componente, 'canDelete')}', 'delete')`)
    // Dentro de la empresa, y sin la regla de rol de antes.
    expect(cuerpo).toContain('company_id = (SELECT public.get_my_company_id())')
    expect(cuerpo).not.toMatch(/current_user_role/)
  })
})

describe('20261103000300 · el UPDATE pregunta por el mismo tab que los controles de edición', () => {
  it.each(CUATRO_TABLAS)('$tabla ↔ $componente', ({ tabla, componente }) => {
    const cuerpo = policy(sqlEditar, `${tabla}_update`)
    expect(cuerpo).toMatch(new RegExp(`ON public\\.${tabla}\\s+FOR UPDATE TO authenticated`))
    // En USING y en WITH CHECK, dentro de la empresa, y ya no la visibilidad sola.
    expect(veces(cuerpo, `condominios_puede_actuar('${tabDe(componente, 'canEdit')}', 'edit')`)).toBe(2)
    expect(veces(cuerpo, 'company_id = (SELECT public.get_my_company_id())')).toBe(2)
    expect(cuerpo).not.toMatch(/user_has_permission/)
  })
})

describe('20261103000400 · el INSERT pregunta por el mismo tab que el botón de alta', () => {
  it.each([...CUATRO_TABLAS, { tabla: 'tickets_mantenimiento', componente: 'MantenimientoTab' }])('$tabla ↔ $componente', ({ tabla, componente }) => {
    const cuerpo = policy(sqlCrear, `${tabla}_insert`)
    expect(cuerpo).toMatch(new RegExp(`ON public\\.${tabla}\\s+FOR INSERT TO authenticated`))
    expect(cuerpo).toContain(`condominios_puede_actuar('${tabDe(componente, 'canCreate')}', 'create')`)
    expect(cuerpo).toContain('company_id = (SELECT public.get_my_company_id())')
    expect(cuerpo).not.toMatch(/user_has_permission/)
  })

  it('tickets conserva la rama del residente que reporta desde el portal', () => {
    expect(policy(sqlCrear, 'tickets_mantenimiento_insert')).toContain('OR (unidad_id IN (SELECT public.mis_unidades_ids()))')
  })
})

describe('tickets_mantenimiento · baja con «Eliminar», ticket vivo con «Editar»', () => {
  const baja = policy(sqlBorrar, 'tickets_mantenimiento_baja_exige_eliminar')
  const vivo = policy(sqlEditar, 'tickets_mantenimiento_vivo_exige_editar')

  it('la baja pregunta por el mismo tab que el 🗑 de MantenimientoTab, al dar de baja y al restaurar', () => {
    expect(veces(baja, `condominios_puede_actuar('${tabDe('MantenimientoTab', 'canDelete')}', 'delete')`)).toBe(2)
  })

  it('dejar un ticket vivo exige editar en Mantenimiento O en el Kanban (las dos pantallas que lo editan)', () => {
    expect(vivo).toContain(`condominios_puede_actuar('${tabDe('MantenimientoTab', 'canEdit')}', 'edit')`)
    expect(vivo).toContain(`condominios_puede_actuar('${tabDe('KanbanTicketsTab', 'canEdit')}', 'edit')`)
    expect(vivo).toMatch(/WITH CHECK \(\s*deleted_at IS NOT NULL/)
  })

  it.each([
    ['tickets_mantenimiento_baja_exige_eliminar', baja],
    ['tickets_mantenimiento_vivo_exige_editar', vivo],
  ])('%s es RESTRICTIVA, de UPDATE, y el instalador genérico no la arrasa', (nombre, cuerpo) => {
    expect(cuerpo).toMatch(/AS RESTRICTIVE\s+FOR UPDATE TO authenticated/)
    // rbac_install_company_policies borra las que terminan en _(select|insert|update|delete|sel|ins|upd|del).
    expect(nombre).not.toMatch(/_(select|insert|update|delete|sel|ins|upd|del)$/)
  })

  it('no se tocan la policy permisiva de UPDATE ni el DELETE físico de tickets', () => {
    for (const sql of [sqlBorrar, sqlEditar, sqlCrear]) {
      expect(sql).not.toMatch(/POLICY tickets_mantenimiento_(update|delete)\b/)
    }
  })
})

describe('el arnés corre en CI', () => {
  it('está cableado en coverage.yml (si no, no corre nunca)', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toContain('supabase/tests/acciones_por_permiso/run.sh')
  })
})
