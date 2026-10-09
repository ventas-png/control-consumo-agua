// Texto de error de las ACCIONES del circuito de compras y pagos (aprobar, registrar, pagar, anular) para la pantalla.
//
// Los rechazos de permiso y de alcance los escribe el servidor para leerse tal cual: dicen QUÉ acción se intentó y QUÉ
// permiso o asignación falta («…tu perfil necesita el permiso «Compras y pagos — Ejecutar un pago»»). La pantalla
// muestra ese texto, sin el código técnico del prefijo y sin sustituirlo por un «no tienes permiso» genérico.
import { SinFilasAfectadasError } from '../queryFetch'

/**
 * Familias de error del servidor cuyo texto se muestra tal cual:
 *  · COMPRAS_PERMISO_ACCION     la persona no tiene la llave de la acción;
 *  · COMPRAS_ALCANCE_PROYECTO   no está asignada al proyecto del documento;
 *  · COMPRAS_ALCANCE_EMPRESA    el documento es de otra empresa;
 *  · COMPRAS_CONFIG_SEPARACION_*  cambios del interruptor de separación solicitante/aprobador fuera de su RPC.
 */
const TEXTO_DEL_SERVIDOR = /^\s*COMPRAS_(?:PERMISO_ACCION|ALCANCE_PROYECTO|ALCANCE_EMPRESA|CONFIG_SEPARACION_[A-Z0-9_]+):\s*([\s\S]*?)\s*$/

function textoDe(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (typeof e === 'object' && e !== null && 'message' in e) return String((e as { message: unknown }).message)
  return ''
}

/**
 * El mensaje a mostrar cuando una acción de compras y pagos falla.
 *  · «el servidor no cambió ninguna fila» (`SinFilasAfectadasError`) conserva su propio texto: no se disfraza de éxito
 *    ni se reescribe;
 *  · permiso, alcance de proyecto o de empresa y separación: el texto del servidor sin su código técnico;
 *  · cualquier otro rechazo del servidor (COMPRAS_*, restricciones) se muestra como llegó, igual que antes.
 */
export function mensajeAccionCompras(e: unknown, respaldo = 'No se pudo completar la acción.'): string {
  if (e instanceof SinFilasAfectadasError) return e.message
  const texto = textoDe(e)
  const m = TEXTO_DEL_SERVIDOR.exec(texto)
  if (m?.[1]) return m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return texto || respaldo
}
