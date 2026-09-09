// domain/condominios/pausasPresencia.ts — Las pausas de la jornada.
//
// TRES NÚMEROS QUE ANTES ERAN UNO. Una jornada de 06:00 a 18:00 no son doce
// horas de trabajo: son doce horas de ESTADÍA, de las que una parte se
// descansó. Separarlos es lo que permite pagar lo que se trabajó y comprobar
// que el descanso se dio.
//
// LA REGLA QUE NO SE NEGOCIA, otra vez: los instantes los pone el servidor
// (`presencia_pausar`, 20260908000300). Aquí no hay ningún parámetro de hora ni
// de duración para la vía de autoservicio — si lo hubiera, la persona estaría
// tecleando minutos que se restan de su propio pago.
//
// EL DESGLOSE VIVE AQUÍ Y EN LA BASE, y los dos tienen que dar lo mismo. Que
// cada lado tuviera su aritmética es exactamente lo que produjo #839: la misma
// jornada valía 24 h en la lista y 0.01 h en el cómputo. Por eso `desglose()`
// se apoya en `horasJornada` —la misma regla de cruce de medianoche que usa
// `turnos_horas_jornada` en SQL— y no en una resta propia.
import { supabase } from '../../lib/supabase'
import { reportDegradedQuery } from '../queryFetch'
import { horasJornada } from './turnos'
import type { CoordsMarcaje } from '../../lib/nativeGeo'
import type { PausaPresencia, TipoPausa } from '../../types'

export type AccionPausa = 'iniciar' | 'terminar'

export interface ResultadoPausa {
  pausa_id: string
  accion: AccionPausa
  tipo: string
  etiqueta: string
  descuenta: boolean
  minutos: number | null
}

/** El desglose de una jornada, en horas. */
export interface DesgloseJornada {
  /** Entrada → salida, sin descontar nada. */
  estadia: number | null
  /** Todo lo pausado, descuente o no. */
  descanso: number
  /** Lo que se paga: estadía menos las pausas que descuentan. */
  laborales: number | null
}

/**
 * Tipos de pausa vigentes para la empresa de quien mira. Si la empresa no
 * configuró los suyos, la base devuelve los cuatro de la casa (`configurado`
 * viene en false): configurar es una mejora, no un requisito para poder marcar.
 */
export async function fetchTiposPausa(): Promise<{ tipos: TipoPausa[]; error: string | null }> {
  const { data, error } = await supabase.rpc('presencia_tipos_pausa_efectivos')
  reportDegradedQuery('condominios.fetchTiposPausa', error)
  if (error) return { tipos: [], error: error.message }
  return { tipos: (data as TipoPausa[] | null) ?? [], error: null }
}

/**
 * Pausas de un puñado de marcajes. Se piden por los ids que ya tiene la
 * pantalla en vez de por fecha: la fecha de la pausa y la del marcaje pueden no
 * coincidir (el turno de noche cena después de la medianoche) y filtrar por
 * fecha dejaría fuera justo esa.
 */
export async function fetchPausasDeRegistros(
  registroIds: string[],
): Promise<{ pausas: PausaPresencia[]; error: string | null }> {
  if (registroIds.length === 0) return { pausas: [], error: null }
  const { data, error } = await supabase
    .from('presencia_pausas')
    .select('*')
    .in('registro_id', registroIds)
    .order('inicio_en', { ascending: true, nullsFirst: false })
  reportDegradedQuery('condominios.fetchPausasDeRegistros', error)
  if (error) return { pausas: [], error: error.message }
  return { pausas: (data as PausaPresencia[] | null) ?? [], error: null }
}

