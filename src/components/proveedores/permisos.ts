// Permisos de la vista de proveedores/contratos y de los PASOS de compras y pagos — SOLO para decidir qué se
// OFRECE. La autoridad es siempre el servidor (RLS, triggers y RPC); un botón oculto no protege nada. Esto evita
// mostrar secciones cuyas consultas la base va a devolver vacías, y no consulta lo que el usuario no puede ver.
import { useMemo } from 'react'
import { LLAVES_ACCION_COMPRAS } from '../../lib/platformPermissions'
import { usePermissionsContext } from '../shared/PermissionsContext'
import { useSession } from '../shared/SessionContext'

/**
 * Los roles que el SERVIDOR deja pasar sin llave: son exactamente los de `user_has_permission` (super_admin, superadmin,
 * company_owner, admin). Es una lista PROPIA a propósito, no `EXEMPT_ROLES` (lib/moduleConfig) ni `isExemptPlatformRole`
 * (lib/permissions): `EXEMPT_ROLES` incluye `cliente` (el portal del residente no pasa por el sidebar de módulos) y no
 * `superadmin`; `isExemptPlatformRole` tampoco trae `superadmin`. Unificarla con cualquiera de las dos ofrecería botones que el
 * servidor rechaza (`cliente`) o escondería los que sí acepta (`superadmin`). Si cambia `user_has_permission`, cambia aquí.
 */
const ROLES_EXENTOS = ['super_admin', 'superadmin', 'company_owner', 'admin']

/**
 * Los pasos del circuito de compras y pagos que la pantalla ofrece. El servidor exige, para cada decisión, SU llave
 * (LLAVES_ACCION_COMPRAS) y además «Editar» de Contabilidad (la política de UPDATE de esas tablas lo pide): con solo
 * la llave o con solo «Editar» el UPDATE no afecta ninguna fila. Solo se ofrece el botón si se cumplen las dos.
 * «Autorizar / Denegar» y «Cambiar estado» genéricos de Contabilidad YA NO conceden ninguna de las seis decisiones.
 */
export interface PasosCompras {
  /** Aprobar una orden de compra o devolver a borrador una aprobada: «Autorizar / Denegar — Órdenes compra» + Editar. */
  puedeAprobarOrdenCompra: boolean
  /** Registrar una recepción (borrador → registrada): mueve existencias y contabiliza. */
  puedeRegistrarRecepcion: boolean
  /** Aprobar una factura de proveedor (registrada → aprobada): la cuadra y la contabiliza. */
  puedeAprobarFactura: boolean
  /** Aprobar una orden de pago (borrador → aprobada). */
  puedeAprobarOrdenPago: boolean
  /** Marcar pagada una orden de pago aprobada (contabiliza el egreso). */
  puedeEjecutarPago: boolean
  /** Anular una orden de pago, también una ya pagada. */
  puedeAnularPago: boolean
  /**
   * Los pasos que NO tienen llave propia: emitir, cancelar y cerrar la orden de compra; anular una recepción, una
   * factura o una contraseña. Siguen con «Cambiar estado» Y «Editar» de Contabilidad.
   */
  puedeCambiarEstadoPaso: boolean
}

export interface EntradaPasosCompras {
  /** `app_users.role` de la sesión. */
  rol: string | null | undefined
  /** Llaves RBAC vigentes de la sesión (ya sin las denegadas ni las vencidas). */
  permisos: ReadonlySet<string> | null | undefined
  /** «Editar» de Contabilidad (ver + editar). */
  puedeEditar: boolean
  /** «Cambiar estado» de Contabilidad (ver + cambiar estado). */
  puedeCambiarEstado: boolean
}

/**
 * Decisión ÚNICA de qué pasos de compras y pagos se ofrecen. Función pura: las pestañas de Contabilidad
 * (Compras, Cuentas por pagar) y la de Operaciones (Órdenes compra) la consumen por los hooks de abajo, en vez de
 * repetir cada una su propia combinación de llaves. Los roles exentos (super_admin, superadmin, company_owner,
 * admin) ven todo, igual que el servidor los deja pasar.
 */
export function decidirPasosCompras(e: EntradaPasosCompras): PasosCompras {
  const exento = !!e.rol && ROLES_EXENTOS.includes(e.rol)
  const conLlave = (llave: string) => exento || (e.permisos?.has(llave) ?? false)
  const editar = exento || e.puedeEditar
  return {
    puedeAprobarOrdenCompra: editar && conLlave(LLAVES_ACCION_COMPRAS.aprobarOrdenCompra),
    puedeRegistrarRecepcion: editar && conLlave(LLAVES_ACCION_COMPRAS.registrarRecepcion),
    puedeAprobarFactura: editar && conLlave(LLAVES_ACCION_COMPRAS.aprobarFactura),
    puedeAprobarOrdenPago: editar && conLlave(LLAVES_ACCION_COMPRAS.aprobarOrdenPago),
    puedeEjecutarPago: editar && conLlave(LLAVES_ACCION_COMPRAS.ejecutarPago),
    puedeAnularPago: editar && conLlave(LLAVES_ACCION_COMPRAS.anularPago),
    puedeCambiarEstadoPaso: editar && (exento || e.puedeCambiarEstado),
  }
}

/** Los pasos de compras y pagos del usuario actual (ver `decidirPasosCompras`). */
export function usePasosCompras(): PasosCompras {
  const session = useSession()
  const perms = usePermissionsContext()
  const puedeEditar = perms.canEdit('contabilidad')
  const puedeCambiarEstado = perms.canChangeStatus('contabilidad')
  return useMemo(
    () => decidirPasosCompras({ rol: session.role, permisos: session.permissions, puedeEditar, puedeCambiarEstado }),
    [session.role, session.permissions, puedeEditar, puedeCambiarEstado],
  )
}

export interface PermisosProveedor extends PasosCompras {
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
  const pasos = usePasosCompras()
  const exento = ROLES_EXENTOS.includes(session.role)
  const tab = (id: string) => exento || (session.permissions?.has(`condominios.tab.${id}`) ?? false)
  const verContabilidad = perms.canViewModule('contabilidad')
  return {
    ...pasos,
    verContabilidad,
    escribirCatalogo: perms.canCreate('contabilidad') || perms.canEdit('contabilidad'),
    cambiarEstado: perms.canChangeStatus('contabilidad'),
    verContratos: tab('proveedores'),
    verCompras: verContabilidad || tab('ordenes_compra'),
    verPapeleria: verContabilidad,
  }
}
