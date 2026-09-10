// domain/agua/mutations.ts — Escrituras del dominio agua. T7/PR3: el acceso
// directo a `registros` (y la foto del registro en Storage) sale de los
// componentes hacia la capa domain.
// P2 tipos: los writes a `registros` van por el cliente TIPADO `db`; `supabase`
// queda solo para Storage (los buckets no están en el esquema generado).
import { db, supabase } from '../../lib/supabase'
import { softDelete } from '../../lib/softDelete'
import type { GPS, Registro } from '../../types'
import type { TablesUpdate } from '../../types/database.types'

/**
 * Sube la foto de un registro al bucket `registro-fotos` (path bare; el display
 * site firma vía useSignedUrl). El path lo arma la UI (scopeado por carpeta de
 * cliente para la RLS de storage, infra:I14). Devuelve `{ error }`.
 */
export async function uploadRegistroFoto(
  path: string,
  file: File | Blob,
  contentType?: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.storage
    .from('registro-fotos')
    .upload(path, file, contentType ? { contentType } : undefined)
  return { error: error?.message ?? null }
}

/**
 * Lo ÚNICO que el operador aporta al registrar una lectura. Todo lo que decide
 * el cobro —lectura anterior, consumo, tarifa, canon, exceso, importe, tipo de
 * cobro, proyecto, cliente y estado inicial— lo resuelve el servidor dentro de
 * `registrar_lectura` (migración 20260910000001). Este tipo es la frontera: si
 * un campo no está aquí, el navegador no puede decidirlo.
 */
export interface LecturaCaptura {
  contadorId: string
  /** Lo que marca el medidor. */
  lecturaActual: number
  /** Día de la lectura, LOCAL, en formato `YYYY-MM-DD`. La base lo ancla al mediodía de la zona del tenant. */
  fecha: string
  /**
   * Identidad de la OPERACIÓN de captura, no de la lectura. Es lo que distingue
   * un reintento de una captura nueva: dos lecturas legítimas del mismo día con
   * el mismo valor son indistinguibles por (contador · lectura · fecha), que es
   * lo que se usaba antes. Se genera una vez al guardar y viaja con la lectura
   * hasta que entra, reintentos incluidos.
   */
  idempotencyKey: string
  notas?: string | null
  /** Path en el bucket `registro-fotos`, bajo la carpeta del cliente. Nunca base64. */
  fotoPath?: string | null
  gps?: GPS | null
  /** Cambio físico / reset del medidor. Exige `lecturaFinalRetirada` y motivo en `notas`. */
  resetMedidor?: boolean
  /** Última lectura del medidor RETIRADO. Con ella el servidor cobra el consumo real del reset. */
  lecturaFinalRetirada?: number | null
  /** Sólo en la PRIMERA lectura del contador: inicio del servicio (`YYYY-MM-DD`). */
  fechaInicioServicio?: string | null
}

/**
 * Registra una lectura llamando a la RPC transaccional `registrar_lectura`.
 *
 * Por qué una RPC y no un INSERT: con el INSERT el navegador mandaba `consumo`,
 * `monto_calculado`, `tarifa_aplicada`, `estado`… y la RLS sólo contestaba
 * «¿puede escribir en este proyecto?», sin mirar un solo valor. Un POST a mano
 * con `monto_calculado: 0` y `estado: 'pagado'` era un recibo en cero firmado
 * por la base. Ahora esos campos no tienen dónde escribirse: el servidor los
 * calcula bajo un bloqueo por contador, con la lectura vigente resuelta por
 * orden total y la tarifa leída de la base.
 *
 * Se usa el cliente `supabase` (sin tipar) y no `db` porque la firma de la RPC
 * todavía no está en el esquema generado — misma convención que el resto de
 * RPCs recientes (presencia_marcar, actividad_equipo…).
 *
 * `duplicado: true` cuando la BD rechazó la lectura por la llave natural UNIQUE
 * (contador · lectura · fecha, 23505): esa lectura YA existe y no es un
 * reintento de esta operación. El reintento de LA MISMA operación no llega
 * aquí: la RPC devuelve la fila que ya creó, sin error.
 */
export async function registrarLectura(
  captura: LecturaCaptura,
): Promise<{ data: Registro | null; error: string | null; duplicado: boolean }> {
  const { data, error } = await supabase.rpc('registrar_lectura', {
    p_contador_id: captura.contadorId,
    p_lectura_actual: captura.lecturaActual,
    p_fecha: captura.fecha,
    p_idempotency_key: captura.idempotencyKey,
    p_notas: captura.notas ?? null,
    p_foto: captura.fotoPath ?? null,
    p_gps: captura.gps ?? null,
    p_reset_medidor: captura.resetMedidor ?? false,
    p_lectura_final_retirada: captura.lecturaFinalRetirada ?? null,
    p_fecha_inicio_servicio: captura.fechaInicioServicio ?? null,
  })
  if (error?.code === '23505') {
    return {
      data: null,
      error: 'Esta lectura ya está registrada (mismo contador, lectura y fecha).',
      duplicado: true,
    }
  }
  // La RPC devuelve la fila completa de `registros` (RETURNS public.registros).
  return { data: (data as unknown as Registro | null) ?? null, error: error?.message ?? null, duplicado: false }
}

/**
 * Actualiza un registro por id (payload ya armado por la UI: monto_pagado, estado,
 * fecha_pago, factura_estado…). La lógica de negocio (saldos, transición de
 * Factura) se queda en la UI; aquí solo baja la escritura. Usado por el flujo de
 * cobros (aplicar/verificar pago).
 */
export async function updateRegistro(
  id: string,
  payload: Record<string, unknown>,
): Promise<{ error: string | null }> {
  // El parche lo arma la UI como objeto libre; el contrato real es el del esquema.
  const { error } = await db.from('registros').update(payload as TablesUpdate<'registros'>).eq('id', id)
  return { error: error?.message ?? null }
}

/**
 * Elimina un registro por id — SOFT DELETE (E2, auditoría 2026-07-16 D3): marca
 * deleted_at/deleted_by en vez de DELETE físico. La lectura desaparece de todos
 * los consumidores (filtran .is('deleted_at', null)) pero queda para auditoría
 * y para la purga programada. Devuelve `count` para que la UI distinga
 * "borrado" (1) de "sin permisos / ya borrado" (0 — RLS niega en silencio).
 */
export async function deleteRegistro(
  id: string,
): Promise<{ error: string | null; count: number | null }> {
  const { error, count } = await softDelete('registros', { id })
  return { error: error?.message ?? null, count: count ?? null }
}

/**
 * Marca un conjunto de registros como 'mora' (para seguimiento del cobrador).
 * Usado al marcar mora en lote y al crear un convenio.
 */
export async function marcarRegistrosMora(ids: string[]): Promise<{ error: string | null }> {
  const { error } = await db.from('registros').update({ estado: 'mora' }).in('id', ids)
  return { error: error?.message ?? null }
}