/** La persona abre o cierra su pausa. Los instantes los pone la base. */
export async function marcarPausa(params: {
  projectId: string
  accion: AccionPausa
  tipo?: string | null
  coords?: CoordsMarcaje | null
}): Promise<{ data: ResultadoPausa | null; error: string | null }> {
  const { projectId, accion, tipo = null, coords = null } = params
  const { data, error } = await supabase.rpc('presencia_pausar', {
    p_project_id: projectId,
    p_accion: accion,
    p_tipo: tipo,
    p_gps: coords ? { lat: coords.lat, lng: coords.lng, exactitud_m: coords.exactitud_m } : null,
  })
  if (error) return { data: null, error: error.message }
  const filas = (data as ResultadoPausa[] | null) ?? []
  return { data: filas[0] ?? null, error: null }
}

/**
 * Corrige cuánto duró una pausa. NO los instantes: el momento lo puso el
 * servidor y lo sigue poniendo. Motivo obligatorio, que exige la base.
 */
export async function ajustarPausa(
  pausaId: string,
  minutos: number,
  motivo: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('presencia_pausa_ajustar', {
    p_pausa_id: pausaId,
    p_minutos: minutos,
    p_motivo: motivo,
  })
  return { error: error ? error.message : null }
}

/** Anula una pausa: queda visible y marcada, fuera del cómputo. Exige `.delete`. */
export async function anularPausa(
  pausaId: string,
  motivo: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('presencia_pausa_anular', {
    p_pausa_id: pausaId,
    p_motivo: motivo,
  })
  return { error: error ? error.message : null }
}

/**
 * Agrega la pausa que la persona no marcó. Nace sin instantes a propósito: se
 * declara cuánto duró, no a qué hora fue, porque eso último nadie lo sabe.
 */
export async function agregarPausa(params: {
  registroId: string
  tipo: string
  minutos: number
  motivo: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('presencia_pausa_agregar', {
    p_registro_id: params.registroId,
    p_tipo: params.tipo,
    p_minutos: params.minutos,
    p_motivo: params.motivo,
  })
  return { error: error ? error.message : null }
}

/** Da de alta o actualiza un tipo de pausa de la empresa. Exige `.edit`. */
export async function guardarTipoPausa(params: {
  codigo: string
  etiqueta: string
  descuenta: boolean
  minutosMax: number | null
  activo?: boolean
}): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('presencia_tipos_pausa_guardar', {
    p_codigo: params.codigo,
    p_etiqueta: params.etiqueta,
    p_descuenta: params.descuenta,
    p_minutos_max: params.minutosMax,
    p_activo: params.activo ?? true,
  })
  return { error: error ? error.message : null }
}

/** Las pausas que cuentan: ni anuladas, ni todavía abiertas. */
export function pausasVigentes(pausas: PausaPresencia[]): PausaPresencia[] {
  return pausas.filter(p => !p.anulado_en && p.minutos !== null)
}

/** Minutos pausados: total y la parte que descuenta. Gemelo de `presencia_minutos_pausa`. */
export function minutosPausa(pausas: PausaPresencia[]): { total: number; descontables: number } {
  return pausasVigentes(pausas).reduce(
    (acc, p) => ({
      total: acc.total + (p.minutos ?? 0),
      descontables: acc.descontables + (p.descuenta ? p.minutos ?? 0 : 0),
    }),
    { total: 0, descontables: 0 },
  )
}

/**
 * Estadía, descanso y horas laborales de una jornada.
 *
 * `laborales` nunca baja de cero: una pausa mal ajustada no puede producir
 * horas negativas en una planilla. Es el mismo `GREATEST(0, …)` que aplica
 * `calcular_horas_personal` — los dos lados tienen que dar el mismo número.
 */
export function desglose(
  horaEntrada: string | null | undefined,
  horaSalida: string | null | undefined,
  pausas: PausaPresencia[],
): DesgloseJornada {
  const { total, descontables } = minutosPausa(pausas)
  const estadia = horasJornada(horaEntrada, horaSalida)
  const descanso = Math.round((total / 60) * 100) / 100
  const laborales =
    estadia === null ? null : Math.max(0, Math.round((estadia - descontables / 60) * 100) / 100)
  return { estadia, descanso, laborales }
}
