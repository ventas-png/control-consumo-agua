// domain/condominios/tabMutations.ts — CRUD genérico de las tablas de condominios
// para los tabs del panel admin. T7/PR3.
//
// Los ~146 tabs de condominios/tabs reciben sus datos por props (los carga
// CondominiosSection) y solo ESCRIBEN sobre su tabla de feature con el mismo
// shape: insert(payload) / update(patch).eq('id', id) / delete().eq('id', id).
// Estos helpers genéricos (la tabla es un parámetro; `lib/supabase` no está tipado
// con Database, así que `from(table)` con string es lo idiomático aquí) centralizan
// ese acceso sin un archivo por tabla.
//
// IMPORTANTE: a diferencia del resto de la capa domain (que mapea a `error:string`),
// estos helpers devuelven el ERROR CON SHAPE `{ message }` (el de supabase) para que
// los ~140 tabs que ya hacen `error.message` / `if (error)` migren con un simple
// swap de la llamada, sin tocar su manejo de errores.
//
// P2 tipos: las funciones con tabla/RPC LITERAL usan el cliente tipado `db`;
// los helpers genéricos (tabla como parámetro string) siguen en `supabase`.
import { supabase, db } from '../../lib/supabase'
import type { ResultadoGeneracionTurnos } from '../../types'

/** Error con el shape mínimo que consume la UI (mensaje legible). */
export type RowError = { message: string } | null

/** Inserta una fila (o varias) en `table` (payload ya armado por la UI). */
export async function createCondominioRow(
  table: string,
  payload: Record<string, unknown> | Record<string, unknown>[],
): Promise<{ error: RowError }> {
  const { error } = await supabase.from(table).insert(payload)
  return { error }
}

/**
 * Inserta una fila en `table` y devuelve la fila creada. `select` permite traer
 * embeds (ej. `'*, unidades(nombre)'`); por defecto trae todas las columnas.
 */
export async function createCondominioRowReturning(
  table: string,
  payload: Record<string, unknown>,
  select = '*',
): Promise<{ data: Record<string, unknown> | null; error: RowError }> {
  const { data, error } = await supabase.from(table).insert(payload).select(select).single()
  return { data: (data as unknown as Record<string, unknown>) ?? null, error }
}

/** Upsert de una fila (o varias) en `table` (resuelve conflictos por `onConflict`). */
export async function upsertCondominioRow(
  table: string,
  payload: Record<string, unknown> | Record<string, unknown>[],
  onConflict?: string,
): Promise<{ error: RowError }> {
  const { error } = await supabase
    .from(table)
    .upsert(payload, onConflict ? { onConflict } : undefined)
  return { error }
}

