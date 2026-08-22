// ════════════════════════════════════════════════════════════════════════════
// Autorización de notify-package — DELEGADA en los helpers de la base.
// ════════════════════════════════════════════════════════════════════════════
// POR QUÉ EXISTE ESTE ARCHIVO
//
// La función corre con `service_role`, que salta la RLS entera: dentro del
// handler la tabla no protege nada y la decisión hay que tomarla a mano. La
// versión anterior la tomaba REIMPLEMENTANDO el RBAC en TypeScript, y esa copia
// divergió de la base en tres puntos, cada uno de los cuales concedía de más:
//
//   1. Pedía `role_permissions` embebido desde `user_roles`:
//
//        .from('user_roles').select('role_id, expires_at, role_permissions(...)')
//
//      No hay FK directa entre esas dos tablas, así que PostgREST no puede
//      resolver la incrustación y devuelve error. El error se ignoraba —sólo se
//      leía `data`— y `permisos` quedaba en `[]`. Fallo ABIERTO disfrazado de
//      cerrado: con la lista vacía, cualquiera cuyo rol estuviera en la lista de
//      «roles con todos los permisos» pasaba igual, y el resto quedaba denegado
//      por una razón falsa. Un fallo de consulta se convertía en una decisión
//      de autorización.
//
//   2. Recolectaba sólo `effect === 'allow'`. La base evalúa el DENY EXPLÍCITO
//      ANTES que el allow y le gana (20260518000008). Un usuario con un rol que
//      concede y otro que veta quedaba autorizado aquí y denegado allá.
//
//   3. Reimplementaba el alcance por proyecto (`admin` sin asignaciones ve
//      todo, etc.). Esa regla vive en `can_access_project` y ha cambiado ya una
//      vez; la copia no se enteró.
//
// La corrección no es arreglar la copia: es NO TENER copia. Se abre un cliente
// Supabase limitado al JWT del usuario —PostgREST hace `SET LOCAL ROLE
// authenticated` y `auth.uid()` pasa a ser él— y se preguntan los MISMOS
// helpers que aplica la RLS. Si mañana cambia la semántica de permisos, cambia
// en un sitio.
//
// FAIL-CLOSED, DE VERDAD
// Cualquier tropiezo —error de PostgREST, excepción de red, respuesta que no es
// un booleano— se convierte en DENEGADO, nunca en «permisos vacíos». Es
// exactamente el fallo del punto 1, así que aquí es una decisión explícita y
// probada, no un efecto lateral de leer `data` sin mirar `error`.
// ════════════════════════════════════════════════════════════════════════════

import { permisoDeClase } from './logic.ts'

/** Lo mínimo de un cliente Supabase que esta capa necesita. Inyectable ⇒ testeable. */
export interface RespuestaRpc {
  data: unknown
  error: { message?: string } | null
}
export interface ClienteRpc {
  rpc(nombre: string, args?: Record<string, unknown>): Promise<RespuestaRpc>
}

export type MotivoDenegado =
  | 'sin_cliente'
  | 'error_autorizacion'
  | 'otra_empresa'
  | 'proyecto_no_asignado'
  | 'sin_permiso_de_clase'

export type Veredicto =
  | { ok: true }
  | { ok: false; motivo: MotivoDenegado; detalle: string }

export interface PiezaAAutorizar {
  company_id: string | null
  project_id: string | null
  clase: string | null
}

/** Fallo de autorización: se distingue de "denegado" para poder responder 503 y no 403. */
class ErrorAutorizacion extends Error {}

/**
 * Llama a un helper que devuelve boolean. Todo lo que no sea un `true`/`false`
 * limpio es un fallo, no un `false`: un `null` por error de consulta y un
 * `false` por regla de negocio significan cosas distintas, y confundirlos es
 * justo cómo se cuela un fallo abierto.
 */
async function helperBooleano(
  cliente: ClienteRpc, nombre: string, args?: Record<string, unknown>,
): Promise<boolean> {
  let res: RespuestaRpc
  try {
    res = await cliente.rpc(nombre, args)
  } catch (err) {
    throw new ErrorAutorizacion(`${nombre} lanzó: ${String(err)}`)
  }
  if (res?.error) {
    throw new ErrorAutorizacion(`${nombre} falló: ${res.error.message ?? 'error sin mensaje'}`)
  }
  if (typeof res?.data !== 'boolean') {
    throw new ErrorAutorizacion(`${nombre} devolvió ${JSON.stringify(res?.data)}, y se esperaba un booleano`)
  }
  return res.data
}

/** Igual, para el helper que devuelve el uuid de la empresa del llamante. */
async function empresaDelLlamante(cliente: ClienteRpc): Promise<string> {
  let res: RespuestaRpc
  try {
    res = await cliente.rpc('get_my_company_id')
  } catch (err) {
    throw new ErrorAutorizacion(`get_my_company_id lanzó: ${String(err)}`)
  }
  if (res?.error) {
    throw new ErrorAutorizacion(`get_my_company_id falló: ${res.error.message ?? 'error sin mensaje'}`)
  }
  if (typeof res?.data !== 'string' || res.data.length === 0) {
    // Sin empresa no hay nada que comparar. Denegar por "otra_empresa" mentiría
    // sobre la causa, así que es un fallo de autorización.
    throw new ErrorAutorizacion('get_my_company_id no devolvió una empresa')
  }
  return res.data
}

/**
 * ¿Puede este llamante disparar el aviso de esta pieza?
 *
 * @param cliente Cliente Supabase LIMITADO AL JWT DEL USUARIO. Pasarle el de
 *                service_role haría que los helpers respondieran sobre un
 *                `auth.uid()` nulo y la comprobación no valdría nada.
 */
export async function autorizarAviso(
  cliente: ClienteRpc | null,
  pieza: PiezaAAutorizar,
): Promise<Veredicto> {
  if (!cliente) {
    return { ok: false, motivo: 'sin_cliente', detalle: 'no hay cliente con el JWT del usuario' }
  }

  try {
    // super_admin conserva su comportamiento legítimo: soporte atiende empresas
    // que no son la suya, así que se resuelve ANTES de comparar empresas. No es
    // una excepción inventada aquí — es la misma que aplica la RPC del acuse.
    if (await helperBooleano(cliente, 'is_super_admin')) return { ok: true }

    const miEmpresa = await empresaDelLlamante(cliente)
    if (!pieza.company_id || pieza.company_id !== miEmpresa) {
      return { ok: false, motivo: 'otra_empresa', detalle: 'la pieza es de otra empresa' }
    }

    // `can_access_project` ya trata el proyecto nulo como accesible (fila sin
    // proyecto sellado: ambigua, no ajena). No se replica ese caso aquí.
    if (!await helperBooleano(cliente, 'can_access_project', { p_project_id: pieza.project_id })) {
      return { ok: false, motivo: 'proyecto_no_asignado', detalle: 'el proyecto no está asignado al usuario' }
    }

    // El permiso DE LA CLASE. Es lo que impide que un operador de paquetería
    // dispare el aviso de una notificación legal conociendo sólo su id. El
    // deny-over-allow y el trato especial de admin/company_owner los pone
    // `user_has_permission`, no este archivo.
    const permiso = permisoDeClase(pieza.clase)
    if (!await helperBooleano(cliente, 'user_has_permission', { perm_key: permiso })) {
      return { ok: false, motivo: 'sin_permiso_de_clase', detalle: `falta ${permiso}` }
    }

    return { ok: true }
  } catch (err) {
    if (err instanceof ErrorAutorizacion) {
      return { ok: false, motivo: 'error_autorizacion', detalle: err.message }
    }
    throw err
  }
}
