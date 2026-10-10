// Texto de error de las ACCIONES del circuito de compras y pagos (aprobar, registrar, pagar, anular) para la pantalla.
//
// Los rechazos de permiso y de alcance los escribe el servidor para leerse tal cual: dicen QUÉ acción se intentó y QUÉ
// permiso o asignación falta («…tu perfil necesita el permiso «Compras y pagos — Ejecutar un pago»»). La pantalla
// muestra ese texto, sin el código técnico del prefijo y sin sustituirlo por un «no tienes permiso» genérico.
import { SinFilasAfectadasError } from '../queryFetch'

/**
 * Qué clase de rechazo es. El PREFIJO del mensaje no basta para saberlo: `COMPRAS_ALCANCE_PROYECTO` lo usan DOS
 * comprobaciones distintas del servidor.
 *  · la nueva, de la persona (SQLSTATE 42501): «…tu perfil necesita estar asignado al proyecto del documento»;
 *  · la de la migración 20261027000000 (SQLSTATE 23514): «…el proyecto … no pertenece a la empresa del documento»,
 *    que no habla de la persona sino de un dato inconsistente del documento.
 * Se distinguen por el SQLSTATE cuando el error lo trae (PostgREST: `code`, a veces dentro de `cause`) y, si no, por
 * el texto. Si no se puede decidir, se trata como una familia desconocida y se muestra como llegó.
 */
export type FamiliaErrorCompras =
  | 'permiso'                // COMPRAS_PERMISO_ACCION: a la persona le falta la llave de la acción
  | 'alcance_proyecto'       // COMPRAS_ALCANCE_PROYECTO (42501): la persona no está asignada al proyecto del documento
  | 'alcance_empresa'        // COMPRAS_ALCANCE_EMPRESA: el documento o la empresa no son los de la sesión
  | 'separacion'             // COMPRAS_CONFIG_SEPARACION_* / COMPRAS_SEPARACION_*: el interruptor solicitante/aprobador
  | 'proyecto_de_otra_empresa' // COMPRAS_ALCANCE_PROYECTO (23514): el proyecto del documento no es de su empresa
  | 'sin_filas'              // el servidor aceptó la orden pero no cambió ninguna fila
  | 'otro'

export interface ErrorCompras {
  familia: FamiliaErrorCompras
  /** Código COMPRAS_* del prefijo, si el mensaje lo trae. */
  codigo: string | null
  /** Mensaje del servidor sin el prefijo técnico (o el texto completo si no lo tenía). */
  texto: string
}

const PREFIJO = /^\s*(COMPRAS_[A-Z0-9_]+):\s*([\s\S]*?)\s*$/
const SEPARACION = /^COMPRAS_(?:CONFIG_)?SEPARACION_[A-Z0-9_]+$/
const ASIGNACION = /necesita estar asignad[oa] al proyecto/i
const OTRA_EMPRESA = /no pertenece a la empresa/i

function textoDe(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (typeof e === 'object' && e !== null && 'message' in e) return String((e as { message: unknown }).message)
  return ''
}

/** SQLSTATE (o código del cliente) del error: propio (`code`) o del PostgrestError que envuelve (`cause.code`). */
function sqlstateDe(e: unknown): string | null {
  if (typeof e !== 'object' || e === null) return null
  const propio = (e as { code?: unknown }).code
  if (typeof propio === 'string' && propio) return propio
  const causa = (e as { cause?: unknown }).cause
  const deCausa = typeof causa === 'object' && causa !== null ? (causa as { code?: unknown }).code : undefined
  return typeof deCausa === 'string' && deCausa ? deCausa : null
}

function familiaDeProyecto(texto: string, sqlstate: string | null): FamiliaErrorCompras {
  if (sqlstate === '42501') return 'alcance_proyecto'
  if (sqlstate === '23514') return 'proyecto_de_otra_empresa'
  if (ASIGNACION.test(texto)) return 'alcance_proyecto'
  if (OTRA_EMPRESA.test(texto)) return 'proyecto_de_otra_empresa'
  return 'otro'
}

/** Clasifica el error de una acción de compras y pagos (ver `FamiliaErrorCompras`). */
export function clasificarErrorCompras(e: unknown): ErrorCompras {
  const completo = textoDe(e)
  const sqlstate = sqlstateDe(e)
  if (e instanceof SinFilasAfectadasError || sqlstate === 'SIN_FILAS') return { familia: 'sin_filas', codigo: null, texto: completo }
  const m = PREFIJO.exec(completo)
  if (!m) return { familia: 'otro', codigo: null, texto: completo }
  const [, codigo, cuerpo] = m
  let familia: FamiliaErrorCompras = 'otro'
  if (codigo === 'COMPRAS_PERMISO_ACCION') familia = 'permiso'
  else if (codigo === 'COMPRAS_ALCANCE_EMPRESA') familia = 'alcance_empresa'
  else if (codigo === 'COMPRAS_ALCANCE_PROYECTO') familia = familiaDeProyecto(cuerpo, sqlstate)
  else if (SEPARACION.test(codigo)) familia = 'separacion'
  return { familia, codigo, texto: cuerpo }
}

/** Las familias cuyo texto es para la persona: se muestra sin el código técnico. */
const SIN_CODIGO: ReadonlySet<FamiliaErrorCompras> = new Set(['permiso', 'alcance_proyecto', 'alcance_empresa', 'separacion'])

/**
 * El mensaje a mostrar cuando una acción de compras y pagos falla.
 *  · «el servidor no cambió ninguna fila» (`SinFilasAfectadasError`) conserva su propio texto: no se disfraza de éxito
 *    ni se reescribe;
 *  · permiso, alcance de proyecto (de la persona) o de empresa y separación solicitante/aprobador: el texto del
 *    servidor sin su código técnico, con la primera letra en mayúscula;
 *  · cualquier otro rechazo (COMPRAS_* de datos, restricciones, y el COMPRAS_ALCANCE_PROYECTO de «el proyecto no
 *    pertenece a la empresa del documento») se muestra como llegó, con su código: no es algo que la persona arregle
 *    pidiendo un permiso, y el código le sirve a quien lo revise.
 */
export function mensajeAccionCompras(e: unknown, respaldo = 'No se pudo completar la acción.'): string {
  const c = clasificarErrorCompras(e)
  if (c.familia === 'sin_filas') return c.texto || respaldo
  if (SIN_CODIGO.has(c.familia) && c.texto) return c.texto.charAt(0).toUpperCase() + c.texto.slice(1)
  return textoDe(e) || respaldo
}