/** Actualiza la fila `id` de `table` con `patch`. */
export async function updateCondominioRow(
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<{ error: RowError }> {
  const { error } = await supabase.from(table).update(patch).eq('id', id)
  return { error }
}

/** Elimina la fila `id` de `table`. */
export async function deleteCondominioRow(
  table: string,
  id: string,
): Promise<{ error: RowError }> {
  const { error } = await supabase.from(table).delete().eq('id', id)
  return { error }
}

/** Elimina filas de `table` por una columna distinta de `id` (ej. encuesta_id). */
export async function deleteCondominioRowBy(
  table: string,
  column: string,
  value: string,
): Promise<{ error: RowError }> {
  const { error } = await supabase.from(table).delete().eq(column, value)
  return { error }
}

/** Elimina un conjunto de filas de `table` por id (`.in`). Si `ids` viene vacío, no-op. */
export async function deleteCondominioRowsByIds(
  table: string,
  ids: string[],
): Promise<{ error: RowError }> {
  if (ids.length === 0) return { error: null }
  const { error } = await supabase.from(table).delete().in('id', ids)
  return { error }
}

/** Aplica `patch` a un conjunto de filas de `table` por id (`.in`). No-op si `ids` vacío. */
export async function updateCondominioRowsByIds(
  table: string,
  ids: string[],
  patch: Record<string, unknown>,
): Promise<{ error: RowError }> {
  if (ids.length === 0) return { error: null }
  const { error } = await supabase.from(table).update(patch).in('id', ids)
  return { error }
}

/**
 * Marca un conjunto de cuotas de condominio como 'moroso' por id (acción de la
 * automatización "marcar_moroso"). Bespoke por el `.in(...)`. Mismo shape de
 * error (`{ message }`) que el resto de helpers de tab.
 */
export async function marcarCuotasMorosas(ids: string[]): Promise<{ error: RowError }> {
  const { error } = await db.from('cuotas_condominio').update({ estado: 'moroso' }).in('id', ids)
  return { error }
}

/** Resultado del cierre de ciclo de cuotas (RPC `condominios_cerrar_ciclo`). */
export interface ResultadoCierreCiclo {
  emitidas: number
  avisos: number
  dias_vencimiento: number
}

/**
 * Cierra el ciclo de cuotas de un proyecto/período: el RPC emite EN UN SOLO
 * statement todas las cuotas emitibles del período (paridad con
 * buildEmitirCuotaPatch: vencimiento por regla de mora + snapshot de total) y
 * avisa in-app al residente responsable vía el outbox. La autorización vive
 * server-side (super admin o empresa del proyecto + permiso de cuotas).
 */
export async function cerrarCicloCuotas(
  projectId: string,
  periodo: string,
  notificar = true,
): Promise<{ data: ResultadoCierreCiclo | null; error: RowError }> {
  const { data, error } = await db.rpc('condominios_cerrar_ciclo', {
    p_project_id: projectId,
    p_periodo: periodo,
    p_notificar: notificar,
  })
  // El RPC declara `Returns: Json`; el shape concreto lo fija el SQL del cierre.
  return { data: (data as ResultadoCierreCiclo | null) ?? null, error }
}

/**
 * Firma la recepción de un paquete por parte del residente (RPC `SECURITY DEFINER`
 * que acota la escritura a la unidad del usuario). `firmaPath` es el objeto ya subido
 * a `condominios-media`.
 */
export async function firmarRecepcionPaquete(
  paqueteId: string,
  firmaPath: string,
  nombre: string,
): Promise<{ error: RowError }> {
  const { error } = await db.rpc('paquete_firmar_recepcion', {
    p_paquete_id: paqueteId, p_firma_path: firmaPath, p_nombre: nombre,
  })
  return { error }
}

/** Parámetros del acuse de correspondencia (`correspondencia_registrar_acuse`). */
export interface AcuseCorrespondenciaParams {
  piezaId: string
  /** Nombre REAL de quien recibe. La RPC rechaza el vacío. */
  nombre: string
  /** Objeto ya subido a `recepcion-evidencias`, o null si se entregó sin firma. */
  firmaPath?: string | null
}

/**
 * Cierra la custodia de una correspondencia con su acuse, en una sola
 * transacción del servidor.
 *
 * Sustituye al `UPDATE … SET estado='atendido'` que hacían "Atender" y la
 * entrega firmada: aquel podía dejar la pieza entregada sin nombre de quien
 * recibió, y no comprobaba ni la clase ni el estado anterior, así que dos
 * clics seguidos re-sellaban la hora de entrega. La RPC valida clase, estado
 * pendiente, empresa/proyecto, permiso y nombre, y sella empleado y hora
 * (20260831000000).
 */
export async function registrarAcuseCorrespondencia(
  { piezaId, nombre, firmaPath = null }: AcuseCorrespondenciaParams,
): Promise<{ error: RowError }> {
  // `supabase` y no `db`: la RPC es nueva y aún no está en database.types.ts.
  const { error } = await supabase.rpc('correspondencia_registrar_acuse', {
    p_pieza_id: piezaId,
    p_nombre: nombre,
    p_firma_path: firmaPath,
    p_via: 'porteria',
  })
  return { error }
}

/** Parámetros de `autorizarSalidaPaquete` (el residente autoriza un retiro por tercero). */
export interface AutorizarSalidaParams {
  unidadId: string
  tipo: string
  descripcion: string
  autorizadoNombre: string
  autorizadoDocumento: string | null
  autorizadoTelefono: string | null
  fotos: string[] | null
  notas: string | null
}

/**
 * Autoriza la salida de un paquete vía RPC `paquete_autorizar_salida` (crea el registro
 * con código de retiro y lo devuelve). Mismo shape de error `{ message }`.
 */
export async function autorizarSalidaPaquete(
  p: AutorizarSalidaParams,
): Promise<{ data: Record<string, unknown> | null; error: RowError }> {
  // Los args opcionales del RPC se generan como `?: string` (no aceptan null);
  // omitirlos (`?? undefined`) equivale a su DEFAULT NULL en SQL.
  const { data, error } = await db.rpc('paquete_autorizar_salida', {
    p_unidad_id: p.unidadId,
    p_tipo: p.tipo,
    p_descripcion: p.descripcion,
    p_autorizado_nombre: p.autorizadoNombre,
    p_autorizado_documento: p.autorizadoDocumento ?? undefined,
    p_autorizado_telefono: p.autorizadoTelefono ?? undefined,
    p_fotos: p.fotos ?? undefined,
    p_notas: p.notas ?? undefined,
  })
  return { data: (data as Record<string, unknown>) ?? null, error }
}

/**
 * Materializa las reglas de turno activas del proyecto en `bloques_turno` para
 * el rango dado (RPC `generar_bloques_turno`, 20260820000200). Se salta
 * ausencias aprobadas, días no laborables y lo ya existente — incluidos los
 * bloques puestos a mano, que nunca se pisan. Volver a llamarla no duplica.
 *
 * Va en `supabase` (sin tipar) y no en `db`: la RPC es nueva y no existe en
 * database.types.ts hasta la próxima corrida de `npm run gen:db-types`.
 * Devuelve UNA fila (RETURNS TABLE con un solo RETURN NEXT).
 */
export async function generarBloquesTurno(
  projectId: string,
  desde: string,
  hasta: string,
): Promise<{ data: ResultadoGeneracionTurnos | null; error: RowError }> {
  const { data, error } = await supabase.rpc('generar_bloques_turno', {
    p_project_id: projectId,
    p_desde: desde,
    p_hasta: hasta,
  })
  const fila = Array.isArray(data) ? data[0] : data
  return { data: (fila as ResultadoGeneracionTurnos | null) ?? null, error }
}
