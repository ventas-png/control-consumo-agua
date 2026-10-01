// Permisos de la vista de proveedores/contratos — SOLO para decidir qué se
// OFRECE. La autoridad es siempre el servidor (RLS, triggers y RPC); un botón
// oculto no protege nada. Esto evita mostrar secciones cuyas consultas la base
// va a devolver vacías, y no consulta lo que el usuario no puede ver.
import { usePermissionsContext } from '../shared/PermissionsContext'
import { useSession } from '../shared/SessionContext'

const ROLES_EXENTOS = ['super_admin', 'superadmin', 'company_owner', 'admin']

export interface PermisosProveedor {
  /** Ve el módulo Contabilidad (facturas, pagos, papelería del proveedor). */
  verContabilidad: boolean
  /** Crea/edita el catálogo de proveedores, sus contactos y vínculos a proyectos. */
  escribirCatalogo: boolean
  /** Habilita, suspende o autoriza (permiso de cambio de estado en Contabilidad). */
  cambiarEstado: boolean
  /** Ve la pestaña de contratos de Operaciones. */
  verContratos: boolean
  /** Ve órdenes de compra y recepciones (pestaña de Operaciones o Contabilidad). */
  verCompras: boolean
  /** Lee la papelería sensible (RTU, DPI, referencia bancaria). Espeja prov_puede_ver_papeleria(). */
  verPapeleria: boolean
}

export function usePermisosProveedor(): PermisosProveedor {
  const session = useSession()
  const perms = usePermissionsContext()
  const exento = ROLES_EXENTOS.includes(session.role)
  const tab = (id: string) => exento || (session.permissions?.has(`condominios.tab.${id}`) ?? false)
  const verContabilidad = perms.canViewModule('contabilidad')
  return {
    verContabilidad,
    escribirCatalogo: perms.canCreate('contabilidad') || perms.canEdit('contabilidad'),
    cambiarEstado: perms.canChangeStatus('contabilidad'),
    verContratos: tab('proveedores'),
    verCompras: verContabilidad || tab('ordenes_compra'),
    verPapeleria: verContabilidad,
  }
}
