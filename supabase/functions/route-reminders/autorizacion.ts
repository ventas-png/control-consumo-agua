// ════════════════════════════════════════════════════════════════════════════
// Autorización del recordatorio manual de una ruta — DELEGADA en la base.
// ════════════════════════════════════════════════════════════════════════════
// El botón «Recordar» de Rutas se muestra con canEdit('rutas')
// (agua.rutas.edit). Antes esta función sólo aceptaba el rol de PLATAFORMA
// admin / company_owner / super_admin, así que el «Admin Agua» —rol de
// plataforma `operator` con agua.* por RBAC— recibía 403 aunque tuviera el
// permiso, y la pantalla tenía que esconderle el botón.
//
// La función corre con service_role, que salta la RLS: la decisión hay que
// tomarla aquí. Se toma igual que en notify-package/autorizacion.ts: con un
// cliente limitado al JWT del usuario se preguntan los MISMOS helpers que aplica
// la RLS de `rutas` (20261221000000): is_super_admin, get_my_company_id,
// can_access_project y user_has_permission (deny explícito incluido). No hay
// copia del RBAC en TypeScript que pueda divergir.
//
// FAIL-CLOSED: cualquier tropiezo al consultar (error de PostgREST, excepción,
// respuesta que no es del tipo esperado) es `error_autorizacion`, nunca un
// «sin permisos» ni un permitido.
// ════════════════════════════════════════════════════════════════════════════

/** La clave que exige «Recordar»: la misma que muestra el botón (canEdit('rutas')). */
export const PERMISO_RECORDAR = 'agua.rutas.edit'

/** Lo mínimo de un cliente Supabase que esta capa necesita. Inyectable ⇒ testeable. */
export interface RespuestaRpc {
  data: unknown
  error: { message?: string } | null
}
export interface ClienteRpc {
  rpc(nombre: string, args?: Record<string, unknown>): PromiseLike<RespuestaRpc>
}

export type MotivoDenegado =
  | 'sin_cliente'
  | 'error_autorizacion'
  | 'otra_empresa'
  | 'proyecto_no_asignado'
  | 'sin_permiso'

export type Veredicto =
  | { ok: true }
  | { ok: false; motivo: MotivoDenegado; detalle: string }

export interface RutaAAutorizar {
  company_id: string | null
  project_id: string | null
}

/** Fallo al consultar: se distingue de "denegado" para responder 503 y no 403. */
class ErrorAutorizacion extends Error {}

async function llamar(cliente: ClienteRpc, nombre: string, args?: Record<string, unknown>): Promise<unknown> {
  let res: RespuestaRpc
  try {
    res = await cliente.rpc(nombre, args)
  } catch (err) {
    throw new ErrorAutorizacion(`${nombre} lanzó: ${String(err)}`)
  }
  if (res?.error) {
    throw new ErrorAutorizacion(`${nombre} falló: ${res.error.message ?? 'error sin mensaje'}`)
  }
  return res?.data
}

/** Un `null` por error de consulta y un `false` por regla no son lo mismo. */
async function helperBooleano(cliente: ClienteRpc, nombre: string, args?: Record<string, unknown>): Promise<boolean> {
  const data = await llamar(cliente, nombre, args)
  if (typeof data !== 'boolean') {
    throw new ErrorAutorizacion(`${nombre} devolvió ${JSON.stringify(data)}, y se esperaba un booleano`)
  }
  return data
}

/**
 * ¿Puede este llamante enviar el recordatorio de esta ruta?
 *
 * @param cliente Cliente Supabase LIMITADO AL JWT DEL USUARIO. Con el de
 *                service_role los helpers responderían sobre un `auth.uid()`
 *                nulo y la comprobación no valdría nada.
 */
export async function autorizarRecordatorio(
  cliente: ClienteRpc | null,
  ruta: RutaAAutorizar,
): Promise<Veredicto> {
  if (!cliente) {
    return { ok: false, motivo: 'sin_cliente', detalle: 'no hay cliente con el JWT del usuario' }
  }

  try {
    // Soporte atiende empresas que no son la suya: igual que en la RLS de rutas.
    if (await helperBooleano(cliente, 'is_super_admin')) return { ok: true }

    const miEmpresa = await llamar(cliente, 'get_my_company_id')
    if (typeof miEmpresa !== 'string' || miEmpresa.length === 0) {
      throw new ErrorAutorizacion('get_my_company_id no devolvió una empresa')
    }
    if (!ruta.company_id || ruta.company_id !== miEmpresa) {
      return { ok: false, motivo: 'otra_empresa', detalle: 'la ruta es de otra empresa' }
    }

    // can_access_project ya trata el proyecto nulo como accesible.
    if (!await helperBooleano(cliente, 'can_access_project', { p_project_id: ruta.project_id })) {
      return { ok: false, motivo: 'proyecto_no_asignado', detalle: 'el proyecto no está asignado al usuario' }
    }

    // company_owner / admin pasan aquí: user_has_permission los trata como exentos.
    if (!await helperBooleano(cliente, 'user_has_permission', { perm_key: PERMISO_RECORDAR })) {
      return { ok: false, motivo: 'sin_permiso', detalle: `falta ${PERMISO_RECORDAR}` }
    }

    return { ok: true }
  } catch (err) {
    if (err instanceof ErrorAutorizacion) {
      return { ok: false, motivo: 'error_autorizacion', detalle: err.message }
    }
    throw err
  }
}
